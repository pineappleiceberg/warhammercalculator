export function woundTarget(strength, toughness) {
  if (strength >= toughness * 2) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (toughness >= strength * 2) return 6;
  return 5;
}

export function savingThrowTarget(save, invulnerable, ap, cover = false) {
  let armourSave = save + ap;
  if (cover && !(ap === 0 && save <= 3) && armourSave > 2) armourSave -= 1;
  const bestSave = invulnerable > 0 ? Math.min(armourSave, invulnerable) : armourSave;
  return Math.max(2, Math.min(7, bestSave));
}
