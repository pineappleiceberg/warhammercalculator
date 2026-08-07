"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkflowNav } from "../../components/workflow-nav";
import {
  AGENT_SCHEMA_VERSION,
  canonicalAgentParameters,
  isCatalogueAgentQuery,
  parseAgentProfile,
  resolveAgentCatalogueSelection,
} from "../../lib/agent-parameters.mjs";
import { calculateProfile, type DamageSummary } from "../../lib/client-calculator";
import {
  applyCombatPresets,
  applyTargetProfile,
  applyWeaponProfile,
  loadCatalogue,
} from "../../lib/catalogue";
import { DEFAULT_PROFILE, normalizeProfile, type CombatProfile } from "../../lib/combat";
import {
  attackKeywordsForWeapon,
  selectedAndAutomaticCombatPresets,
} from "../../lib/combat-presets.mjs";

type AgentResult = {
  schemaVersion: number;
  status: "ok";
  calculation: "single-profile-exact";
  engine: { implementation: "C17/WebAssembly"; exactDistribution: true };
  source: Record<string, unknown>;
  input: CombatProfile;
  result: {
    rawDamage: ReturnType<typeof damageResult>;
    appliedDamage: ReturnType<typeof damageResult>;
    targetCapacity: number;
  };
};

type AgentError = {
  schemaVersion: number;
  status: "error";
  error: { code: "REQUEST_FAILED"; message: string };
};

type AgentResponse = AgentResult | AgentError;

