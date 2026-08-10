import { catalogueModelComposition } from "./catalogue-models.mjs";

export function normalizeEquippedCount(value, maximum = 100) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}

export function groupWeaponProfiles(weapons) {
  const groups = new Map();
  for (const weapon of weapons) {
    const group = groups.get(weapon.groupId) ?? {
      id: weapon.groupId,
      name: weapon.groupName,
      profiles: [],
    };
    group.profiles.push(weapon);
    groups.set(weapon.groupId, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    profiles: group.profiles.sort((left, right) => left.profileIndex - right.profileIndex),
  }));
}

export function armyListWeaponsFromGroups(groups, equippedCounts = {}) {
  return groups.map((group) => ({
    weaponId: group.profiles[0].id,
    groupId: group.id,
    name: group.name,
    count: normalizeEquippedCount(equippedCounts[group.id] ?? 0),
    optionCount: 0,
  }));
}

export function weaponAllocationErrors(groups, equippedCounts, profileCounts) {
  return groups.flatMap((group) => {
    const equipped = normalizeEquippedCount(equippedCounts[group.id] ?? 0);
    if (group.profiles.length === 1 || equipped === 0) return [];
    const allocated = group.profiles.reduce(
      (sum, profile) => sum + normalizeEquippedCount(profileCounts[profile.id] ?? 0),
      0,
    );
    if (allocated === 0) return [`Choose firing profiles for ${group.name}`];
    if (allocated > equipped) {
      return [`${group.name} allocates ${allocated} profiles across ${equipped} equipped copies`];
    }
    return [];
  });
}

export function equippedWeaponLines(groups, counts, profileCounts = {}) {
  return groups.flatMap((group) => {
    const count = normalizeEquippedCount(counts[group.id] ?? 0);
    if (count === 0) return [];
    if (group.profiles.length === 1) return [{ weapon: group.profiles[0], count }];
    return group.profiles.flatMap((weapon) => {
      const allocated = normalizeEquippedCount(profileCounts[weapon.id] ?? 0);
      return allocated > 0 ? [{ weapon, count: allocated }] : [];
    });
  });
}

export function weaponLimitMaximum(limit, modelCount) {
  const models = normalizeEquippedCount(modelCount, 1000);
  return limit.terms.reduce(
    (maximum, term) =>
      maximum +
      (term.fixed + Math.floor(models / term.modelsPerIncrement) * term.perIncrement) *
        term.quantity,
    0,
  );
}

export function choicePoolMaximum(pool, modelCount) {
  const models = normalizeEquippedCount(modelCount, 1000);
  if (models < (pool.minimumModels ?? 1)) return 0;
  return pool.fixed + Math.floor(models / pool.modelsPerIncrement) * pool.perIncrement;
}

export function choiceAlternativeMaximum(pool, alternative, modelCount) {
  const slots = Math.max(1, normalizeEquippedCount(alternative.selectionSlots ?? 1));
  const poolMaximum = Math.floor(choicePoolMaximum(pool, modelCount) / slots);
  return Math.min(poolMaximum, alternative.maximumSelections ?? poolMaximum);
}

export function choicePoolUsed(pool, choiceSelections = {}) {
  return pool.alternatives.reduce(
    (total, alternative) =>
      total +
      normalizeEquippedCount(choiceSelections[alternative.id] ?? 0) *
        Math.max(1, normalizeEquippedCount(alternative.selectionSlots ?? 1)),
    0,
  );
}

function choicePoolReplacementUses(pool, choiceSelections = {}) {
  const selectionsPerReplacement = Math.max(
    1,
    normalizeEquippedCount(pool.selectionsPerReplacement ?? 1),
  );
  return Math.ceil(choicePoolUsed(pool, choiceSelections) / selectionsPerReplacement);
}

export function choiceItemLimitMaximum(limit, modelCount) {
  const models = normalizeEquippedCount(modelCount, 1000);
  return limit.fixed + Math.floor(models / limit.modelsPerIncrement) * limit.perIncrement;
}

