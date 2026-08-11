export const RULE_COVERAGE_SCHEMA_VERSION = 1;
export const RULE_COVERAGE_STATUS = Object.freeze({
  executable: 1,
  guided: 2,
  irrelevant: 3,
  unsupported: 4,
});

const CATEGORIES = Object.freeze([
  "core",
  "faction",
  "detachment",
  "enhancement",
  "datasheet",
  "stratagem",
  "terrain",
  "mission",
]);
const STATUS_NAMES = Object.freeze(Object.keys(RULE_COVERAGE_STATUS));

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function boundedString(value, message, maximum = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(message);
  }
  return value.trim();
}

function coverageStatus(value, message) {
  if (!STATUS_NAMES.includes(value)) throw new Error(message);
  return value;
}

function normalizeSourceManifest(value) {
  const body = object(value, "Battle rule source manifest must be an object");
  if (!Array.isArray(body.sources) || body.sources.length === 0) {
    throw new Error("Battle rule source manifest must contain sources");
  }
  return new Map(
    body.sources.map((sourceValue) => {
      const source = object(sourceValue, "Each battle rule source must be an object");
      const id = boundedString(source.id, "Each battle rule source must have an id");
      const sha256 = boundedString(source.sha256, `Source ${id} must have a checksum`, 64);
      if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Source ${id} checksum is invalid`);
      if (!Array.isArray(source.pages) || source.pages.some((page) => !Number.isInteger(page))) {
        throw new Error(`Source ${id} pages are invalid`);
      }
      const recordTypes = source.recordTypes ?? [];
      if (
        !Array.isArray(recordTypes) ||
        recordTypes.some((type) => !CATEGORIES.includes(type)) ||
        new Set(recordTypes).size !== recordTypes.length
      ) {
        throw new Error(`Source ${id} record types are invalid`);
      }
      return [id, { sha256, pages: new Set(source.pages), recordTypes: new Set(recordTypes) }];
    }),
  );
}

export function normalizeRuleCoverageMatrix(value, sourceManifest) {
  const body = object(value, "Rule coverage matrix must be an object");
  if (body.schemaVersion !== RULE_COVERAGE_SCHEMA_VERSION) {
    throw new Error("Rule coverage matrix schema is unsupported");
  }
  const snapshotId = boundedString(body.snapshotId, "Rule coverage snapshot id is required");
  const edition = boundedString(body.edition, "Rule coverage edition is required");
  const updatedAt = boundedString(body.updatedAt, "Rule coverage update date is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) {
    throw new Error("Rule coverage update date is invalid");
  }
  const manifest = normalizeSourceManifest(sourceManifest);
  if (!Array.isArray(body.sourceLocks) || body.sourceLocks.length !== manifest.size) {
    throw new Error("Rule coverage source locks do not cover the source manifest");
  }
  const sourceLockIds = new Set();
  const sourceLocks = body.sourceLocks.map((lockValue) => {
    const lock = object(lockValue, "Each rule coverage source lock must be an object");
    const id = boundedString(lock.id, "Each rule coverage source lock must have an id");
    const sha256 = boundedString(lock.sha256, `Source lock ${id} must have a checksum`, 64);
    if (sourceLockIds.has(id)) throw new Error(`Source lock ${id} is duplicated`);
    sourceLockIds.add(id);
    const source = manifest.get(id);
    if (!source || source.sha256 !== sha256) {
      throw new Error(`Source lock ${id} does not match the source manifest`);
    }
    return { id, sha256 };
  });
  if ([...manifest.keys()].some((id) => !sourceLockIds.has(id))) {
    throw new Error("Rule coverage source locks do not cover the source manifest");
  }
  if (
    !Array.isArray(body.statuses) ||
    body.statuses.length !== STATUS_NAMES.length ||
    STATUS_NAMES.some((status) => !body.statuses.includes(status))
  ) {
    throw new Error("Rule coverage statuses are incomplete");
  }
  const defaultsValue = object(
    body.categoryDefaults,
    "Rule coverage category defaults are required",
  );
  const categoryDefaults = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      coverageStatus(defaultsValue[category], `Category ${category} must have a default status`),
    ]),
  );
  if (Object.keys(defaultsValue).some((category) => !CATEGORIES.includes(category))) {
    throw new Error("Rule coverage contains an unknown category default");
  }
  if (!Array.isArray(body.rules)) throw new Error("Rule coverage rules must be an array");
  const ruleIds = new Set();
  const rules = body.rules.map((ruleValue) => {
    const rule = object(ruleValue, "Each rule coverage entry must be an object");
    const id = boundedString(rule.id, "Each rule coverage entry must have an id");
    if (!/^[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9.-]*$/.test(id)) {
      throw new Error(`Rule coverage id ${id} is invalid`);
    }
    if (ruleIds.has(id)) throw new Error(`Rule coverage id ${id} is duplicated`);
    ruleIds.add(id);
    if (!CATEGORIES.includes(rule.category) || !id.startsWith(`${rule.category}.`)) {
      throw new Error(`Rule coverage category for ${id} is invalid`);
    }
    const name = boundedString(rule.name, `Rule coverage name for ${id} is required`);
    const status = coverageStatus(rule.status, `Rule coverage status for ${id} is invalid`);
    if (
      !Number.isInteger(rule.introducedBattleStateVersion) ||
      rule.introducedBattleStateVersion < 0 ||
      rule.introducedBattleStateVersion > 100000
    ) {
      throw new Error(`Rule coverage battle-state version for ${id} is invalid`);
    }
    if (!Array.isArray(rule.sources) || rule.sources.length === 0) {
      throw new Error(`Rule coverage sources for ${id} are required`);
    }
    const sources = rule.sources.map((sourceValue) => {
      const source = object(sourceValue, `Rule coverage source for ${id} is invalid`);
      const sourceId = boundedString(source.id, `Rule coverage source for ${id} needs an id`);
      const locked = manifest.get(sourceId);
      if (!locked || !sourceLockIds.has(sourceId)) {
        throw new Error(`Rule coverage source ${sourceId} for ${id} is not locked`);
      }
      const pages = source.pages ?? [];
      const records = source.records ?? [];
      if (
        !Array.isArray(pages) ||
        !Array.isArray(records) ||
        (pages.length === 0 && records.length === 0)
      ) {
        throw new Error(`Rule coverage locators for ${id} are required`);
      }
      if (pages.some((page) => !Number.isInteger(page) || !locked.pages.has(page))) {
        throw new Error(`Rule coverage pages for ${id} are outside the source manifest`);
      }
      const normalizedRecords = records.map((recordValue) => {
        const record = object(recordValue, `Rule coverage record for ${id} is invalid`);
        const type = boundedString(record.type, `Rule coverage record for ${id} needs a type`);
        const recordId = boundedString(record.id, `Rule coverage record for ${id} needs an id`);
        if (!locked.recordTypes.has(type) || type !== rule.category) {
          throw new Error(`Rule coverage record for ${id} is outside the source manifest`);
        }
        return { type, id: recordId };
      });
      if (
        new Set(normalizedRecords.map((record) => `${record.type}:${record.id}`)).size !==
        normalizedRecords.length
      ) {
        throw new Error(`Rule coverage records for ${id} are duplicated`);
      }
      return {
        id: sourceId,
        ...(pages.length ? { pages: [...new Set(pages)] } : {}),
        ...(normalizedRecords.length ? { records: normalizedRecords } : {}),
      };
    });
    return {
      id,
      category: rule.category,
      name,
      status,
      introducedBattleStateVersion: rule.introducedBattleStateVersion,
      sources,
    };
  });
  return {
    schemaVersion: RULE_COVERAGE_SCHEMA_VERSION,
    snapshotId,
    edition,
    updatedAt,
    sourceLocks,
    statuses: [...STATUS_NAMES],
    categoryDefaults,
    rules,
    sourceLocked: true,
  };
}

export function ruleCoverageIsPermitted(status, sourceLocked, acknowledgement = "") {
  const code = typeof status === "number" ? status : (RULE_COVERAGE_STATUS[status] ?? 0);
  if (!sourceLocked) return false;
  if (code === RULE_COVERAGE_STATUS.executable || code === RULE_COVERAGE_STATUS.irrelevant) {
    return true;
  }
  return code === RULE_COVERAGE_STATUS.guided && Boolean(acknowledgement.trim());
}

export function assessRuleCoverage(matrix, requests) {
  if (!matrix?.sourceLocked || !Array.isArray(matrix.rules)) {
    throw new Error("A normalized source-locked rule coverage matrix is required");
  }
  if (!Array.isArray(requests) || requests.length > 1000) {
    throw new Error("Rule coverage requests must be an array with at most 1000 entries");
  }
  const rules = new Map(matrix.rules.map((rule) => [rule.id, rule]));
  const seen = new Set();
  const results = requests.map((requestValue) => {
    const request =
      typeof requestValue === "string"
        ? { id: requestValue, acknowledgement: "" }
        : object(requestValue, "Each rule coverage request must be a string or object");
    const id = boundedString(request.id, "Each rule coverage request must have an id");
    if (seen.has(id)) throw new Error(`Rule coverage request ${id} is duplicated`);
    seen.add(id);
    if (
      request.acknowledgement !== undefined &&
      (typeof request.acknowledgement !== "string" || request.acknowledgement.length > 500)
    ) {
      throw new Error(`Rule coverage acknowledgement for ${id} is invalid`);
    }
    const acknowledgement = request.acknowledgement?.trim() ?? "";
    const rule = rules.get(id);
    const category = CATEGORIES.find((candidate) => id.startsWith(`${candidate}.`)) ?? "unknown";
    const status = rule?.status ?? matrix.categoryDefaults[category] ?? "unsupported";
    const permitted = Boolean(rule) && ruleCoverageIsPermitted(status, true, acknowledgement);
    return {
      id,
      category: rule?.category ?? category,
      name: rule?.name ?? id,
      status,
      sourceLocked: Boolean(rule),
      acknowledgementRequired: status === "guided",
      acknowledged: Boolean(acknowledgement),
      permitted,
      reason: rule
        ? permitted
          ? "covered"
          : status === "guided"
            ? "guided rule requires a reason-backed player acknowledgement"
            : "rule is explicitly unsupported"
        : "rule is absent from the source-locked coverage matrix",
    };
  });
  return {
    snapshotId: matrix.snapshotId,
    permitted: results.every((entry) => entry.permitted),
    results,
  };
}
