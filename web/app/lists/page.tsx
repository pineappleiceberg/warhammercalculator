"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WorkflowNav } from "../../components/workflow-nav";
import { CombatPresetSelector } from "../../components/combat-preset-selector";
import {
  importArmyLists,
  loadArmyLists,
  removeArmyList,
  saveArmyList,
  serializeArmyLists,
  type ArmyListInput,
  type ArmyListRecord,
  type ArmyListUnit,
} from "../../lib/army-list";
import { normalizeArmyListInput } from "../../lib/army-list-codec.mjs";
import { loadCatalogue, type Catalogue } from "../../lib/catalogue";
import {
  applyChoiceSelectionChange,
  applyLoadoutSubjectCountChange,
  applyModelCountChange,
  armyListWeaponsFromGroups,
  choicePoolMaximum,
  defaultWeaponCounts,
  defaultLoadoutSubjectCounts,
  groupWeaponProfiles,
  normalizeEquippedCount,
  unitLoadoutWarnings,
} from "../../lib/loadout.mjs";
import { transportAssignmentReport, transportPassengerEligibility } from "../../lib/transport.mjs";

const emptyList: ArmyListInput = { name: "", factionId: "", units: [] };
const DRAFT_KEY = "warhammer-calculator:army-list-draft:v1";

