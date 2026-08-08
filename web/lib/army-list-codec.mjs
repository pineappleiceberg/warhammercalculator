export const ARMY_LIST_BACKUP_KIND = "warhammer-calculator-army-lists";
export const ARMY_LIST_BACKUP_VERSION = 1;

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function integer(value, minimum, maximum, message) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(message);
  return value;
}

export function normalizeArmyListInput(value) {
  const body = object(value, "Army list must be a JSON object");
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) {
    throw new Error("name must contain 1 to 100 characters");
  }
  if (typeof body.factionId !== "string" || !body.factionId || body.factionId.length > 100) {
    throw new Error("factionId is required");
  }
  if (!Array.isArray(body.units) || body.units.length > 100) {
    throw new Error("units must be an array containing at most 100 entries");
  }
  const units = body.units.map((candidate) => {
    const unit = object(candidate, "Each unit must be a JSON object");
    if (
      typeof unit.id !== "string" ||
      !unit.id ||
      unit.id.length > 100 ||
      typeof unit.unitId !== "string" ||
      !unit.unitId ||
      unit.unitId.length > 100 ||
      typeof unit.name !== "string" ||
      !unit.name ||
      unit.name.length > 200 ||
      !Array.isArray(unit.weapons) ||
      unit.weapons.length > 200
    ) {
      throw new Error("Each unit must have an id, unitId, name, model count, and weapons");
    }
    const modelCount = integer(
      unit.modelCount,
      1,
      1000,
      "Each unit must have an id, unitId, name, model count, and weapons",
    );
    let choiceSelections;
    if (unit.choiceSelections !== undefined) {
      const selections = object(unit.choiceSelections, "choiceSelections must be an object");
      if (
        Object.keys(selections).length > 500 ||
        Object.keys(selections).some((key) => !key || key.length > 200)
      ) {
        throw new Error("choiceSelections contains too many or invalid entries");
      }
      choiceSelections = Object.fromEntries(
        Object.entries(selections).map(([key, count]) => [
          key,
          integer(count, 0, 100, "choiceSelections values must be integers from 0 to 100"),
        ]),
      );
    }
    let loadoutSubjectCounts;
    if (unit.loadoutSubjectCounts !== undefined) {
      const counts = object(unit.loadoutSubjectCounts, "loadoutSubjectCounts must be an object");
      if (
        Object.keys(counts).length > 100 ||
        Object.keys(counts).some((key) => !key || key.length > 200)
      ) {
        throw new Error("loadoutSubjectCounts contains too many or invalid entries");
      }
      loadoutSubjectCounts = Object.fromEntries(
        Object.entries(counts).map(([key, count]) => [
          key,
          integer(count, 0, 1000, "loadoutSubjectCounts values must be integers from 0 to 1000"),
        ]),
      );
    }
    let combatPresetIds;
    if (unit.combatPresetIds !== undefined) {
      if (
        !Array.isArray(unit.combatPresetIds) ||
        unit.combatPresetIds.length > 100 ||
        unit.combatPresetIds.some((id) => typeof id !== "string" || !id || id.length > 200)
      ) {
        throw new Error("combatPresetIds must contain at most 100 valid preset ids");
      }
      combatPresetIds = [...new Set(unit.combatPresetIds)];
    }
    let transportId;
    if (unit.transportId !== undefined) {
      if (
        typeof unit.transportId !== "string" ||
        !unit.transportId ||
        unit.transportId.length > 100 ||
        unit.transportId === unit.id
      ) {
        throw new Error("transportId must reference a different saved unit");
      }
      transportId = unit.transportId;
    }
    let attachedToId;
    if (unit.attachedToId !== undefined) {
      if (
        typeof unit.attachedToId !== "string" ||
        !unit.attachedToId ||
        unit.attachedToId.length > 100 ||
        unit.attachedToId === unit.id
      ) {
        throw new Error("attachedToId must reference a different saved unit");
      }
      attachedToId = unit.attachedToId;
    }
    let joinedToId;
    if (unit.joinedToId !== undefined) {
      if (
        typeof unit.joinedToId !== "string" ||
        !unit.joinedToId ||
        unit.joinedToId.length > 100 ||
        unit.joinedToId === unit.id
      ) {
        throw new Error("joinedToId must reference a different saved unit");
      }
      joinedToId = unit.joinedToId;
    }
    const weapons = unit.weapons.map((candidateWeapon) => {
      const weapon = object(candidateWeapon, "Each weapon must be a JSON object");
      if (
        typeof weapon.name !== "string" ||
        !weapon.name ||
        weapon.name.length > 200 ||
        (weapon.groupId !== undefined &&
          (typeof weapon.groupId !== "string" || weapon.groupId.length > 200))
      ) {
        throw new Error("Each weapon must have a profile id, name, and 0 to 100 equipped copies");
      }
      const weaponId = integer(
        weapon.weaponId,
        1,
        Number.MAX_SAFE_INTEGER,
        "Each weapon must have a profile id, name, and 0 to 100 equipped copies",
      );
      const count = integer(
        weapon.count,
        0,
        100,
        "Each weapon must have a profile id, name, and 0 to 100 equipped copies",
      );
      const normalized = { weaponId, name: weapon.name, count };
      if (weapon.groupId !== undefined) normalized.groupId = weapon.groupId;
      if (weapon.optionCount !== undefined) {
        normalized.optionCount = integer(
          weapon.optionCount,
          0,
          count,
          "optionCount must be an integer from 0 to the equipped count",
        );
      }
      return normalized;
    });
    const normalized = { id: unit.id, unitId: unit.unitId, name: unit.name, modelCount, weapons };
    if (choiceSelections !== undefined) normalized.choiceSelections = choiceSelections;
    if (loadoutSubjectCounts !== undefined) {
      normalized.loadoutSubjectCounts = loadoutSubjectCounts;
    }
    if (combatPresetIds !== undefined) normalized.combatPresetIds = combatPresetIds;
    if (transportId !== undefined) normalized.transportId = transportId;
    if (attachedToId !== undefined) normalized.attachedToId = attachedToId;
    if (joinedToId !== undefined) normalized.joinedToId = joinedToId;
    return normalized;
  });
  return { name: body.name.trim(), factionId: body.factionId, units };
}

