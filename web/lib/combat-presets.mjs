function matchesRole(effectRole, role) {
  return role === "either" || effectRole === "either" || effectRole === role;
}

function legacyModifierRole(value) {
  if (value > 0) return "attacker";
  if (value < 0) return "target";
  return null;
}

function modifierRole(preset, field) {
  return preset[`${field}Role`] ?? legacyModifierRole(preset[field]);
}

function rerollRole(preset, field) {
  return preset[`${field}Role`] ?? (preset[field] ? "attacker" : null);
}

const subjectLabels = {
  self: "this unit",
  led_unit: "led unit",
  friendly_unit: "friendly unit",
  enemy_unit: "enemy attacker",
  affected_unit: "affected unit",
  unknown: "chosen unit",
};

export function combatPresetSubjectSummary(preset, role) {
  const subjects = [];
  const add = (enabled, effectRole, subject) => {
    if (enabled && matchesRole(effectRole, role)) {
      subjects.push(
        subjectLabels[subject] ?? (effectRole === "target" ? "enemy attacker" : "this unit"),
      );
    }
  };
  add(preset.hitModifier !== 0, modifierRole(preset, "hitModifier"), preset.hitModifierSubject);
  add(
    preset.woundModifier !== 0,
    modifierRole(preset, "woundModifier"),
    preset.woundModifierSubject,
  );
  add(
    preset.rerollHits || preset.rerollHitOnes,
    rerollRole(preset, "hitReroll"),
    preset.hitRerollSubject,
  );
  add(
    preset.rerollWounds || preset.rerollWoundOnes,
    rerollRole(preset, "woundReroll"),
    preset.woundRerollSubject,
  );
  return [...new Set(subjects)].filter(Boolean).join(" + ");
}

export function combatPresetSupportsRole(preset, role) {
  return (
    (preset.hitModifier !== 0 && matchesRole(modifierRole(preset, "hitModifier"), role)) ||
    (preset.woundModifier !== 0 && matchesRole(modifierRole(preset, "woundModifier"), role)) ||
    ((preset.rerollHits || preset.rerollHitOnes) &&
      matchesRole(rerollRole(preset, "hitReroll"), role)) ||
    ((preset.rerollWounds || preset.rerollWoundOnes) &&
      matchesRole(rerollRole(preset, "woundReroll"), role))
  );
}

export function combatPresetEffects(presets, weaponType, role) {
  const applicable = presets.filter(
    (preset) =>
      combatPresetSupportsRole(preset, role) &&
      (preset.weaponScope === "Any" || preset.weaponScope === weaponType),
  );
  const hitModifiers = applicable.filter((preset) =>
    matchesRole(modifierRole(preset, "hitModifier"), role),
  );
  const woundModifiers = applicable.filter((preset) =>
    matchesRole(modifierRole(preset, "woundModifier"), role),
  );
  const hitRerolls = applicable.filter((preset) =>
    matchesRole(rerollRole(preset, "hitReroll"), role),
  );
  const woundRerolls = applicable.filter((preset) =>
    matchesRole(rerollRole(preset, "woundReroll"), role),
  );
  return {
    hitModifier: hitModifiers.reduce((sum, preset) => sum + preset.hitModifier, 0),
    woundModifier: woundModifiers.reduce((sum, preset) => sum + preset.woundModifier, 0),
    rerollHits: hitRerolls.some((preset) => preset.rerollHits),
    rerollHitOnes:
      !hitRerolls.some((preset) => preset.rerollHits) &&
      hitRerolls.some((preset) => preset.rerollHitOnes),
    rerollWounds: woundRerolls.some((preset) => preset.rerollWounds),
    rerollWoundOnes:
      !woundRerolls.some((preset) => preset.rerollWounds) &&
      woundRerolls.some((preset) => preset.rerollWoundOnes),
  };
}

export function updateCombatPresetSelection(presets, selectedIds, presetId, checked) {
  const preset = presets.find((candidate) => candidate.id === presetId);
  if (!preset) return selectedIds;
  if (!checked) return selectedIds.filter((id) => id !== presetId);
  const incompatible = new Set(
    preset.choiceGroup
      ? presets
          .filter((candidate) => candidate.choiceGroup === preset.choiceGroup)
          .map((candidate) => candidate.id)
      : [],
  );
  return [...selectedIds.filter((id) => !incompatible.has(id) && id !== presetId), presetId];
}

export function applyCombatPresets(profile, attackerPresets, targetPresets, weaponType) {
  const attacker = combatPresetEffects(attackerPresets, weaponType, "attacker");
  const target = combatPresetEffects(targetPresets, weaponType, "target");
  return {
    ...profile,
    hitModifier: Math.max(-1, Math.min(1, attacker.hitModifier + target.hitModifier)),
    woundModifier: Math.max(-1, Math.min(1, attacker.woundModifier + target.woundModifier)),
    rerollHits: attacker.rerollHits || target.rerollHits,
    rerollHitOnes:
      !attacker.rerollHits &&
      !target.rerollHits &&
      (attacker.rerollHitOnes || target.rerollHitOnes),
    rerollWounds: attacker.rerollWounds || target.rerollWounds,
    rerollWoundOnes:
      !attacker.rerollWounds &&
      !target.rerollWounds &&
      (attacker.rerollWoundOnes || target.rerollWoundOnes),
  };
}