export function weaponTypeLimitMaximum(limit, modelCount) {
  const models = normalizeEquippedCount(modelCount, 1000);
  return limit.fixed + Math.floor(models / limit.modelsPerIncrement) * limit.perIncrement;
}

export function choiceSelectionWeaponCounts(unit, choiceSelections = {}) {
  const counts = {};
  for (const pool of unit?.wargearChoicePools ?? []) {
    for (const alternative of pool.alternatives) {
      const selected = normalizeEquippedCount(choiceSelections[alternative.id] ?? 0);
      for (const weapon of alternative.weapons) {
        counts[weapon.groupId] = (counts[weapon.groupId] ?? 0) + selected * weapon.quantity;
      }
    }
  }
  return counts;
}

export function choiceSelectionItemCounts(unit, choiceSelections = {}) {
  const counts = {};
  for (const pool of unit?.wargearChoicePools ?? []) {
    for (const alternative of pool.alternatives) {
      if (!alternative.selectionKey) continue;
      const selected = normalizeEquippedCount(choiceSelections[alternative.id] ?? 0);
      counts[alternative.selectionKey] =
        (counts[alternative.selectionKey] ?? 0) +
        selected * normalizeEquippedCount(alternative.selectionQuantity ?? 1);
    }
  }
  return counts;
}

export function compositionLoadoutSubjectCounts(unit, modelCount, loadoutSubjectCounts = {}) {
  const result = { ...loadoutSubjectCounts };
  const composition = catalogueModelComposition(unit, modelCount, result);
  if (!composition.exact) return result;
  for (const subjectId of new Set(
    (unit?.compositionModels ?? [])
      .map((entry) => entry.loadoutSubjectId)
      .filter((subjectId) => subjectId !== undefined),
  )) {
    result[subjectId] = (unit.compositionModels ?? []).reduce(
      (total, entry, index) =>
        total + (entry.loadoutSubjectId === subjectId ? composition.counts[index] : 0),
      0,
    );
  }
  return result;
}

export function defaultLoadoutSubjectCounts(unit, modelCount = unit?.suggestedModelCount ?? 0) {
  const composed = compositionLoadoutSubjectCounts(unit, modelCount, {});
  return Object.fromEntries(
    (unit?.unresolvedLoadoutSubjects ?? []).map((subject) => [
      subject.id,
      composed[subject.id] ?? 0,
    ]),
  );
}

export function rebaseCompositionLoadoutSubjectCounts(
  unit,
  previousModelCount,
  nextModelCount,
  loadoutSubjectCounts = {},
) {
  const formulaSubjectIds = new Set(
    (unit?.compositionModels ?? [])
      .filter((entry) => entry.countFormula && entry.loadoutSubjectId && entry.controlsComposition)
      .map((entry) => entry.loadoutSubjectId),
  );
  if (formulaSubjectIds.size === 0) {
    return compositionLoadoutSubjectCounts(unit, nextModelCount, loadoutSubjectCounts);
  }
  const previousDefaults = defaultLoadoutSubjectCounts(unit, previousModelCount);
  const hasFormulaOverride = [...formulaSubjectIds].some(
    (subjectId) =>
      normalizeEquippedCount(loadoutSubjectCounts[subjectId] ?? 0, 1000) !==
      normalizeEquippedCount(previousDefaults[subjectId] ?? 0, 1000),
  );
  return compositionLoadoutSubjectCounts(
    unit,
    nextModelCount,
    hasFormulaOverride ? loadoutSubjectCounts : {},
  );
}

export function loadoutSubjectWeaponCounts(unit, loadoutSubjectCounts = {}) {
  const counts = {};
  for (const subject of unit?.unresolvedLoadoutSubjects ?? []) {
    const models = normalizeEquippedCount(loadoutSubjectCounts[subject.id] ?? 0, 1000);
    for (const weapon of subject.weapons) {
      counts[weapon.groupId] = (counts[weapon.groupId] ?? 0) + models * weapon.quantity;
    }
  }
  return counts;
}

