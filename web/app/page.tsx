"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PROFILE,
  normalizeProfile,
  type CombatProfile as Profile,
  type RollResult,
} from "../lib/combat";
import {
  attackRollSucceeds,
  modifiedRollTarget,
  savingThrowTarget,
  woundTarget,
} from "../lib/thresholds.mjs";
import { antiWoundThreshold } from "../lib/anti.mjs";
import { allocateDamageToUnit } from "../lib/allocation.mjs";
import { abilityDiceValue, parseDice } from "../lib/dice.mjs";
import { WorkflowNav } from "../components/workflow-nav";
import { CombatPresetSelector } from "../components/combat-preset-selector";
import {
  applyCombatPresets as applySelectedCombatPresets,
  combatPresetSupportsRole,
} from "../lib/combat-presets.mjs";

type Result = {
  minimum: number;
  firstQuartile: number;
  median: number;
  thirdQuartile: number;
  maximum: number;
  numerator: bigint;
  denominator: bigint;
  mean: number;
  appliedMinimum: number;
  appliedFirstQuartile: number;
  appliedMedian: number;
  appliedThirdQuartile: number;
  appliedMaximum: number;
  appliedNumerator: bigint;
  appliedDenominator: bigint;
  appliedMean: number;
};

type WasmModule = {
  _malloc: (size: number) => number;
  _free: (pointer: number) => void;
  _whc_calculate_summary: (...values: number[]) => number;
  getValue: (pointer: number, type: "i32") => number;
};

type CatalogueFaction = { id: string; name: string };
type CatalogueAbility = { name: string; value: string | null };
type CatalogueWeapon = {
  id: number;
  name: string;
  type: "Ranged" | "Melee";
  attacks: string;
  skill: number | null;
  strength: string;
  ap: number | null;
  damage: string;
  rules: string;
  abilities: CatalogueAbility[];
};
type CatalogueModel = {
  id: number;
  name: string;
  t: number | null;
  save: number | null;
  invuln: number | null;
  wounds: number | null;
  keywords: string[];
};
type CatalogueCombatPreset = {
  id: string;
  choiceGroup: string | null;
  name: string;
  description: string;
  weaponScope: "Any" | "Ranged" | "Melee";
  hitModifier: number;
  hitModifierRole: "attacker" | "target" | "either" | null;
  hitModifierSubject: string | null;
  woundModifier: number;
  woundModifierRole: "attacker" | "target" | "either" | null;
  woundModifierSubject: string | null;
  rerollHits: boolean;
  rerollHitOnes: boolean;
  hitRerollRole: "attacker" | "target" | "either" | null;
  hitRerollSubject: string | null;
  rerollWounds: boolean;
  rerollWoundOnes: boolean;
  woundRerollRole: "attacker" | "target" | "either" | null;
  woundRerollSubject: string | null;
  effects: Array<{
    type: string;
    value: number;
    diceCount: number;
    diceSides: number;
    role: "attacker" | "target" | "either";
    subject: string;
  }>;
};
type CatalogueUnit = {
  id: string;
  factionId: string;
  name: string;
  models: CatalogueModel[];
  weapons: CatalogueWeapon[];
  combatPresets: CatalogueCombatPreset[];
};
type Catalogue = {
  sourceUpdatedAt: string;
  factions: CatalogueFaction[];
  units: CatalogueUnit[];
};

type SharedMatchup = {
  version: 1;
  profile: Profile;
  attackerFaction: string;
  attackerUnit: string;
  attackerWeapon: string;
  targetFaction: string;
  targetUnit: string;
  targetModel: string;
};

function encodeMatchup(matchup: SharedMatchup) {
  const bytes = new TextEncoder().encode(JSON.stringify(matchup));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeMatchup(encoded: string): SharedMatchup {
  if (encoded.length > 12_000) throw new Error("Matchup link is too large");
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  if (parsed.version !== 1) throw new Error("Unsupported matchup link version");
  const selection = (key: string) => {
    const value = parsed[key];
    if (typeof value !== "string") throw new Error(`Invalid ${key}`);
    return value;
  };
  return {
    version: 1,
    profile: normalizeProfile(parsed.profile),
    attackerFaction: selection("attackerFaction"),
    attackerUnit: selection("attackerUnit"),
    attackerWeapon: selection("attackerWeapon"),
    targetFaction: selection("targetFaction"),
    targetUnit: selection("targetUnit"),
    targetModel: selection("targetModel"),
  };
}

let modulePromise: Promise<WasmModule> | null = null;

async function loadCalculator(): Promise<WasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const modulePath = new URL("wasm/calculator.js", document.baseURI).href;
      const importModule = Function("specifier", "return import(specifier)") as (
        specifier: string,
      ) => Promise<{
        default: (options: { locateFile: (file: string) => string }) => Promise<WasmModule>;
      }>;
      const imported = await importModule(modulePath);
      return imported.default({
        locateFile: (file) => new URL(`wasm/${file}`, document.baseURI).href,
      });
    })();
  }
  return modulePromise;
}

