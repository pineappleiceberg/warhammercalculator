"use client";

import { useEffect, useState } from "react";
import { WorkflowNav } from "../../components/workflow-nav";
import { fetchArmyLists, type ArmyListRecord } from "../../lib/army-list";
import {
  DEFAULT_PROFILE,
  simulateAttack,
  type CombatProfile,
  type RollResult,
} from "../../lib/combat";
import {
  applyTargetProfile,
  applyWeaponProfile,
  loadCatalogue,
  type Catalogue,
} from "../../lib/catalogue";

type LogEntry = {
  id: string;
  attacker: string;
  weapon: string;
  target: string;
  damage: number;
  successful: number;
};

export default function PlayMode() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [lists, setLists] = useState<ArmyListRecord[]>([]);
  const [attackerListId, setAttackerListId] = useState("");
  const [targetListId, setTargetListId] = useState("");
  const [attackerUnitId, setAttackerUnitId] = useState("");
  const [targetUnitId, setTargetUnitId] = useState("");
  const [weaponId, setWeaponId] = useState("");
  const [targetModelId, setTargetModelId] = useState("");
  const [profile, setProfile] = useState<CombatProfile>(DEFAULT_PROFILE);
  const [result, setResult] = useState<RollResult | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState("Select two saved lists");

  useEffect(() => {
    Promise.all([loadCatalogue(), fetchArmyLists()])
      .then(([profiles, saved]) => {
        setCatalogue(profiles);
        setLists(saved);
        setStatus("Battle console ready");
      })
      .catch(() => setStatus("Saved lists are unavailable in this deployment"));
  }, []);

  const attackerList = lists.find((list) => list.id === attackerListId);
  const targetList = lists.find((list) => list.id === targetListId);
  const attackerUnit = attackerList?.units.find((unit) => unit.id === attackerUnitId);
  const targetUnit = targetList?.units.find((unit) => unit.id === targetUnitId);
  const selectedWeapon = attackerUnit?.weapons.find(
    (weapon) => String(weapon.weaponId) === weaponId,
  );
  const weaponProfile = catalogue?.units
    .find((unit) => unit.id === attackerUnit?.unitId)
    ?.weapons.find((weapon) => String(weapon.id) === weaponId);
  const targetProfiles =
    catalogue?.units.find((unit) => unit.id === targetUnit?.unitId)?.models ?? [];

  const refreshProfile = (nextWeaponId = weaponId, nextTargetModelId = targetModelId) => {
    const weapon = catalogue?.units
      .find((unit) => unit.id === attackerUnit?.unitId)
      ?.weapons.find((entry) => String(entry.id) === nextWeaponId);
    const model =
      targetProfiles.find((entry) => String(entry.id) === nextTargetModelId) ?? targetProfiles[0];
    const listWeapon = attackerUnit?.weapons.find(
      (entry) => String(entry.weaponId) === nextWeaponId,
    );
    if (!weapon || !model) return;
    setProfile(
      applyWeaponProfile(
        {
          ...applyTargetProfile(DEFAULT_PROFILE, model),
          weaponCount: listWeapon?.count ?? 1,
          targetModels: targetUnit?.modelCount ?? 1,
        },
        weapon,
        model.keywords,
      ),
    );
    setResult(null);
  };

  const chooseWeapon = (id: string) => {
    setWeaponId(id);
    refreshProfile(id, targetModelId);
  };

  const chooseTargetProfile = (id: string) => {
    setTargetModelId(id);
    refreshProfile(weaponId, id);
  };

  const chooseTargetUnit = (id: string) => {
    const nextTarget = targetList?.units.find((unit) => unit.id === id);
    const model = catalogue?.units.find((unit) => unit.id === nextTarget?.unitId)?.models[0];
    setTargetUnitId(id);
    setTargetModelId(model ? String(model.id) : "");
    if (!weaponProfile || !model || !nextTarget) return;
    setProfile(
      applyWeaponProfile(
        {
          ...applyTargetProfile(DEFAULT_PROFILE, model),
          weaponCount: selectedWeapon?.count ?? 1,
          targetModels: nextTarget.modelCount,
        },
        weaponProfile,
        model.keywords,
      ),
    );
    setResult(null);
  };

  const roll = () => {
    if (!attackerUnit || !targetUnit || !selectedWeapon || !weaponProfile) return;
    const rolled = simulateAttack(profile);
    setResult(rolled);
    setHistory((current) =>
      [
        {
          id: crypto.randomUUID(),
          attacker: attackerUnit.name,
          weapon: selectedWeapon.name,
          target: targetUnit.name,
          damage: rolled.appliedDamage,
          successful: rolled.successfulAttacks,
        },
        ...current,
      ].slice(0, 30),
    );
    setStatus(`${rolled.appliedDamage} damage applied`);
  };

  const setNumber = (key: keyof CombatProfile, value: number) =>
    setProfile((current) => ({ ...current, [key]: value }));

  const ready = Boolean(attackerUnit && targetUnit && selectedWeapon && targetModelId);

  return (
    <main>
      <header className="masthead">
        <div className="brand-lockup">
          <span className="serial">BATTLE CONSOLE // 10E</span>
          <h1>Play Mode</h1>
        </div>
        <div className="engine-status ready">
          <span />
          {status}
        </div>
      </header>
      <WorkflowNav current="/play" />
      <div className="play-layout">
        <section className="panel play-console">
          <div className="panel-heading">
            <span>01</span>
            <div>
              <p>Rapid resolution</p>
              <h2>Choose attack</h2>
            </div>
          </div>
          <div className="panel-body">
            <div className="play-selectors">
              <label>
                <span>Attacking list</span>
                <select
                  value={attackerListId}
                  onChange={(event) => {
                    setAttackerListId(event.target.value);
                    setAttackerUnitId("");
                    setWeaponId("");
                  }}
                >
                  <option value="">Choose list</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Attacking unit</span>
                <select
                  value={attackerUnitId}
                  onChange={(event) => {
                    setAttackerUnitId(event.target.value);
                    setWeaponId("");
                  }}
                >
                  <option value="">Choose unit</option>
                  {attackerList?.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} ({unit.modelCount})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Weapon</span>
                <select value={weaponId} onChange={(event) => chooseWeapon(event.target.value)}>
                  <option value="">Choose weapon</option>
                  {attackerUnit?.weapons
                    .filter((weapon) => weapon.count > 0)
                    .map((weapon) => (
                      <option key={weapon.weaponId} value={weapon.weaponId}>
                        {weapon.name} × {weapon.count}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Target list</span>
                <select
                  value={targetListId}
                  onChange={(event) => {
                    setTargetListId(event.target.value);
                    setTargetUnitId("");
                  }}
                >
                  <option value="">Choose list</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Target unit</span>
                <select
                  value={targetUnitId}
                  onChange={(event) => chooseTargetUnit(event.target.value)}
                >
                  <option value="">Choose unit</option>
                  {targetList?.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} ({unit.modelCount})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Target profile</span>
                <select
                  value={targetModelId}
                  onChange={(event) => chooseTargetProfile(event.target.value)}
                >
                  <option value="">Choose profile</option>
                  {targetProfiles.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="override-strip">
              <h3>Quick overrides</h3>
              <div>
                {(
                  [
                    ["weaponCount", "Weapons"],
                    ["attacks", "Attacks"],
                    ["hitOn", "Hit"],
                    ["strength", "S"],
                    ["ap", "AP"],
                    ["damage", "Damage"],
                    ["toughness", "T"],
                    ["save", "Save"],
                    ["invulnerable", "Invuln"],
                    ["feelNoPain", "FNP"],
                    ["targetModels", "Targets"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={key === "invulnerable" || key === "feelNoPain" ? 0 : 1}
                      value={profile[key] as number}
                      onChange={(event) => setNumber(key, Math.max(0, +event.target.value))}
                    />
                  </label>
                ))}
              </div>
            </div>
            <button className="resolve-button" type="button" disabled={!ready} onClick={roll}>
              Resolve attack
            </button>
          </div>
        </section>
        <aside className="resolution-panel">
          <span className="section-kicker">Latest result</span>
          {!result && <p>Choose an attack to begin.</p>}
          {result && (
            <>
              <strong className="damage-callout">{result.appliedDamage}</strong>
              <span className="damage-label">damage applied</span>
              <div className="combat-flow">
                <div>
                  <b>{result.attacks}</b>
                  <span>Attacks</span>
                </div>
                <div>
                  <b>{result.hits}</b>
                  <span>Hits</span>
                </div>
                <div>
                  <b>{result.woundingAttacks}</b>
                  <span>Wounds</span>
                </div>
                <div>
                  <b>{result.savedAttacks}</b>
                  <span>Saved</span>
                </div>
                <div>
                  <b>{result.fnpPrevented}</b>
                  <span>FNP</span>
                </div>
                <div>
                  <b>{result.successfulAttacks}</b>
                  <span>Through</span>
                </div>
              </div>
              <p>
                {result.modelsDestroyed} models destroyed · {result.wastedDamage} excess damage lost
                · {result.totalDamage} damage rolled.
              </p>
            </>
          )}
        </aside>
      </div>
      <section className="battle-log">
        <div className="battle-log-head">
          <div>
            <span className="section-kicker">Attack history</span>
            <h2>Battle log</h2>
          </div>
          {history.length > 0 && (
            <button type="button" onClick={() => setHistory([])}>
              Clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p>Resolved attacks will appear here for this play session.</p>
        ) : (
          history.map((entry, index) => (
            <article key={entry.id}>
              <b>{history.length - index}</b>
              <span>{entry.attacker}</span>
              <span>{entry.weapon}</span>
              <span>into {entry.target}</span>
              <strong>{entry.damage} damage</strong>
              <small>{entry.successful} through</small>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
