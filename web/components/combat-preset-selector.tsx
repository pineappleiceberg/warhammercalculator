"use client";

import type { CatalogueCombatPreset } from "../lib/catalogue";
import {
  combatPresetRequiresActivation,
  combatPresetMatchesSourceRelationship,
  combatPresetSubjectSummary,
  combatPresetSupportsRole,
  updateCombatPresetSelection,
} from "../lib/combat-presets.mjs";

type Props = {
  presets: CatalogueCombatPreset[];
  role: "attacker" | "target" | "either";
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  title?: string;
  hint?: string;
  targetDistance?: number;
  supportDistance?: number;
  sourceTargetDistance?: number;
  sourceTargetVisible?: boolean;
  supportedUnitKeywords?: string[];
  attackerCharged?: boolean;
  attackerRemainedStationary?: boolean;
  sourceUnitAttached?: boolean;
  sourceUnitWaaaghActive?: boolean;
  attackerBattleShocked?: boolean;
  targetBattleShocked?: boolean;
  targetStrengthState?: "full" | "below_starting" | "below_half";
  sourceRelationship?: "self" | "supporting_unit";
  disabledIds?: string[];
  usageLabels?: Record<string, string>;
};

export function CombatPresetSelector({
  presets,
  role,
  selectedIds,
  onChange,
  title,
  hint,
  targetDistance = 0,
  supportDistance = 0,
  sourceTargetDistance = 0,
  sourceTargetVisible = false,
  supportedUnitKeywords = [],
  attackerCharged = false,
  attackerRemainedStationary = false,
  sourceUnitAttached = false,
  sourceUnitWaaaghActive = false,
  attackerBattleShocked = false,
  targetBattleShocked = false,
  targetStrengthState = "full",
  sourceRelationship = "self",
  disabledIds = [],
  usageLabels = {},
}: Props) {
  const available = presets.filter(
    (preset) =>
      combatPresetMatchesSourceRelationship(preset, sourceRelationship) &&
      combatPresetRequiresActivation(preset) &&
      combatPresetSupportsRole(preset, role),
  );
  if (!available.length) return null;
  const selected = new Set(selectedIds);
  const disabled = new Set(disabledIds);
  return (
    <fieldset className="combat-preset-selector">
      <legend>{title ?? "Conditional unit abilities"}</legend>
      <small>{hint ?? "Enable only when the published condition applies."}</small>
      {available.map((preset) => (
        <label key={preset.id} title={preset.description}>
          <input
            type="checkbox"
            checked={selected.has(preset.id)}
            disabled={disabled.has(preset.id) && !selected.has(preset.id)}
            onChange={(event) =>
              onChange(
                updateCombatPresetSelection(
                  available,
                  selectedIds,
                  preset.id,
                  event.target.checked,
                ),
              )
            }
          />
          <span>
            <b>{preset.name}</b>
            <small>
              {preset.weaponScope}
              {preset.choiceGroup ? " · choose one mode" : ""} · {preset.description}
            </small>
            {preset.maximumTargetDistance ? (
              <small>
                Requires target within {preset.maximumTargetDistance}&quot;
                {targetDistance <= 0 || targetDistance > preset.maximumTargetDistance
                  ? " · inactive at current distance"
                  : " · active at current distance"}
              </small>
            ) : null}
            {preset.maximumSupportDistance ? (
              <small>
                Requires supported unit within {preset.maximumSupportDistance}&quot;
                {supportDistance > 0 && supportDistance <= preset.maximumSupportDistance
                  ? " · active at current distance"
                  : " · inactive at current distance"}
              </small>
            ) : null}
            {preset.maximumSourceTargetDistance ? (
              <small>
                Requires source within {preset.maximumSourceTargetDistance}&quot; of its selected
                target
                {sourceTargetDistance > 0 &&
                sourceTargetDistance <= preset.maximumSourceTargetDistance
                  ? " · active at current distance"
                  : " · inactive at current distance"}
              </small>
            ) : null}
            {preset.requiresSourceTargetVisible ? (
              <small>
                Requires the selected target to be visible to the source
                {sourceTargetVisible ? " · active" : " · inactive"}
              </small>
            ) : null}
            {preset.requiredSupportedKeywords?.length ? (
              <small>
                Requires supported unit keywords: {preset.requiredSupportedKeywords.join(", ")}
                {preset.requiredSupportedKeywords.every((keyword) =>
                  supportedUnitKeywords.some(
                    (candidate) => candidate.toLocaleLowerCase() === keyword.toLocaleLowerCase(),
                  ),
                )
                  ? " · eligible"
                  : " · ineligible"}
              </small>
            ) : null}
            {preset.requiredAttackerKeywords?.length ? (
              <small>
                Requires attacker keywords: {preset.requiredAttackerKeywords.join(", ")}
              </small>
            ) : null}
            {preset.requiredTargetKeywords?.length ? (
              <small>Requires target keywords: {preset.requiredTargetKeywords.join(", ")}</small>
            ) : null}
            {preset.requiredAttackKeywordsAny?.length ? (
              <small>
                Requires weapon keyword: {preset.requiredAttackKeywordsAny.join(" or ")}
              </small>
            ) : null}
            {preset.requiresAttackerCharge ? (
              <small>
                Requires attacker to have charged this turn
                {attackerCharged ? " · active" : " · inactive"}
              </small>
            ) : null}
            {preset.requiresAttackerStationary ? (
              <small>
                Requires attacker to have remained stationary
                {attackerRemainedStationary ? " · active" : " · inactive"}
              </small>
            ) : null}
            {preset.requiresAttachedUnit ? (
              <small>
                Requires an Attached unit
                {sourceUnitAttached ? " · active" : " · inactive"}
              </small>
            ) : null}
            {preset.requiresWaaaghActive ? (
              <small>
                Requires this unit to be gaining Waaagh! benefits
                {sourceUnitWaaaghActive ? " · active" : " · inactive"}
              </small>
            ) : null}
            {preset.requiresTargetBattleShocked ? (
              <small>
                Requires a Battle-shocked target
                {targetBattleShocked ? " · active" : " · inactive"}
              </small>
            ) : null}
            {preset.requiresAttackerNotBattleShocked ? (
              <small>
                Requires the attacker not to be Battle-shocked
                {attackerBattleShocked ? " · inactive" : " · active"}
              </small>
            ) : null}
            {preset.requiredTargetStrengthState ? (
              <small>
                Requires target{" "}
                {preset.requiredTargetStrengthState === "below_half"
                  ? "Below Half-strength"
                  : preset.requiredTargetStrengthState === "below_starting"
                    ? "below Starting Strength"
                    : "not Below Half-strength"}
                {(preset.requiredTargetStrengthState === "below_half" &&
                  targetStrengthState === "below_half") ||
                (preset.requiredTargetStrengthState === "below_starting" &&
                  targetStrengthState !== "full") ||
                (preset.requiredTargetStrengthState === "not_below_half" &&
                  targetStrengthState !== "below_half")
                  ? " · active"
                  : " · inactive"}
              </small>
            ) : null}
            <small>Affects {combatPresetSubjectSummary(preset, role)}</small>
            {usageLabels[preset.id] ? <small>{usageLabels[preset.id]}</small> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