export function defaultWeaponCounts(unit, modelCount, loadoutSubjectCounts = {}) {
  const models = normalizeEquippedCount(modelCount, 1000);
  const effectiveSubjectCounts = compositionLoadoutSubjectCounts(
    unit,
    models,
    loadoutSubjectCounts,
  );
  const counts = Object.fromEntries(
    (unit?.defaultWeapons ?? []).map((weapon) => [
      weapon.groupId,
      normalizeEquippedCount(
        weapon.terms.reduce(
          (count, term) =>
            count +
            (term.fixed +
              term.perModel * models +
              Math.floor(models / term.modelsPerIncrement) * term.perIncrement) *
              term.quantity,
          0,
        ),
      ),
    ]),
  );
  for (const [groupId, count] of Object.entries(
    loadoutSubjectWeaponCounts(unit, effectiveSubjectCounts),
  )) {
    counts[groupId] = normalizeEquippedCount((counts[groupId] ?? 0) + count);
  }
  return counts;
}

export function choiceSelectionReplacementCounts(unit, choiceSelections = {}) {
  const counts = {};
  for (const pool of unit?.wargearChoicePools ?? []) {
    const commonReplacementUses = choicePoolReplacementUses(pool, choiceSelections);
    for (const weapon of pool.replaces ?? []) {
      counts[weapon.groupId] =
        (counts[weapon.groupId] ?? 0) + commonReplacementUses * weapon.quantity;
    }
    for (const alternative of pool.alternatives) {
      const selected = normalizeEquippedCount(choiceSelections[alternative.id] ?? 0);
      for (const weapon of alternative.replaces ?? []) {
        counts[weapon.groupId] = (counts[weapon.groupId] ?? 0) + selected * weapon.quantity;
      }
    }
  }
  return counts;
}

export function sourceEquippedWeaponCounts(
  unit,
  modelCount,
  choiceSelections = {},
  loadoutSubjectCounts = {},
) {
  const counts = defaultWeaponCounts(unit, modelCount, loadoutSubjectCounts);
  const additions = choiceSelectionWeaponCounts(unit, choiceSelections);
  const replacements = choiceSelectionReplacementCounts(unit, choiceSelections);
  for (const [groupId, count] of Object.entries(additions)) {
    counts[groupId] = (counts[groupId] ?? 0) + count;
  }
  for (const [groupId, count] of Object.entries(replacements)) {
    counts[groupId] = Math.max(0, (counts[groupId] ?? 0) - count);
  }
  return counts;
}

export function applyChoiceSelectionChange(
  equippedCounts,
  pool,
  alternative,
  previousValue,
  nextValue,
  choiceSelections = {},
) {
  const delta = normalizeEquippedCount(nextValue) - normalizeEquippedCount(previousValue);
  const counts = { ...equippedCounts };
  const previousSelections = { ...choiceSelections, [alternative.id]: previousValue };
  const nextSelections = { ...choiceSelections, [alternative.id]: nextValue };
  const commonReplacementDelta =
    choicePoolReplacementUses(pool, nextSelections) -
    choicePoolReplacementUses(pool, previousSelections);
  for (const weapon of pool.replaces ?? []) {
    counts[weapon.groupId] = normalizeEquippedCount(
      (counts[weapon.groupId] ?? 0) - commonReplacementDelta * weapon.quantity,
    );
  }
  for (const weapon of alternative.replaces ?? []) {
    counts[weapon.groupId] = normalizeEquippedCount(
      (counts[weapon.groupId] ?? 0) - delta * weapon.quantity,
    );
  }
  for (const weapon of alternative.weapons) {
    counts[weapon.groupId] = normalizeEquippedCount(
      (counts[weapon.groupId] ?? 0) + delta * weapon.quantity,
    );
  }
  return counts;
}

export function applyLoadoutSubjectCountChange(equippedCounts, subject, previousValue, nextValue) {
  const delta =
    normalizeEquippedCount(nextValue, 1000) - normalizeEquippedCount(previousValue, 1000);
  const counts = { ...equippedCounts };
  for (const weapon of subject.weapons) {
    counts[weapon.groupId] = normalizeEquippedCount(
      (counts[weapon.groupId] ?? 0) + delta * weapon.quantity,
    );
  }
  return counts;
}

