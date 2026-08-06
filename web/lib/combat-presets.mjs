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
  for (const effect of preset.effects ?? []) {
    add(true, effect.role, effect.subject);
  }
  return [...new Set(subjects)].filter(Boolean).join(" + ");
}

export function combatPresetSupportsRole(preset, role) {
  return (
    (preset.hitModifier !== 0 && matchesRole(modifierRole(preset, "hitModifier"), role)) ||
    (preset.woundModifier !== 0 && matchesRole(modifierRole(preset, "woundModifier"), role)) ||
    ((preset.rerollHits || preset.rerollHitOnes) &&
      matchesRole(rerollRole(preset, "hitReroll"), role)) ||
    ((preset.rerollWounds || preset.rerollWoundOnes) &&
      matchesRole(rerollRole(preset, "woundReroll"), role)) ||
    (preset.effects ?? []).some((effect) => matchesRole(effect.role, role))
  );
}

export function combatPresetRequiresActivation(preset) {
  return preset.activation !== "inherent";
}

function strongerDiceEffect(current, candidate) {
  const expected = (effect) => effect.value + (effect.diceCount * (effect.diceSides + 1)) / 2;
  return expected(candidate) > expected(current) ? candidate : current;
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
  const additional = applicable
    .flatMap((preset) => preset.effects ?? [])
    .filter((effect) => matchesRole(effect.role, role));
  const diceEffect = (type) =>
    additional
      .filter((effect) => effect.type === type)
      .reduce(strongerDiceEffect, { value: 0, diceCount: 0, diceSides: 0 });
  const sustainedHits = diceEffect("sustained_hits");
  const rapidFire = diceEffect("rapid_fire");
  const threshold = (type) => {
    const values = additional
      .filter((effect) => effect.type === type)
      .map((effect) => effect.value);
    return values.length ? Math.min(...values) : 0;
  };
  const strongestDefense = (type) => {
    const values = additional
      .filter((effect) => effect.type === type)
      .map((effect) => effect.value);
    return values.length ? Math.min(...values) : 0;
  };
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
    apModifier: additional
      .filter((effect) => effect.type === "ap_modifier")
      .reduce((sum, effect) => sum + effect.value, 0),
    attacksModifier: additional
      .filter((effect) => effect.type === "attacks_modifier")
      .reduce((sum, effect) => sum + effect.value, 0),
    strengthModifier: additional
      .filter((effect) => effect.type === "strength_modifier")
      .reduce((sum, effect) => sum + effect.value, 0),
    damageModifier: additional
      .filter((effect) => effect.type === "damage_modifier")
      .reduce((sum, effect) => sum + effect.value, 0),
    saveTarget: strongestDefense("save_target"),
    invulnerableSave: strongestDefense("invulnerable_save"),
    feelNoPain: strongestDefense("feel_no_pain"),
    damageReduction: additional
      .filter((effect) => effect.type === "damage_reduction")
      .reduce((strongest, effect) => Math.max(strongest, effect.value), 0),
    criticalHits: threshold("critical_hits"),
    criticalWounds: threshold("critical_wounds"),
    lethalHits: additional.some((effect) => effect.type === "lethal_hits"),
    devastatingWounds: additional.some((effect) => effect.type === "devastating_wounds"),
    twinLinked: additional.some((effect) => effect.type === "twin_linked"),
    ignoresCover: additional.some((effect) => effect.type === "ignores_cover"),
    lanceActive: additional.some((effect) => effect.type === "lance"),
    heavyActive: additional.some((effect) => effect.type === "heavy"),
    sustainedHits: sustainedHits.value,
    sustainedHitsDice: sustainedHits.diceCount,
    sustainedHitsSides: sustainedHits.diceSides,
    rapidFire: rapidFire.value,
    rapidFireDice: rapidFire.diceCount,
    rapidFireSides: rapidFire.diceSides,
  };
}

function strongestSave(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return Math.min(current, candidate);
}

function applyDefensiveEffects(profile, effects) {
  return {
    ...profile,
    save: strongestSave(profile.save, effects.saveTarget),
    invulnerable: strongestSave(profile.invulnerable, effects.invulnerableSave),
    feelNoPain: strongestSave(profile.feelNoPain, effects.feelNoPain),
    reduction: Math.max(profile.reduction ?? 0, effects.damageReduction),
  };
}

