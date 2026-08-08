import { attachmentFormationReport } from "./attachments.mjs";
import {
  defensiveEquipmentBounds,
  defensiveEquipmentDefaultCount,
  defensiveEquipmentEligibleForModel,
  defensiveEquipmentSelectionKey,
} from "./defensive-equipment.mjs";
import { catalogueModelComposition } from "./catalogue-models.mjs";

export function catalogueModelSegments(unit, modelCount, loadoutSubjectCounts = {}) {
  const composition = catalogueModelComposition(unit, modelCount, loadoutSubjectCounts);
  return {
    exact: composition.exact,
    segments: (unit?.models ?? [])
      .map((model, index) => ({ model, modelCount: composition.counts[index] ?? 0 }))
      .filter((segment) => segment.modelCount > 0),
  };
}

export function bodyguardJoinerOptions(catalogue, bodyguard) {
  if (!bodyguard) return [];
  return (catalogue?.units ?? []).filter((unit) =>
    (unit.bodyguardJoinOptions ?? []).some((option) => option.bodyguardId === bodyguard.id),
  );
}

function modelRoleOrder(role) {
  if (role === "bodyguard") return 0;
  if (role === "joined") return 1;
  if (role === "leader") return 2;
  return 0;
}

export function savedFormationGroups(catalogue, armyList) {
  const units = armyList?.units ?? [];
  const report = attachmentFormationReport(catalogue, armyList);
  const parents = new Map(units.map((unit) => [unit.id, unit.id]));
  const find = (id) => {
    const parent = parents.get(id);
    if (!parent || parent === id) return parent;
    const root = find(parent);
    parents.set(id, root);
    return root;
  };
  const unite = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot && rightRoot && leftRoot !== rightRoot) parents.set(leftRoot, rightRoot);
  };
  for (const attachment of report.attachments) {
    unite(attachment.leaderUnit.id, attachment.bodyguardUnit.id);
  }
  for (const join of report.joins) unite(join.joinerUnit.id, join.bodyguardUnit.id);

  const bodyguardIds = new Set([
    ...report.attachments.map((entry) => entry.bodyguardUnit.id),
    ...report.joins.map((entry) => entry.bodyguardUnit.id),
  ]);
  const leaderIds = new Set(report.attachments.map((entry) => entry.leaderUnit.id));
  const joinerIds = new Set(report.joins.map((entry) => entry.joinerUnit.id));
  const groups = new Map();
  for (const unit of units) {
    const key = find(unit.id) ?? unit.id;
    const group = groups.get(key) ?? [];
    group.push(unit);
    groups.set(key, group);
  }
  const catalogueUnits = new Map((catalogue?.units ?? []).map((unit) => [unit.id, unit]));
  const result = [];
  for (const members of groups.values()) {
    const root = members.find((unit) => bodyguardIds.has(unit.id)) ?? members[0];
    const components = members
      .map((unit) => ({
        unit,
        catalogueUnit: catalogueUnits.get(unit.unitId),
        role: leaderIds.has(unit.id)
          ? "leader"
          : joinerIds.has(unit.id)
            ? "joined"
            : members.length > 1
              ? "bodyguard"
              : "standalone",
      }))
      .sort(
        (left, right) =>
          modelRoleOrder(left.role) - modelRoleOrder(right.role) ||
          units.indexOf(left.unit) - units.indexOf(right.unit),
      );
    result.push({
      id: root.id,
      root,
      components,
      name: components.map((component) => component.unit.name).join(" + "),
      modelCount: components.reduce((total, component) => total + component.unit.modelCount, 0),
      attached: components.some((component) => report.attachedUnitIds.has(component.unit.id)),
    });
  }
  return result.sort((left, right) => units.indexOf(left.root) - units.indexOf(right.root));
}

export function savedFormationForUnit(catalogue, armyList, savedUnitId) {
  return savedFormationGroups(catalogue, armyList).find((group) =>
    group.components.some((component) => component.unit.id === savedUnitId),
  );
}

export function savedFormationModelSegments(formation) {
  const segments = [];
  const ambiguousComponents = [];
  for (const component of formation?.components ?? []) {
    const models = catalogueModelSegments(
      component.catalogueUnit,
      component.unit.modelCount,
      component.unit.loadoutSubjectCounts,
    );
    if (models.segments.length === 0) continue;
    const composition = models;
    if (!composition.exact) ambiguousComponents.push(component.unit.name);
    for (const { model, modelCount } of models.segments) {
      segments.push({
        id: `${component.unit.id}:${model.id}`,
        savedUnitId: component.unit.id,
        unitName: component.unit.name,
        role: component.role,
        model,
        modelCount,
      });
    }
  }
  return { segments, ambiguousComponents };
}