export function applyLoadoutSubjectCountsChange(equippedCounts, unit, previousCounts, nextCounts) {
  const previous = loadoutSubjectWeaponCounts(unit, previousCounts);
  const next = loadoutSubjectWeaponCounts(unit, nextCounts);
  const counts = { ...equippedCounts };
  for (const groupId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    counts[groupId] = normalizeEquippedCount(
      (counts[groupId] ?? 0) + (next[groupId] ?? 0) - (previous[groupId] ?? 0),
    );
  }
  return counts;
}

export function applyModelCountChange(
  equippedCounts,
  unit,
  previousValue,
  nextValue,
  loadoutSubjectCounts = {},
) {
  const previousSubjects = compositionLoadoutSubjectCounts(
    unit,
    previousValue,
    loadoutSubjectCounts,
  );
  const nextSubjects = rebaseCompositionLoadoutSubjectCounts(
    unit,
    previousValue,
    nextValue,
    loadoutSubjectCounts,
  );
  const previous = defaultWeaponCounts(unit, previousValue, previousSubjects);
  const next = defaultWeaponCounts(unit, nextValue, nextSubjects);
  const counts = { ...equippedCounts };
  for (const groupId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    counts[groupId] = normalizeEquippedCount(
      (counts[groupId] ?? 0) + (next[groupId] ?? 0) - (previous[groupId] ?? 0),
    );
  }
  return counts;
}

export function loadoutSubjectWarnings(
  unit,
  modelCount,
  loadoutSubjectCounts = {},
  equippedCounts = {},
) {
  if (!unit) return [];
  const models = normalizeEquippedCount(modelCount, 1000);
  const warnings = [];
  const composition = catalogueModelComposition(unit, models, loadoutSubjectCounts);
  if (
    (unit.compositionModels ?? []).some((model) => model.loadoutSubjectId) &&
    !composition.exact
  ) {
    warnings.push(
      `${unit.name}: published specialist counts do not form a legal ${models}-model composition`,
    );
  }
  const effectiveSubjectCounts = composition.exact
    ? compositionLoadoutSubjectCounts(unit, models, loadoutSubjectCounts)
    : loadoutSubjectCounts;
  const known = new Set((unit.unresolvedLoadoutSubjects ?? []).map((subject) => subject.id));
  for (const subject of unit.unresolvedLoadoutSubjects ?? []) {
    const count = normalizeEquippedCount(loadoutSubjectCounts[subject.id] ?? 0, 1000);
    if (count > models) {
      warnings.push(
        `${subject.subject}: ${count} matching models exceeds the unit total of ${models}`,
      );
    }
  }
  for (const [subjectId, value] of Object.entries(loadoutSubjectCounts)) {
    if (normalizeEquippedCount(value, 1000) > 0 && !known.has(subjectId)) {
      warnings.push(`Unknown source loadout subject: ${subjectId}`);
    }
  }
  for (const [groupId, count] of Object.entries(
    loadoutSubjectWeaponCounts(unit, effectiveSubjectCounts),
  )) {
    const equipped = normalizeEquippedCount(equippedCounts[groupId] ?? 0);
    if (count > equipped) {
      const name = unit.weapons.find((weapon) => weapon.groupId === groupId)?.groupName ?? groupId;
      warnings.push(
        `${name}: model composition produces ${count} copies but only ${equipped} are equipped`,
      );
    }
  }
  return warnings;
}