export function applyTargetCombatPresets(targets, targetPresets, weaponTypes) {
  const types = [...new Set(weaponTypes)];
  const effects = types.map((weaponType) =>
    combatPresetEffects(targetPresets, weaponType, "target"),
  );
  const candidates = effects.map((effect) =>
    targets.map((target) => applyDefensiveEffects(target, effect)),
  );
  const signatures = candidates.map((candidate) =>
    JSON.stringify(
      candidate.map((target) => [
        target.save,
        target.invulnerable,
        target.feelNoPain,
        target.reduction,
      ]),
    ),
  );
  if (new Set(signatures).size > 1) {
    throw new Error("Resolve ranged and melee weapons separately for this defensive ability");
  }
  return candidates[0] ?? targets;
}

function strongerProfileDice(profile, prefix, effect) {
  const current = {
    value: profile[prefix] ?? 0,
    diceCount: profile[`${prefix}Dice`] ?? 0,
    diceSides: profile[`${prefix}Sides`] ?? 0,
  };
  return strongerDiceEffect(current, effect);
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
  const combined = {
    sustainedHits: strongerDiceEffect(
      {
        value: attacker.sustainedHits,
        diceCount: attacker.sustainedHitsDice,
        diceSides: attacker.sustainedHitsSides,
      },
      {
        value: target.sustainedHits,
        diceCount: target.sustainedHitsDice,
        diceSides: target.sustainedHitsSides,
      },
    ),
    rapidFire: strongerDiceEffect(
      {
        value: attacker.rapidFire,
        diceCount: attacker.rapidFireDice,
        diceSides: attacker.rapidFireSides,
      },
      {
        value: target.rapidFire,
        diceCount: target.rapidFireDice,
        diceSides: target.rapidFireSides,
      },
    ),
  };
  combined.sustainedHits = strongerProfileDice(profile, "sustainedHits", combined.sustainedHits);
  combined.rapidFire = strongerProfileDice(profile, "rapidFire", combined.rapidFire);
  const criticalHits = [profile.criticalHits, attacker.criticalHits, target.criticalHits].filter(
    (value) => value > 0,
  );
  const criticalWounds = [
    profile.criticalWounds,
    attacker.criticalWounds,
    target.criticalWounds,
  ].filter((value) => value > 0);
  return applyDefensiveEffects(
    {
      ...profile,
      attacksModifier:
        (profile.attacksModifier ?? 0) + attacker.attacksModifier + target.attacksModifier,
      strengthModifier:
        (profile.strengthModifier ?? 0) + attacker.strengthModifier + target.strengthModifier,
      damageModifier:
        (profile.damageModifier ?? 0) + attacker.damageModifier + target.damageModifier,
      ap: Math.max(0, (profile.ap ?? 0) + attacker.apModifier + target.apModifier),
      criticalHits: criticalHits.length ? Math.min(...criticalHits) : 0,
      criticalWounds: criticalWounds.length ? Math.min(...criticalWounds) : 0,
      lethalHits: profile.lethalHits || attacker.lethalHits || target.lethalHits,
      devastatingWounds:
        profile.devastatingWounds || attacker.devastatingWounds || target.devastatingWounds,
      twinLinked: profile.twinLinked || attacker.twinLinked || target.twinLinked,
      ignoresCover: profile.ignoresCover || attacker.ignoresCover || target.ignoresCover,
      lanceActive: profile.lanceActive || attacker.lanceActive || target.lanceActive,
      heavyActive: profile.heavyActive || attacker.heavyActive || target.heavyActive,
      sustainedHits: combined.sustainedHits.value,
      sustainedHitsDice: combined.sustainedHits.diceCount,
      sustainedHitsSides: combined.sustainedHits.diceSides,
      rapidFire: combined.rapidFire.value,
      rapidFireDice: combined.rapidFire.diceCount,
      rapidFireSides: combined.rapidFire.diceSides,
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
    },
    {
      saveTarget: strongestSave(attacker.saveTarget, target.saveTarget),
      invulnerableSave: strongestSave(attacker.invulnerableSave, target.invulnerableSave),
      feelNoPain: strongestSave(attacker.feelNoPain, target.feelNoPain),
      damageReduction: Math.max(attacker.damageReduction, target.damageReduction),
    },
  );
}
