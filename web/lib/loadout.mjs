export function normalizeEquippedCount(value, maximum = 100) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}

export function equippedWeaponLines(weapons, counts) {
  return weapons.flatMap((weapon) => {
    const count = normalizeEquippedCount(counts[weapon.id] ?? 0);
    return count > 0 ? [{ weapon, count }] : [];
  });
}