export function choiceSelectionLimitWarnings(unit, modelCount, choiceSelections = {}) {
  if (!unit) return [];
  const warnings = [];
  const knownAlternativeIds = new Set();
  const alternativeNames = new Map(
    (unit.wargearChoicePools ?? []).flatMap((pool) =>
      pool.alternatives.map((alternative) => [alternative.id, alternative.label]),
    ),
  );
  for (const pool of unit.wargearChoicePools ?? []) {
    const maximum = choicePoolMaximum(pool, modelCount);
    let selected = 0;
    for (const alternative of pool.alternatives) {
      knownAlternativeIds.add(alternative.id);
      const alternativeCount = normalizeEquippedCount(choiceSelections[alternative.id] ?? 0);
      selected +=
        alternativeCount * Math.max(1, normalizeEquippedCount(alternative.selectionSlots ?? 1));
      if (
        alternative.maximumSelections !== undefined &&
        alternativeCount > alternative.maximumSelections
      ) {
        warnings.push(
          `${alternative.label}: ${alternativeCount} selections exceeds the source limit of ${alternative.maximumSelections} — ${pool.source}`,
        );
      }
      if (alternativeCount <= 0) continue;
      for (const prerequisite of alternative.prerequisites ?? []) {
        const requiredCount = normalizeEquippedCount(
          choiceSelections[prerequisite.alternativeId] ?? 0,
        );
        if (requiredCount < prerequisite.minimum || requiredCount > prerequisite.maximum) {
          warnings.push(
            `${alternative.label}: requires ${prerequisite.minimum === prerequisite.maximum ? prerequisite.minimum : `${prerequisite.minimum}-${prerequisite.maximum}`} selection(s) of ${alternativeNames.get(prerequisite.alternativeId) ?? prerequisite.alternativeId} — ${prerequisite.source}`,
          );
        }
      }
    }
    if (selected > maximum) {
      warnings.push(
        `Source choice pool: ${selected} selections exceeds the shared limit of ${maximum} for ${modelCount} models — ${pool.source}`,
      );
    }
  }
  for (const [alternativeId, value] of Object.entries(choiceSelections)) {
    if (normalizeEquippedCount(value) > 0 && !knownAlternativeIds.has(alternativeId)) {
      warnings.push(`Unknown source choice: ${alternativeId}`);
    }
  }
  const selectedItems = choiceSelectionItemCounts(unit, choiceSelections);
  for (const limit of unit.wargearChoiceItemLimits ?? []) {
    const selected = selectedItems[limit.itemKey] ?? 0;
    const maximum = choiceItemLimitMaximum(limit, modelCount);
    if (selected > maximum) {
      warnings.push(
        `${limit.itemName}: ${selected} selections across source choice pools exceeds the shared limit of ${maximum} for ${modelCount} models — ${limit.source}`,
      );
    }
  }
  const weaponProfilesByGroup = new Map();
  for (const weapon of unit.weapons ?? []) {
    const profiles = weaponProfilesByGroup.get(weapon.groupId) ?? [];
    profiles.push(weapon);
    weaponProfilesByGroup.set(weapon.groupId, profiles);
  }
  for (const rule of unit.wargearChoicePairingRules ?? []) {
    const pool = (unit.wargearChoicePools ?? []).find((entry) => entry.id === rule.poolId);
    if (!pool) continue;
    const requirements =
      rule.requirements ??
      (rule.requiredAbility
        ? [
            {
              label: rule.requiredAbility,
              minimum: rule.requiredMinimum,
              maximum: rule.requiredMaximum,
              matches: [{ kind: "ability", value: rule.requiredAbility }],
            },
          ]
        : []);
    let typedSelections = 0;
    const requirementSelections = requirements.map(() => 0);
    const weaponSelections =
      rule.evaluationScope === "unit"
        ? sourceEquippedWeaponCounts(unit, modelCount, choiceSelections)
        : pool.alternatives.reduce((counts, alternative) => {
            const selected = normalizeEquippedCount(choiceSelections[alternative.id] ?? 0);
            for (const choice of alternative.weapons) {
              counts[choice.groupId] = (counts[choice.groupId] ?? 0) + selected * choice.quantity;
            }
            return counts;
          }, {});
    for (const [groupId, copies] of Object.entries(weaponSelections)) {
      const profiles = weaponProfilesByGroup.get(groupId) ?? [];
      if (!profiles.some((weapon) => weapon.type === rule.weaponType)) continue;
      typedSelections += copies;
      for (const [index, requirement] of requirements.entries()) {
        const matches = requirement.matches.some((match) => {
          if (match.kind === "weapon_group") return groupId === match.value;
          return profiles.some((weapon) =>
            (weapon.abilities ?? []).some(
              (ability) => ability.name.toLowerCase() === match.value.toLowerCase(),
            ),
          );
        });
        if (matches) requirementSelections[index] += copies;
      }
    }
    if (typedSelections < rule.triggerCount) continue;
    const maximumTypedSelections = rule.maximumTypedSelections ?? rule.triggerCount;
    if (typedSelections > maximumTypedSelections) {
      warnings.push(
        `Source choice pairing: ${typedSelections} ${rule.weaponType.toLowerCase()} selections exceeds the permitted maximum of ${maximumTypedSelections} — ${rule.source}`,
      );
    }
    for (const [index, requirement] of requirements.entries()) {
      const matched = requirementSelections[index];
      if (matched > requirement.maximum) {
        warnings.push(
          `Source choice pairing: ${matched} ${requirement.label} selections exceeds the limit of ${requirement.maximum} — ${rule.source}`,
        );
      } else if (matched < requirement.minimum) {
        warnings.push(
          `Source choice pairing: ${typedSelections} ${rule.weaponType.toLowerCase()} selections requires at least ${requirement.minimum} ${requirement.label} selection — ${rule.source}`,
        );
      }
    }
  }
  return warnings;
}

