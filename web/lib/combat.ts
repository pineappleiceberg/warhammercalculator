import { attackRollSucceeds, savingThrowTarget, woundTarget } from "./thresholds.mjs";
import { allocateDamageToUnit } from "./allocation.mjs";

export type CombatProfile = {
  attackDice: number;
  attackSides: number;
  attacks: number;
  weaponCount: number;
  hitOn: number;
  strength: number;
  ap: number;
  damageDice: number;
  damageSides: number;
  damage: number;
  criticalHits: number;
  toughness: number;
  save: number;
  invulnerable: number;
  feelNoPain: number;
  wounds: number;
  targetModels: number;
  reduction: number;
  criticalWounds: number;
  sustainedHitsDice: number;
  sustainedHitsSides: number;
  sustainedHits: number;
  rapidFireDice: number;
  rapidFireSides: number;
  rapidFire: number;
  melta: number;
  withinHalfRange: boolean;
  torrent: boolean;
  blast: boolean;
  heavyActive: boolean;
  lanceActive: boolean;
  targetCover: boolean;
  ignoresCover: boolean;
  indirect: boolean;
  lethalHits: boolean;
  devastatingWounds: boolean;
  twinLinked: boolean;
  rerollHits: boolean;
};

export type RollDetail = {
  label: string;
  hit: string;
  wound: string;
  save: string;
  fnp: string;
  damage: number;
  appliedDamage: number;
  wastedDamage: number;
  outcome: string;
  tone: "failed" | "saved" | "prevented" | "damage";
};

export type RollResult = {
  attacks: number;
  attacksResolved: number;
  hits: number;
  criticalHits: number;
  woundingAttacks: number;
  savedAttacks: number;
  unsavedAttacks: number;
  fnpPrevented: number;
  successfulAttacks: number;
  totalDamage: number;
  appliedDamage: number;
  wastedDamage: number;
  modelsDestroyed: number;
  targetWoundsRemaining: number;
  hitsOn: number;
  woundsOn: number;
  savesOn: number;
  details: RollDetail[];
};

export const DEFAULT_PROFILE: CombatProfile = {
  attackDice: 0,
  attackSides: 0,
  attacks: 4,
  weaponCount: 1,
  hitOn: 3,
  strength: 8,
  ap: 2,
  damageDice: 1,
  damageSides: 6,
  damage: 1,
  criticalHits: 6,
  toughness: 8,
  save: 3,
  invulnerable: 5,
  feelNoPain: 0,
  wounds: 12,
  targetModels: 1,
  reduction: 0,
  criticalWounds: 0,
  sustainedHitsDice: 0,
  sustainedHitsSides: 0,
  sustainedHits: 0,
  rapidFireDice: 0,
  rapidFireSides: 0,
  rapidFire: 0,
  melta: 0,
  withinHalfRange: false,
  torrent: false,
  blast: false,
  heavyActive: false,
  lanceActive: false,
  targetCover: false,
  ignoresCover: false,
  indirect: false,
  lethalHits: false,
  devastatingWounds: false,
  twinLinked: false,
  rerollHits: false,
};

export function normalizeProfile(input: unknown): CombatProfile {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("profile must be a JSON object");
  }
  const source = input as Record<string, unknown>;
  const numberValue = (key: keyof CombatProfile, minimum: number, maximum: number) => {
    const value = source[key] ?? DEFAULT_PROFILE[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
    }
    return value;
  };
  const optionalSave = (key: "invulnerable" | "feelNoPain") => {
    const value = numberValue(key, 0, 6);
    if (value === 1) throw new Error(`${key} must be 0 or an integer from 2 to 6`);
    return value;
  };
  const booleanValue = (key: keyof CombatProfile) => {
    const value = source[key] ?? DEFAULT_PROFILE[key];
    if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
    return value;
  };

  const profile: CombatProfile = {
    attackDice: numberValue("attackDice", 0, 20),
    attackSides: numberValue("attackSides", 0, 100),
    attacks: numberValue("attacks", 0, 1024),
    weaponCount: numberValue("weaponCount", 1, 100),
    hitOn: numberValue("hitOn", 2, 6),
    strength: numberValue("strength", 1, 1024),
    ap: numberValue("ap", 0, 100),
    damageDice: numberValue("damageDice", 0, 20),
    damageSides: numberValue("damageSides", 0, 100),
    damage: numberValue("damage", 0, 1024),
    criticalHits: numberValue("criticalHits", 2, 6),
    toughness: numberValue("toughness", 1, 1024),
    save: numberValue("save", 2, 7),
    invulnerable: optionalSave("invulnerable"),
    feelNoPain: optionalSave("feelNoPain"),
    wounds: numberValue("wounds", 1, 1024),
    targetModels: numberValue("targetModels", 1, 1000),
    reduction: numberValue("reduction", 0, 1024),
    criticalWounds: numberValue("criticalWounds", 0, 6),
    sustainedHitsDice: numberValue("sustainedHitsDice", 0, 20),
    sustainedHitsSides: numberValue("sustainedHitsSides", 0, 100),
    sustainedHits: numberValue("sustainedHits", 0, 1024),
    rapidFireDice: numberValue("rapidFireDice", 0, 20),
    rapidFireSides: numberValue("rapidFireSides", 0, 100),
    rapidFire: numberValue("rapidFire", 0, 100),
    melta: numberValue("melta", 0, 100),
    withinHalfRange: booleanValue("withinHalfRange"),
    torrent: booleanValue("torrent"),
    blast: booleanValue("blast"),
    heavyActive: booleanValue("heavyActive"),
    lanceActive: booleanValue("lanceActive"),
    targetCover: booleanValue("targetCover"),
    ignoresCover: booleanValue("ignoresCover"),
    indirect: booleanValue("indirect"),
    lethalHits: booleanValue("lethalHits"),
    devastatingWounds: booleanValue("devastatingWounds"),
    twinLinked: booleanValue("twinLinked"),
    rerollHits: booleanValue("rerollHits"),
  };
  if (profile.criticalWounds === 1) {
    throw new Error("criticalWounds must be 0 or an integer from 2 to 6");
  }
  if (profile.attackDice > 0 && profile.attackSides < 2) {
    throw new Error("attackSides must be at least 2 when attackDice is non-zero");
  }
  if (profile.damageDice > 0 && profile.damageSides < 2) {
    throw new Error("damageSides must be at least 2 when damageDice is non-zero");
  }
  if (profile.sustainedHitsDice > 0 && profile.sustainedHitsSides < 2) {
    throw new Error("sustainedHitsSides must be at least 2 when sustainedHitsDice is non-zero");
  }
  if (profile.rapidFireDice > 0 && profile.rapidFireSides < 2) {
    throw new Error("rapidFireSides must be at least 2 when rapidFireDice is non-zero");
  }
  return profile;
}

