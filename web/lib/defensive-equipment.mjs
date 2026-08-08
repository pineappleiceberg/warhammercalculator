export function defensiveEquipmentSelectionKey(savedUnitId, modelId, optionId) {
  return `${savedUnitId}::${modelId ?? "unit"}::${optionId}`;
}

export function normalizeDefensiveEquipmentCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("targetDefensiveEquipmentCounts must be an object");
  }
  const entries = Object.entries(value);
  if (
    entries.length > 500 ||
    entries.some(
      ([key, count]) =>
        !key || key.length > 500 || !Number.isSafeInteger(count) || count < 0 || count > 1000,
    )
  ) {
    throw new Error("targetDefensiveEquipmentCounts contains invalid entries");
  }
  return Object.fromEntries(entries.filter(([, count]) => count > 0));
}

export function applyDefensiveEquipmentProfile(profile, options, selectedIds, attackKeywords = []) {
  const selected = new Set(selectedIds);
  const normalizedAttackKeywords = new Set(attackKeywords.map((keyword) => keyword.toLowerCase()));
  const result = { ...profile };
  for (const option of options) {
    if (!selected.has(option.id)) continue;
    for (const effect of option.effects) {
      if (
        effect.requiredAttackKeyword &&
        !normalizedAttackKeywords.has(effect.requiredAttackKeyword.toLowerCase())
      ) {
        continue;
      }
      if (effect.type === "save_target") result.save = Math.min(result.save, effect.value);
      if (effect.type === "invulnerable_save") {
        result.invulnerable = result.invulnerable
          ? Math.min(result.invulnerable, effect.value)
          : effect.value;
      }
      if (effect.type === "feel_no_pain") {
        result.feelNoPain = result.feelNoPain
          ? Math.min(result.feelNoPain, effect.value)
          : effect.value;
      }
      if (effect.type === "damage_reduction") {
        result.reduction = Math.max(result.reduction, effect.value);
      }
      if (effect.type === "first_failed_save_damage_replacement") {
        result.firstFailedSaveDamageReplacement = effect.value;
      }
    }
  }
  return result;
}

export function applyDefensiveEquipmentTargets(targets, options, attackKeywords = []) {
  return targets.map((target) =>
    applyDefensiveEquipmentProfile(
      target,
      options,
      target.defensiveEquipmentIds ?? [],
      attackKeywords,
    ),
  );
}