function combineUint64(low: number, high: number): bigint {
  return (BigInt(high >>> 0) << BigInt(32)) | BigInt(low >>> 0);
}

async function calculate(profile: Profile): Promise<Result> {
  const wasmModule = await loadCalculator();
  const output = wasmModule._malloc(72);
  const flags =
    (profile.lethalHits ? 1 : 0) |
    (profile.devastatingWounds ? 2 : 0) |
    (profile.twinLinked ? 4 : 0) |
    (profile.rerollHits ? 8 : 0) |
    (profile.torrent ? 16 : 0) |
    (profile.heavyActive ? 32 : 0) |
    (profile.lanceActive ? 64 : 0) |
    (profile.blast ? 128 : 0) |
    (profile.withinHalfRange && (profile.rapidFire > 0 || profile.rapidFireDice > 0) ? 256 : 0) |
    (profile.withinHalfRange && profile.melta > 0 ? 512 : 0) |
    (profile.targetCover ? 1024 : 0) |
    (profile.ignoresCover ? 2048 : 0) |
    (profile.indirect ? 4096 : 0) |
    (profile.rerollHitOnes ? 8192 : 0) |
    (profile.rerollWounds ? 16384 : 0) |
    (profile.rerollWoundOnes ? 32768 : 0);

  try {
    const ok = wasmModule._whc_calculate_summary(
      profile.attackDice,
      profile.attackSides,
      profile.attacks,
      profile.weaponCount,
      profile.hitOn,
      profile.strength,
      profile.ap,
      profile.damageDice,
      profile.damageSides,
      profile.damage,
      profile.criticalHits,
      profile.toughness,
      profile.save,
      profile.invulnerable,
      profile.feelNoPain,
      profile.wounds,
      profile.reduction,
      flags,
      profile.criticalWounds,
      profile.targetModels,
      profile.sustainedHitsDice,
      profile.sustainedHitsSides,
      profile.sustainedHits,
      profile.rapidFireDice,
      profile.rapidFireSides,
      profile.rapidFire,
      profile.melta,
      profile.hitModifier,
      profile.woundModifier,
      output,
    );

    if (!ok) throw new Error("That profile exceeds the calculator limits.");

    const read = (index: number) => wasmModule.getValue(output + index * 4, "i32") >>> 0;
    const numerator = combineUint64(read(5), read(6));
    const denominator = combineUint64(read(7), read(8));
    const appliedNumerator = combineUint64(read(14), read(15));
    const appliedDenominator = combineUint64(read(16), read(17));

    return {
      minimum: read(0),
      firstQuartile: read(1),
      median: read(2),
      thirdQuartile: read(3),
      maximum: read(4),
      numerator,
      denominator,
      mean: Number(numerator) / Number(denominator),
      appliedMinimum: read(9),
      appliedFirstQuartile: read(10),
      appliedMedian: read(11),
      appliedThirdQuartile: read(12),
      appliedMaximum: read(13),
      appliedNumerator,
      appliedDenominator,
      appliedMean: Number(appliedNumerator) / Number(appliedDenominator),
    };
  } finally {
    wasmModule._free(output);
  }
}

function formatDice(count: number, sides: number, modifier: number) {
  if (count === 0) return `${modifier}`;
  const suffix = modifier > 0 ? `+${modifier}` : "";
  return `${count > 1 ? count : ""}D${sides}${suffix}`;
}

function randomBelow(exclusiveMaximum: number) {
  if (!Number.isInteger(exclusiveMaximum) || exclusiveMaximum < 1) {
    throw new Error("Invalid die size");
  }
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
  rerollOnes = false,
) {
  const first = rollDie();
  const succeeds = (face: number) =>
    attackRollSucceeds(face, succeedsOn, criticalOn, autoFailsThrough);
  if (!(rerollOnes && first === 1) && (!rerollFailures || succeeds(first))) {
    return { face: first, label: String(first) };
  }
  const second = rollDie();
  return { face: second, label: `${first}→${second}` };
}

function simulateAttack(profile: Profile): RollResult {
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
    throw new Error("This roll is too large to display. Reduce the attack or weapon count.");
  }

  const hitsOn = modifiedRollTarget(
    profile.hitOn,
    profile.hitModifier + (profile.heavyActive ? 1 : 0) - (profile.indirect ? 1 : 0),
  );
  const woundsOn = modifiedRollTarget(
    woundTarget(profile.strength, profile.toughness),
    profile.woundModifier + (profile.lanceActive ? 1 : 0),
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
      const wound = rollCheck(
        woundsOn,
        profile.criticalWounds || 6,
        profile.twinLinked || profile.rerollWounds,
        0,
        profile.rerollWoundOnes,
      );
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
    const hit = rollCheck(
      hitsOn,
      profile.criticalHits,
      profile.rerollHits,
      autoFailsThrough,
      profile.rerollHitOnes,
    );
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

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 1024,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <span className="input-wrap">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) =>
            onChange(Math.min(max, Math.max(min, Number(event.target.value) || 0)))
          }
        />
        {suffix && <b>{suffix}</b>}
      </span>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  allowNone = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  allowNone?: boolean;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(+event.target.value)}>
        {allowNone && <option value={0}>None</option>}
        {[2, 3, 4, 5, 6].map((number) => (
          <option value={number} key={number}>
            {number}+
          </option>
        ))}
      </select>
    </label>
  );
}