function randomBelow(exclusiveMaximum: number) {
  if (!Number.isInteger(exclusiveMaximum) || exclusiveMaximum < 1)
    throw new Error("Invalid die size");
  const range = 0x1_0000_0000;
  const limit = range - (range % exclusiveMaximum);
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    globalThis.crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % exclusiveMaximum;
}

function rollDie(sides = 6) {
  return randomBelow(sides) + 1;
}

function rollDiceValue(count: number, sides: number, modifier: number) {
  let total = modifier;
  for (let die = 0; die < count; die += 1) total += rollDie(sides);
  return total;
}

function rollCheck(
  succeedsOn: number,
  criticalOn = 0,
  rerollFailures = false,
  autoFailsThrough = 0,
) {
  const first = rollDie();
  const succeeds = (face: number) =>
    attackRollSucceeds(face, succeedsOn, criticalOn, autoFailsThrough);
  if (!rerollFailures || succeeds(first)) return { face: first, label: String(first) };
  const second = rollDie();
  return { face: second, label: `${first}→${second}` };
}

export function simulateAttack(profile: CombatProfile): RollResult {
  if (profile.torrent && profile.indirect) {
    throw new Error("Torrent weapons cannot fire indirectly when the target is not visible");
  }
  const attacksPerWeapon =
    profile.attacks + (profile.blast ? Math.floor(profile.targetModels / 5) : 0);
  const attacks =
    rollDiceValue(
      profile.attackDice * profile.weaponCount,
      profile.attackSides,
      attacksPerWeapon * profile.weaponCount,
    ) +
    (profile.withinHalfRange
      ? rollDiceValue(
          profile.rapidFireDice * profile.weaponCount,
          profile.rapidFireSides,
          profile.rapidFire * profile.weaponCount,
        )
      : 0);
  if (attacks > 10_000) {
    throw new Error("This roll is too large. Reduce the attack or weapon count.");
  }

  let hitModifier = (profile.heavyActive ? 1 : 0) - (profile.indirect ? 1 : 0);
  hitModifier = Math.max(-1, Math.min(1, hitModifier));
  const hitsOn = Math.max(2, Math.min(6, profile.hitOn - hitModifier));
  const woundsOn = Math.max(
    2,
    woundTarget(profile.strength, profile.toughness) - (profile.lanceActive ? 1 : 0),
  );
  const savesOn = savingThrowTarget(
    profile.save,
    profile.invulnerable,
    profile.ap,
    (profile.targetCover || profile.indirect) && !profile.ignoresCover,
  );

  const result: RollResult = {
    attacks,
    attacksResolved: 0,
    hits: 0,
    criticalHits: 0,
    woundingAttacks: 0,
    savedAttacks: 0,
    unsavedAttacks: 0,
    fnpPrevented: 0,
    successfulAttacks: 0,
    totalDamage: 0,
    appliedDamage: 0,
    wastedDamage: 0,
    modelsDestroyed: 0,
    targetWoundsRemaining: profile.wounds,
    hitsOn,
    woundsOn,
    savesOn,
    details: [],
  };

  const resolveHit = (label: string, hitLabel: string, lethalWound: boolean) => {
    result.hits += 1;
    let woundLabel = "Lethal ✓";
    let criticalWound = false;
    if (!lethalWound) {
      const wound = rollCheck(woundsOn, profile.criticalWounds || 6, profile.twinLinked);
      criticalWound = wound.face >= (profile.criticalWounds || 6);
      const wounded = criticalWound || wound.face >= woundsOn;
      woundLabel = `${wound.label}${criticalWound ? "★" : ""} ${wounded ? "✓" : "✕"}`;
      if (!wounded) {
        result.details.push({
          label,
          hit: hitLabel,
          wound: woundLabel,
          save: "Not reached",
          fnp: "Not reached",
          damage: 0,
          appliedDamage: 0,
          wastedDamage: 0,
          outcome: "Failed to wound",
          tone: "failed",
        });
        return;
      }
    }

    result.woundingAttacks += 1;
    const bypassSave = criticalWound && profile.devastatingWounds;
    let saveLabel = "Bypassed";
    if (!bypassSave) {
      const save = rollDie();
      const saved = save >= savesOn;
      saveLabel = `${save} ${saved ? "✓" : "✕"}`;
      if (saved) {
        result.savedAttacks += 1;
        result.details.push({
          label,
          hit: hitLabel,
          wound: woundLabel,
          save: saveLabel,
          fnp: "Not reached",
          damage: 0,
          appliedDamage: 0,
          wastedDamage: 0,
          outcome: "Saved",
          tone: "saved",
        });
        return;
      }
    }

    result.unsavedAttacks += 1;
    const rawDamage = rollDiceValue(
      profile.damageDice,
      profile.damageSides,
      profile.damage + (profile.withinHalfRange ? profile.melta : 0),
    );
    const reducedDamage =
      rawDamage > 0 && profile.reduction > 0
        ? Math.max(1, rawDamage - profile.reduction)
        : rawDamage;
    let prevented = 0;
    if (profile.feelNoPain > 0) {
      for (let point = 0; point < reducedDamage; point += 1) {
        if (rollDie() >= profile.feelNoPain) prevented += 1;
      }
    }
    const damage = reducedDamage - prevented;
    result.fnpPrevented += prevented;
    result.totalDamage += damage;
    const allocation = allocateDamageToUnit(
      result.appliedDamage,
      damage,
      profile.wounds,
      profile.targetModels,
    );
    result.appliedDamage = allocation.applied;
    result.wastedDamage += allocation.wasted;
    result.modelsDestroyed = allocation.modelsDestroyed;
    result.targetWoundsRemaining = allocation.woundsRemaining;
    if (damage > 0) result.successfulAttacks += 1;
    result.details.push({
      label,
      hit: hitLabel,
      wound: woundLabel,
      save: saveLabel,
      fnp: profile.feelNoPain > 0 ? `${prevented} prevented` : "None",
      damage,
      appliedDamage: allocation.appliedThisAttack,
      wastedDamage: allocation.wasted,
      outcome:
        damage === 0
          ? "Stopped by FNP"
          : allocation.wasted > 0
            ? `${allocation.appliedThisAttack} applied · ${allocation.wasted} lost`
            : `${allocation.appliedThisAttack} applied`,
      tone: damage > 0 ? "damage" : "prevented",
    });
  };

  for (let attack = 1; attack <= attacks; attack += 1) {
    if (result.modelsDestroyed >= profile.targetModels) break;
    result.attacksResolved += 1;
    if (profile.torrent) {
      resolveHit(`#${attack}`, "Auto ✓", false);
      continue;
    }
    const autoFailsThrough = profile.indirect ? 3 : 0;
    const hit = rollCheck(hitsOn, profile.criticalHits, profile.rerollHits, autoFailsThrough);
    const hitSucceeded = attackRollSucceeds(
      hit.face,
      hitsOn,
      profile.criticalHits,
      autoFailsThrough,
    );
    const criticalHit = hitSucceeded && hit.face >= profile.criticalHits;
    const hitLabel = `${hit.label}${criticalHit ? "★" : ""} ${hitSucceeded ? "✓" : "✕"}`;
    if (!hitSucceeded) {
      result.details.push({
        label: `#${attack}`,
        hit: hitLabel,
        wound: "Not reached",
        save: "Not reached",
        fnp: "Not reached",
        damage: 0,
        appliedDamage: 0,
        wastedDamage: 0,
        outcome: "Missed",
        tone: "failed",
      });
      continue;
    }
    if (criticalHit) result.criticalHits += 1;
    resolveHit(`#${attack}`, hitLabel, criticalHit && profile.lethalHits);
    if (criticalHit) {
      const sustainedHits = rollDiceValue(
        profile.sustainedHitsDice,
        profile.sustainedHitsSides,
        profile.sustainedHits,
      );
      for (let extra = 1; extra <= sustainedHits; extra += 1) {
        if (result.modelsDestroyed >= profile.targetModels) break;
        resolveHit(`#${attack}.S${extra}`, "Sustained ✓", false);
      }
    }
  }
  return result;
}
