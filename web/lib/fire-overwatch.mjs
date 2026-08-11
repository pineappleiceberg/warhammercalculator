export function applyFireOverwatchAttackRules(profile) {
  return {
    ...profile,
    hitOn: 6,
    hitModifier: 0,
    heavyActive: false,
    indirect: false,
    criticalHits: 6,
  };
}