export function choiceSelectionWarnings(
  unit,
  modelCount,
  choiceSelections = {},
  equippedCounts = {},
  loadoutSubjectCounts = {},
) {
  if (!unit) return [];
  const warnings = choiceSelectionLimitWarnings(unit, modelCount, choiceSelections);
  const selectedWeapons = choiceSelectionWeaponCounts(unit, choiceSelections);
  const replacedWeapons = choiceSelectionReplacementCounts(unit, choiceSelections);
  const defaultWeapons = defaultWeaponCounts(unit, modelCount, loadoutSubjectCounts);
  for (const [groupId, count] of Object.entries(replacedWeapons)) {
    const available = (defaultWeapons[groupId] ?? 0) + (selectedWeapons[groupId] ?? 0);
    if (count > available) {
      const name = unit.weapons.find((weapon) => weapon.groupId === groupId)?.groupName ?? groupId;
      warnings.push(
        `${name}: structured choices replace ${count} copies but the source loadout and selected options supply ${available}`,
      );
    }
  }
  for (const [groupId, count] of Object.entries(selectedWeapons)) {
    const replacedSelectedCopies = Math.max(
      0,
      (replacedWeapons[groupId] ?? 0) - (defaultWeapons[groupId] ?? 0),
    );
    const remainingSelectedCopies = Math.max(0, count - replacedSelectedCopies);
    const equipped = normalizeEquippedCount(equippedCounts[groupId] ?? 0);
    if (remainingSelectedCopies > equipped) {
      const name = unit.weapons.find((weapon) => weapon.groupId === groupId)?.groupName ?? groupId;
      warnings.push(
        `${name}: structured choices produce ${remainingSelectedCopies} retained copies but only ${equipped} are equipped`,
      );
    }
  }
  return warnings;
}

