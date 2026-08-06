function relevantModifier(value, role) {
  if (role === "attacker") return Math.max(0, value);
  if (role === "target") return Math.min(0, value);
  return value;
}

export function combatPresetSupportsRole(preset, role) {
  if (role === "either")
    return (
      combatPresetSupportsRole(preset, "attacker") || combatPresetSupportsRole(preset, "target")
    );
  if (role === "attacker") {
    return (
      preset.hitModifier > 0 ||
      preset.woundModifier > 0 ||
      preset.rerollHits ||
      preset.rerollHitOnes ||
      preset.rerollWounds ||
      preset.rerollWoundOnes
    );
  }
  return preset.hitModifier < 0 || preset.woundModifier < 0;
}

export function combatPresetEffects(presets, weaponType, role) {
  const applicable = presets.filter(
    (preset) =>
      combatPresetSupportsRole(preset, role) &&
      (preset.weaponScope === "Any" || preset.weaponScope === weaponType),
  );
  return {
    hitModifier: applicable.reduce(
      (sum, preset) => sum + relevantModifier(preset.hitModifier, role),
      0,
    ),
    woundModifier: applicable.reduce(
      (sum, preset) => sum + relevantModifier(preset.woundModifier, role),
      0,
    ),
    rerollHits: role === "attacker" && applicable.some((preset) => preset.rerollHits),
    rerollHitOnes:
      role === "attacker" &&
      !applicable.some((preset) => preset.rerollHits) &&
      applicable.some((preset) => preset.rerollHitOnes),
    rerollWounds: role === "attacker" && applicable.some((preset) => preset.rerollWounds),
    rerollWoundOnes:
      role === "attacker" &&
      !applicable.some((preset) => preset.rerollWounds) &&
      applicable.some((preset) => preset.rerollWoundOnes),
  };
}

export function applyCombatPresets(profile, attackerPresets, targetPresets, weaponType) {
  const attacker = combatPresetEffects(attackerPresets, weaponType, "attacker");
  const target = combatPresetEffects(targetPresets, weaponType, "target");
  return {
    ...profile,
    hitModifier: Math.max(-1, Math.min(1, attacker.hitModifier + target.hitModifier)),
    woundModifier: Math.max(-1, Math.min(1, attacker.woundModifier + target.woundModifier)),
    rerollHits: attacker.rerollHits,
    rerollHitOnes: attacker.rerollHitOnes,
    rerollWounds: attacker.rerollWounds,
    rerollWoundOnes: attacker.rerollWoundOnes,
  };
}
