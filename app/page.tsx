"use client";

import { useEffect, useMemo, useState } from "react";

type Profile = {
  attackDice: number;
  attackSides: number;
  attacks: number;
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
  reduction: number;
  criticalWounds: number;
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

const DEFAULT_PROFILE: Profile = {
  attackDice: 0,
  attackSides: 0,
  attacks: 4,
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
  reduction: 0,
  criticalWounds: 0,
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
  return (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
}

async function calculate(profile: Profile): Promise<Result> {
  const module = await loadCalculator();
  const output = module._malloc(36);
  const flags =
    (profile.lethalHits ? 1 : 0) |
    (profile.devastatingWounds ? 2 : 0) |
    (profile.twinLinked ? 4 : 0) |
    (profile.rerollHits ? 8 : 0);

  try {
    const ok = module._whc_calculate_summary(
      profile.attackDice,
      profile.attackSides,
      profile.attacks,
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
      output,
    );

    if (!ok) throw new Error("That profile exceeds the calculator limits.");

    const read = (index: number) =>
      module.getValue(output + index * 4, "i32") >>> 0;
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
    module._free(output);
  }
}

function formatDice(count: number, sides: number, modifier: number) {
  if (count === 0) return `${modifier}`;
  const suffix = modifier > 0 ? `+${modifier}` : "";
  return `${count > 1 ? count : ""}D${sides}${suffix}`;
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

export default function Home() {
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("Loading calculation engine…");

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setProfile((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let active = true;
    setStatus("loading");
    calculate(profile)
      .then((next) => {
        if (!active) return;
        setResult(next);
        setStatus("ready");
        setMessage("Calculated locally in WebAssembly");
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
              <div className="field-grid two">
                <SelectField label="Critical hits" value={profile.criticalHits} onChange={(value) => set("criticalHits", value)} />
                <SelectField label="Critical wounds / Anti-X" value={profile.criticalWounds} onChange={(value) => set("criticalWounds", value)} allowNone />
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
            <div className="panel-body field-grid three">
              <NumberField label="Toughness" value={profile.toughness} min={1} onChange={(value) => set("toughness", value)} suffix="T" />
              <SelectField label="Armour save" value={profile.save} onChange={(value) => set("save", value)} />
              <SelectField label="Invulnerable save" value={profile.invulnerable} onChange={(value) => set("invulnerable", value)} allowNone />
              <SelectField label="Feel No Pain" value={profile.feelNoPain} onChange={(value) => set("feelNoPain", value)} allowNone />
              <NumberField label="Wounds" value={profile.wounds} min={1} onChange={(value) => set("wounds", value)} suffix="W" />
              <NumberField label="Damage reduction" value={profile.reduction} onChange={(value) => set("reduction", value)} suffix="−D" />
            </div>
          </section>

          <section className="panel rules-panel" aria-labelledby="rules-heading">
            <div className="panel-heading rules-heading">
              <span>03</span>
              <div>
                <p>Weapon abilities</p>
                <h2 id="rules-heading">Rules</h2>
              </div>
            </div>
            <div className="rules-grid">
              {[
                ["lethalHits", "Lethal Hits", "Critical hits wound automatically"],
                ["devastatingWounds", "Devastating Wounds", "Critical wounds bypass saves"],
                ["twinLinked", "Twin-linked", "Re-roll failed wound rolls"],
                ["rerollHits", "Re-roll Hits", "Re-roll failed hit rolls"],
              ].map(([key, title, detail]) => (
                <label className="rule-toggle" key={key}>
                  <input
                    type="checkbox"
                    checked={profile[key as keyof Profile] as boolean}
                    onChange={(event) =>
                      set(key as keyof Profile, event.target.checked as never)
                    }
                  />
                  <span className="checkmark" aria-hidden="true" />
                  <span>
                    <b>{title}</b>
                    <small>{detail}</small>
                  </span>
                </label>
              ))}
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
                Exact mean <b>{result.numerator.toString()} / {result.denominator.toString()}</b>
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
          <div className="scope-note">
            <b>Calculation scope</b>
            <p>Reports uncapped inflicted damage. Model-by-model spill, Blast, Sustained Hits, and target wound caps are not applied.</p>
          </div>
          <footer>
            Runs entirely on your device · C17 fixed-point engine
          </footer>
        </aside>
      </div>
    </main>
  );
}
