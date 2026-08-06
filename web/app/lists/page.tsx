"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkflowNav } from "../../components/workflow-nav";
import {
  fetchArmyLists,
  type ArmyListInput,
  type ArmyListRecord,
  type ArmyListUnit,
} from "../../lib/army-list";
import { loadCatalogue, type Catalogue } from "../../lib/catalogue";
import {
  applyChoiceSelectionChange,
  applyModelCountChange,
  armyListWeaponsFromGroups,
  choicePoolMaximum,
  defaultWeaponCounts,
  groupWeaponProfiles,
  normalizeEquippedCount,
  unitLoadoutWarnings,
} from "../../lib/loadout.mjs";

const emptyList: ArmyListInput = { name: "", factionId: "", units: [] };

export default function ArmyLists() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [lists, setLists] = useState<ArmyListRecord[]>([]);
  const [draft, setDraft] = useState<ArmyListInput>(emptyList);
  const [editingId, setEditingId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [status, setStatus] = useState("Loading lists…");

  const reload = () =>
    fetchArmyLists()
      .then((items) => {
        setLists(items);
        setStatus("Lists ready");
      })
      .catch(() => setStatus("List storage unavailable in this deployment"));

  useEffect(() => {
    loadCatalogue()
      .then(setCatalogue)
      .catch(() => setStatus("Profile catalogue unavailable"));
    reload();
  }, []);

  const units = useMemo(
    () => catalogue?.units.filter((unit) => unit.factionId === draft.factionId) ?? [],
    [catalogue, draft.factionId],
  );

  const addUnit = () => {
    const unit = units.find((entry) => entry.id === unitId);
    if (!unit) return;
    const weaponGroups = groupWeaponProfiles(unit.weapons);
    const modelCount = unit.suggestedModelCount ?? 1;
    const defaults = defaultWeaponCounts(unit, modelCount);
    const item: ArmyListUnit = {
      id: crypto.randomUUID(),
      unitId: unit.id,
      name: unit.name,
      modelCount,
      weapons: armyListWeaponsFromGroups(weaponGroups, defaults),
      choiceSelections: Object.fromEntries(
        unit.wargearChoicePools.flatMap((pool) =>
          pool.alternatives.map((alternative) => [alternative.id, 0]),
        ),
      ),
    };
    setDraft((current) => ({ ...current, units: [...current.units, item] }));
    setUnitId("");
  };

  const changeUnit = (id: string, update: (unit: ArmyListUnit) => ArmyListUnit) =>
    setDraft((current) => ({
      ...current,
      units: current.units.map((unit) => (unit.id === id ? update(unit) : unit)),
    }));

  const save = async () => {
    if (!draft.name.trim() || !draft.factionId) return;
    setStatus("Saving…");
    const response = await fetch(editingId ? `/api/v1/lists/${editingId}` : "/api/v1/lists", {
      method: editingId ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!response.ok) {
      setStatus("Could not save this list");
      return;
    }
    setDraft(emptyList);
    setEditingId("");
    reload();
  };

  const edit = (list: ArmyListRecord) => {
    setEditingId(list.id);
    setDraft({ name: list.name, factionId: list.factionId, units: list.units });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (id: string) => {
    await fetch(`/api/v1/lists/${id}`, { method: "DELETE" });
    reload();
  };

  return (
    <main>
      <header className="masthead">
        <div className="brand-lockup">
          <span className="serial">MUSTER CONTROL // 10E</span>
          <h1>Army Lists</h1>
        </div>
        <div className="engine-status ready">
          <span />
          {status}
        </div>
      </header>
      <WorkflowNav current="/lists" />
      <div className="list-workspace">
        <section className="panel workspace-panel">
          <div className="panel-heading">
            <span>01</span>
            <div>
              <p>{editingId ? "Editing roster" : "New roster"}</p>
              <h2>Build a battle list</h2>
            </div>
          </div>
          <div className="panel-body compact-form">
            <label>
              <span>List name</span>
              <input
                value={draft.name}
                maxLength={100}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Awakened Dynasty — 2,000 pts"
              />
            </label>
            <label>
              <span>Faction</span>
              <select
                value={draft.factionId}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, factionId: event.target.value, units: [] }));
                  setUnitId("");
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
            <div className="add-unit-row">
              <label>
                <span>Add unit</span>
                <select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
                  <option value="">Choose unit</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={addUnit} disabled={!unitId}>
                Add
              </button>
            </div>
            <div className="roster-units">
              {draft.units.map((unit) => (
                <article key={unit.id}>
                  <div className="roster-unit-head">
                    <div>
                      <h3>{unit.name}</h3>
                      <label>
                        <span>Models</span>
                        <input
                          type="number"
                          min={1}
                          max={1000}
                          value={unit.modelCount}
                          onChange={(event) => {
                            const next = Math.max(1, +event.target.value);
                            const sourceUnit = catalogue?.units.find(
                              (entry) => entry.id === unit.unitId,
                            );
                            changeUnit(unit.id, (current) => {
                              const counts = Object.fromEntries(
                                current.weapons.map((weapon) => [
                                  weapon.groupId ?? String(weapon.weaponId),
                                  weapon.count,
                                ]),
                              );
                              const adjusted = applyModelCountChange(
                                counts,
                                sourceUnit,
                                current.modelCount,
                                next,
                              );
                              return {
                                ...current,
                                modelCount: next,
                                weapons: current.weapons.map((weapon) => ({
                                  ...weapon,
                                  count: adjusted[weapon.groupId ?? String(weapon.weaponId)] ?? 0,
                                })),
                              };
                            });
                          }}
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          units: current.units.filter((entry) => entry.id !== unit.id),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <div className="weapon-counts">
                    {unit.weapons.map((weapon) => {
                      const sourceUnit = catalogue?.units.find((entry) => entry.id === unit.unitId);
                      const groupId = weapon.groupId ?? String(weapon.weaponId);
                      const structured = sourceUnit?.wargearChoicePools.some(
                        (pool) =>
                          pool.replaces.some((choice) => choice.groupId === groupId) ||
                          pool.alternatives.some((alternative) =>
                            alternative.weapons.some((choice) => choice.groupId === groupId),
                          ),
                      );
                      const manualOption =
                        !structured &&
                        sourceUnit?.weaponLimits.some((limit) => limit.groupId === groupId);
                      return (
                        <label key={weapon.weaponId}>
                          <span>{weapon.name}</span>
                          <input
                            aria-label={`${weapon.name} copies`}
                            type="number"
                            min={0}
                            max={100}
                            value={weapon.count}
                            onChange={(event) =>
                              changeUnit(unit.id, (current) => ({
                                ...current,
                                weapons: current.weapons.map((entry) =>
                                  entry.weaponId === weapon.weaponId
                                    ? {
                                        ...entry,
                                        count: normalizeEquippedCount(+event.target.value),
                                      }
                                    : entry,
                                ),
                              }))
                            }
                          />
                          {manualOption && (
                            <span className="option-count-inline">
                              <span>Via options</span>
                              <input
                                aria-label={`${weapon.name} option-selected copies`}
                                type="number"
                                min={0}
                                max={weapon.count}
                                value={weapon.optionCount ?? 0}
                                onChange={(event) =>
                                  changeUnit(unit.id, (current) => ({
                                    ...current,
                                    weapons: current.weapons.map((entry) =>
                                      entry.weaponId === weapon.weaponId
                                        ? {
                                            ...entry,
                                            optionCount: normalizeEquippedCount(
                                              +event.target.value,
                                            ),
                                          }
                                        : entry,
                                    ),
                                  }))
                                }
                              />
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  {(() => {
                    const sourceUnit = catalogue?.units.find((entry) => entry.id === unit.unitId);
                    const counts = Object.fromEntries(
                      unit.weapons.map((weapon) => [
                        weapon.groupId ?? String(weapon.weaponId),
                        weapon.count,
                      ]),
                    );
                    const optionCounts = Object.fromEntries(
                      unit.weapons.map((weapon) => [
                        weapon.groupId ?? String(weapon.weaponId),
                        weapon.optionCount ?? 0,
                      ]),
                    );
                    const warnings = unitLoadoutWarnings(
                      sourceUnit,
                      unit.modelCount,
                      optionCounts,
                      counts,
                      unit.choiceSelections ?? {},
                    );
                    return (
                      <>
                        {(sourceUnit?.wargearChoicePools.length ?? 0) > 0 && (
                          <details className="source-choice-pools roster-choice-pools">
                            <summary>Source option choices</summary>
                            {sourceUnit?.wargearChoicePools.map((pool) => {
                              const maximum = choicePoolMaximum(pool, unit.modelCount);
                              const used = pool.alternatives.reduce(
                                (sum, alternative) =>
                                  sum + (unit.choiceSelections?.[alternative.id] ?? 0),
                                0,
                              );
                              return (
                                <fieldset key={pool.id}>
                                  <legend>
                                    {used}/{maximum} selections
                                  </legend>
                                  <small>{pool.source}</small>
                                  {pool.alternatives.map((alternative) => (
                                    <label key={alternative.id}>
                                      <span>{alternative.label}</span>
                                      <input
                                        aria-label={`${alternative.label} source selections`}
                                        type="number"
                                        min={0}
                                        max={maximum}
                                        value={unit.choiceSelections?.[alternative.id] ?? 0}
                                        onChange={(event) => {
                                          const next = normalizeEquippedCount(
                                            +event.target.value,
                                            maximum,
                                          );
                                          changeUnit(unit.id, (current) => {
                                            const previous =
                                              current.choiceSelections?.[alternative.id] ?? 0;
                                            const counts = Object.fromEntries(
                                              current.weapons.map((weapon) => [
                                                weapon.groupId ?? String(weapon.weaponId),
                                                weapon.count,
                                              ]),
                                            );
                                            const adjusted = applyChoiceSelectionChange(
                                              counts,
                                              pool,
                                              alternative,
                                              previous,
                                              next,
                                            );
                                            return {
                                              ...current,
                                              weapons: current.weapons.map((weapon) => ({
                                                ...weapon,
                                                count:
                                                  adjusted[
                                                    weapon.groupId ?? String(weapon.weaponId)
                                                  ] ?? 0,
                                              })),
                                              choiceSelections: {
                                                ...(current.choiceSelections ?? {}),
                                                [alternative.id]: next,
                                              },
                                            };
                                          });
                                        }}
                                      />
                                    </label>
                                  ))}
                                </fieldset>
                              );
                            })}
                          </details>
                        )}
                        {warnings.length > 0 && (
                          <div className="loadout-warnings" role="status">
                            <strong>Source loadout check</strong>
                            <ul>
                              {warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                            <small>
                              Saving remains available for casualties and narrative overrides.
                            </small>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </article>
              ))}
            </div>
            <div className="editor-actions">
              <button
                className="primary-action"
                type="button"
                disabled={!draft.name.trim() || !draft.factionId}
                onClick={save}
              >
                {editingId ? "Update list" : "Save list"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(emptyList);
                    setEditingId("");
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </section>
        <aside className="saved-lists">
          <div className="section-kicker">Saved rosters</div>
          {lists.length === 0 && <p>No saved lists yet.</p>}
          {lists.map((list) => (
            <article key={list.id}>
              <div>
                <span>
                  {catalogue?.factions.find((faction) => faction.id === list.factionId)?.name ??
                    list.factionId}
                </span>
                <h2>{list.name}</h2>
                <p>
                  {list.units.length} units ·{" "}
                  {list.units.reduce((sum, unit) => sum + unit.modelCount, 0)} models
                </p>
              </div>
              <div>
                <button type="button" onClick={() => edit(list)}>
                  Edit
                </button>
                <button type="button" onClick={() => remove(list.id)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
          {lists.length > 0 && (
            <a className="primary-action play-link" href="/play">
              Open play mode
            </a>
          )}
        </aside>
      </div>
    </main>
  );
}
