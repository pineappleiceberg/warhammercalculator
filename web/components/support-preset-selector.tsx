"use client";

import type { CatalogueCombatPreset } from "../lib/catalogue";
import {
  combatPresetMatchesSourceRelationship,
  combatPresetSupportsRole,
} from "../lib/combat-presets.mjs";
import { CombatPresetSelector } from "./combat-preset-selector";
import {
  commitSupportPresetSelection,
  setSupportUsesRemaining,
  supportUsesRemaining,
} from "../lib/support-uses.mjs";

type Props = {
  units: Array<{ id: string; name: string; combatPresets: CatalogueCombatPreset[] }>;
  role: "attacker" | "target" | "either";
  selectedUnitId: string;
  selectedIds: string[];
  onUnitChange: (unitId: string) => void;
  onPresetChange: (ids: string[]) => void;
  attackerCharged?: boolean;
  attackerRemainedStationary?: boolean;
  sourceUnitAttached?: boolean;
  sourceUnitWaaaghActive?: boolean;
  attackerBattleShocked?: boolean;
  targetBattleShocked?: boolean;
  targetStrengthState?: "full" | "below_starting" | "below_half";
  supportDistance?: number;
  onSupportDistanceChange?: (distance: number) => void;
  supportedUnitKeywords?: string[];
  supportUsesSpent?: Record<string, Record<string, number>>;
  onSupportUsesChange?: (uses: Record<string, Record<string, number>>) => void;
};

export function SupportPresetSelector({
  units,
  role,
  selectedUnitId,
  selectedIds,
  onUnitChange,
  onPresetChange,
  supportUsesSpent = {},
  onSupportUsesChange,
  supportDistance = 0,
  onSupportDistanceChange,
  supportedUnitKeywords = [],
  ...eligibility
}: Props) {
  const supportUnits = units.filter((unit) =>
    unit.combatPresets.some(
      (preset) =>
        combatPresetMatchesSourceRelationship(preset, "supporting_unit") &&
        combatPresetSupportsRole(preset, role),
    ),
  );
  if (!supportUnits.length) return null;
  const selectedUnit = supportUnits.find((unit) => unit.id === selectedUnitId);
  const tracked = Boolean(onSupportUsesChange);
  const limitedPresets =
    selectedUnit?.combatPresets.filter(
      (preset) =>
        combatPresetMatchesSourceRelationship(preset, "supporting_unit") && preset.usesPerBattle,
    ) ?? [];
  const remaining = Object.fromEntries(
    limitedPresets.map((preset) => [
      preset.id,
      supportUsesRemaining(supportUsesSpent, selectedUnitId, preset.id, preset.usesPerBattle),
    ]),
  );
  return (
    <div className="support-preset-selector">
      <label>
        <span>Supporting unit</span>
        <select value={selectedUnitId} onChange={(event) => onUnitChange(event.target.value)}>
          <option value="">No supporting unit</option>
          {supportUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
      </label>
      {selectedUnit ? (
        <>
          {selectedUnit.combatPresets.some(
            (preset) =>
              combatPresetMatchesSourceRelationship(preset, "supporting_unit") &&
              preset.maximumSupportDistance,
          ) && onSupportDistanceChange ? (
            <label>
              <span>Distance from supporting unit</span>
              <input
                aria-label="Distance from supporting unit in inches"
                type="number"
                inputMode="decimal"
                min={0}
                max={1000}
                step="any"
                value={supportDistance}
                onChange={(event) =>
                  onSupportDistanceChange(
                    Math.min(1000, Math.max(0, Number(event.target.value) || 0)),
                  )
                }
              />
              <small>Inches; 0 means unknown</small>
            </label>
          ) : null}
          <CombatPresetSelector
            presets={selectedUnit.combatPresets}
            role={role}
            selectedIds={selectedIds}
            onChange={(ids) => {
              if (!tracked) {
                onPresetChange(ids);
                return;
              }
              try {
                const next = commitSupportPresetSelection(
                  selectedUnit.combatPresets,
                  selectedIds,
                  ids,
                  selectedUnitId,
                  supportUsesSpent,
                );
                onSupportUsesChange?.(next.uses);
                onPresetChange(next.selectedIds);
              } catch {
                onPresetChange(selectedIds);
              }
            }}
            title="Active supporting abilities"
            hint={
              tracked && limitedPresets.length
                ? "Turning on a limited ability spends one use. Leave it on while resolving every weapon it supports."
                : `Select an ability only when this unit is providing it for the ${
                    role === "target" ? "defending" : "attacking"
                  } side of this matchup.`
            }
            sourceRelationship="supporting_unit"
            supportDistance={supportDistance}
            supportedUnitKeywords={supportedUnitKeywords}
            disabledIds={
              tracked
                ? limitedPresets
                    .filter((preset) => remaining[preset.id] === 0)
                    .map((preset) => preset.id)
                : []
            }
            usageLabels={
              tracked
                ? Object.fromEntries(
                    limitedPresets.map((preset) => [
                      preset.id,
                      `${remaining[preset.id]} of ${preset.usesPerBattle} uses remaining`,
                    ]),
                  )
                : {}
            }
            {...eligibility}
          />
          {tracked && limitedPresets.length ? (
            <div className="support-use-controls">
              {limitedPresets.map((preset) => (
                <label key={preset.id}>
                  <span>{preset.name} uses remaining</span>
                  <input
                    aria-label={`${preset.name} uses remaining`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={preset.usesPerBattle}
                    value={remaining[preset.id]}
                    onChange={(event) => {
                      const nextRemaining = Math.min(
                        preset.usesPerBattle ?? 0,
                        Math.max(0, Number(event.target.value) || 0),
                      );
                      onSupportUsesChange?.(
                        setSupportUsesRemaining(
                          supportUsesSpent,
                          selectedUnitId,
                          preset.id,
                          preset.usesPerBattle,
                          nextRemaining,
                        ),
                      );
                      if (nextRemaining === 0 && selectedIds.includes(preset.id)) {
                        onPresetChange(selectedIds.filter((id) => id !== preset.id));
                      }
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
