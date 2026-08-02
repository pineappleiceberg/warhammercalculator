"use client";

import { useEffect, useMemo, useState } from "react";

type Profile = {
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
  sustainedHits: number;
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

type Result = {
  minimum: number;
  firstQuartile: number;
  median: number;
  thirdQuartile: number;
  maximum: number;
  numerator: bigint;
  denominator: bigint;
  mean: number;
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
};
type CatalogueUnit = {
  id: string;
  factionId: string;
  name: string;
  models: CatalogueModel[];
  weapons: CatalogueWeapon[];
};
type Catalogue = {
  sourceUpdatedAt: string;
  factions: CatalogueFaction[];
  units: CatalogueUnit[];
};

const DEFAULT_PROFILE: Profile = {
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
  sustainedHits: 0,
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

let modulePromise: Promise<WasmModule> | null = null;

async function loadCalculator(): Promise<WasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const modulePath = "/wasm/calculator.js";
      const imported = (await import(/* @vite-ignore */ modulePath)) as {
        default: (options: {
          locateFile: (file: string) => string;
        }) => Promise<WasmModule>;
      };
      return imported.default({
        locateFile: (file) => `/wasm/${file}`,
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
  const output = wasmModule._malloc(36);
  const flags =
    (profile.lethalHits ? 1 : 0) |
    (profile.devastatingWounds ? 2 : 0) |
    (profile.twinLinked ? 4 : 0) |
    (profile.rerollHits ? 8 : 0) |
    (profile.torrent ? 16 : 0) |
    (profile.heavyActive ? 32 : 0) |
    (profile.lanceActive ? 64 : 0) |
    (profile.blast ? 128 : 0) |
    (profile.withinHalfRange && profile.rapidFire > 0 ? 256 : 0) |
    (profile.withinHalfRange && profile.melta > 0 ? 512 : 0) |
    (profile.targetCover ? 1024 : 0) |
    (profile.ignoresCover ? 2048 : 0) |
    (profile.indirect ? 4096 : 0);

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
      profile.sustainedHits,
      profile.rapidFire,
      profile.melta,
      output,
    );

    if (!ok) throw new Error("That profile exceeds the calculator limits.");

    const read = (index: number) =>
      wasmModule.getValue(output + index * 4, "i32") >>> 0;
    const numerator = combineUint64(read(5), read(6));
    const denominator = combineUint64(read(7), read(8));

    return {
      minimum: read(0),
      firstQuartile: read(1),
      median: read(2),
      thirdQuartile: read(3),
      maximum: read(4),
      numerator,
      denominator,
      mean: Number(numerator) / Number(denominator),
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

function parseDice(value: string) {
  const normalized = value.replace(/\s/g, "");
  const fixed = /^\d+$/.exec(normalized);
  if (fixed) return { count: 0, sides: 0, modifier: Number(fixed[0]) };
  const dice = /^(\d*)D(\d+)([+-]\d+)?$/i.exec(normalized);
  if (!dice) return null;
  return {
    count: dice[1] ? Number(dice[1]) : 1,
    sides: Number(dice[2]),
    modifier: Math.max(0, Number(dice[3] ?? 0)),
  };
}

function fixedAbilityValue(ability: CatalogueAbility | undefined) {
  if (!ability?.value || !/^\d+$/.test(ability.value)) return 0;
  return Number(ability.value);
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
            onChange(
              Math.min(max, Math.max(min, Number(event.target.value) || 0)),
            )
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
          onChange={(event) =>
            onChange({ count: +event.target.value, sides, modifier })
          }
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
          onChange={(event) =>
            onChange({ count, sides: +event.target.value, modifier })
          }
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
          onChange={(event) =>
            onChange({ count, sides, modifier: +event.target.value })
          }
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

export default function Home() {
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [attackerFaction, setAttackerFaction] = useState("");
  const [attackerUnit, setAttackerUnit] = useState("");
  const [attackerWeapon, setAttackerWeapon] = useState("");
  const [targetFaction, setTargetFaction] = useState("");
  const [targetUnit, setTargetUnit] = useState("");
  const [targetModel, setTargetModel] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("Loading…");

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setProfile((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let active = true;
    fetch("/profile-data.json")
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
  const selectedAttackerUnit = attackerUnits.find(
    (unit) => unit.id === attackerUnit,
  );
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

  const applyWeapon = (weapon: CatalogueWeapon) => {
    const attacks = parseDice(weapon.attacks);
    const damage = parseDice(weapon.damage);
    const names = new Set(weapon.abilities.map((ability) => ability.name));
    const ability = (name: string) =>
      weapon.abilities.find((entry) => entry.name === name);
    const anti = weapon.abilities.find((entry) => entry.name.startsWith("anti-"));
    const antiTarget = anti?.value ? Number(anti.value.replace("+", "")) : 0;

    setProfile((current) => ({
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
      ...(/^\d+$/.test(weapon.strength)
        ? { strength: Number(weapon.strength) }
        : {}),
      ...(weapon.ap !== null ? { ap: Math.abs(weapon.ap) } : {}),
      criticalWounds: Number.isFinite(antiTarget) ? antiTarget : 0,
      sustainedHits: fixedAbilityValue(ability("sustained hits")),
      rapidFire: fixedAbilityValue(ability("rapid fire")),
      melta: fixedAbilityValue(ability("melta")),
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
    }));
  };

  const applyTarget = (model: CatalogueModel) => {
    setProfile((current) => ({
      ...current,
      ...(model.t ? { toughness: model.t } : {}),
      ...(model.save ? { save: model.save } : {}),
      invulnerable: model.invuln ?? 0,
      ...(model.wounds ? { wounds: model.wounds } : {}),
    }));
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

      <div className="intro-strip">
        <p>{weaponSummary}</p>
        <button type="button" onClick={() => setProfile(DEFAULT_PROFILE)}>
          Reset profile
        </button>
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
                    }}
                  >
                    <option value="">{catalogue ? "Choose faction" : "Loading profiles…"}</option>
                    {catalogue?.factions.map((faction) => (
                      <option value={faction.id} key={faction.id}>{faction.name}</option>
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
                    }}
                  >
                    <option value="">Choose unit</option>
                    {attackerUnits.map((unit) => (
                      <option value={unit.id} key={unit.id}>{unit.name}</option>
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
                <SelectField label="Ballistic / Weapon skill" value={profile.hitOn} onChange={(value) => set("hitOn", value)} />
                <NumberField label="Strength" value={profile.strength} min={1} onChange={(value) => set("strength", value)} suffix="S" />
                <NumberField label="Armour penetration" value={profile.ap} onChange={(value) => set("ap", value)} suffix="AP" />
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
                <SelectField label="Critical hits" value={profile.criticalHits} onChange={(value) => set("criticalHits", value)} />
                <SelectField label="Critical wounds / Anti-X" value={profile.criticalWounds} onChange={(value) => set("criticalWounds", value)} allowNone />
                <NumberField label="Weapons" value={profile.weaponCount} min={1} max={100} onChange={(value) => set("weaponCount", value)} />
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
                    }}
                  >
                    <option value="">{catalogue ? "Choose faction" : "Loading profiles…"}</option>
                    {catalogue?.factions.map((faction) => (
                      <option value={faction.id} key={faction.id}>{faction.name}</option>
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
                      const unit = targetUnits.find((item) => item.id === event.target.value);
                      if (unit?.models.length === 1) {
                        setTargetModel(String(unit.models[0].id));
                        applyTarget(unit.models[0]);
                      }
                    }}
                  >
                    <option value="">Choose unit</option>
                    {targetUnits.map((unit) => (
                      <option value={unit.id} key={unit.id}>{unit.name}</option>
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
                      <option value={model.id} key={model.id}>{model.name}</option>
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
              <div className="field-grid three">
                <NumberField label="Toughness" value={profile.toughness} min={1} onChange={(value) => set("toughness", value)} suffix="T" />
                <SelectField label="Armour save" value={profile.save} onChange={(value) => set("save", value)} />
                <SelectField label="Invulnerable save" value={profile.invulnerable} onChange={(value) => set("invulnerable", value)} allowNone />
                <SelectField label="Feel No Pain" value={profile.feelNoPain} onChange={(value) => set("feelNoPain", value)} allowNone />
                <NumberField label="Wounds" value={profile.wounds} min={1} onChange={(value) => set("wounds", value)} suffix="W" />
                <NumberField label="Models in unit" value={profile.targetModels} min={1} onChange={(value) => set("targetModels", value)} />
                <NumberField label="Damage reduction" value={profile.reduction} onChange={(value) => set("reduction", value)} suffix="−D" />
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
              <Toggle label="Lethal Hits" checked={profile.lethalHits} onChange={(value) => set("lethalHits", value)} />
              <Toggle label="Devastating Wounds" checked={profile.devastatingWounds} onChange={(value) => set("devastatingWounds", value)} />
              <Toggle label="Twin-linked" checked={profile.twinLinked} onChange={(value) => set("twinLinked", value)} />
              <Toggle label="Torrent" checked={profile.torrent} onChange={(value) => set("torrent", value)} />
              <Toggle label="Blast" checked={profile.blast} onChange={(value) => set("blast", value)} />
              <Toggle label="Re-roll Hits" checked={profile.rerollHits} onChange={(value) => set("rerollHits", value)} />
            </div>
            <div className="rule-values field-grid three">
              <NumberField label="Sustained Hits" value={profile.sustainedHits} max={6} onChange={(value) => set("sustainedHits", value)} suffix="X" />
              <NumberField label="Rapid Fire" value={profile.rapidFire} max={100} onChange={(value) => set("rapidFire", value)} suffix="X" />
              <NumberField label="Melta" value={profile.melta} max={100} onChange={(value) => set("melta", value)} suffix="X" />
            </div>
            <div className="context-grid">
              <Toggle label="Within half range" checked={profile.withinHalfRange} onChange={(value) => set("withinHalfRange", value)} />
              <Toggle label="Heavy · stationary" checked={profile.heavyActive} onChange={(value) => set("heavyActive", value)} />
              <Toggle label="Lance · charged" checked={profile.lanceActive} onChange={(value) => set("lanceActive", value)} />
              <Toggle label="Target in cover" checked={profile.targetCover} onChange={(value) => set("targetCover", value)} />
              <Toggle label="Ignores Cover" checked={profile.ignoresCover} onChange={(value) => set("ignoresCover", value)} />
              <Toggle label="Indirect · no LOS" checked={profile.indirect} onChange={(value) => set("indirect", value)} />
            </div>
          </section>
        </div>

        <aside className="results-panel" aria-live="polite">
          <div className="results-heading">
            <span>OUTCOME // EXACT MEAN</span>
            <p>Expected damage</p>
          </div>
          <div className="mean-readout">
            <strong>{result ? result.mean.toFixed(2) : "—"}</strong>
            <span>WOUNDS</span>
          </div>
          {result && (
            <>
              <p className="fraction">
                Exact <b>{result.numerator.toString()} / {result.denominator.toString()}</b>
              </p>
              <div className="quartile-title">
                <span>Damage spread</span>
                <small>25% / 50% / 75%</small>
              </div>
              <div className="damage-rail" aria-label="Damage quartiles">
                <div className="rail-line" />
                {[
                  ["MIN", result.minimum],
                  ["Q1", result.firstQuartile],
                  ["MED", result.median],
                  ["Q3", result.thirdQuartile],
                  ["MAX", result.maximum],
                ].map(([label, value], index) => (
                  <div
                    className={`rail-point point-${index}`}
                    key={label}
                    style={{
                      left: `${result.maximum ? (Number(value) / result.maximum) * 100 : index * 25}%`,
                    }}
                  >
                    <b>{value}</b>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <div className="result-table">
                <div><span>Likely floor</span><b>{result.firstQuartile}</b></div>
                <div><span>Median</span><b>{result.median}</b></div>
                <div><span>Likely ceiling</span><b>{result.thirdQuartile}</b></div>
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