function DiceField({
  label,
  count,
  sides,
  modifier,
  onChange,
}: {
  label: string;
  count: number;
  sides: number;
  modifier: number;
  onChange: (values: { count: number; sides: number; modifier: number }) => void;
}) {
  return (
    <fieldset className="dice-field">
      <legend>{label}</legend>
      <label>
        <span>Dice</span>
        <input
          aria-label={`${label} dice count`}
          type="number"
          min={0}
          max={20}
          value={count}
          onChange={(event) => onChange({ count: +event.target.value, sides, modifier })}
        />
      </label>
      <b className="dice-mark">D</b>
      <label>
        <span>Sides</span>
        <input
          aria-label={`${label} die sides`}
          type="number"
          min={count === 0 ? 0 : 2}
          max={100}
          value={sides}
          onChange={(event) => onChange({ count, sides: +event.target.value, modifier })}
        />
      </label>
      <b className="dice-mark">+</b>
      <label>
        <span>Fixed</span>
        <input
          aria-label={`${label} fixed modifier`}
          type="number"
          min={0}
          max={1024}
          value={modifier}
          onChange={(event) => onChange({ count, sides, modifier: +event.target.value })}
        />
      </label>
      <output>{formatDice(count, sides, modifier)}</output>
    </fieldset>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="rule-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="checkmark" aria-hidden="true" />
      <b>{label}</b>
    </label>
  );
}

function RerollField({
  label,
  ones,
  failures,
  onChange,
}: {
  label: string;
  ones: boolean;
  failures: boolean;
  onChange: (mode: "none" | "ones" | "failures") => void;
}) {
  const mode = failures ? "failures" : ones ? "ones" : "none";
  return (
    <label className="number-field">
      <span>{label}</span>
      <select
        value={mode}
        onChange={(event) => onChange(event.target.value as "none" | "ones" | "failures")}
      >
        <option value="none">None</option>
        <option value="ones">Re-roll 1s</option>
        <option value="failures">Re-roll failed rolls</option>
      </select>
    </label>
  );
}

