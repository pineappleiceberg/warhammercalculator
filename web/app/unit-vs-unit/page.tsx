"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkflowNav } from "../../components/workflow-nav";
import { CombatPresetSelector } from "../../components/combat-preset-selector";
import {
  applyTargetCombatPresets,
  selectedAndAutomaticCombatPresets,
} from "../../lib/combat-presets.mjs";
import {
  calculateOrderedVolley,
  estimateOrderedVolleyComplexity,
  type ExactComplexity,
  type OrderedTargetSegment,
  type OrderedVolleySummary,
} from "../../lib/client-calculator";
import {
  DEFAULT_PROFILE,
  simulateOrderedVolley,
  simulateOrderedVolleyPhase,
  type PhaseSimulationResult,
  type OrderedVolleyRollResult,
} from "../../lib/combat";
import {
  applyChoiceSelectionChange,
  applyLoadoutSubjectCountChange,
  applyModelCountChange,
  choicePoolMaximum,
  choiceSelectionWeaponCounts,
  defaultWeaponCounts,
  defaultLoadoutSubjectCounts,
  equippedWeaponLines,
  groupWeaponProfiles,
  normalizeEquippedCount,
  unitLoadoutWarnings,
  weaponAllocationErrors,
  weaponLimitMaximum,
} from "../../lib/loadout.mjs";
import {
  applyCombatPresets,
  applyWeaponProfile,
  loadCatalogue,
  type Catalogue,
  type CatalogueModel,
  type CatalogueWeapon,
} from "../../lib/catalogue";

type TargetSegment = OrderedTargetSegment & {
  id: string;
  modelId: number;
  name: string;
  keywords: string[];
};
type WeaponLine = {
  weapon: CatalogueWeapon;
  count: number;
  incrementalMean?: number;
  cumulativeMean?: number;
};

function targetSegment(model: CatalogueModel, modelCount: number): TargetSegment {
  return {
    id: crypto.randomUUID(),
    modelId: model.id,
    name: model.name,
    keywords: model.keywords,
    toughness: model.t ?? 8,
    save: model.save ?? 7,
    invulnerable: model.invuln ?? 0,
    feelNoPain: model.feelNoPain ?? 0,
    wounds: model.wounds ?? 1,
    reduction: model.reduction ?? 0,
    modelCount,
  };
}