export function savedUnitDefensiveEquipmentDefaults(savedUnit, catalogueUnit) {
  const stored = savedUnit?.defensiveEquipmentCounts;
  const defaults = {};
  const modelSegments = catalogueModelSegments(
    catalogueUnit,
    savedUnit?.modelCount ?? 0,
    savedUnit?.loadoutSubjectCounts,
  ).segments;
  for (const option of catalogueUnit?.defensiveEquipment ?? []) {
    const sourceDefault = defensiveEquipmentDefaultCount(option, savedUnit);
    if (option.scope === "unit") {
      const key = defensiveEquipmentSelectionKey(savedUnit.id, null, option.id);
      if ((stored?.[key] ?? (stored === undefined ? sourceDefault : 0)) > 0) defaults[key] = 1;
      continue;
    }
    const legacyKeys = new Set(
      modelSegments
        .filter((segment) => defensiveEquipmentEligibleForModel(option, segment.model.id))
        .map((segment) => segment.model.sourceModelId)
        .filter((modelId) => modelId !== undefined)
        .map((modelId) => defensiveEquipmentSelectionKey(savedUnit.id, modelId, option.id)),
    );
    let remainingDefault =
      stored === undefined
        ? sourceDefault
        : [...legacyKeys].reduce((total, key) => total + (stored[key] ?? 0), 0);
    for (const segment of modelSegments) {
      if (!defensiveEquipmentEligibleForModel(option, segment.model.id)) continue;
      const key = defensiveEquipmentSelectionKey(savedUnit.id, segment.model.id, option.id);
      const count = Math.min(segment.modelCount, stored?.[key] ?? remainingDefault);
      if (count > 0) defaults[key] = count;
      if (stored?.[key] === undefined) remainingDefault -= count;
    }
  }
  return defaults;
}

export function savedUnitDefensiveEquipmentWarnings(savedUnit, catalogueUnit) {
  if (!savedUnit || !catalogueUnit) return [];
  const effective =
    savedUnit.defensiveEquipmentCounts === undefined
      ? savedUnitDefensiveEquipmentDefaults(savedUnit, catalogueUnit)
      : savedUnit.defensiveEquipmentCounts;
  const segments = catalogueModelSegments(
    catalogueUnit,
    savedUnit.modelCount,
    savedUnit.loadoutSubjectCounts,
  ).segments;
  const knownKeys = new Set();
  const warnings = [];
  for (const option of catalogueUnit.defensiveEquipment ?? []) {
    let count = 0;
    let eligibleModelCount = 0;
    if (option.scope === "unit") {
      const key = defensiveEquipmentSelectionKey(savedUnit.id, null, option.id);
      knownKeys.add(key);
      count = effective[key] ?? 0;
      eligibleModelCount = savedUnit.modelCount;
    } else {
      const legacyKeys = new Set();
      for (const segment of segments) {
        if (!defensiveEquipmentEligibleForModel(option, segment.model.id)) continue;
        const key = defensiveEquipmentSelectionKey(savedUnit.id, segment.model.id, option.id);
        knownKeys.add(key);
        count += effective[key] ?? 0;
        eligibleModelCount += segment.modelCount;
        if (segment.model.sourceModelId !== undefined) {
          legacyKeys.add(
            defensiveEquipmentSelectionKey(savedUnit.id, segment.model.sourceModelId, option.id),
          );
        }
      }
      for (const key of legacyKeys) {
        knownKeys.add(key);
        count += effective[key] ?? 0;
      }
    }
    const { minimum, maximum } = defensiveEquipmentBounds(option, savedUnit, eligibleModelCount);
    let message = null;
    if (count < minimum) {
      message = `${option.name}: ${count} equipped is below the required source minimum of ${minimum}`;
    } else if (count > maximum) {
      message = `${option.name}: ${count} equipped exceeds the source maximum of ${maximum} for ${savedUnit.modelCount} models`;
    }
    if (message) {
      warnings.push({
        key: option.id,
        optionId: option.id,
        message,
        source: option.limitSource,
        exact: option.limitExact,
        reason: savedUnit.defensiveEquipmentOverrides?.[option.id] ?? null,
      });
    }
  }
  for (const [key, value] of Object.entries(savedUnit.defensiveEquipmentCounts ?? {})) {
    if (!key.startsWith(`${savedUnit.id}::`) || value <= 0 || knownKeys.has(key)) continue;
    const warningKey = `unknown:${key}`;
    warnings.push({
      key: warningKey,
      optionId: null,
      message: `Unknown or ineligible defensive-equipment selection: ${key}`,
      source: null,
      exact: true,
      reason: savedUnit.defensiveEquipmentOverrides?.[warningKey] ?? null,
    });
  }
  return warnings;
}