declare global {
  interface Window {
    __WARHAMMER_CALC_RESULT__?: AgentResponse;
  }
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function damageResult(summary: DamageSummary, applied: boolean) {
  return {
    minimum: applied ? summary.appliedMinimum : summary.minimum,
    firstQuartile: applied ? summary.appliedFirstQuartile : summary.firstQuartile,
    median: applied ? summary.appliedMedian : summary.median,
    thirdQuartile: applied ? summary.appliedThirdQuartile : summary.thirdQuartile,
    maximum: applied ? summary.appliedMaximum : summary.maximum,
    expected: rounded(applied ? summary.appliedMean : summary.mean),
    engineFraction: applied ? summary.exactAppliedMean : summary.exactMean,
  };
}

const directExample =
  "attacks=4&hit=3&strength=12&ap=3&damage=D6%2B1&toughness=10&save=2&invuln=4&wounds=12";
const catalogueExample =
  "attacker=Doom%20Scythe&weapon=Heavy%20death%20ray&target=Brutalis%20Dreadnought";

export default function AgentCalculator() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Add parameters to run an exact calculation");
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const json = useMemo(() => (response ? JSON.stringify(response, null, 2) : ""), [response]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const search = new URL(window.location.href).searchParams;
      const hasRequest = [...search.keys()].some((name) => name !== "format");
      if (!hasRequest) return;
      setStatus("loading");
      setMessage("Loading the local C/WebAssembly engine…");
      delete window.__WARHAMMER_CALC_RESULT__;
      try {
        let source: Record<string, unknown> = { mode: "direct-parameters" };
        let candidate: unknown;
        if (isCatalogueAgentQuery(search)) {
          const catalogue = await loadCatalogue();
          const selection = resolveAgentCatalogueSelection(search, catalogue);
          const requestedContext = parseAgentProfile(search, DEFAULT_PROFILE, false);
          const requestedDistance = requestedContext.targetDistance;
          const attackerUnitModels = requestedContext.attackerUnitModels;
          const nearbyEnemyModels = requestedContext.nearbyEnemyModels;
          const attackerCharged = requestedContext.attackerCharged;
          const attackerRemainedStationary = requestedContext.attackerRemainedStationary;
          const attackerAttached = requestedContext.attackerAttached;
          const targetAttached = requestedContext.targetAttached;
          const attackerWaaaghActive = requestedContext.attackerWaaaghActive;
          const targetWaaaghActive = requestedContext.targetWaaaghActive;
          const targetOathOfMoment = requestedContext.targetOathOfMoment;
          const attackerOathWoundBonusEligible = requestedContext.attackerOathWoundBonusEligible;
          const attackerOnObjective = requestedContext.attackerOnObjective;
          const targetOnObjective = requestedContext.targetOnObjective;
          const attackerObjectiveOwner = requestedContext.attackerObjectiveOwner;
          const targetObjectiveOwner = requestedContext.targetObjectiveOwner;
          const attackerOnAttackerSelectedObjective =
            requestedContext.attackerOnAttackerSelectedObjective;
          const targetOnAttackerSelectedObjective =
            requestedContext.targetOnAttackerSelectedObjective;
          const attackerOnTargetSelectedObjective =
            requestedContext.attackerOnTargetSelectedObjective;
          const targetOnTargetSelectedObjective = requestedContext.targetOnTargetSelectedObjective;
          const attackerGuidedAgainstTarget = requestedContext.attackerGuidedAgainstTarget;
          const targetSpotted = requestedContext.targetSpotted;
          const targetSpottedByMarkerlightObserver =
            requestedContext.targetSpottedByMarkerlightObserver;
          const attackerBattleShocked = requestedContext.attackerBattleShocked;
          const targetBattleShocked = requestedContext.targetBattleShocked;
          const targetStrengthState = requestedContext.targetStrengthState;
          let profile = applyTargetProfile(DEFAULT_PROFILE, selection.model);
          profile = applyWeaponProfile(profile, selection.weapon, selection.model.keywords);
          profile = {
            ...profile,
            targetDistance: requestedDistance,
            attackerUnitModels,
            nearbyEnemyModels,
            attackerCharged,
            attackerRemainedStationary,
            attackerAttached,
            targetAttached,
            attackerWaaaghActive,
            targetWaaaghActive,
            targetOathOfMoment,
            attackerOathWoundBonusEligible,
            attackerOnObjective,
            targetOnObjective,
            attackerObjectiveOwner,
            targetObjectiveOwner,
            attackerOnAttackerSelectedObjective,
            targetOnAttackerSelectedObjective,
            attackerOnTargetSelectedObjective,
            targetOnTargetSelectedObjective,
            attackerGuidedAgainstTarget,
            targetSpotted,
            targetSpottedByMarkerlightObserver,
            attackerBattleShocked,
            targetBattleShocked,
            targetStrengthState,
          };
          const attackerPresets = selectedAndAutomaticCombatPresets(
            selection.attacker.combatPresets,
            selection.attackerPresets.map((preset) => preset.id),
            selection.weapon.type,
            selection.weapon.name,
            selection.model.keywords,
            attackKeywordsForWeapon(selection.weapon),
            requestedDistance,
            attackerCharged,
            attackerBattleShocked,
            targetBattleShocked,
            targetStrengthState,
            attackerRemainedStationary,
            attackerAttached,
            attackerWaaaghActive,
            targetOathOfMoment,
            attackerOathWoundBonusEligible,
            attackerOnObjective,
            targetOnObjective,
            attackerOnObjective && attackerObjectiveOwner === "attacker",
            targetOnObjective && ["target", "uncontrolled"].includes(targetObjectiveOwner),
            attackerOnAttackerSelectedObjective,
            targetOnAttackerSelectedObjective,
            attackerBattleShocked,
            attackerGuidedAgainstTarget,
            targetSpotted,
            targetSpottedByMarkerlightObserver,
          );
          const targetPresets = selectedAndAutomaticCombatPresets(
            selection.target.combatPresets,
            selection.targetPresets.map((preset) => preset.id),
            selection.weapon.type,
            selection.weapon.name,
            selection.model.keywords,
            attackKeywordsForWeapon(selection.weapon),
            requestedDistance,
            attackerCharged,
            attackerBattleShocked,
            targetBattleShocked,
            targetStrengthState,
            attackerRemainedStationary,
            targetAttached,
            targetWaaaghActive,
            false,
            false,
            targetOnObjective,
            attackerOnObjective,
            targetOnObjective && targetObjectiveOwner === "target",
            attackerOnObjective && ["attacker", "uncontrolled"].includes(attackerObjectiveOwner),
            targetOnTargetSelectedObjective,
            attackerOnTargetSelectedObjective,
            targetBattleShocked,
            false,
            targetSpotted,
            targetSpottedByMarkerlightObserver,
          );
          profile = applyCombatPresets(
            profile,
            attackerPresets,
            targetPresets,
            selection.weapon.type,
            {
              targetKeywords: selection.model.keywords,
              attackKeywords: attackKeywordsForWeapon(selection.weapon),
              targetDistance: requestedDistance,
              attackerUnitModels,
              nearbyEnemyModels,
              attackerCharged,
              attackerRemainedStationary,
              attackerAttached,
              targetAttached,
              attackerWaaaghActive,
              targetWaaaghActive,
              targetOathOfMoment,
              attackerOathWoundBonusEligible,
              attackerOnObjective,
              targetOnObjective,
              attackerObjectiveOwner,
              targetObjectiveOwner,
              attackerOnAttackerSelectedObjective,
              targetOnAttackerSelectedObjective,
              attackerOnTargetSelectedObjective,
              targetOnTargetSelectedObjective,
              attackerGuidedAgainstTarget,
              targetSpotted,
              targetSpottedByMarkerlightObserver,
              attackerBattleShocked,
              targetBattleShocked,
              targetStrengthState,
            },
          );
          candidate = parseAgentProfile(search, profile, false);
          source = {
            mode: "catalogue",
            profileSourceUpdatedAt: catalogue.sourceUpdatedAt,
            attacker: { id: selection.attacker.id, name: selection.attacker.name },
            weapon: { id: selection.weapon.id, name: selection.weapon.name },
            target: { id: selection.target.id, name: selection.target.name },
            model: { id: selection.model.id, name: selection.model.name },
            attackerPresets: attackerPresets.map((preset) => ({
              id: preset.id,
              name: preset.name,
              automatic: preset.activation === "automatic",
            })),
            targetPresets: targetPresets.map((preset) => ({
              id: preset.id,
              name: preset.name,
              automatic: preset.activation === "automatic",
            })),
          };
        } else {
          candidate = parseAgentProfile(search, DEFAULT_PROFILE, true);
        }
        const profile = normalizeProfile(candidate);
        const summary = await calculateProfile(profile);
        const output: AgentResult = {
          schemaVersion: AGENT_SCHEMA_VERSION,
          status: "ok",
          calculation: "single-profile-exact",
          engine: { implementation: "C17/WebAssembly", exactDistribution: true },
          source,
          input: profile,
          result: {
            rawDamage: damageResult(summary, false),
            appliedDamage: damageResult(summary, true),
            targetCapacity: profile.wounds * profile.targetModels,
          },
        };
        const url = new URL(base + "/agent/", window.location.origin);
        url.search = canonicalAgentParameters(profile).toString();
        if (!active) return;
        window.__WARHAMMER_CALC_RESULT__ = output;
        setResponse(output);
        setCanonicalUrl(url.href);
        setStatus("ready");
        setMessage("Exact result ready");
      } catch (error) {
        if (!active) return;
        const output: AgentError = {
          schemaVersion: AGENT_SCHEMA_VERSION,
          status: "error",
          error: {
            code: "REQUEST_FAILED",
            message: error instanceof Error ? error.message : "Calculation failed",
          },
        };
        window.__WARHAMMER_CALC_RESULT__ = output;
        setResponse(output);
        setCanonicalUrl("");
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Calculation failed");
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [base]);

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setCopyStatus(label + " copied");
    window.setTimeout(() => setCopyStatus(""), 2000);
  };

  return (
    <main>
      <header className="masthead">
        <div>
          <span className="serial">AGENT INTERFACE / URL SCHEMA V1</span>
          <h1>Parameterized Calculator</h1>
        </div>
        <div className={"engine-status " + status} data-agent-status={status}>
          <span /> {message}
        </div>
      </header>
      <WorkflowNav current="/agent" />
      <section className="agent-layout">
        <article className="panel agent-guide">
          <div className="panel-heading rules-heading">
            <span>01</span>
            <div>
              <small>STATIC CALL SURFACE</small>
              <h2>Call with a URL</h2>
            </div>
          </div>
          <div className="agent-content">
            <p>
              A browser-capable agent can open this page with query parameters and wait for
              <code> [data-agent-status=&quot;ready&quot;]</code>. Calculation happens locally in
              the C/WebAssembly engine.
            </p>
            <h3>Catalogue matchup</h3>
            <code className="agent-example">
              /agent/?attacker=Doom Scythe&amp;weapon=Heavy death ray&amp;target=Brutalis
              Dreadnought
            </code>
            <a className="agent-run-link" href={base + "/agent/?" + catalogueExample}>
              Run catalogue example
            </a>
            <h3>Direct profile</h3>
            <code className="agent-example">
              /agent/?attacks=4&amp;hit=3&amp;strength=12&amp;ap=3&amp;damage=D6+1&amp;toughness=10&amp;save=2&amp;invuln=4&amp;wounds=12
            </code>
            <a className="agent-run-link" href={base + "/agent/?" + directExample}>
              Run direct example
            </a>
            <h3>Optional parameters</h3>
            <p className="agent-parameter-list">
              weaponCount, attacksReplacement, attacksMultiplier, attacksModifier,
              strengthReplacement, strengthMultiplier, strengthModifier, damageReplacement,
              damageMultiplier, damageModifier, characteristicModifier,
              firstFailedSaveDamageReplacement, allocatedAttackDamageReplacement,
              allocatedAttackDamageReplacementUses, allocatedAttackDamageReplacementSkip,
              characteristicModifierAttacks, characteristicModifierStrength,
              characteristicModifierDamage, model, models, fnp, reduction, damageDivisor,
              criticalHits, criticalWounds, sustainedHits, rapidFire, melta, hitModifier,
              woundModifier, rerollHits, rerollWounds, distance, unitModels, nearbyEnemyModels,
              charged, stationary, attackerAttached, targetAttached, attackerWaaaghActive,
              targetWaaaghActive, oathTarget, oathWoundBonus, attackerObjective, targetObjective,
              attackerObjectiveOwner, targetObjectiveOwner, attackerBattleShocked,
              targetBattleShocked, attackerOnAttackerSelectedObjective,
              targetOnAttackerSelectedObjective, attackerOnTargetSelectedObjective,
              targetOnTargetSelectedObjective, guided, spotted, markerlightSpotted, targetStrength,
              attackerPreset, targetPreset, and rules.
            </p>
            <p>
              <code>rules</code> accepts comma-separated values such as{" "}
              <code>lethal-hits,devastating-wounds,twin-linked,blast,cover,half-range</code>. Names
              or stable catalogue IDs are accepted; ambiguous names return an error.
            </p>
            <p>
              Catalogue queries apply exact target-, attack-keyword, charge, distance, Battle-shock,
              Attached-unit, Waaagh!, Oath of Moment, objective-marker position and ownership,
              Guided/Spotted/Markerlight relationships, and model-count conditions automatically.
              Applied source rules are listed in the result with <code>automatic: true</code>; any
              numeric URL override is applied afterward.
            </p>
          </div>
        </article>
        <article className="panel agent-result-panel">
          <div className="panel-heading target-heading">
            <span>02</span>
            <div>
              <small>MACHINE-READABLE OUTPUT</small>
              <h2>Exact result</h2>
            </div>
          </div>
          <div className="agent-content">
            <div className="agent-result-actions" aria-live="polite">
              <button type="button" disabled={!response} onClick={() => copy(json, "JSON")}>
                Copy JSON
              </button>
              <button
                type="button"
                disabled={!canonicalUrl}
                onClick={() => copy(canonicalUrl, "Canonical URL")}
              >
                Copy canonical URL
              </button>
              <span>{copyStatus}</span>
            </div>
            <output id="warhammer-agent-result" data-agent-status={status} aria-live="polite">
              <pre>
                {response ? json : JSON.stringify({ schemaVersion: 1, status, message }, null, 2)}
              </pre>
            </output>
          </div>
        </article>
      </section>
    </main>
  );
}
