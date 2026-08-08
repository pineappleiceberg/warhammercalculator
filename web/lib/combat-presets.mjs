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
  return preset.activation !== "inherent" && preset.activation !== "automatic";
}

function normalizedKeyword(value) {
  return (value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en");
}

export function attackKeywordsForWeapon(weapon) {
  if (!weapon) return [];
  return [weapon.type, ...(weapon.abilities ?? []).map((ability) => ability.name)].map(
    normalizedKeyword,
  );
}

export function combatPresetMeetsEligibility(
  preset,
  targetKeywords = [],
  attackKeywords = [],
  targetDistance = 0,
  attackerCharged = false,
  attackerBattleShocked = false,
  targetBattleShocked = false,
  targetStrengthState = "full",
  attackerRemainedStationary = false,
  sourceUnitAttached = false,
  sourceUnitWaaaghActive = false,
  targetOathOfMoment = false,
  sourceUnitOathWoundBonusEligible = false,
  sourceUnitOnObjective = false,
  targetUnitOnObjective = false,
  sourceUnitControlsObjective = false,
  targetUnitOnObjectiveNotControlledBySource = false,
  sourceUnitOnSelectedObjective = false,
  targetUnitOnSourceSelectedObjective = false,
  sourceUnitBattleShocked = false,
  sourceUnitGuidedAgainstTarget = false,
  targetUnitSpotted = false,
  targetUnitSpottedByMarkerlightObserver = false,
) {
  const targets = new Set(targetKeywords.map(normalizedKeyword));
  const attacks = new Set(attackKeywords.map(normalizedKeyword));
  const distanceEligible =
    !preset.maximumTargetDistance ||
    (targetDistance > 0 && targetDistance <= preset.maximumTargetDistance);
  const strengthEligible =
    !preset.requiredTargetStrengthState ||
    (preset.requiredTargetStrengthState === "below_starting" && targetStrengthState !== "full") ||
    (preset.requiredTargetStrengthState === "below_half" && targetStrengthState === "below_half") ||
    (preset.requiredTargetStrengthState === "not_below_half" &&
      targetStrengthState !== "below_half");
  return (
    distanceEligible &&
    strengthEligible &&
    (!preset.requiresAttackerCharge || attackerCharged) &&
    (!preset.requiresAttackerStationary || attackerRemainedStationary) &&
    (!preset.requiresAttachedUnit || sourceUnitAttached) &&
    (!preset.requiresWaaaghActive || sourceUnitWaaaghActive) &&
    (!preset.requiresOathTarget || targetOathOfMoment) &&
    (!preset.requiresOathWoundBonusEligible || sourceUnitOathWoundBonusEligible) &&
    (!preset.requiresSourceOnObjective || sourceUnitOnObjective) &&
    (!preset.requiresTargetOnObjective || targetUnitOnObjective) &&
    (!preset.requiresSourceControlsObjective || sourceUnitControlsObjective) &&
    (!preset.requiresTargetOnObjectiveNotControlledBySource ||
      targetUnitOnObjectiveNotControlledBySource) &&
    (!preset.requiresSourceOnSelectedObjective || sourceUnitOnSelectedObjective) &&
    (!preset.requiresTargetOnSourceSelectedObjective || targetUnitOnSourceSelectedObjective) &&
    (!preset.requiresSourceNotBattleShocked || !sourceUnitBattleShocked) &&
    (!preset.requiresSourceGuidedAgainstTarget || sourceUnitGuidedAgainstTarget) &&
    (!preset.requiresTargetSpotted || targetUnitSpotted) &&
    (!preset.requiresTargetSpottedByMarkerlightObserver ||
      targetUnitSpottedByMarkerlightObserver) &&
    (!preset.requiresTargetBattleShocked || targetBattleShocked) &&
    (!preset.requiresAttackerNotBattleShocked || !attackerBattleShocked) &&
    (preset.effects ?? []).every(
      (effect) =>
        (!effect.requiredTargetKeyword ||
          targets.has(normalizedKeyword(effect.requiredTargetKeyword))) &&
        (!effect.requiredAttackKeyword ||
          attacks.has(normalizedKeyword(effect.requiredAttackKeyword))),
    )
  );
}

export function selectedAndAutomaticCombatPresets(
  presets,
  selectedIds,
  weaponType,
  weaponName = "",
  targetKeywords = [],
  attackKeywords = [],
  targetDistance = 0,
  attackerCharged = false,
  attackerBattleShocked = false,
  targetBattleShocked = false,
  targetStrengthState = "full",
  attackerRemainedStationary = false,
  sourceUnitAttached = false,
  sourceUnitWaaaghActive = false,
  targetOathOfMoment = false,
  sourceUnitOathWoundBonusEligible = false,
  sourceUnitOnObjective = false,
  targetUnitOnObjective = false,
  sourceUnitControlsObjective = false,
  targetUnitOnObjectiveNotControlledBySource = false,
  sourceUnitOnSelectedObjective = false,
  targetUnitOnSourceSelectedObjective = false,
  sourceUnitBattleShocked = false,
  sourceUnitGuidedAgainstTarget = false,
  targetUnitSpotted = false,
  targetUnitSpottedByMarkerlightObserver = false,
  sourceRelationship = "self",
) {
  const selected = new Set(selectedIds);
  return presets.filter(
    (preset) =>
      (preset.sourceRelationship ?? "self") === sourceRelationship &&
      (selected.has(preset.id) || preset.activation === "automatic") &&
      combatPresetSupportsWeapon(preset, weaponType, weaponName) &&
      combatPresetMeetsEligibility(
        preset,
        targetKeywords,
        attackKeywords,
        targetDistance,
        attackerCharged,
        attackerBattleShocked,
        targetBattleShocked,
        targetStrengthState,
        attackerRemainedStationary,
        sourceUnitAttached,
        sourceUnitWaaaghActive,
        targetOathOfMoment,
        sourceUnitOathWoundBonusEligible,
        sourceUnitOnObjective,
        targetUnitOnObjective,
        sourceUnitControlsObjective,
        targetUnitOnObjectiveNotControlledBySource,
        sourceUnitOnSelectedObjective,
        targetUnitOnSourceSelectedObjective,
        sourceUnitBattleShocked,
        sourceUnitGuidedAgainstTarget,
        targetUnitSpotted,
        targetUnitSpottedByMarkerlightObserver,
      ),
  );
}

export function combatPresetSupportsWeapon(preset, weaponType, weaponName = "") {
  if (preset.weaponScope !== "Any" && preset.weaponScope !== weaponType) return false;
  const hasUnscopedEffect =
    preset.hitModifier !== 0 ||
    preset.woundModifier !== 0 ||
    preset.rerollHits ||
    preset.rerollHitOnes ||
    preset.rerollWounds ||
    preset.rerollWoundOnes;
  const effects = preset.effects ?? [];
  return (
    hasUnscopedEffect ||
    effects.length === 0 ||
    effects.some(
      (effect) =>
        !effect.weaponName ||
        normalizedWeaponName(effect.weaponName) === normalizedWeaponName(weaponName),
    )
  );
}

function strongerDiceEffect(current, candidate) {
  const expected = (effect) => effect.value + (effect.diceCount * (effect.diceSides + 1)) / 2;
  return expected(candidate) > expected(current) ? candidate : current;
}

function normalizedWeaponName(value) {
  return (value ?? "").normalize("NFKC").replace(/[‘’]/g, "'").trim().toLocaleLowerCase("en");
}

export function combatPresetEffects(
  presets,
  weaponType,
  role,
  weaponName = "",
  targetKeywords = [],
  attackKeywords = [],
  targetDistance = 0,
  attackerCharged = false,
  attackerBattleShocked = false,
  targetBattleShocked = false,
  targetStrengthState = "full",
  attackerRemainedStationary = false,
  sourceUnitAttached = false,
  sourceUnitWaaaghActive = false,
  targetOathOfMoment = false,
  sourceUnitOathWoundBonusEligible = false,
  attackerUnitModels = 0,
  nearbyEnemyModels = 0,
  sourceUnitOnObjective = false,
  targetUnitOnObjective = false,
  sourceUnitControlsObjective = false,
  targetUnitOnObjectiveNotControlledBySource = false,
  sourceUnitOnSelectedObjective = false,
  targetUnitOnSourceSelectedObjective = false,
  sourceUnitBattleShocked = false,
  sourceUnitGuidedAgainstTarget = false,
  targetUnitSpotted = false,
  targetUnitSpottedByMarkerlightObserver = false,
) {
  const applicable = presets.filter(
    (preset) =>
      combatPresetSupportsRole(preset, role) &&
      combatPresetSupportsWeapon(preset, weaponType, weaponName) &&
      combatPresetMeetsEligibility(
        preset,
        targetKeywords,
        attackKeywords,
        targetDistance,
        attackerCharged,
        attackerBattleShocked,
        targetBattleShocked,
        targetStrengthState,
        attackerRemainedStationary,
        sourceUnitAttached,
        sourceUnitWaaaghActive,
        targetOathOfMoment,
        sourceUnitOathWoundBonusEligible,
        sourceUnitOnObjective,
        targetUnitOnObjective,
        sourceUnitControlsObjective,
        targetUnitOnObjectiveNotControlledBySource,
        sourceUnitOnSelectedObjective,
        targetUnitOnSourceSelectedObjective,
        sourceUnitBattleShocked,
        sourceUnitGuidedAgainstTarget,
        targetUnitSpotted,
        targetUnitSpottedByMarkerlightObserver,
      ),
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
    .flatMap((preset, presetIndex) =>
      (preset.effects ?? []).map((effect) => ({
        ...effect,
        presetId: preset.id ?? `selection:${presetIndex}`,
      })),
    )
    .filter(
      (effect) =>
        matchesRole(effect.role, role) &&
        (!effect.weaponName ||
          normalizedWeaponName(effect.weaponName) === normalizedWeaponName(weaponName)),
    );
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
  const replacement = (type, label) => {
    const values = additional
      .filter((effect) => effect.type === type)
      .map((effect) => effect.value);
    if (new Set(values).size > 1) {
      throw new Error(`Choose only one ${label} characteristic replacement`);
    }
    return values.length ? values[0] : null;
  };
  const multiplier = (type) =>
    additional
      .filter((effect) => effect.type === type)
      .reduce((product, effect) => product * effect.value, 1);
  const allocatedReplacements = additional.filter(
    (effect) => effect.type === "allocated_attack_damage_replacement",
  );
  if (
    new Set(allocatedReplacements.map((effect) => `${effect.value}:${effect.uses ?? 0}`)).size > 1
  ) {
    throw new Error("Choose only one allocated-attack Damage replacement");
  }
  const allocatedReplacement = allocatedReplacements[0] ?? null;
  const randomCharacteristicEffects = additional.filter(
    (effect) =>
      ["attacks_modifier", "strength_modifier", "damage_modifier"].includes(effect.type) &&
      effect.diceCount > 0,
  );
  const randomCharacteristicGroups = new Map();
  for (const effect of randomCharacteristicEffects) {
    const key = effect.presetId;
    const current = randomCharacteristicGroups.get(key);
    const roll = {
      diceCount: effect.diceCount,
      diceSides: effect.diceSides,
      bonus: effect.value,
      group: String(key),
    };
    if (
      current &&
      (current.diceCount !== roll.diceCount ||
        current.diceSides !== roll.diceSides ||
        current.bonus !== roll.bonus)
    ) {
      throw new Error("A shared characteristic roll must use one dice expression");
    }
    randomCharacteristicGroups.set(key, current ?? roll);
  }
  if (randomCharacteristicGroups.size > 1) {
    throw new Error("Resolve independent random characteristic modifiers separately");
  }
  const randomCharacteristicRoll = [...randomCharacteristicGroups.values()][0] ?? {
    diceCount: 0,
    diceSides: 0,
    bonus: 0,
    group: "",
  };
  return {
    attacksReplacement: replacement("attacks_replacement", "Attacks") ?? 0,
    attacksMultiplier: multiplier("attacks_multiplier"),
    strengthReplacement: replacement("strength_replacement", "Strength") ?? 0,
    strengthMultiplier: multiplier("strength_multiplier"),
    damageReplacement: replacement("damage_replacement", "Damage"),
    firstFailedSaveDamageReplacement: replacement(
      "first_failed_save_damage_replacement",
      "first failed save Damage",
    ),
    allocatedAttackDamageReplacement: allocatedReplacement?.value ?? 0,
    allocatedAttackDamageReplacementUses: allocatedReplacement?.uses ?? 0,
    damageMultiplier: multiplier("damage_multiplier"),
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
    skillModifier: additional
      .filter((effect) => effect.type === "skill_modifier")
      .reduce((sum, effect) => sum + effect.value, 0),
    attacksModifier: additional
      .filter((effect) => effect.type === "attacks_modifier" && effect.diceCount === 0)
      .reduce((sum, effect) => {
        if (!effect.modelsPerIncrement) return sum + effect.value;
        const modelCount =
          effect.modelCountSource === "source_unit" ? attackerUnitModels : nearbyEnemyModels;
        return sum + effect.value * Math.floor(modelCount / effect.modelsPerIncrement);
      }, 0),
    strengthModifier: additional
      .filter((effect) => effect.type === "strength_modifier" && effect.diceCount === 0)
      .reduce((sum, effect) => sum + effect.value, 0),
    damageModifier: additional
      .filter((effect) => effect.type === "damage_modifier" && effect.diceCount === 0)
      .reduce((sum, effect) => sum + effect.value, 0),
    characteristicModifierDice: randomCharacteristicRoll.diceCount,
    characteristicModifierSides: randomCharacteristicRoll.diceSides,
    characteristicModifierBonus: randomCharacteristicRoll.bonus,
    characteristicModifierAttacks: randomCharacteristicEffects.some(
      (effect) => effect.type === "attacks_modifier",
    ),
    characteristicModifierStrength: randomCharacteristicEffects.some(
      (effect) => effect.type === "strength_modifier",
    ),
    characteristicModifierDamage: randomCharacteristicEffects.some(
      (effect) => effect.type === "damage_modifier",
    ),
    characteristicModifierGroup: randomCharacteristicRoll.group,
    saveTarget: strongestDefense("save_target"),
    invulnerableSave: strongestDefense("invulnerable_save"),
    feelNoPain: strongestDefense("feel_no_pain"),
    damageReduction: additional
      .filter((effect) => effect.type === "damage_reduction")
      .reduce((strongest, effect) => Math.max(strongest, effect.value), 0),
    damageDivisor: additional
      .filter((effect) => effect.type === "damage_divisor")
      .reduce((product, effect) => product * effect.value, 1),
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
    damageDivisor: (profile.damageDivisor ?? 1) * effects.damageDivisor,
    firstFailedSaveDamageReplacement:
      effects.firstFailedSaveDamageReplacement ?? profile.firstFailedSaveDamageReplacement ?? null,
    allocatedAttackDamageReplacement:
      effects.allocatedAttackDamageReplacementUses > 0
        ? effects.allocatedAttackDamageReplacement
        : (profile.allocatedAttackDamageReplacement ?? 0),
    allocatedAttackDamageReplacementUses:
      effects.allocatedAttackDamageReplacementUses > 0
        ? effects.allocatedAttackDamageReplacementUses
        : (profile.allocatedAttackDamageReplacementUses ?? 0),
    allocatedAttackDamageReplacementSkip: profile.allocatedAttackDamageReplacementSkip ?? 0,
  };
}

function controlsObjective(onObjective, owner, side) {
  return Boolean(onObjective && owner === side);
}

function onObjectiveNotControlledBy(onObjective, owner, side) {
  return Boolean(onObjective && owner !== "unknown" && owner !== side);
}

export function applyTargetCombatPresets(targets, targetPresets, weaponContexts) {
  const contexts = weaponContexts.map((context) =>
    typeof context === "string" ? { weaponType: context, attackKeywords: [context] } : context,
  );
  const uniqueContexts = [
    ...new Map(
      contexts.map((context) => [
        JSON.stringify([context.weaponType, context.weaponName, context.attackKeywords]),
        context,
      ]),
    ).values(),
  ];
  const targetKeywords = targets[0]?.keywords ?? [];
  const effects = uniqueContexts.map((context) =>
    combatPresetEffects(
      targetPresets,
      context.weaponType,
      "target",
      context.weaponName ?? "",
      targetKeywords,
      context.attackKeywords ?? [],
      context.targetDistance ?? 0,
      context.attackerCharged ?? false,
      context.attackerBattleShocked ?? false,
      context.targetBattleShocked ?? false,
      context.targetStrengthState ?? "full",
      context.attackerRemainedStationary ?? false,
      context.targetAttached ?? false,
      context.targetWaaaghActive ?? false,
      false,
      false,
      context.attackerUnitModels ?? 0,
      context.nearbyEnemyModels ?? 0,
      context.targetOnObjective ?? false,
      context.attackerOnObjective ?? false,
      controlsObjective(
        context.targetOnObjective,
        context.targetObjectiveOwner ?? "unknown",
        "target",
      ),
      onObjectiveNotControlledBy(
        context.attackerOnObjective,
        context.attackerObjectiveOwner ?? "unknown",
        "target",
      ),
      context.targetOnTargetSelectedObjective ?? false,
      context.attackerOnTargetSelectedObjective ?? false,
      context.targetBattleShocked ?? false,
      false,
      false,
      false,
    ),
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
        target.damageDivisor,
        target.firstFailedSaveDamageReplacement,
        target.allocatedAttackDamageReplacement,
        target.allocatedAttackDamageReplacementUses,
        target.allocatedAttackDamageReplacementSkip,
      ]),
    ),
  );
  if (new Set(signatures).size > 1) {
    throw new Error("Resolve weapons with different defensive eligibility separately");
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

export function applyCombatPresets(
  profile,
  attackerPresets,
  targetPresets,
  weaponType,
  context = {},
) {
  const attacker = combatPresetEffects(
    attackerPresets,
    weaponType,
    "attacker",
    profile.weaponName,
    context.targetKeywords,
    context.attackKeywords,
    context.targetDistance ?? profile.targetDistance ?? 0,
    context.attackerCharged ?? profile.attackerCharged ?? false,
    context.attackerBattleShocked ?? profile.attackerBattleShocked ?? false,
    context.targetBattleShocked ?? profile.targetBattleShocked ?? false,
    context.targetStrengthState ?? profile.targetStrengthState ?? "full",
    context.attackerRemainedStationary ?? profile.attackerRemainedStationary ?? false,
    context.attackerAttached ?? profile.attackerAttached ?? false,
    context.attackerWaaaghActive ?? profile.attackerWaaaghActive ?? false,
    context.targetOathOfMoment ?? profile.targetOathOfMoment ?? false,
    context.attackerOathWoundBonusEligible ?? profile.attackerOathWoundBonusEligible ?? false,
    context.attackerUnitModels ?? profile.attackerUnitModels ?? 0,
    context.nearbyEnemyModels ?? profile.nearbyEnemyModels ?? 0,
    context.attackerOnObjective ?? profile.attackerOnObjective ?? false,
    context.targetOnObjective ?? profile.targetOnObjective ?? false,
    controlsObjective(
      context.attackerOnObjective ?? profile.attackerOnObjective,
      context.attackerObjectiveOwner ?? profile.attackerObjectiveOwner ?? "unknown",
      "attacker",
    ),
    onObjectiveNotControlledBy(
      context.targetOnObjective ?? profile.targetOnObjective,
      context.targetObjectiveOwner ?? profile.targetObjectiveOwner ?? "unknown",
      "attacker",
    ),
    context.attackerOnAttackerSelectedObjective ??
      profile.attackerOnAttackerSelectedObjective ??
      false,
    context.targetOnAttackerSelectedObjective ?? profile.targetOnAttackerSelectedObjective ?? false,
    context.attackerBattleShocked ?? profile.attackerBattleShocked ?? false,
    context.attackerGuidedAgainstTarget ?? profile.attackerGuidedAgainstTarget ?? false,
    context.targetSpotted ?? profile.targetSpotted ?? false,
    context.targetSpottedByMarkerlightObserver ??
      profile.targetSpottedByMarkerlightObserver ??
      false,
  );
  const target = combatPresetEffects(
    targetPresets,
    weaponType,
    "target",
    profile.weaponName,
    context.targetKeywords,
    context.attackKeywords,
    context.targetDistance ?? profile.targetDistance ?? 0,
    context.attackerCharged ?? profile.attackerCharged ?? false,
    context.attackerBattleShocked ?? profile.attackerBattleShocked ?? false,
    context.targetBattleShocked ?? profile.targetBattleShocked ?? false,
    context.targetStrengthState ?? profile.targetStrengthState ?? "full",
    context.attackerRemainedStationary ?? profile.attackerRemainedStationary ?? false,
    context.targetAttached ?? profile.targetAttached ?? false,
    context.targetWaaaghActive ?? profile.targetWaaaghActive ?? false,
    false,
    false,
    context.attackerUnitModels ?? profile.attackerUnitModels ?? 0,
    context.nearbyEnemyModels ?? profile.nearbyEnemyModels ?? 0,
    context.targetOnObjective ?? profile.targetOnObjective ?? false,
    context.attackerOnObjective ?? profile.attackerOnObjective ?? false,
    controlsObjective(
      context.targetOnObjective ?? profile.targetOnObjective,
      context.targetObjectiveOwner ?? profile.targetObjectiveOwner ?? "unknown",
      "target",
    ),
    onObjectiveNotControlledBy(
      context.attackerOnObjective ?? profile.attackerOnObjective,
      context.attackerObjectiveOwner ?? profile.attackerObjectiveOwner ?? "unknown",
      "target",
    ),
    context.targetOnTargetSelectedObjective ?? profile.targetOnTargetSelectedObjective ?? false,
    context.attackerOnTargetSelectedObjective ?? profile.attackerOnTargetSelectedObjective ?? false,
    context.targetBattleShocked ?? profile.targetBattleShocked ?? false,
    false,
    context.targetSpotted ?? profile.targetSpotted ?? false,
    context.targetSpottedByMarkerlightObserver ??
      profile.targetSpottedByMarkerlightObserver ??
      false,
  );
  const attacksReplacements = [attacker.attacksReplacement, target.attacksReplacement].filter(
    (value) => value > 0,
  );
  if (new Set(attacksReplacements).size > 1) {
    throw new Error("Choose only one Attacks characteristic replacement");
  }
  const strengthReplacements = [attacker.strengthReplacement, target.strengthReplacement].filter(
    (value) => value > 0,
  );
  if (new Set(strengthReplacements).size > 1) {
    throw new Error("Choose only one Strength characteristic replacement");
  }
  const damageReplacements = [attacker.damageReplacement, target.damageReplacement].filter(
    (value) => value !== null,
  );
  if (new Set(damageReplacements).size > 1) {
    throw new Error("Choose only one Damage characteristic replacement");
  }
  const firstFailedSaveDamageReplacements = [
    attacker.firstFailedSaveDamageReplacement,
    target.firstFailedSaveDamageReplacement,
  ].filter((value) => value !== null);
  if (new Set(firstFailedSaveDamageReplacements).size > 1) {
    throw new Error("Choose only one first-failed-save Damage replacement");
  }
  const characteristicRolls = [
    {
      dice: profile.characteristicModifierDice ?? 0,
      sides: profile.characteristicModifierSides ?? 0,
      bonus: profile.characteristicModifierBonus ?? 0,
      attacks: profile.characteristicModifierAttacks ?? false,
      strength: profile.characteristicModifierStrength ?? false,
      damage: profile.characteristicModifierDamage ?? false,
      group: profile.characteristicModifierGroup ?? "",
    },
    {
      dice: attacker.characteristicModifierDice,
      sides: attacker.characteristicModifierSides,
      bonus: attacker.characteristicModifierBonus,
      attacks: attacker.characteristicModifierAttacks,
      strength: attacker.characteristicModifierStrength,
      damage: attacker.characteristicModifierDamage,
      group: attacker.characteristicModifierGroup,
    },
    {
      dice: target.characteristicModifierDice,
      sides: target.characteristicModifierSides,
      bonus: target.characteristicModifierBonus,
      attacks: target.characteristicModifierAttacks,
      strength: target.characteristicModifierStrength,
      damage: target.characteristicModifierDamage,
      group: target.characteristicModifierGroup,
    },
  ].filter((roll) => roll.dice > 0);
  if (characteristicRolls.length > 1) {
    throw new Error("Resolve independent random characteristic modifiers separately");
  }
  const characteristicRoll = characteristicRolls[0] ?? {
    dice: 0,
    sides: 0,
    bonus: 0,
    attacks: false,
    strength: false,
    damage: false,
    group: "",
  };
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
      attacksReplacement: attacksReplacements[0] ?? profile.attacksReplacement ?? 0,
      strengthReplacement: strengthReplacements[0] ?? profile.strengthReplacement ?? 0,
      damageReplacement: damageReplacements[0] ?? profile.damageReplacement ?? null,
      firstFailedSaveDamageReplacement:
        firstFailedSaveDamageReplacements[0] ?? profile.firstFailedSaveDamageReplacement ?? null,
      attacksMultiplier:
        (profile.attacksMultiplier ?? 1) * attacker.attacksMultiplier * target.attacksMultiplier,
      strengthMultiplier:
        (profile.strengthMultiplier ?? 1) * attacker.strengthMultiplier * target.strengthMultiplier,
      damageMultiplier:
        (profile.damageMultiplier ?? 1) * attacker.damageMultiplier * target.damageMultiplier,
      attacksModifier:
        (profile.attacksModifier ?? 0) + attacker.attacksModifier + target.attacksModifier,
      strengthModifier:
        (profile.strengthModifier ?? 0) + attacker.strengthModifier + target.strengthModifier,
      damageModifier:
        (profile.damageModifier ?? 0) + attacker.damageModifier + target.damageModifier,
      characteristicModifierDice: characteristicRoll.dice,
      characteristicModifierSides: characteristicRoll.sides,
      characteristicModifierBonus: characteristicRoll.bonus,
      characteristicModifierAttacks: characteristicRoll.attacks,
      characteristicModifierStrength: characteristicRoll.strength,
      characteristicModifierDamage: characteristicRoll.damage,
      characteristicModifierGroup: characteristicRoll.group,
      ap: Math.max(0, (profile.ap ?? 0) + attacker.apModifier + target.apModifier),
      hitOn: Math.max(2, (profile.hitOn ?? 2) - attacker.skillModifier - target.skillModifier),
      criticalHits: criticalHits.length ? Math.min(...criticalHits) : 0,
      criticalWounds: criticalWounds.length ? Math.min(...criticalWounds) : 0,
      lethalHits: profile.lethalHits || attacker.lethalHits || target.lethalHits,
      devastatingWounds:
        profile.devastatingWounds || attacker.devastatingWounds || target.devastatingWounds,
      twinLinked: profile.twinLinked || attacker.twinLinked || target.twinLinked,
      ignoresCover: profile.ignoresCover || attacker.ignoresCover || target.ignoresCover,
      lanceActive:
        profile.lanceActive ||
        ((context.attackerCharged ?? profile.attackerCharged ?? false) &&
          (attacker.lanceActive ||
            target.lanceActive ||
            (context.attackKeywords ?? []).some(
              (keyword) => normalizedKeyword(keyword) === "lance",
            ))),
      heavyActive:
        profile.heavyActive ||
        ((context.attackerRemainedStationary ?? profile.attackerRemainedStationary ?? false) &&
          (attacker.heavyActive ||
            target.heavyActive ||
            (context.attackKeywords ?? []).some(
              (keyword) => normalizedKeyword(keyword) === "heavy",
            ))),
      sustainedHits: combined.sustainedHits.value,
      sustainedHitsDice: combined.sustainedHits.diceCount,
      sustainedHitsSides: combined.sustainedHits.diceSides,
      rapidFire: combined.rapidFire.value,
      rapidFireDice: combined.rapidFire.diceCount,
      rapidFireSides: combined.rapidFire.diceSides,
      hitModifier: Math.max(
        -1,
        Math.min(1, (profile.hitModifier ?? 0) + attacker.hitModifier + target.hitModifier),
      ),
      woundModifier: Math.max(
        -1,
        Math.min(1, (profile.woundModifier ?? 0) + attacker.woundModifier + target.woundModifier),
      ),
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
      allocatedAttackDamageReplacement:
        target.allocatedAttackDamageReplacementUses > 0
          ? target.allocatedAttackDamageReplacement
          : attacker.allocatedAttackDamageReplacement,
      allocatedAttackDamageReplacementUses: Math.max(
        attacker.allocatedAttackDamageReplacementUses,
        target.allocatedAttackDamageReplacementUses,
      ),
    },
  );
}
