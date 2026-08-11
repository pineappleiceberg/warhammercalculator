export function applySmokescreenAttackEffects(attackProfiles, active) {
  if (!active) return attackProfiles;
  return attackProfiles.map((profile) => ({
    ...profile,
    targetCover: true,
    hitModifier: Math.max(-1, Math.min(1, (profile.hitModifier ?? 0) - 1)),
  }));
}
