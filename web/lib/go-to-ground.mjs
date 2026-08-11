export function applyGoToGroundAttackEffects(attackProfiles, targets, active) {
  if (!active) return { attackProfiles, targets };
  return {
    attackProfiles: attackProfiles.map((profile) => ({ ...profile, targetCover: true })),
    targets: targets.map((target) => ({
      ...target,
      invulnerable: target.invulnerable === 0 ? 6 : Math.min(target.invulnerable, 6),
    })),
  };
}
