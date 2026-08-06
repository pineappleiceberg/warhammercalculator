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

export function armyListWeaponsFromGroups(groups) {
  return groups.map((group) => ({
    weaponId: group.profiles[0].id,
    groupId: group.id,
    name: group.name,
    count: 0,
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