export function savedFormationDefensiveEquipmentDefaults(formation) {
  return Object.assign(
    {},
    ...(formation?.components ?? []).map((component) =>
      savedUnitDefensiveEquipmentDefaults(component.unit, component.catalogueUnit),
    ),
  );
}

export function savedFormationTargetSequence(
  formation,
  firstSegmentId = "",
  defensiveEquipmentCounts = {},
) {
  const composition = savedFormationModelSegments(formation);
  const effectiveEquipmentCounts = Object.assign(
    {},
    ...(formation?.components ?? []).map((component) =>
      savedUnitDefensiveEquipmentDefaults(
        { ...component.unit, defensiveEquipmentCounts },
        component.catalogueUnit,
      ),
    ),
  );
  const unitEquipmentIds = (formation?.components ?? []).flatMap((component) =>
    (component.catalogueUnit?.defensiveEquipment ?? [])
      .filter(
        (option) =>
          option.scope === "unit" &&
          (effectiveEquipmentCounts[
            defensiveEquipmentSelectionKey(component.unit.id, null, option.id)
          ] ?? 0) > 0,
      )
      .map((option) => option.id),
  );
  const segments = [];
  for (const segment of composition.segments) {
    const component = (formation?.components ?? []).find(
      (candidate) => candidate.unit.id === segment.savedUnitId,
    );
    const bearerSelections = (component?.catalogueUnit?.defensiveEquipment ?? [])
      .filter(
        (option) =>
          option.scope === "bearer" && defensiveEquipmentEligibleForModel(option, segment.model.id),
      )
      .map((option) => ({
        option,
        count:
          effectiveEquipmentCounts[
            defensiveEquipmentSelectionKey(segment.savedUnitId, segment.model.id, option.id)
          ] ?? 0,
      }))
      .filter((selection) => selection.count > 0);
    if (bearerSelections.length > 1) {
      composition.ambiguousComponents.push(
        `${segment.unitName} has overlapping bearer equipment selections`,
      );
    }
    const bearer = bearerSelections[0];
    const equippedCount = Math.min(segment.modelCount, bearer?.count ?? 0);
    if (equippedCount > 0) {
      segments.push({
        ...segment,
        id: `${segment.id}:equipment:${bearer.option.id}`,
        modelCount: equippedCount,
        defensiveEquipmentIds: [...unitEquipmentIds, bearer.option.id],
      });
    }
    if (segment.modelCount > equippedCount) {
      segments.push({
        ...segment,
        id: equippedCount > 0 ? `${segment.id}:unequipped` : segment.id,
        modelCount: segment.modelCount - equippedCount,
        defensiveEquipmentIds: [...unitEquipmentIds],
      });
    }
  }
  const hasProtectedLeader = segments.some((segment) => segment.role !== "leader");
  const allocationOptions = segments.filter(
    (segment) => !hasProtectedLeader || segment.role !== "leader",
  );
  const first =
    allocationOptions.find((segment) => segment.id === firstSegmentId) ??
    allocationOptions.find((segment) => {
      if (segment.model.sourceModelId === undefined) return false;
      const legacyBase = `${segment.savedUnitId}:${segment.model.sourceModelId}`;
      if (firstSegmentId === legacyBase) return true;
      return (
        firstSegmentId.startsWith(`${legacyBase}:`) &&
        segment.id.endsWith(firstSegmentId.slice(legacyBase.length))
      );
    }) ??
    allocationOptions[0];
  const orderedSegments = first
    ? [first, ...segments.filter((segment) => segment.id !== first.id)]
    : [];
  return {
    ...composition,
    allocationOptions,
    first,
    orderedSegments,
    targets: orderedSegments.map((segment) => ({
      keywords: segment.model.keywords,
      toughness: segment.model.t ?? 8,
      save: segment.model.save ?? 7,
      invulnerable: segment.model.invuln ?? 0,
      feelNoPain: segment.model.feelNoPain ?? 0,
      wounds: segment.model.wounds ?? 1,
      reduction: segment.model.reduction ?? 0,
      damageDivisor: segment.model.damageDivisor ?? 1,
      firstFailedSaveDamageReplacement: null,
      allocatedAttackDamageReplacement: 0,
      allocatedAttackDamageReplacementUses: 0,
      allocatedAttackDamageReplacementSkip: 0,
      modelCount: segment.modelCount,
      defensiveEquipmentIds: segment.defensiveEquipmentIds,
    })),
  };
}
