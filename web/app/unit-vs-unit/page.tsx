"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkflowNav } from "../../components/workflow-nav";
import { calculateProfile, type DamageSummary } from "../../lib/client-calculator";
import { DEFAULT_PROFILE } from "../../lib/combat";
import {
  applyTargetProfile,
  applyWeaponProfile,
  loadCatalogue,
  type Catalogue,
  type CatalogueWeapon,
} from "../../lib/catalogue";

type WeaponLine = { weapon: CatalogueWeapon; count: number; result?: DamageSummary };

export default function UnitVsUnit() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [attackerFaction, setAttackerFaction] = useState("");
  const [attackerUnitId, setAttackerUnitId] = useState("");
  const [targetFaction, setTargetFaction] = useState("");
  const [targetUnitId, setTargetUnitId] = useState("");
  const [targetModelId, setTargetModelId] = useState("");
  const [attackerModels, setAttackerModels] = useState(1);
  const [targetModels, setTargetModels] = useState(1);
  const [weaponCounts, setWeaponCounts] = useState<Record<number, number>>({});
  const [targetOverrides, setTargetOverrides] = useState({
    toughness: 8,
    save: 3,
    invulnerable: 0,
    wounds: 12,
  });
  const [results, setResults] = useState<WeaponLine[]>([]);
  const [status, setStatus] = useState("Choose both units");

  useEffect(() => {
    loadCatalogue()
      .then(setCatalogue)
      .catch(() => setStatus("Profile catalogue unavailable"));
  }, []);

  const attackerUnits = useMemo(
    () =>
      catalogue?.units.filter(
        (unit) => unit.factionId === attackerFaction && unit.weapons.length,
      ) ?? [],
    [catalogue, attackerFaction],
  );
  const targetUnits = useMemo(
    () =>
      catalogue?.units.filter((unit) => unit.factionId === targetFaction && unit.models.length) ??
      [],
    [catalogue, targetFaction],
  );
  const attackerUnit = attackerUnits.find((unit) => unit.id === attackerUnitId);
  const targetUnit = targetUnits.find((unit) => unit.id === targetUnitId);

  const selectAttacker = (unitId: string) => {
    setAttackerUnitId(unitId);
    const unit = attackerUnits.find((entry) => entry.id === unitId);
    setWeaponCounts(Object.fromEntries((unit?.weapons ?? []).map((weapon) => [weapon.id, 1])));
    setResults([]);
  };

  const selectTarget = (unitId: string) => {
    setTargetUnitId(unitId);
    const unit = targetUnits.find((entry) => entry.id === unitId);
    const model = unit?.models[0];
    setTargetModelId(model ? String(model.id) : "");
    if (model) {
      setTargetOverrides({
        toughness: model.t ?? 8,
        save: model.save ?? 7,
        invulnerable: model.invuln ?? 0,
        wounds: model.wounds ?? 1,
      });
    }
    setResults([]);
  };

  const calculateUnit = async () => {
    if (!attackerUnit || !targetUnit) return;
    setStatus("Calculating unit volley…");
    const model =
      targetUnit.models.find((entry) => String(entry.id) === targetModelId) ?? targetUnit.models[0];
    const lines = attackerUnit.weapons
      .filter((weapon) => (weaponCounts[weapon.id] ?? 0) > 0)
      .map((weapon) => ({ weapon, count: weaponCounts[weapon.id] * attackerModels }));
    try {
      const resolved = await Promise.all(
        lines.map(async (line) => {
          const target = applyTargetProfile(DEFAULT_PROFILE, model);
          const profile = applyWeaponProfile(
            { ...target, ...targetOverrides, targetModels, weaponCount: line.count },
            line.weapon,
            model.keywords,
          );
          return { ...line, result: await calculateProfile(profile) };
        }),
      );
      setResults(resolved);
      setStatus("Volley calculated");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Calculation failed");
    }
  };

  const total = results.reduce((sum, line) => sum + (line.result?.mean ?? 0), 0);

  return (
    <main>
      <header className="masthead">
        <div className="brand-lockup">
          <span className="serial">COGITATOR // 10E</span>
          <h1>Unit vs Unit</h1>
        </div>
        <div className="engine-status ready">
          <span />
          {status}
        </div>
      </header>
      <WorkflowNav current="/unit-vs-unit" />
      <div className="workspace-grid">
        <section className="panel workspace-panel">
          <div className="panel-heading">
            <span>01</span>
            <div>
              <p>Attacking formation</p>
              <h2>Unit and loadout</h2>
            </div>
          </div>
          <div className="panel-body compact-form">
            <label>
              <span>Faction</span>
              <select
                value={attackerFaction}
                onChange={(event) => {
                  setAttackerFaction(event.target.value);
                  setAttackerUnitId("");
                }}
              >
                <option value="">Choose faction</option>
                {catalogue?.factions.map((faction) => (
                  <option key={faction.id} value={faction.id}>
                    {faction.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Unit</span>
              <select
                value={attackerUnitId}
                onChange={(event) => selectAttacker(event.target.value)}
              >
                <option value="">Choose unit</option>
                {attackerUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Models firing</span>
              <input
                type="number"
                min={1}
                max={100}
                value={attackerModels}
                onChange={(event) => setAttackerModels(Math.max(1, +event.target.value))}
              />
            </label>
            {attackerUnit && (
              <div className="loadout-list">
                <h3>Weapons per model</h3>
                {attackerUnit.weapons.map((weapon) => (
                  <label key={weapon.id}>
                    <span>
                      {weapon.name}
                      <small>
                        {weapon.attacks} · S{weapon.strength} · AP {weapon.ap ?? "—"} · D{" "}
                        {weapon.damage}
                      </small>
                    </span>
                    <input
                      aria-label={`${weapon.name} count`}
                      type="number"
                      min={0}
                      max={20}
                      value={weaponCounts[weapon.id] ?? 0}
                      onChange={(event) =>
                        setWeaponCounts((current) => ({
                          ...current,
                          [weapon.id]: Math.max(0, +event.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="panel workspace-panel">
          <div className="panel-heading">
            <span>02</span>
            <div>
              <p>Defending formation</p>
              <h2>Target unit</h2>
            </div>
          </div>
          <div className="panel-body compact-form">
            <label>
              <span>Faction</span>
              <select
                value={targetFaction}
                onChange={(event) => {
                  setTargetFaction(event.target.value);
                  setTargetUnitId("");
                }}
              >
                <option value="">Choose faction</option>
                {catalogue?.factions.map((faction) => (
                  <option key={faction.id} value={faction.id}>
                    {faction.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Unit</span>
              <select value={targetUnitId} onChange={(event) => selectTarget(event.target.value)}>
                <option value="">Choose unit</option>
                {targetUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Profile</span>
              <select
                value={targetModelId}
                onChange={(event) => {
                  const model = targetUnit?.models.find(
                    (entry) => String(entry.id) === event.target.value,
                  );
                  setTargetModelId(event.target.value);
                  if (model)
                    setTargetOverrides({
                      toughness: model.t ?? 8,
                      save: model.save ?? 7,
                      invulnerable: model.invuln ?? 0,
                      wounds: model.wounds ?? 1,
                    });
                }}
              >
                <option value="">Choose profile</option>
                {targetUnit?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Models in target</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={targetModels}
                onChange={(event) => setTargetModels(Math.max(1, +event.target.value))}
              />
            </label>
            <div className="stat-row">
              {(
                [
                  ["toughness", "T"],
                  ["save", "Save"],
                  ["invulnerable", "Invuln"],
                  ["wounds", "W/model"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    type="number"
                    min={key === "invulnerable" ? 0 : 1}
                    value={targetOverrides[key]}
                    onChange={(event) =>
                      setTargetOverrides((current) => ({
                        ...current,
                        [key]: Math.max(0, +event.target.value),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </section>
      </div>
      <section className="volley-results">
        <button
          className="primary-action"
          type="button"
          disabled={!attackerUnit || !targetUnit}
          onClick={calculateUnit}
        >
          Calculate full volley
        </button>
        <div className="volley-total">
          <span>Expected unit damage</span>
          <strong>{total.toFixed(2)}</strong>
        </div>
        {results.length > 0 && (
          <div className="result-lines">
            {results.map((line) => (
              <div key={line.weapon.id}>
                <span>
                  {line.count} × {line.weapon.name}
                </span>
                <b>{line.result?.mean.toFixed(2)} damage</b>
                <small>
                  Median {line.result?.median} · range {line.result?.minimum}–{line.result?.maximum}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