export function normalizeArmyListRecord(value) {
  const body = object(value, "Army list record must be a JSON object");
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
    throw new Error("Imported list id must be a UUID");
  }
  return {
    ...normalizeArmyListInput(body),
    id: body.id,
    createdAt: integer(body.createdAt, 0, Number.MAX_SAFE_INTEGER, "createdAt is invalid"),
    updatedAt: integer(body.updatedAt, 0, Number.MAX_SAFE_INTEGER, "updatedAt is invalid"),
  };
}

export function createArmyListBackup(
  lists,
  exportedAt = new Date().toISOString(),
  profileSourceUpdatedAt = null,
) {
  if (!Array.isArray(lists) || lists.length > 100) {
    throw new Error("A backup can contain at most 100 lists");
  }
  if (Number.isNaN(Date.parse(exportedAt))) throw new Error("exportedAt is invalid");
  if (
    profileSourceUpdatedAt !== null &&
    (typeof profileSourceUpdatedAt !== "string" ||
      !profileSourceUpdatedAt ||
      profileSourceUpdatedAt.length > 100)
  ) {
    throw new Error("profileSourceUpdatedAt is invalid");
  }
  return {
    kind: ARMY_LIST_BACKUP_KIND,
    version: ARMY_LIST_BACKUP_VERSION,
    exportedAt,
    profileSourceUpdatedAt,
    lists: lists.map(normalizeArmyListRecord),
  };
}

export function parseArmyListBackup(value) {
  const backup = object(value, "Backup must be a JSON object");
  if (backup.kind !== ARMY_LIST_BACKUP_KIND) {
    throw new Error("This is not a Warhammer Calculator army-list backup");
  }
  if (backup.version !== ARMY_LIST_BACKUP_VERSION) {
    throw new Error(`Unsupported army-list backup version: ${String(backup.version)}`);
  }
  return createArmyListBackup(
    backup.lists,
    backup.exportedAt,
    backup.profileSourceUpdatedAt ?? null,
  );
}

export function mergeArmyListRecords(cloudLists, cachedLists, deletedIds = []) {
  if (!Array.isArray(cloudLists) || !Array.isArray(cachedLists) || !Array.isArray(deletedIds)) {
    throw new Error("List synchronization inputs must be arrays");
  }
  const deleted = new Set(deletedIds);
  const merged = new Map();
  for (const candidate of cloudLists) {
    const record = normalizeArmyListRecord(candidate);
    if (!deleted.has(record.id)) merged.set(record.id, record);
  }
  for (const candidate of cachedLists) {
    const record = normalizeArmyListRecord(candidate);
    const current = merged.get(record.id);
    if (!deleted.has(record.id) && (!current || record.updatedAt > current.updatedAt)) {
      merged.set(record.id, record);
    }
  }
  if (merged.size > 100) throw new Error("Cloud storage supports at most 100 army lists");
  return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}
