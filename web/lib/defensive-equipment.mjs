export function defensiveEquipmentSelectionKey(savedUnitId, modelId, optionId) {
  return `${savedUnitId}::${modelId ?? "unit"}::${optionId}`;
}

export function defensiveEquipmentEligibleForModel(option, modelId) {
  return !option?.eligibleModelIds?.length || option.eligibleModelIds.includes(modelId);
}

export function defensiveEquipmentSourceDefaultCount(option, savedUnit) {
  const modelCount = Math.max(0, Math.floor(savedUnit?.modelCount ?? 0));
  return Math.min(
    modelCount,
    Math.max(
      0,
      (option?.defaultTerms ?? []).reduce((total, term) => {
        if (term.loadoutSubjectId) {
          return (
            total +
            Math.max(0, Math.floor(savedUnit?.loadoutSubjectCounts?.[term.loadoutSubjectId] ?? 0))
          );
        }
        return (
          total +
          term.fixed +
          term.perModel * modelCount +
          Math.floor(modelCount / term.modelsPerIncrement) * term.perIncrement
        );
      }, 0),
    ),
  );
}

export function defensiveEquipmentDefaultCount(option, savedUnit) {
  const modelCount = Math.max(0, Math.floor(savedUnit?.modelCount ?? 0));
  const sourceDefault = defensiveEquipmentSourceDefaultCount(option, savedUnit);
  const choiceDelta = (option?.choiceLinks ?? []).reduce(
    (total, link) =>
      total +
      Math.max(0, Math.floor(savedUnit?.choiceSelections?.[link.alternativeId] ?? 0)) *
        link.quantityDelta,
    0,
  );
  return Math.min(modelCount, Math.max(0, sourceDefault + choiceDelta));
}

export function defensiveEquipmentBounds(option, savedUnit, eligibleModelCount) {
  const modelCount = Math.max(0, Math.floor(savedUnit?.modelCount ?? 0));
  const eligible = Math.max(0, Math.floor(eligibleModelCount ?? modelCount));
  const sourceDefault = defensiveEquipmentSourceDefaultCount(option, savedUnit);
  const minimum = option?.minimumKind === "default" ? sourceDefault : 0;
  let maximum;
  switch (option?.maximumKind) {
    case "default":
      maximum = sourceDefault;
      break;
    case "per_model":
      maximum = eligible * option.maximumValue;
      break;
    case "per_increment":
      maximum = Math.floor(modelCount / option.maximumModelsPerIncrement) * option.maximumValue;
      break;
    default:
      maximum = option?.maximumValue ?? 1;
  }
  return { minimum, maximum: Math.max(minimum, maximum) };
}

export function normalizeDefensiveEquipmentCounts(
  value,
  fieldName = "targetDefensiveEquipmentCounts",
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  const entries = Object.entries(value);
  if (
    entries.length > 500 ||
    entries.some(
      ([key, count]) =>
        !key || key.length > 500 || !Number.isSafeInteger(count) || count < 0 || count > 1000,
    )
  ) {
    throw new Error(`${fieldName} contains invalid entries`);
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
  const selectedUnitIds = new Set(
    options
      .filter(
        (option) =>
          option.scope === "unit" &&
          targets.some((target) => (target.defensiveEquipmentIds ?? []).includes(option.id)),
      )
      .map((option) => option.id),
  );
  return targets.map((target) =>
    applyDefensiveEquipmentProfile(
      target,
      options,
      [...new Set([...(target.defensiveEquipmentIds ?? []), ...selectedUnitIds])],
      attackKeywords,
    ),
  );
}

export function bearerEquipmentCount(segments, unitId, modelId, optionId) {
  return segments
    .filter(
      (segment) =>
        segment.unitId === unitId &&
        segment.modelId === modelId &&
        segment.defensiveEquipmentIds.includes(optionId),
    )
    .reduce((total, segment) => total + segment.modelCount, 0);
}

export function bearerEquipmentAvailableCount(
  segments,
  unitId,
  modelId,
  optionId,
  bearerOptionIds,
) {
  return segments
    .filter(
      (segment) =>
        segment.unitId === unitId &&
        segment.modelId === modelId &&
        (segment.defensiveEquipmentIds.includes(optionId) ||
          !segment.defensiveEquipmentIds.some((id) => bearerOptionIds.has(id))),
    )
    .reduce((total, segment) => total + segment.modelCount, 0);
}

export function setBearerEquipmentCount(
  segments,
  unitId,
  modelId,
  optionId,
  bearerOptionIds,
  requestedCount,
  maximumSegments = 16,
  createId = () => crypto.randomUUID(),
) {
  const candidateIndices = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (
      segment.unitId === unitId &&
      segment.modelId === modelId &&
      (segment.defensiveEquipmentIds.includes(optionId) ||
        !segment.defensiveEquipmentIds.some((id) => bearerOptionIds.has(id)))
    ) {
      candidateIndices.push(index);
    }
  }
  if (candidateIndices.length === 0) return segments;
  const candidates = candidateIndices.map((index) => segments[index]);
  const total = candidates.reduce((sum, segment) => sum + segment.modelCount, 0);
  const equippedCount = Math.min(total, Math.max(0, Math.floor(requestedCount)));
  const unequippedCount = total - equippedCount;
  const equippedTemplate = candidates.find((segment) =>
    segment.defensiveEquipmentIds.includes(optionId),
  );
  const unequippedTemplate = candidates.find(
    (segment) => !segment.defensiveEquipmentIds.includes(optionId),
  );
  const baseTemplate = equippedTemplate ?? unequippedTemplate ?? candidates[0];
  const makeSegment = (template, modelCount, equipped) => ({
    ...baseTemplate,
    ...template,
    id: template ? template.id : createId(),
    modelCount,
    defensiveEquipmentIds: equipped
      ? [...new Set([...baseTemplate.defensiveEquipmentIds, optionId])]
      : baseTemplate.defensiveEquipmentIds.filter((id) => id !== optionId),
  });
  const equipped = equippedCount > 0 ? makeSegment(equippedTemplate, equippedCount, true) : null;
  const unequipped =
    unequippedCount > 0 ? makeSegment(unequippedTemplate, unequippedCount, false) : null;
  const candidateSet = new Set(candidateIndices);
  const next = [];
  let placedEquipped = false;
  let placedUnequipped = false;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!candidateSet.has(index)) {
      next.push(segment);
      continue;
    }
    if (segment.defensiveEquipmentIds.includes(optionId)) {
      if (equipped && !placedEquipped) {
        next.push(equipped);
        placedEquipped = true;
      }
    } else if (unequipped && !placedUnequipped) {
      next.push(unequipped);
      placedUnequipped = true;
    }
  }
  if (equipped && !placedEquipped) {
    const unequippedIndex = next.indexOf(unequipped);
    next.splice(unequippedIndex < 0 ? candidateIndices[0] : unequippedIndex, 0, equipped);
  }
  if (unequipped && !placedUnequipped) {
    const equippedIndex = next.indexOf(equipped);
    next.splice(equippedIndex < 0 ? candidateIndices[0] : equippedIndex + 1, 0, unequipped);
  }
  if (next.length > maximumSegments) {
    throw new Error(`Damage allocation supports at most ${maximumSegments} target segments`);
  }
  return next;
}
