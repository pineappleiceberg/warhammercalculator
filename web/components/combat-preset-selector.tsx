"use client";

import type { CatalogueCombatPreset } from "../lib/catalogue";
import {
  combatPresetRequiresActivation,
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
};

export function CombatPresetSelector({
  presets,
  role,
  selectedIds,
  onChange,
  title,
  hint,
  targetDistance = 0,
}: Props) {
  const available = presets.filter(
    (preset) => combatPresetRequiresActivation(preset) && combatPresetSupportsRole(preset, role),
  );
  if (!available.length) return null;
  const selected = new Set(selectedIds);
  return (
    <fieldset className="combat-preset-selector">
      <legend>{title ?? "Conditional unit abilities"}</legend>
      <small>{hint ?? "Enable only when the published condition applies."}</small>
      {available.map((preset) => (
        <label key={preset.id} title={preset.description}>
          <input
            type="checkbox"
            checked={selected.has(preset.id)}
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
            <small>Affects {combatPresetSubjectSummary(preset, role)}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