export default function ArmyLists() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [lists, setLists] = useState<ArmyListRecord[]>([]);
  const [draft, setDraft] = useState<ArmyListInput>(emptyList);
  const [editingId, setEditingId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [status, setStatus] = useState("Loading lists…");
  const [draftReady, setDraftReady] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const reload = () =>
    loadArmyLists()
      .then(({ lists: items, source }) => {
        setLists(items);
        setStatus(source === "cloud" ? "Lists saved to cloud" : "Lists saved on this device");
      })
      .catch(() => setStatus("List storage is unavailable"));

  useEffect(() => {
    loadCatalogue()
      .then(setCatalogue)
      .catch(() => setStatus("Profile catalogue unavailable"));
    reload();
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null") as {
          version?: unknown;
          editingId?: unknown;
          draft?: unknown;
        } | null;
        if (saved?.version === 1 && typeof saved.editingId === "string" && saved.draft) {
          setDraft(normalizeArmyListInput(saved.draft) as ArmyListInput);
          setEditingId(saved.editingId);
          setStatus("Recovered an unfinished list");
        }
      } catch {
        setStatus("Ignored an invalid saved draft");
      } finally {
        setDraftReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    if (!draft.name && !draft.factionId && draft.units.length === 0) {
      window.localStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, editingId, draft }));
  }, [draft, draftReady, editingId]);

  const units = useMemo(
    () => catalogue?.units.filter((unit) => unit.factionId === draft.factionId) ?? [],
    [catalogue, draft.factionId],
  );
  const transportReport = useMemo(
    () =>
      catalogue
        ? transportAssignmentReport(catalogue, draft)
        : { assignments: [], errors: [], slotsByTransport: new Map() },
    [catalogue, draft],
  );

  const addUnit = () => {
    const unit = units.find((entry) => entry.id === unitId);
    if (!unit) return;
    const weaponGroups = groupWeaponProfiles(unit.weapons);
    const modelCount = unit.suggestedModelCount ?? 1;
    const loadoutSubjectCounts = defaultLoadoutSubjectCounts(unit);
    const defaults = defaultWeaponCounts(unit, modelCount, loadoutSubjectCounts);
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
      loadoutSubjectCounts,
      combatPresetIds: [],
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
    try {
      const saved = await saveArmyList(draft, editingId);
      setLists((current) => [
        saved.record,
        ...current.filter((entry) => entry.id !== saved.record.id),
      ]);
      setDraft(emptyList);
      setEditingId("");
      setStatus(
        saved.source === "device"
          ? "List saved on this device"
          : saved.cached
            ? "List saved to cloud"
            : "List saved to cloud · device copy unavailable",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save this list");
    }
  };

  const edit = (list: ArmyListRecord) => {
    setEditingId(list.id);
    setDraft({ name: list.name, factionId: list.factionId, units: list.units });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (id: string) => {
    const source = await removeArmyList(id);
    setLists((current) => current.filter((entry) => entry.id !== id));
    setStatus(source === "cloud" ? "List deleted" : "Device copy deleted");
  };

  const downloadBackup = () => {
    const blob = new Blob([serializeArmyLists(lists, catalogue?.sourceUpdatedAt ?? null)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `warhammer-calculator-lists-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${lists.length} ${lists.length === 1 ? "list" : "lists"}`);
  };

  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setStatus("Backup is larger than the 2 MB limit");
      return;
    }
    try {
      const value = JSON.parse(await file.text()) as unknown;
      if (!window.confirm("Import this backup? Matching list IDs will be updated.")) return;
      const imported = await importArmyLists(value);
      setLists(imported.lists);
      const sourceWarning =
        imported.profileSourceUpdatedAt &&
        catalogue?.sourceUpdatedAt &&
        imported.profileSourceUpdatedAt !== catalogue.sourceUpdatedAt
          ? " · backup used a different profile-data release"
          : "";
      setStatus(
        `${imported.lists.length} lists available ${
          imported.source === "cloud" ? "in cloud storage" : "on this device"
        }${imported.cached ? "" : " · device copy unavailable"}${sourceWarning}`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Backup could not be imported");
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
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
                                current.loadoutSubjectCounts ?? {},
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
                          units: current.units
                            .filter((entry) => entry.id !== unit.id)
                            .map((entry) => {
                              if (entry.transportId !== unit.id && entry.attachedToId !== unit.id)
                                return entry;
                              const next = { ...entry };
                              if (next.transportId === unit.id) delete next.transportId;
                              if (next.attachedToId === unit.id) delete next.attachedToId;
                              return next;
                            }),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                  {(() => {
                    const passenger = catalogue?.units.find((entry) => entry.id === unit.unitId);
                    const attachedSavedUnit = draft.units.find(
                      (candidate) => candidate.id === unit.attachedToId,
                    );
                    const attachedUnit = catalogue?.units.find(
                      (entry) => entry.id === attachedSavedUnit?.unitId,
                    );
                    const isCharacter = passenger?.transportKeywords.includes("character");
                    const transports = draft.units.filter((candidate) => {
                      if (candidate.id === unit.id) return false;
                      const transport = catalogue?.units.find(
                        (entry) => entry.id === candidate.unitId,
                      );
                      return transportPassengerEligibility(transport, passenger, {
                        attachedUnit,
                      }).eligible;
                    });
                    const assignment = transportReport.assignments.find(
                      (entry) => entry.passengerUnit.id === unit.id,
                    );
                    return (
                      <>
                        {isCharacter && (
                          <label>
                            <span>Attached to</span>
                            <select
                              aria-label={`${unit.name} attached unit`}
                              value={unit.attachedToId ?? ""}
                              onChange={(event) =>
                                changeUnit(unit.id, (current) => {
                                  const next = { ...current };
                                  if (event.target.value) next.attachedToId = event.target.value;
                                  else delete next.attachedToId;
                                  return next;
                                })
                              }
                            >
                              <option value="">Not attached</option>
                              {draft.units
                                .filter((candidate) => candidate.id !== unit.id)
                                .map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.name}
                                  </option>
                                ))}
                            </select>
                            <small>Declare the bodyguard unit this Character joined.</small>
                          </label>
                        )}
                        <label>
                          <span>Embarked in</span>
                          <select
                            aria-label={`${unit.name} assigned Transport`}
                            value={unit.transportId ?? ""}
                            onChange={(event) =>
                              changeUnit(unit.id, (current) => {
                                const next = { ...current };
                                if (event.target.value) next.transportId = event.target.value;
                                else delete next.transportId;
                                return next;
                              })
                            }
                          >
                            <option value="">Not embarked</option>
                            {transports.map((transport) => (
                              <option key={transport.id} value={transport.id}>
                                {transport.name}
                              </option>
                            ))}
                            {unit.transportId &&
                              !transports.some(
                                (transport) => transport.id === unit.transportId,
                              ) && (
                                <option value={unit.transportId}>
                                  Unavailable Transport assignment
                                </option>
                              )}
                          </select>
                          {assignment && (
                            <small>
                              {assignment.slots} Transport spaces ({assignment.modelCost} per model)
                              {((assignment.transport.transport?.additionalPools.length ?? 0) > 0 ||
                                (assignment.transport.transport?.alternativePools.length ?? 0) >
                                  0) &&
                                ` · ${assignment.poolLabel} ${
                                  assignment.poolKind === "alternative" ? "mode" : "pool"
                                }`}
                            </small>
                          )}
                        </label>
                      </>
                    );
                  })()}
                  {(catalogue?.units.find((entry) => entry.id === unit.unitId)
                    ?.unresolvedLoadoutSubjects.length ?? 0) > 0 && (
                    <details className="source-choice-pools model-composition-editor" open>
                      <summary>Model composition</summary>
                      <small>
                        Enter how many models match each published loadout clause. Weapon totals
                        remain editable.
                      </small>
                      {catalogue?.units
                        .find((entry) => entry.id === unit.unitId)
                        ?.unresolvedLoadoutSubjects.map((subject) => (
                          <label key={subject.id}>
                            <span>
                              {subject.subject}
                              <small>{subject.equipment}</small>
                            </span>
                            <input
                              aria-label={`${subject.subject} model count`}
                              type="number"
                              min={0}
                              max={1000}
                              value={unit.loadoutSubjectCounts?.[subject.id] ?? 0}
                              onChange={(event) => {
                                const next = normalizeEquippedCount(+event.target.value, 1000);
                                changeUnit(unit.id, (current) => {
                                  const previous = current.loadoutSubjectCounts?.[subject.id] ?? 0;
                                  const counts = Object.fromEntries(
                                    current.weapons.map((weapon) => [
                                      weapon.groupId ?? String(weapon.weaponId),
                                      weapon.count,
                                    ]),
                                  );
                                  const adjusted = applyLoadoutSubjectCountChange(
                                    counts,
                                    subject,
                                    previous,
                                    next,
                                  );
                                  return {
                                    ...current,
                                    weapons: current.weapons.map((weapon) => ({
                                      ...weapon,
                                      count:
                                        adjusted[weapon.groupId ?? String(weapon.weaponId)] ?? 0,
                                    })),
                                    loadoutSubjectCounts: {
                                      ...(current.loadoutSubjectCounts ?? {}),
                                      [subject.id]: next,
                                    },
                                  };
                                });
                              }}
                            />
                          </label>
                        ))}
                    </details>
                  )}
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
                      unit.loadoutSubjectCounts ?? {},
                    );
                    return (
                      <>
                        {sourceUnit && (
                          <CombatPresetSelector
                            presets={sourceUnit.combatPresets}
                            role="either"
                            selectedIds={unit.combatPresetIds ?? []}
                            onChange={(combatPresetIds) =>
                              changeUnit(unit.id, (current) => ({
                                ...current,
                                combatPresetIds,
                              }))
                            }
                            title="Play Mode ability defaults"
                            hint="Save conditions that normally begin active; you can change them during play."
                          />
                        )}
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
              {(editingId || draft.name || draft.factionId || draft.units.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(emptyList);
                    setEditingId("");
                  }}
                >
                  Clear draft
                </button>
              )}
            </div>
            {transportReport.errors.length > 0 && (
              <div className="loadout-warnings" role="status">
                <strong>Transport assignment check</strong>
                <ul>
                  {transportReport.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
                <small>Correct these assignments before using Firing Deck in Play Mode.</small>
              </div>
            )}
          </div>
        </section>
        <aside className="saved-lists">
          <div className="section-kicker">Saved rosters</div>
          <div className="backup-actions">
            <button type="button" disabled={lists.length === 0} onClick={downloadBackup}>
              Export backup
            </button>
            <button type="button" onClick={() => importInput.current?.click()}>
              Import backup
            </button>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => void importBackup(event.target.files?.[0])}
            />
          </div>
          <small className="storage-note">
            Lists use cloud storage when available and keep a device copy.
          </small>
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