export default function UnitVsUnit() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [attackerFaction, setAttackerFaction] = useState("");
  const [attackerUnitId, setAttackerUnitId] = useState("");
  const [targetFaction, setTargetFaction] = useState("");
  const [targetUnitId, setTargetUnitId] = useState("");
  const [attackerModels, setAttackerModels] = useState(1);
  const [weaponCounts, setWeaponCounts] = useState<Record<string, number>>({});
  const [optionCounts, setOptionCounts] = useState<Record<string, number>>({});
  const [choiceSelections, setChoiceSelections] = useState<Record<string, number>>({});
  const [loadoutSubjectCounts, setLoadoutSubjectCounts] = useState<Record<string, number>>({});
  const [profileCounts, setProfileCounts] = useState<Record<number, number>>({});
  const [activeAttackerPresetIds, setActiveAttackerPresetIds] = useState<string[]>([]);
  const [activeTargetPresetIds, setActiveTargetPresetIds] = useState<string[]>([]);
  const [weaponOrder, setWeaponOrder] = useState<number[]>([]);
  const [targetSegments, setTargetSegments] = useState<TargetSegment[]>([]);
  const [initialWoundsLost, setInitialWoundsLost] = useState(0);
  const [results, setResults] = useState<WeaponLine[]>([]);
  const [volleySummary, setVolleySummary] = useState<OrderedVolleySummary | null>(null);
  const [rollResult, setRollResult] = useState<OrderedVolleyRollResult | null>(null);
  const [phaseResult, setPhaseResult] = useState<PhaseSimulationResult | null>(null);
  const [simulationSeed, setSimulationSeed] = useState(1);
  const [simulationTrials, setSimulationTrials] = useState(10_000);
  const [phaseKey, setPhaseKey] = useState("");
  const [rollKey, setRollKey] = useState("");
  const [resultKey, setResultKey] = useState("");
  const [complexity, setComplexity] = useState<ExactComplexity | null>(null);
  const [complexityKey, setComplexityKey] = useState("");
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
  const structuredGroupIds = new Set(
    attackerUnit?.wargearChoicePools.flatMap((pool) =>
      pool.replaces
        .map((weapon) => weapon.groupId)
        .concat(
          pool.alternatives.flatMap((alternative) =>
            alternative.weapons.map((weapon) => weapon.groupId),
          ),
        ),
    ) ?? [],
  );
  const structuredOptionCounts = choiceSelectionWeaponCounts(attackerUnit, choiceSelections);
  const loadoutWarnings = unitLoadoutWarnings(
    attackerUnit,
    attackerModels,
    { ...optionCounts, ...structuredOptionCounts },
    weaponCounts,
    choiceSelections,
    loadoutSubjectCounts,
  );
  const orderIndex = new Map(weaponOrder.map((weaponId, index) => [weaponId, index]));
  const orderedLines = equippedWeaponLines(weaponGroups, weaponCounts, profileCounts).sort(
    (left, right) =>
      (orderIndex.get(left.weapon.id) ?? Number.MAX_SAFE_INTEGER) -
      (orderIndex.get(right.weapon.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const inputKey = JSON.stringify({
    initialWoundsLost,
    orderedLines: orderedLines.map((line) => [line.weapon.id, line.count]),
    targetSegments,
    activeAttackerPresetIds,
    activeTargetPresetIds,
  });
  const resultsAreCurrent = resultKey === inputKey;
  const rollIsCurrent = rollKey === inputKey;
  const currentPhaseKey = `${inputKey}:${simulationSeed}:${simulationTrials}`;
  const phaseIsCurrent = phaseKey === currentPhaseKey;

  const selectAttacker = (unitId: string) => {
    setAttackerUnitId(unitId);
    const unit = attackerUnits.find((entry) => entry.id === unitId);
    const groups = groupWeaponProfiles(unit?.weapons ?? []);
    const models = unit?.suggestedModelCount ?? 1;
    const subjectCounts = defaultLoadoutSubjectCounts(unit);
    const defaults = defaultWeaponCounts(unit, models, subjectCounts);
    setAttackerModels(models);
    setWeaponCounts(Object.fromEntries(groups.map((group) => [group.id, defaults[group.id] ?? 0])));
    setOptionCounts(Object.fromEntries(groups.map((group) => [group.id, 0])));
    setChoiceSelections(
      Object.fromEntries(
        (unit?.wargearChoicePools ?? []).flatMap((pool) =>
          pool.alternatives.map((alternative) => [alternative.id, 0]),
        ),
      ),
    );
    setLoadoutSubjectCounts(subjectCounts);
    setProfileCounts(
      Object.fromEntries(
        groups.flatMap((group) => group.profiles.map((profile) => [profile.id, 0])),
      ),
    );
    setWeaponOrder(groups.flatMap((group) => group.profiles.map((profile) => profile.id)));
    setActiveAttackerPresetIds([]);
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
    setStatus(unit ? "Source loadout applied; edit it if needed" : "Choose both units");
  };

  const selectTarget = (unitId: string) => {
    setTargetUnitId(unitId);
    const unit = targetUnits.find((entry) => entry.id === unitId);
    const model = unit?.models[0];
    setTargetSegments(model ? [targetSegment(model, unit?.suggestedModelCount ?? 1)] : []);
    setInitialWoundsLost(0);
    setActiveTargetPresetIds([]);
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
  };

  const moveWeapon = (weaponId: number, direction: -1 | 1) => {
    setWeaponOrder((current) => {
      const index = current.indexOf(weaponId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
  };

  const moveTarget = (id: string, direction: -1 | 1) => {
    setTargetSegments((current) => {
      const index = current.findIndex((segment) => segment.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setInitialWoundsLost(0);
    setResults([]);
    setVolleySummary(null);
    setRollResult(null);
  };

  const currentProfiles = () => {
    const targetModels = targetSegments.reduce((sum, segment) => sum + segment.modelCount, 0);
    return orderedLines.map((line) =>
      applyCombatPresets(
        applyWeaponProfile(
          { ...DEFAULT_PROFILE, targetModels, weaponCount: line.count },
          line.weapon,
          targetSegments[0]?.keywords ?? [],
        ),
        selectedAndAutomaticCombatPresets(
          attackerUnit?.combatPresets ?? [],
          activeAttackerPresetIds,
          line.weapon.type,
          line.weapon.name,
          targetSegments[0]?.keywords ?? [],
        ),
        selectedAndAutomaticCombatPresets(
          targetUnit?.combatPresets ?? [],
          activeTargetPresetIds,
          line.weapon.type,
          line.weapon.name,
          targetSegments[0]?.keywords ?? [],
        ),
        line.weapon.type,
      ),
    );
  };

  const currentTargets = () => {
    const targetPresets = [
      ...new Map(
        orderedLines
          .flatMap((line) =>
            selectedAndAutomaticCombatPresets(
              targetUnit?.combatPresets ?? [],
              activeTargetPresetIds,
              line.weapon.type,
              line.weapon.name,
              targetSegments[0]?.keywords ?? [],
            ),
          )
          .map((preset) => [preset.id, preset]),
      ).values(),
    ];
    return applyTargetCombatPresets(
      targetSegments,
      targetPresets,
      orderedLines.map((line) => line.weapon.type),
    );
  };

  const calculateUnit = async (forceExact = false) => {
    if (!attackerUnit || !targetUnit) return;
    setStatus("Calculating unit volley…");
    const allocationErrors = weaponAllocationErrors(weaponGroups, weaponCounts, profileCounts);
    if (allocationErrors.length) {
      setStatus(allocationErrors[0]);
      return;
    }
    const lines = orderedLines;
    if (!lines.length) {
      setStatus("Enter at least one equipped weapon quantity");
      return;
    }
    if (!targetSegments.length) {
      setStatus("Add at least one target profile segment");
      return;
    }
    try {
      const profiles = currentProfiles();
      const targets = currentTargets();
      const estimate = await estimateOrderedVolleyComplexity(profiles, targets, initialWoundsLost);
      setComplexity(estimate);
      setComplexityKey(inputKey);
      if (estimate.usesDeferredStates && !estimate.exactGuaranteedByBound && !forceExact) {
        setStatus("This volley may exceed the exact state budget; choose exact or simulation");
        return;
      }
      const summary = await calculateOrderedVolley(profiles, targets, initialWoundsLost);
      const resolved = lines.map((line, index) => ({
        ...line,
        incrementalMean: summary.incrementalMeans[index],
        cumulativeMean: summary.cumulativeMeans[index],
      }));
      setResults(resolved);
      setVolleySummary(summary);
      setResultKey(inputKey);
      setStatus(
        loadoutWarnings.length ? "Volley calculated with loadout warnings" : "Volley calculated",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Calculation failed");
    }
  };

  const rollUnit = () => {
    if (!attackerUnit || !targetUnit) return;
    const allocationErrors = weaponAllocationErrors(weaponGroups, weaponCounts, profileCounts);
    if (allocationErrors.length) {
      setStatus(allocationErrors[0]);
      return;
    }
    if (!orderedLines.length || !targetSegments.length) {
      setStatus("Enter a weapon quantity and target profile first");
      return;
    }
    try {
      const profiles = currentProfiles();
      setRollResult(simulateOrderedVolley(profiles, currentTargets(), initialWoundsLost));
      setRollKey(inputKey);
      setStatus("Full volley rolled with secure random dice");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Roll failed");
    }
  };

  const runPhaseSimulation = async () => {
    if (!attackerUnit || !targetUnit) return;
    const allocationErrors = weaponAllocationErrors(weaponGroups, weaponCounts, profileCounts);
    if (allocationErrors.length) {
      setStatus(allocationErrors[0]);
      return;
    }
    if (!orderedLines.length || !targetSegments.length) {
      setStatus("Enter a weapon quantity and target profile first");
      return;
    }
    setStatus(`Simulating ${simulationTrials.toLocaleString()} seeded volleys…`);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      const profiles = currentProfiles();
      setPhaseResult(
        simulateOrderedVolleyPhase(
          profiles,
          currentTargets(),
          simulationSeed,
          simulationTrials,
          initialWoundsLost,
        ),
      );
      setPhaseKey(currentPhaseKey);
      setStatus("Reproducible phase simulation complete");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Simulation failed");
    }
  };

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
                onChange={(event) => {
                  const next = Math.max(1, +event.target.value);
                  setWeaponCounts((current) =>
                    applyModelCountChange(
                      current,
                      attackerUnit,
                      attackerModels,
                      next,
                      loadoutSubjectCounts,
                    ),
                  );
                  setAttackerModels(next);
                }}
              />
            </label>
            {attackerUnit && (
              <div className="loadout-list">
                <CombatPresetSelector
                  presets={attackerUnit.combatPresets}
                  role="attacker"
                  selectedIds={activeAttackerPresetIds}
                  onChange={setActiveAttackerPresetIds}
                  title="Active attacking abilities"
                />
                {attackerUnit.unresolvedLoadoutSubjects.length > 0 && (
                  <details className="source-choice-pools model-composition-editor" open>
                    <summary>Model composition</summary>
                    <small>
                      Enter how many models match each published loadout clause. Weapon totals
                      remain editable.
                    </small>
                    {attackerUnit.unresolvedLoadoutSubjects.map((subject) => (
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
                          value={loadoutSubjectCounts[subject.id] ?? 0}
                          onChange={(event) => {
                            const next = normalizeEquippedCount(+event.target.value, 1000);
                            const previous = loadoutSubjectCounts[subject.id] ?? 0;
                            setWeaponCounts((current) =>
                              applyLoadoutSubjectCountChange(current, subject, previous, next),
                            );
                            setLoadoutSubjectCounts((current) => ({
                              ...current,
                              [subject.id]: next,
                            }));
                          }}
                        />
                      </label>
                    ))}
                  </details>
                )}
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
                          {attackerUnit.weaponLimits?.find((limit) => limit.groupId === group.id)
                            ? ` · options allow up to ${weaponLimitMaximum(
                                attackerUnit.weaponLimits.find(
                                  (limit) => limit.groupId === group.id,
                                )!,
                                attackerModels,
                              )}`
                            : ""}
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
                    {attackerUnit.weaponLimits.some((limit) => limit.groupId === group.id) &&
                      !structuredGroupIds.has(group.id) && (
                        <label className="option-count">
                          <span>
                            Selected through wargear options
                            <small>Copies taken or replaced using the source options</small>
                          </span>
                          <input
                            aria-label={`${group.name} option-selected copies`}
                            type="number"
                            min={0}
                            max={weaponCounts[group.id] ?? 0}
                            value={optionCounts[group.id] ?? 0}
                            onChange={(event) =>
                              setOptionCounts((current) => ({
                                ...current,
                                [group.id]: normalizeEquippedCount(+event.target.value),
                              }))
                            }
                          />
                        </label>
                      )}
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
                {attackerUnit.wargearChoicePools.length > 0 && (
                  <details className="source-choice-pools">
                    <summary>
                      Source option choices ({attackerUnit.wargearChoicePools.length})
                    </summary>
                    <p>
                      Enter how many times each alternative is selected. Alternatives in the same
                      block share one allowance, including bundled weapons.
                    </p>
                    {attackerUnit.wargearChoicePools.map((pool) => {
                      const maximum = choicePoolMaximum(pool, attackerModels);
                      const used = pool.alternatives.reduce(
                        (sum, alternative) => sum + (choiceSelections[alternative.id] ?? 0),
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
                                value={choiceSelections[alternative.id] ?? 0}
                                onChange={(event) => {
                                  const previous = choiceSelections[alternative.id] ?? 0;
                                  const next = normalizeEquippedCount(+event.target.value, maximum);
                                  setWeaponCounts((current) =>
                                    applyChoiceSelectionChange(
                                      current,
                                      pool,
                                      alternative,
                                      previous,
                                      next,
                                    ),
                                  );
                                  setChoiceSelections((current) => ({
                                    ...current,
                                    [alternative.id]: next,
                                  }));
                                }}
                              />
                            </label>
                          ))}
                        </fieldset>
                      );
                    })}
                  </details>
                )}
                {loadoutWarnings.length > 0 && (
                  <div className="loadout-warnings" role="status">
                    <strong>Check this edited loadout</strong>
                    <ul>
                      {loadoutWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                    <small>
                      You can still calculate to represent casualties or narrative rules.
                    </small>
                  </div>
                )}
                <details className="source-guidance" open>
                  <summary>Unit composition</summary>
                  <ul>
                    {attackerUnit.composition.map((line, index) => (
                      <li key={`${line.text}-${index}`}>{line.text}</li>
                    ))}
                  </ul>
                </details>
                {attackerUnit.loadout && (
                  <details className="source-guidance" open>
                    <summary>Starting equipment</summary>
                    <p>{attackerUnit.loadout}</p>
                  </details>
                )}
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
            {targetUnit && (
              <div className="target-sequence">
                <CombatPresetSelector
                  presets={targetUnit.combatPresets}
                  role="target"
                  selectedIds={activeTargetPresetIds}
                  onChange={setActiveTargetPresetIds}
                  title="Active defensive abilities"
                />
                <div className="sequence-heading">
                  <div>
                    <h3>Damage allocation order</h3>
                    <small>First surviving profile receives the next attack</small>
                  </div>
                  <button
                    type="button"
                    disabled={targetSegments.length >= 16}
                    onClick={() => {
                      const model = targetUnit.models[0];
                      if (model)
                        setTargetSegments((current) => [...current, targetSegment(model, 1)]);
                    }}
                  >
                    Add profile
                  </button>
                </div>
                {targetSegments.map((segment, index) => (
                  <article className="target-segment" key={segment.id}>
                    <div className="sequence-heading">
                      <strong>{index + 1}</strong>
                      <select
                        aria-label={`Target profile ${index + 1}`}
                        value={segment.modelId}
                        onChange={(event) => {
                          const model = targetUnit.models.find(
                            (entry) => entry.id === +event.target.value,
                          );
                          if (!model) return;
                          setTargetSegments((current) =>
                            current.map((entry) =>
                              entry.id === segment.id
                                ? { ...targetSegment(model, entry.modelCount), id: entry.id }
                                : entry,
                            ),
                          );
                          if (index === 0) setInitialWoundsLost(0);
                        }}
                      >
                        {targetUnit.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                      <div className="order-actions">
                        <button
                          type="button"
                          aria-label={`Move ${segment.name} earlier`}
                          disabled={index === 0}
                          onClick={() => moveTarget(segment.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${segment.name} later`}
                          disabled={index === targetSegments.length - 1}
                          onClick={() => moveTarget(segment.id, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={targetSegments.length === 1}
                          onClick={() =>
                            setTargetSegments((current) =>
                              current.filter((entry) => entry.id !== segment.id),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="stat-row target-stats">
                      {(
                        [
                          ["modelCount", "Models"],
                          ["toughness", "T"],
                          ["save", "Save"],
                          ["invulnerable", "Invuln"],
                          ["wounds", "W/model"],
                          ["feelNoPain", "FNP"],
                          ["reduction", "-Damage"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          <span>{label}</span>
                          <input
                            type="number"
                            min={["invulnerable", "feelNoPain", "reduction"].includes(key) ? 0 : 1}
                            max={key === "modelCount" ? 1000 : undefined}
                            value={segment[key]}
                            onChange={(event) => {
                              const value = Math.max(
                                ["invulnerable", "feelNoPain", "reduction"].includes(key) ? 0 : 1,
                                +event.target.value,
                              );
                              setTargetSegments((current) =>
                                current.map((entry) =>
                                  entry.id === segment.id ? { ...entry, [key]: value } : entry,
                                ),
                              );
                              if (index === 0 && key === "wounds") {
                                setInitialWoundsLost((current) => Math.min(current, value - 1));
                              }
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </article>
                ))}
                {targetSegments[0] && (
                  <label>
                    <span>
                      Wounds already lost on first model
                      <small>
                        Carried into the first attack; damage cannot spill between models
                      </small>
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={targetSegments[0].wounds - 1}
                      value={initialWoundsLost}
                      onChange={(event) =>
                        setInitialWoundsLost(
                          Math.max(0, Math.min(targetSegments[0].wounds - 1, +event.target.value)),
                        )
                      }
                    />
                  </label>
                )}
              </div>
            )}
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
          </div>
        </section>
      </div>
      <section className="volley-results">
        {orderedLines.length > 0 && (
          <div className="volley-order">
            <div className="sequence-heading">
              <div>
                <span>Attack sequence</span>
                <strong>Weapon order changes who receives later attacks</strong>
              </div>
            </div>
            {orderedLines.map((line, index) => (
              <div key={line.weapon.id}>
                <span>
                  {index + 1}. {line.count} × {line.weapon.name}
                </span>
                <div className="order-actions">
                  <button
                    type="button"
                    aria-label={`Move ${line.weapon.name} earlier`}
                    disabled={index === 0}
                    onClick={() => moveWeapon(line.weapon.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${line.weapon.name} later`}
                    disabled={index === orderedLines.length - 1}
                    onClick={() => moveWeapon(line.weapon.id, 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          className="primary-action"
          type="button"
          disabled={!attackerUnit || !targetUnit}
          onClick={() => calculateUnit(false)}
        >
          Calculate full volley
        </button>
        {complexityKey === inputKey && complexity && (
          <div
            className={`complexity-report ${
              complexity.usesDeferredStates && !complexity.exactGuaranteedByBound
                ? "complexity-warning"
                : ""
            }`}
          >
            <div>
              <span>Exact calculation complexity</span>
              <strong>
                {complexity.usesDeferredStates
                  ? complexity.exactGuaranteedByBound
                    ? "Within sparse-state bound"
                    : "May exceed sparse-state bound"
                  : "Standard exact distribution"}
              </strong>
              <small>
                {complexity.usesDeferredStates
                  ? `Prefix-aware upper bound ${complexity.estimatedStateUpperBound.toLocaleString()} · engine budget ${complexity.stateLimit.toLocaleString()}${resultsAreCurrent && volleySummary ? ` · observed peak ${volleySummary.peakSparseStates.toLocaleString()}` : ""}`
                  : `${complexity.targetCapacity + 1} possible applied-damage totals`}
              </small>
            </div>
            {complexity.usesDeferredStates && !complexity.exactGuaranteedByBound && (
              <div className="complexity-actions">
                <button type="button" onClick={() => calculateUnit(true)}>
                  Try exact anyway
                </button>
                <button type="button" className="secondary-action" onClick={runPhaseSimulation}>
                  Use seeded simulation
                </button>
              </div>
            )}
          </div>
        )}
        <button
          className="secondary-action"
          type="button"
          disabled={!attackerUnit || !targetUnit}
          onClick={rollUnit}
        >
          Roll full volley
        </button>
        <div className="phase-controls">
          <label>
            <span>Simulation seed</span>
            <input
              type="number"
              min={0}
              max={0xffff_ffff}
              value={simulationSeed}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                setSimulationSeed(
                  Number.isFinite(value)
                    ? Math.max(0, Math.min(0xffff_ffff, Math.trunc(value)))
                    : 0,
                );
              }}
            />
          </label>
          <label>
            <span>Repeated volleys</span>
            <input
              type="number"
              min={100}
              max={100_000}
              step={100}
              value={simulationTrials}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                setSimulationTrials(
                  Number.isFinite(value)
                    ? Math.max(100, Math.min(100_000, Math.trunc(value)))
                    : 100,
                );
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const value = new Uint32Array(1);
              crypto.getRandomValues(value);
              setSimulationSeed(value[0]);
            }}
          >
            New seed
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!attackerUnit || !targetUnit}
            onClick={runPhaseSimulation}
          >
            Simulate phase
          </button>
        </div>
        <div className="volley-total">
          <span>Expected applied damage after ordered allocation</span>
          <strong>{resultsAreCurrent ? volleySummary?.mean.toFixed(2) : "—"}</strong>
        </div>
        {resultsAreCurrent && volleySummary && (
          <div className="volley-distribution">
            <span>Median {volleySummary.median}</span>
            <span>
              Middle half {volleySummary.firstQuartile}–{volleySummary.thirdQuartile}
            </span>
            <span>
              Range {volleySummary.minimum}–{volleySummary.maximum}
            </span>
          </div>
        )}
        {resultsAreCurrent && results.length > 0 && volleySummary && (
          <div className="result-lines">
            {results.map((line, index) => (
              <div key={line.weapon.id}>
                <span>
                  {index + 1}. {line.count} × {line.weapon.name}
                </span>
                <b>{line.incrementalMean?.toFixed(2)} expected damage added</b>
                <small>{line.cumulativeMean?.toFixed(2)} cumulative after this profile</small>
              </div>
            ))}
          </div>
        )}
        {rollIsCurrent && rollResult && (
          <section className="volley-roll" aria-live="polite">
            <div className="sequence-heading">
              <div>
                <span>Rolled result</span>
                <strong>{rollResult.appliedDamage} damage applied</strong>
              </div>
              <small>{rollResult.modelsDestroyed} models destroyed</small>
            </div>
            <div className="roll-summary-grid">
              <span>
                <b>{rollResult.attacksResolved}</b> attacks
              </span>
              <span>
                <b>{rollResult.hits}</b> hits
              </span>
              <span>
                <b>{rollResult.criticalHits}</b> critical hits
              </span>
              <span>
                <b>{rollResult.woundingAttacks}</b> wounds
              </span>
              <span>
                <b>{rollResult.savedAttacks}</b> saved
              </span>
              <span>
                <b>{rollResult.fnpPrevented}</b> FNP prevented
              </span>
              <span>
                <b>{rollResult.successfulAttacks}</b> damaging attacks
              </span>
              <span>
                <b>{rollResult.wastedDamage}</b> damage lost
              </span>
            </div>
            <div className="result-lines">
              {rollResult.lines.map((line, index) => (
                <div key={`${orderedLines[index]?.weapon.id ?? index}-roll`}>
                  <span>
                    {index + 1}. {orderedLines[index]?.weapon.name ?? "Weapon"}
                  </span>
                  <b>{line.appliedDamage} damage applied</b>
                  <small>
                    {line.hits} hits · {line.woundingAttacks} wounds · {line.savedAttacks} saved ·{" "}
                    {line.fnpPrevented} FNP
                  </small>
                </div>
              ))}
            </div>
          </section>
        )}
        {phaseIsCurrent && phaseResult && (
          <section className="phase-results" aria-live="polite">
            <div className="sequence-heading">
              <div>
                <span>Seeded phase result</span>
                <strong>{phaseResult.mean.toFixed(2)} mean applied damage</strong>
              </div>
              <small>
                Seed {phaseResult.seed} · {phaseResult.trials.toLocaleString()} volleys
              </small>
            </div>
            <div className="roll-summary-grid">
              <span>
                <b>{(phaseResult.unitDestroyedChance * 100).toFixed(1)}%</b> unit destroyed
              </span>
              <span>
                <b>{(phaseResult.zeroDamageChance * 100).toFixed(1)}%</b> zero damage
              </span>
              <span>
                <b>{phaseResult.standardDeviation.toFixed(2)}</b> standard deviation
              </span>
              <span>
                <b>{phaseResult.meanModelsDestroyed.toFixed(2)}</b> models destroyed
              </span>
              <span>
                <b>{phaseResult.means.hits.toFixed(2)}</b> mean hits
              </span>
              <span>
                <b>{phaseResult.means.woundingAttacks.toFixed(2)}</b> mean wounds
              </span>
              <span>
                <b>{phaseResult.means.savedAttacks.toFixed(2)}</b> mean saves
              </span>
              <span>
                <b>{phaseResult.means.fnpPrevented.toFixed(2)}</b> mean FNP prevented
              </span>
            </div>
            <div className="volley-distribution">
              <span>Median {phaseResult.median}</span>
              <span>
                Middle half {phaseResult.firstQuartile}–{phaseResult.thirdQuartile}
              </span>
              <span>
                Range {phaseResult.minimum}–{phaseResult.maximum}
              </span>
            </div>
            <div className="phase-histogram" aria-label="Applied damage frequency distribution">
              {phaseResult.histogram.map((bucket) => (
                <div key={bucket.damage}>
                  <span>{bucket.damage}</span>
                  <i style={{ width: `${bucket.probability * 100}%` }} />
                  <b>{(bucket.probability * 100).toFixed(1)}%</b>
                </div>
              ))}
            </div>
            <small className="simulation-replay">
              Reuse this seed, trial count, weapon order, and target order to reproduce the same
              result. Live rolls remain cryptographically random.
            </small>
          </section>
        )}
      </section>
    </main>
  );
}