export function unitLoadoutWarnings(
  unit,
  modelCount,
  optionCounts = {},
  equippedCounts = {},
  choiceSelections = {},
  loadoutSubjectCounts = {},
) {
  if (!unit) return [];
  const models = normalizeEquippedCount(modelCount, 1000);
  const warnings = [];
  const startingSizeWarning = unitStartingSizeWarning(unit, models);
  if (startingSizeWarning) warnings.push(startingSizeWarning);
  const structuredCounts = choiceSelectionWeaponCounts(unit, choiceSelections);
  const effectiveOptionCounts = { ...optionCounts };
  for (const [groupId, count] of Object.entries(structuredCounts)) {
    effectiveOptionCounts[groupId] = Math.max(
      normalizeEquippedCount(effectiveOptionCounts[groupId] ?? 0),
      count,
    );
  }
  for (const limit of unit.weaponLimits ?? []) {
    const count = normalizeEquippedCount(effectiveOptionCounts[limit.groupId] ?? 0);
    const equipped = normalizeEquippedCount(equippedCounts[limit.groupId] ?? 0);
    const maximum = weaponLimitMaximum(limit, models);
    if (count > equipped) {
      warnings.push(
        `${limit.groupName}: ${count} option-selected copies exceeds ${equipped} total equipped`,
      );
    }
    if (count > maximum) {
      warnings.push(
        `${limit.groupName}: ${count} option-selected copies exceeds the source-backed limit of ${maximum} for ${models} models`,
      );
    }
  }
  const weaponTypesByGroup = new Map();
  for (const weapon of unit.weapons ?? []) {
    const types = weaponTypesByGroup.get(weapon.groupId) ?? new Set();
    types.add(weapon.type);
    weaponTypesByGroup.set(weapon.groupId, types);
  }
  for (const limit of unit.weaponTypeLimits ?? []) {
    const equipped = Object.entries(equippedCounts).reduce(
      (total, [groupId, count]) =>
        total +
        (weaponTypesByGroup.get(groupId)?.has(limit.weaponType)
          ? normalizeEquippedCount(count)
          : 0),
      0,
    );
    const maximum = weaponTypeLimitMaximum(limit, models);
    if (equipped > maximum) {
      warnings.push(
        `${limit.weaponType} weapons: ${equipped} equipped copies exceeds the source-backed limit of ${maximum} for ${models} models — ${limit.source}`,
      );
    }
  }
  return warnings
    .concat(
      choiceSelectionWarnings(unit, models, choiceSelections, equippedCounts, loadoutSubjectCounts),
    )
    .concat(loadoutSubjectWarnings(unit, models, loadoutSubjectCounts, equippedCounts));
}

export function startingSizeRangeLabel(ranges = []) {
  return ranges
    .map((range) =>
      range.minimum === range.maximum ? String(range.minimum) : `${range.minimum}–${range.maximum}`,
    )
    .join(" or ");
}

export function unitStartingSizeWarning(unit, modelCount) {
  if (!unit) return null;
  const models = normalizeEquippedCount(modelCount, 1000);
  const status = unitStartingSizeStatus(unit, models);
  const ranges = Array.isArray(unit.startingSizeRanges) ? unit.startingSizeRanges : [];
  if (ranges.length > 0) {
    if (status.legal) return null;
    if (status.interpretation === "above_maximum") {
      return `${unit.name} source composition allows at most ${status.maximum} models`;
    }
    return `${unit.name} published starting sizes are ${startingSizeRangeLabel(ranges)}; ${models} is not a legal starting size and may represent battlefield casualties`;
  }
  if (unit.suggestedModelCount !== null && models < unit.suggestedModelCount) {
    return `${unit.name} source composition starts at ${unit.suggestedModelCount} models; ${models} may represent battlefield casualties`;
  }
  if (unit.maximumModelCount !== null && models > unit.maximumModelCount) {
    return `${unit.name} source composition allows at most ${unit.maximumModelCount} models`;
  }
  return null;
}

export function unitStartingSizeStatus(unit, modelCount) {
  if (!unit) return { legal: null, interpretation: "unknown", maximum: null };
  const models = normalizeEquippedCount(modelCount, 1000);
  const ranges = Array.isArray(unit.startingSizeRanges) ? unit.startingSizeRanges : [];
  if (ranges.length > 0) {
    const maximum = Math.max(...ranges.map((range) => range.maximum));
    if (ranges.some((range) => models >= range.minimum && models <= range.maximum)) {
      return { legal: true, interpretation: "legal_start", maximum };
    }
    return {
      legal: false,
      interpretation: models > maximum ? "above_maximum" : "possible_casualties",
      maximum,
    };
  }
  const minimum = Number.isInteger(unit.suggestedModelCount) ? unit.suggestedModelCount : null;
  const maximum = Number.isInteger(unit.maximumModelCount) ? unit.maximumModelCount : null;
  if (maximum !== null && models > maximum) {
    return { legal: false, interpretation: "above_maximum", maximum };
  }
  if (minimum !== null && models < minimum) {
    return { legal: false, interpretation: "possible_casualties", maximum };
  }
  return {
    legal: minimum !== null || maximum !== null ? true : null,
    interpretation: minimum !== null || maximum !== null ? "legal_start" : "unknown",
    maximum,
  };
}
