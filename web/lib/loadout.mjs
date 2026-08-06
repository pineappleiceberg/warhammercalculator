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
  return pool.fixed + Math.floor(models / pool.modelsPerIncrement) * pool.perIncrement;
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

export function defaultLoadoutSubjectCounts(unit) {
  return Object.fromEntries(
    (unit?.unresolvedLoadoutSubjects ?? []).map((subject) => [subject.id, 0]),
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
    loadoutSubjectWeaponCounts(unit, loadoutSubjectCounts),
  )) {
    counts[groupId] = normalizeEquippedCount((counts[groupId] ?? 0) + count);
  }
  return counts;
}

export function choiceSelectionReplacementCounts(unit, choiceSelections = {}) {
  const counts = {};
  for (const pool of unit?.wargearChoicePools ?? []) {
    const selected = pool.alternatives.reduce(
      (sum, alternative) => sum + normalizeEquippedCount(choiceSelections[alternative.id] ?? 0),
      0,
    );
    for (const weapon of pool.replaces ?? []) {
      counts[weapon.groupId] = (counts[weapon.groupId] ?? 0) + selected * weapon.quantity;
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
) {
  const delta = normalizeEquippedCount(nextValue) - normalizeEquippedCount(previousValue);
  const counts = { ...equippedCounts };
  for (const weapon of pool.replaces ?? []) {
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

export function applyModelCountChange(
  equippedCounts,
  unit,
  previousValue,
  nextValue,
  loadoutSubjectCounts = {},
) {
  const previous = defaultWeaponCounts(unit, previousValue, loadoutSubjectCounts);
  const next = defaultWeaponCounts(unit, nextValue, loadoutSubjectCounts);
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
    loadoutSubjectWeaponCounts(unit, loadoutSubjectCounts),
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

export function choiceSelectionWarnings(
  unit,
  modelCount,
  choiceSelections = {},
  equippedCounts = {},
  loadoutSubjectCounts = {},
) {
  if (!unit) return [];
  const warnings = [];
  const knownAlternativeIds = new Set();
  for (const pool of unit.wargearChoicePools ?? []) {
    const maximum = choicePoolMaximum(pool, modelCount);
    let selected = 0;
    for (const alternative of pool.alternatives) {
      knownAlternativeIds.add(alternative.id);
      selected += normalizeEquippedCount(choiceSelections[alternative.id] ?? 0);
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
  const selectedWeapons = choiceSelectionWeaponCounts(unit, choiceSelections);
  const replacedWeapons = choiceSelectionReplacementCounts(unit, choiceSelections);
  const defaultWeapons = defaultWeaponCounts(unit, modelCount, loadoutSubjectCounts);
  for (const [groupId, count] of Object.entries(replacedWeapons)) {
    if (count > (defaultWeapons[groupId] ?? 0)) {
      const name = unit.weapons.find((weapon) => weapon.groupId === groupId)?.groupName ?? groupId;
      warnings.push(
        `${name}: structured choices replace ${count} copies but the source default has ${defaultWeapons[groupId] ?? 0}`,
      );
    }
  }
  for (const [groupId, count] of Object.entries(selectedWeapons)) {
    const equipped = normalizeEquippedCount(equippedCounts[groupId] ?? 0);
    if (count > equipped) {
      const name = unit.weapons.find((weapon) => weapon.groupId === groupId)?.groupName ?? groupId;
      warnings.push(
        `${name}: structured choices produce ${count} copies but only ${equipped} are equipped`,
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
  if (unit.suggestedModelCount !== null && models < unit.suggestedModelCount) {
    warnings.push(
      `${unit.name} source composition starts at ${unit.suggestedModelCount} models; ${models} may represent battlefield casualties`,
    );
  }
  if (unit.maximumModelCount !== null && models > unit.maximumModelCount) {
    warnings.push(
      `${unit.name} source composition allows at most ${unit.maximumModelCount} models`,
    );
  }
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
  return warnings
    .concat(
      choiceSelectionWarnings(unit, models, choiceSelections, equippedCounts, loadoutSubjectCounts),
    )
    .concat(loadoutSubjectWarnings(unit, models, loadoutSubjectCounts, equippedCounts));
}
