import { normalizeSupportUses } from "./support-uses.mjs";
import { normalizeDefensiveEquipmentCounts } from "./defensive-equipment.mjs";

export const PLAY_RECOVERY_KEY = "warhammer-calculator:play-state:v1";
export const PLAY_RECOVERY_VERSION = 1;

const selectorKeys = [
  "attackerListId",
  "targetListId",
  "attackerUnitId",
  "targetUnitId",
  "weaponId",
  "profileId",
  "targetModelId",
  "supportUnitId",
  "targetSupportUnitId",
];

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

export function createPlayRecovery(state, savedAt = Date.now()) {
  const value = object(state, "Play recovery state must be an object");
  const recovery = { version: PLAY_RECOVERY_VERSION, savedAt };
  if (!Number.isSafeInteger(savedAt) || savedAt < 0) throw new Error("savedAt is invalid");
  for (const key of selectorKeys) {
    const selected =
      key === "supportUnitId" || key === "targetSupportUnitId" ? (value[key] ?? "") : value[key];
    if (typeof selected !== "string" || selected.length > 100) {
      throw new Error(`${key} must be a string of at most 100 characters`);
    }
    recovery[key] = selected;
  }
  for (const key of [
    "activeAttackerPresetIds",
    "activeTargetPresetIds",
    "activeSupportPresetIds",
    "activeTargetSupportPresetIds",
  ]) {
    const ids = value[key] ?? [];
    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string" || !id || id.length > 200)
    ) {
      throw new Error(`${key} must contain at most 100 valid preset ids`);
    }
    recovery[key] = [...new Set(ids)];
  }
  const firingDeckModels = value.firingDeckModels ?? 1;
  if (!Number.isSafeInteger(firingDeckModels) || firingDeckModels < 1 || firingDeckModels > 1000) {
    throw new Error("firingDeckModels must be an integer from 1 to 1000");
  }
  if (
    value.firingDeckPassengerAlreadyShot !== undefined &&
    typeof value.firingDeckPassengerAlreadyShot !== "boolean"
  ) {
    throw new Error("firingDeckPassengerAlreadyShot must be true or false");
  }
  recovery.firingDeckModels = firingDeckModels;
  recovery.firingDeckPassengerAlreadyShot = value.firingDeckPassengerAlreadyShot ?? false;
  const profile = object(value.profile, "profile must be an object");
  recovery.profile = {
    ...profile,
    targetClosestEligible: profile.targetClosestEligible ?? false,
    attackerSourceTargetDistance: profile.attackerSourceTargetDistance ?? 0,
    targetSourceAttackerDistance: profile.targetSourceAttackerDistance ?? 0,
    attackerSourceCanSeeTarget: profile.attackerSourceCanSeeTarget ?? false,
    targetSourceCanSeeAttacker: profile.targetSourceCanSeeAttacker ?? false,
  };
  recovery.supportUsesSpent = normalizeSupportUses(value.supportUsesSpent ?? {});
  recovery.targetDefensiveEquipmentCounts = normalizeDefensiveEquipmentCounts(
    value.targetDefensiveEquipmentCounts ?? {},
  );
  if (!Array.isArray(value.history) || value.history.length > 30) {
    throw new Error("history must contain at most 30 attacks");
  }
  recovery.history = value.history.map((candidate) => {
    const entry = object(candidate, "Each history entry must be an object");
    for (const key of ["id", "attacker", "weapon", "target"]) {
      if (typeof entry[key] !== "string" || !entry[key] || entry[key].length > 200) {
        throw new Error(`History ${key} is invalid`);
      }
    }
    for (const key of ["damage", "successful"]) {
      if (!Number.isSafeInteger(entry[key]) || entry[key] < 0 || entry[key] > 1_000_000) {
        throw new Error(`History ${key} is invalid`);
      }
    }
    return {
      id: entry.id,
      attacker: entry.attacker,
      weapon: entry.weapon,
      target: entry.target,
      damage: entry.damage,
      successful: entry.successful,
    };
  });
  return recovery;
}

export function parsePlayRecovery(value) {
  const recovery = object(value, "Play recovery state must be an object");
  if (recovery.version !== PLAY_RECOVERY_VERSION) {
    throw new Error(`Unsupported play recovery version: ${String(recovery.version)}`);
  }
  return createPlayRecovery(recovery, recovery.savedAt);
}
