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
};

export function CombatPresetSelector({ presets, role, selectedIds, onChange, title, hint }: Props) {
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
            <small>Affects {combatPresetSubjectSummary(preset, role)}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