export default function Home() {
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [attackerFaction, setAttackerFaction] = useState("");
  const [attackerUnit, setAttackerUnit] = useState("");
  const [attackerWeapon, setAttackerWeapon] = useState("");
  const [targetFaction, setTargetFaction] = useState("");
  const [targetUnit, setTargetUnit] = useState("");
  const [targetModel, setTargetModel] = useState("");
  const [activeAttackerPresetIds, setActiveAttackerPresetIds] = useState<string[]>([]);
  const [activeTargetPresetIds, setActiveTargetPresetIds] = useState<string[]>([]);
  const [rollResult, setRollResult] = useState<RollResult | null>(null);
  const [rollError, setRollError] = useState("");
  const [shareStatus, setShareStatus] = useState("Share matchup");
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Loading…");

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setProfile((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const encoded = new URL(window.location.href).searchParams.get("matchup");
      if (!encoded) return;
      try {
        const shared = decodeMatchup(encoded);
        setProfile(shared.profile);
        setAttackerFaction(shared.attackerFaction);
        setAttackerUnit(shared.attackerUnit);
        setAttackerWeapon(shared.attackerWeapon);
        setTargetFaction(shared.targetFaction);
        setTargetUnit(shared.targetUnit);
        setTargetModel(shared.targetModel);
        setShareStatus("Matchup loaded");
      } catch {
        setShareStatus("Invalid matchup link");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    fetch(new URL("profile-data.json", document.baseURI))
      .then((response) => {
        if (!response.ok) throw new Error("Profile catalogue unavailable");
        return response.json() as Promise<Catalogue>;
      })
      .then((data) => {
        if (active) setCatalogue(data);
      })
      .catch(() => {
        if (active) setCatalogue(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    calculate(profile)
      .then((next) => {
        if (!active) return;
        setResult(next);
        setStatus("ready");
        setMessage("Ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Calculation failed");
      });
    return () => {
      active = false;
    };
  }, [profile]);

  const weaponSummary = useMemo(
    () =>
      `${formatDice(profile.attackDice, profile.attackSides, profile.attacks)} attacks · ${profile.hitOn}+ hit · S${profile.strength} · AP-${profile.ap} · ${formatDice(profile.damageDice, profile.damageSides, profile.damage)} damage`,
    [profile],
  );

  const attackerUnits = useMemo(
    () =>
      catalogue?.units.filter(
        (unit) => unit.factionId === attackerFaction && unit.weapons.length > 0,
      ) ?? [],
    [catalogue, attackerFaction],
  );
  const selectedAttackerUnit = attackerUnits.find((unit) => unit.id === attackerUnit);
  const selectedWeapon = selectedAttackerUnit?.weapons.find(
    (weapon) => String(weapon.id) === attackerWeapon,
  );
  const targetUnits = useMemo(
    () =>
      catalogue?.units.filter(
        (unit) => unit.factionId === targetFaction && unit.models.length > 0,
      ) ?? [],
    [catalogue, targetFaction],
  );
  const selectedTargetUnit = targetUnits.find((unit) => unit.id === targetUnit);
  const selectedTargetModel = selectedTargetUnit?.models.find(
    (model) => String(model.id) === targetModel,
  );
  const selectedPresets = (unit: CatalogueUnit | undefined, ids: string[]) =>
    unit?.combatPresets.filter((preset) => ids.includes(preset.id)) ?? [];
  const withActivePresets = (
    current: Profile,
    weapon: CatalogueWeapon | undefined = selectedWeapon,
    attackerIds = activeAttackerPresetIds,
    targetIds = activeTargetPresetIds,
    targetKeywords = selectedTargetModel?.keywords ?? [],
  ) => {
    const ability = (name: string) => weapon?.abilities.find((entry) => entry.name === name);
    const names = new Set(weapon?.abilities.map((entry) => entry.name) ?? []);
    const sustainedHits = abilityDiceValue(ability("sustained hits"));
    const rapidFire = abilityDiceValue(ability("rapid fire"));
    const baseProfile = weapon
      ? {
          ...current,
          ap: Math.abs(weapon.ap ?? 0),
          criticalHits: 6,
          criticalWounds: antiWoundThreshold(weapon.abilities, targetKeywords),
          sustainedHits: sustainedHits.modifier,
          sustainedHitsDice: sustainedHits.count,
          sustainedHitsSides: sustainedHits.sides,
          rapidFire: rapidFire.modifier,
          rapidFireDice: rapidFire.count,
          rapidFireSides: rapidFire.sides,
          ignoresCover: names.has("ignores cover"),
          lethalHits: names.has("lethal hits"),
          devastatingWounds: names.has("devastating wounds"),
          twinLinked: names.has("twin-linked"),
          heavyActive: false,
          lanceActive: false,
        }
      : current;
    return applySelectedCombatPresets(
      baseProfile,
      selectedPresets(selectedAttackerUnit, attackerIds),
      selectedPresets(selectedTargetUnit, targetIds),
      weapon?.type ?? "Ranged",
    ) as Profile;
  };

  const applyWeapon = (weapon: CatalogueWeapon) => {
    const attacks = parseDice(weapon.attacks);
    const damage = parseDice(weapon.damage);
    const names = new Set(weapon.abilities.map((ability) => ability.name));
    const ability = (name: string) => weapon.abilities.find((entry) => entry.name === name);
    const sustainedHits = abilityDiceValue(ability("sustained hits"));
    const rapidFire = abilityDiceValue(ability("rapid fire"));

    setProfile((current) =>
      withActivePresets(
        {
          ...current,
          ...(attacks
            ? {
                attackDice: attacks.count,
                attackSides: attacks.sides,
                attacks: attacks.modifier,
              }
            : {}),
          ...(damage
            ? {
                damageDice: damage.count,
                damageSides: damage.sides,
                damage: damage.modifier,
              }
            : {}),
          ...(weapon.skill ? { hitOn: weapon.skill } : {}),
          ...(/^\d+$/.test(weapon.strength) ? { strength: Number(weapon.strength) } : {}),
          ...(weapon.ap !== null ? { ap: Math.abs(weapon.ap) } : {}),
          criticalWounds: antiWoundThreshold(weapon.abilities, selectedTargetModel?.keywords ?? []),
          sustainedHitsDice: sustainedHits.count,
          sustainedHitsSides: sustainedHits.sides,
          sustainedHits: sustainedHits.modifier,
          rapidFireDice: rapidFire.count,
          rapidFireSides: rapidFire.sides,
          rapidFire: rapidFire.modifier,
          melta: abilityDiceValue(ability("melta")).modifier,
          torrent: names.has("torrent"),
          blast: names.has("blast"),
          ignoresCover: names.has("ignores cover"),
          lethalHits: names.has("lethal hits"),
          devastatingWounds: names.has("devastating wounds"),
          twinLinked: names.has("twin-linked"),
          withinHalfRange: false,
          heavyActive: false,
          lanceActive: false,
          indirect: false,
        },
        weapon,
      ),
    );
  };

  const applyTarget = (model: CatalogueModel, targetIds = activeTargetPresetIds) => {
    setProfile((current) =>
      withActivePresets(
        {
          ...current,
          ...(model.t ? { toughness: model.t } : {}),
          ...(model.save ? { save: model.save } : {}),
          invulnerable: model.invuln ?? 0,
          ...(model.wounds ? { wounds: model.wounds } : {}),
          criticalWounds: selectedWeapon
            ? antiWoundThreshold(selectedWeapon.abilities, model.keywords)
            : 0,
        },
        selectedWeapon,
        activeAttackerPresetIds,
        targetIds,
        model.keywords,
      ),
    );
  };

  const chooseAttackerPresets = (ids: string[]) => {
    setActiveAttackerPresetIds(ids);
    setProfile((current) => withActivePresets(current, selectedWeapon, ids));
  };

  const chooseTargetPresets = (ids: string[]) => {
    setActiveTargetPresetIds(ids);
    setProfile((current) =>
      withActivePresets(current, selectedWeapon, activeAttackerPresetIds, ids),
    );
  };

  const shareMatchup = async () => {
    const matchup: SharedMatchup = {
      version: 1,
      profile,
      attackerFaction,
      attackerUnit,
      attackerWeapon,
      targetFaction,
      targetUnit,
      targetModel,
    };
    const url = new URL(window.location.href);
    url.searchParams.set("matchup", encodeMatchup(matchup));
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareStatus("Link copied");
    } catch {
      setShareStatus("Link ready in address bar");
    }
    window.setTimeout(() => setShareStatus("Share matchup"), 2500);
  };

  return (
    <main>
      <header className="masthead">
        <div className="brand-lockup">
          <span className="serial">COGITATOR // 10E</span>
          <h1>Damage Calculator</h1>
        </div>
        <div className={`engine-status ${status}`}>
          <span aria-hidden="true" />
          {message}
        </div>
      </header>

      <WorkflowNav current="/" />

      <div className="intro-strip">
        <p>{weaponSummary}</p>
        <div className="intro-actions">
          <button className="share-matchup" type="button" onClick={shareMatchup} aria-live="polite">
            {shareStatus}
          </button>
          <button
            type="button"
            onClick={() => {
              setProfile(DEFAULT_PROFILE);
              setActiveAttackerPresetIds([]);
              setActiveTargetPresetIds([]);
            }}
          >
            Reset profile
          </button>
        </div>
      </div>

      <div className="calculator-grid">
        <div className="form-stack">
          <section className="panel" aria-labelledby="weapon-heading">
            <div className="panel-heading">
              <span>01</span>
              <div>
                <p>Attacker profile</p>
                <h2 id="weapon-heading">Weapon</h2>
              </div>
            </div>

            <div className="panel-body">
              <div className="profile-picker" aria-label="Attacker profile picker">
                <label>
                  <span>Faction</span>
                  <select
                    value={attackerFaction}
                    disabled={!catalogue}
                    onChange={(event) => {
                      setAttackerFaction(event.target.value);
                      setAttackerUnit("");
                      setAttackerWeapon("");
                      setActiveAttackerPresetIds([]);
                      setProfile((current) =>
                        withActivePresets(current, selectedWeapon, [], activeTargetPresetIds),
                      );
                    }}
                  >
                    <option value="">{catalogue ? "Choose faction" : "Loading profiles…"}</option>
                    {catalogue?.factions.map((faction) => (
                      <option value={faction.id} key={faction.id}>
                        {faction.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Unit</span>
                  <select
                    value={attackerUnit}
                    disabled={!attackerFaction}
                    onChange={(event) => {
                      setAttackerUnit(event.target.value);
                      setAttackerWeapon("");
                      setActiveAttackerPresetIds([]);
                      setProfile((current) =>
                        withActivePresets(current, selectedWeapon, [], activeTargetPresetIds),
                      );
                    }}
                  >
                    <option value="">Choose unit</option>
                    {attackerUnits.map((unit) => (
                      <option value={unit.id} key={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Weapon</span>
                  <select
                    value={attackerWeapon}
                    disabled={!selectedAttackerUnit}
                    onChange={(event) => {
                      setAttackerWeapon(event.target.value);
                      const weapon = selectedAttackerUnit?.weapons.find(
                        (item) => String(item.id) === event.target.value,
                      );
                      if (weapon) applyWeapon(weapon);
                    }}
                  >
                    <option value="">Choose weapon</option>
                    {selectedAttackerUnit?.weapons.map((weapon) => (
                      <option value={weapon.id} key={weapon.id}>
                        {weapon.name} · {weapon.type}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedWeapon && (
                <p className="loaded-profile">
                  <b>Profile loaded</b>
                  <span>{selectedWeapon.rules || "No weapon keywords"}</span>
                </p>
              )}
              {selectedWeapon && selectedAttackerUnit && (
                <CombatPresetSelector
                  presets={selectedAttackerUnit.combatPresets.filter(
                    (preset) =>
                      combatPresetSupportsRole(preset, "attacker") &&
                      (preset.weaponScope === "Any" || preset.weaponScope === selectedWeapon.type),
                  )}
                  role="attacker"
                  selectedIds={activeAttackerPresetIds}
                  onChange={chooseAttackerPresets}
                  title="Active attacking abilities"
                />
              )}
              <DiceField
                label="Attacks"
                count={profile.attackDice}
                sides={profile.attackSides}
                modifier={profile.attacks}
                onChange={({ count, sides, modifier }) =>
                  setProfile((current) => ({
                    ...current,
                    attackDice: count,
                    attackSides: sides,
                    attacks: modifier,
                  }))
                }
              />
              <div className="field-grid three">
                <SelectField
                  label="Ballistic / Weapon skill"
                  value={profile.hitOn}
                  onChange={(value) => set("hitOn", value)}
                />
                <NumberField
                  label="Strength"
                  value={profile.strength}
                  min={1}
                  onChange={(value) => set("strength", value)}
                  suffix="S"
                />
                <NumberField
                  label="Armour penetration"
                  value={profile.ap}
                  onChange={(value) => set("ap", value)}
                  suffix="AP"
                />
              </div>
              <DiceField
                label="Damage"
                count={profile.damageDice}
                sides={profile.damageSides}
                modifier={profile.damage}
                onChange={({ count, sides, modifier }) =>
                  setProfile((current) => ({
                    ...current,
                    damageDice: count,
                    damageSides: sides,
                    damage: modifier,
                  }))
                }
              />
              <div className="field-grid three">
                <SelectField
                  label="Critical hits"
                  value={profile.criticalHits}
                  onChange={(value) => set("criticalHits", value)}
                />
                <SelectField
                  label="Critical wounds / Anti-X"
                  value={profile.criticalWounds}
                  onChange={(value) => set("criticalWounds", value)}
                  allowNone
                />
                <NumberField
                  label="Weapons"
                  value={profile.weaponCount}
                  min={1}
                  max={100}
                  onChange={(value) => set("weaponCount", value)}
                />
              </div>
            </div>
          </section>

          <section className="panel" aria-labelledby="target-heading">
            <div className="panel-heading target-heading">
              <span>02</span>
              <div>
                <p>Defender profile</p>
                <h2 id="target-heading">Target</h2>
              </div>
            </div>
            <div className="panel-body">
              <div className="profile-picker" aria-label="Target profile picker">
                <label>
                  <span>Faction</span>
                  <select
                    value={targetFaction}
                    disabled={!catalogue}
                    onChange={(event) => {
                      setTargetFaction(event.target.value);
                      setTargetUnit("");
                      setTargetModel("");
                      setActiveTargetPresetIds([]);
                      setProfile((current) =>
                        withActivePresets(current, selectedWeapon, activeAttackerPresetIds, []),
                      );
                    }}
                  >
                    <option value="">{catalogue ? "Choose faction" : "Loading profiles…"}</option>
                    {catalogue?.factions.map((faction) => (
                      <option value={faction.id} key={faction.id}>
                        {faction.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Unit</span>
                  <select
                    value={targetUnit}
                    disabled={!targetFaction}
                    onChange={(event) => {
                      setTargetUnit(event.target.value);
                      setTargetModel("");
                      setActiveTargetPresetIds([]);
                      setProfile((current) =>
                        withActivePresets(current, selectedWeapon, activeAttackerPresetIds, []),
                      );
                      const unit = targetUnits.find((item) => item.id === event.target.value);
                      if (unit?.models.length === 1) {
                        setTargetModel(String(unit.models[0].id));
                        applyTarget(unit.models[0], []);
                      }
                    }}
                  >
                    <option value="">Choose unit</option>
                    {targetUnits.map((unit) => (
                      <option value={unit.id} key={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Model profile</span>
                  <select
                    value={targetModel}
                    disabled={!selectedTargetUnit}
                    onChange={(event) => {
                      setTargetModel(event.target.value);
                      const model = selectedTargetUnit?.models.find(
                        (item) => String(item.id) === event.target.value,
                      );
                      if (model) applyTarget(model);
                    }}
                  >
                    <option value="">Choose profile</option>
                    {selectedTargetUnit?.models.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedTargetModel && (
                <p className="loaded-profile">
                  <b>Profile loaded</b>
                  <span>Adjust wounds, models, and defensive rules as needed</span>
                </p>
              )}
              {selectedTargetUnit && (
                <CombatPresetSelector
                  presets={selectedTargetUnit.combatPresets.filter((preset) =>
                    combatPresetSupportsRole(preset, "target"),
                  )}
                  role="target"
                  selectedIds={activeTargetPresetIds}
                  onChange={chooseTargetPresets}
                  title="Active defensive abilities"
                />
              )}
              <div className="field-grid three">
                <NumberField
                  label="Toughness"
                  value={profile.toughness}
                  min={1}
                  onChange={(value) => set("toughness", value)}
                  suffix="T"
                />
                <SelectField
                  label="Armour save"
                  value={profile.save}
                  onChange={(value) => set("save", value)}
                />
                <SelectField
                  label="Invulnerable save"
                  value={profile.invulnerable}
                  onChange={(value) => set("invulnerable", value)}
                  allowNone
                />
                <SelectField
                  label="Feel No Pain"
                  value={profile.feelNoPain}
                  onChange={(value) => set("feelNoPain", value)}
                  allowNone
                />
                <NumberField
                  label="Wounds"
                  value={profile.wounds}
                  min={1}
                  onChange={(value) => set("wounds", value)}
                  suffix="W"
                />
                <NumberField
                  label="Models in unit"
                  value={profile.targetModels}
                  min={1}
                  onChange={(value) => set("targetModels", value)}
                />
                <NumberField
                  label="Damage reduction"
                  value={profile.reduction}
                  onChange={(value) => set("reduction", value)}
                  suffix="−D"
                />
              </div>
            </div>
          </section>

          <section className="panel rules-panel" aria-labelledby="rules-heading">
            <div className="panel-heading rules-heading">
              <span>03</span>
              <div>
                <p>10th edition</p>
                <h2 id="rules-heading">Weapon rules</h2>
              </div>
            </div>
            <div className="rules-grid">
              <Toggle
                label="Lethal Hits"
                checked={profile.lethalHits}
                onChange={(value) => set("lethalHits", value)}
              />
              <Toggle
                label="Devastating Wounds"
                checked={profile.devastatingWounds}
                onChange={(value) => set("devastatingWounds", value)}
              />
              <Toggle
                label="Twin-linked"
                checked={profile.twinLinked}
                onChange={(value) => set("twinLinked", value)}
              />
              <Toggle
                label="Torrent"
                checked={profile.torrent}
                onChange={(value) => set("torrent", value)}
              />
              <Toggle
                label="Blast"
                checked={profile.blast}
                onChange={(value) => set("blast", value)}
              />
            </div>
            <div className="rule-values field-grid three">
              <RerollField
                label="Hit re-rolls"
                ones={profile.rerollHitOnes}
                failures={profile.rerollHits}
                onChange={(mode) =>
                  setProfile((current) => ({
                    ...current,
                    rerollHitOnes: mode === "ones",
                    rerollHits: mode === "failures",
                  }))
                }
              />
              <RerollField
                label="Wound re-rolls"
                ones={profile.rerollWoundOnes}
                failures={profile.rerollWounds}
                onChange={(mode) =>
                  setProfile((current) => ({
                    ...current,
                    rerollWoundOnes: mode === "ones",
                    rerollWounds: mode === "failures",
                  }))
                }
              />
              <NumberField
                label="Other Hit modifier"
                value={profile.hitModifier}
                min={-10}
                max={10}
                onChange={(value) => set("hitModifier", value)}
              />
              <NumberField
                label="Other Wound modifier"
                value={profile.woundModifier}
                min={-10}
                max={10}
                onChange={(value) => set("woundModifier", value)}
              />
              <NumberField
                label="Sustained Hits dice"
                value={profile.sustainedHitsDice}
                max={20}
                onChange={(value) => set("sustainedHitsDice", value)}
              />
              <NumberField
                label="Sustained Hits sides"
                value={profile.sustainedHitsSides}
                max={100}
                onChange={(value) => set("sustainedHitsSides", value)}
              />
              <NumberField
                label="Sustained Hits modifier"
                value={profile.sustainedHits}
                max={1024}
                onChange={(value) => set("sustainedHits", value)}
              />
              <NumberField
                label="Rapid Fire dice"
                value={profile.rapidFireDice}
                max={20}
                onChange={(value) => set("rapidFireDice", value)}
              />
              <NumberField
                label="Rapid Fire sides"
                value={profile.rapidFireSides}
                max={100}
                onChange={(value) => set("rapidFireSides", value)}
              />
              <NumberField
                label="Rapid Fire modifier"
                value={profile.rapidFire}
                max={100}
                onChange={(value) => set("rapidFire", value)}
              />
              <NumberField
                label="Melta"
                value={profile.melta}
                max={100}
                onChange={(value) => set("melta", value)}
                suffix="X"
              />
            </div>
            <div className="context-grid">
              <Toggle
                label="Within half range"
                checked={profile.withinHalfRange}
                onChange={(value) => set("withinHalfRange", value)}
              />
              <Toggle
                label="Heavy · stationary"
                checked={profile.heavyActive}
                onChange={(value) => set("heavyActive", value)}
              />
              <Toggle
                label="Lance · charged"
                checked={profile.lanceActive}
                onChange={(value) => set("lanceActive", value)}
              />
              <Toggle
                label="Target in cover"
                checked={profile.targetCover}
                onChange={(value) => set("targetCover", value)}
              />
              <Toggle
                label="Ignores Cover"
                checked={profile.ignoresCover}
                onChange={(value) => set("ignoresCover", value)}
              />
              <Toggle
                label="Indirect · no LOS"
                checked={profile.indirect}
                onChange={(value) => set("indirect", value)}
              />
            </div>
          </section>

          <section className="roll-panel" aria-labelledby="roll-heading">
            <div className="roll-action">
              <div>
                <span>LIVE RESOLUTION // CSPRNG</span>
                <h2 id="roll-heading">Roll this attack</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  try {
                    setRollResult(simulateAttack(profile));
                    setRollError("");
                  } catch (error) {
                    setRollResult(null);
                    setRollError(error instanceof Error ? error.message : "Roll failed");
                  }
                }}
              >
                Roll this attack
              </button>
            </div>
            {rollError && <p className="roll-error">{rollError}</p>}
            {rollResult && (
              <div className="roll-output" aria-live="polite">
                <div className="roll-flow" aria-label="Attack resolution summary">
                  <div>
                    <b>{rollResult.attacks}</b>
                    <span>Attacks</span>
                  </div>
                  <i aria-hidden="true">→</i>
                  <div>
                    <b>{rollResult.hits}</b>
                    <span>Hits</span>
                  </div>
                  <i aria-hidden="true">→</i>
                  <div>
                    <b>{rollResult.woundingAttacks}</b>
                    <span>Wounds</span>
                  </div>
                  <i aria-hidden="true">→</i>
                  <div>
                    <b>{rollResult.unsavedAttacks}</b>
                    <span>Unsaved</span>
                  </div>
                  <i aria-hidden="true">→</i>
                  <div className="flow-damage">
                    <b>{rollResult.appliedDamage}</b>
                    <span>Applied</span>
                  </div>
                </div>
                <div className="roll-summary">
                  {[
                    ["Attacks generated", rollResult.attacks],
                    ["Attacks resolved", rollResult.attacksResolved],
                    ["Successful hits", rollResult.hits],
                    ["Critical hit rolls", rollResult.criticalHits],
                    ["Successful wounds", rollResult.woundingAttacks],
                    ["Successful saves", rollResult.savedAttacks],
                    ["Damage prevented by FNP", rollResult.fnpPrevented],
                    ["Attacks dealing damage", rollResult.successfulAttacks],
                    ["Damage rolled", rollResult.totalDamage],
                    ["Damage applied", rollResult.appliedDamage],
                    ["Excess damage lost", rollResult.wastedDamage],
                    ["Models destroyed", rollResult.modelsDestroyed],
                    ["Wounds on current model", rollResult.targetWoundsRemaining],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <b>{value}</b>
                    </div>
                  ))}
                </div>
                <div className="roll-table-wrap">
                  <table className="roll-table">
                    <caption>Roll-by-roll breakdown</caption>
                    <thead>
                      <tr>
                        <th>Attack</th>
                        <th>Hit ({rollResult.hitsOn}+)</th>
                        <th>Wound ({rollResult.woundsOn}+)</th>
                        <th>
                          Save ({rollResult.savesOn <= 6 ? `${rollResult.savesOn}+` : "none"})
                        </th>
                        <th>FNP</th>
                        <th>Rolled</th>
                        <th>Applied</th>
                        <th>Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rollResult.details.slice(0, 250).map((detail, index) => (
                        <tr key={`${detail.label}-${index}`} className={`outcome-${detail.tone}`}>
                          <th>{detail.label}</th>
                          <td>{detail.hit}</td>
                          <td>{detail.wound}</td>
                          <td>{detail.save}</td>
                          <td>{detail.fnp}</td>
                          <td>
                            <b>{detail.damage}</b>
                          </td>
                          <td>
                            <b>{detail.appliedDamage}</b>
                            {detail.wastedDamage > 0 && (
                              <small> ({detail.wastedDamage} lost)</small>
                            )}
                          </td>
                          <td>
                            <span className="outcome-label">{detail.outcome}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="roll-legend">
                    <b>✓</b> success <b>✕</b> failure <b>★</b> critical <b>→</b> reroll <b>.S</b>{" "}
                    sustained hit
                  </p>
                  {rollResult.details.length > 250 && (
                    <p className="roll-truncated">Showing the first 250 resolved attacks.</p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="results-panel" aria-live="polite">
          <div className="results-heading">
            <span>OUTCOME // UNIT ALLOCATION</span>
            <p>Expected applied damage</p>
          </div>
          <div className="mean-readout">
            <strong>{result ? result.appliedMean.toFixed(2) : "—"}</strong>
            <span>WOUNDS</span>
          </div>
          {result && (
            <>
              <p className="fraction">
                Potential before model caps{" "}
                <b>
                  {result.mean.toFixed(2)} ({result.numerator.toString()} /{" "}
                  {result.denominator.toString()})
                </b>
              </p>
              <div className="quartile-title">
                <span>Damage spread</span>
                <small>25% / 50% / 75%</small>
              </div>
              <div className="damage-rail" aria-label="Damage quartiles">
                <div className="rail-line" />
                {[
                  ["MIN", result.appliedMinimum],
                  ["Q1", result.appliedFirstQuartile],
                  ["MED", result.appliedMedian],
                  ["Q3", result.appliedThirdQuartile],
                  ["MAX", result.appliedMaximum],
                ].map(([label, value], index) => (
                  <div
                    className={`rail-point point-${index}`}
                    key={label}
                    style={{
                      left: `${result.appliedMaximum ? (Number(value) / result.appliedMaximum) * 100 : index * 25}%`,
                    }}
                  >
                    <b>{value}</b>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <div className="result-table">
                <div>
                  <span>Likely floor</span>
                  <b>{result.appliedFirstQuartile}</b>
                </div>
                <div>
                  <span>Median</span>
                  <b>{result.appliedMedian}</b>
                </div>
                <div>
                  <span>Likely ceiling</span>
                  <b>{result.appliedThirdQuartile}</b>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
      <footer className="site-credit">
        <span>Base C calculator code by the repository owner.</span>
        <span>Website and supporting scaffolding generated with AI assistance.</span>
      </footer>
    </main>
  );
}
