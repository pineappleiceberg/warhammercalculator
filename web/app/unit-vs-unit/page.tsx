"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkflowNav } from "../../components/workflow-nav";
import { calculateProfile, type DamageSummary } from "../../lib/client-calculator";
import { DEFAULT_PROFILE } from "../../lib/combat";
import {
  equippedWeaponLines,
  groupWeaponProfiles,
  normalizeEquippedCount,
  weaponAllocationErrors,
} from "../../lib/loadout.mjs";
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
  const [weaponCounts, setWeaponCounts] = useState<Record<string, number>>({});
  const [profileCounts, setProfileCounts] = useState<Record<number, number>>({});
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
  const weaponGroups = groupWeaponProfiles(attackerUnit?.weapons ?? []);

  const selectAttacker = (unitId: string) => {
    setAttackerUnitId(unitId);
    const unit = attackerUnits.find((entry) => entry.id === unitId);
    const groups = groupWeaponProfiles(unit?.weapons ?? []);
    setAttackerModels(unit?.suggestedModelCount ?? 1);
    setWeaponCounts(Object.fromEntries(groups.map((group) => [group.id, 0])));
    setProfileCounts(
      Object.fromEntries(
        groups.flatMap((group) => group.profiles.map((profile) => [profile.id, 0])),
      ),
    );
    setResults([]);
    setStatus(unit ? "Set the total equipped weapon quantities" : "Choose both units");
  };

  const selectTarget = (unitId: string) => {
    setTargetUnitId(unitId);
    const unit = targetUnits.find((entry) => entry.id === unitId);
    const model = unit?.models[0];
    setTargetModels(unit?.suggestedModelCount ?? 1);
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
    const allocationErrors = weaponAllocationErrors(weaponGroups, weaponCounts, profileCounts);
    if (allocationErrors.length) {
      setStatus(allocationErrors[0]);
      return;
    }
    const lines = equippedWeaponLines(weaponGroups, weaponCounts, profileCounts);
    if (!lines.length) {
      setStatus("Enter at least one equipped weapon quantity");
      return;
    }
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
                max={attackerUnit?.maximumModelCount ?? 100}
                value={attackerModels}
                onChange={(event) => setAttackerModels(Math.max(1, +event.target.value))}
              />
            </label>
            {attackerUnit && (
              <div className="loadout-list">
                <h3>Total weapons equipped</h3>
                {weaponGroups.map((group) => (
                  <div className="weapon-group" key={group.id}>
                    <label>
                      <span>
                        {group.name}
                        <small>
                          {group.profiles.length > 1
                            ? `${group.profiles.length} mutually exclusive profiles`
                            : `${group.profiles[0].attacks} · S${group.profiles[0].strength} · AP ${group.profiles[0].ap ?? "—"} · D ${group.profiles[0].damage}`}
                          {" · copies across unit"}
                        </small>
                      </span>
                      <input
                        aria-label={`${group.name} count`}
                        type="number"
                        min={0}
                        max={100}
                        value={weaponCounts[group.id] ?? 0}
                        onChange={(event) =>
                          setWeaponCounts((current) => ({
                            ...current,
                            [group.id]: normalizeEquippedCount(+event.target.value),
                          }))
                        }
                      />
                    </label>
                    {group.profiles.length > 1 && (
                      <div className="profile-allocations">
                        <span>Copies using each profile this volley</span>
                        {group.profiles.map((profile) => (
                          <label key={profile.id}>
                            <span>
                              {profile.profileName ?? profile.name}
                              <small>
                                {profile.attacks} · S{profile.strength} · AP {profile.ap ?? "—"} · D{" "}
                                {profile.damage}
                              </small>
                            </span>
                            <input
                              aria-label={`${profile.name} firing count`}
                              type="number"
                              min={0}
                              max={weaponCounts[group.id] ?? 0}
                              value={profileCounts[profile.id] ?? 0}
                              onChange={(event) =>
                                setProfileCounts((current) => ({
                                  ...current,
                                  [profile.id]: normalizeEquippedCount(
                                    +event.target.value,
                                    weaponCounts[group.id] ?? 0,
                                  ),
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <details className="source-guidance" open>
                  <summary>Unit composition</summary>
                  <ul>
                    {attackerUnit.composition.map((line, index) => (
                      <li key={`${line.text}-${index}`}>{line.text}</li>
                    ))}
                  </ul>
                </details>
                {attackerUnit.wargearOptions.length > 0 && (
                  <details className="source-guidance">
                    <summary>Wargear options ({attackerUnit.wargearOptions.length})</summary>
                    <ul>
                      {attackerUnit.wargearOptions.map((option, index) => (
                        <li key={`${option}-${index}`}>{option}</li>
                      ))}
                    </ul>
                  </details>
                )}
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
                max={targetUnit?.maximumModelCount ?? 1000}
                value={targetModels}
                onChange={(event) => setTargetModels(Math.max(1, +event.target.value))}
              />
            </label>
            {targetUnit && targetUnit.composition.length > 0 && (
              <details className="source-guidance" open>
                <summary>Unit composition</summary>
                <ul>
                  {targetUnit.composition.map((line, index) => (
                    <li key={`${line.text}-${index}`}>{line.text}</li>
                  ))}
                </ul>
              </details>
            )}
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
          <span>Potential damage before allocation</span>
          <strong>{total.toFixed(2)}</strong>
        </div>
        {results.length > 0 && (
          <div className="result-lines">
            {results.map((line) => (
              <div key={line.weapon.id}>
                <span>
                  {line.count} × {line.weapon.name}
                </span>
                <b>{line.result?.appliedMean.toFixed(2)} applied</b>
                <small>
                  {line.result?.mean.toFixed(2)} potential · median {line.result?.appliedMedian} ·
                  range {line.result?.appliedMinimum}–{line.result?.appliedMaximum}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
