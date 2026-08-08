"use client";

import type { CatalogueCombatPreset } from "../lib/catalogue";
import { combatPresetSupportsRole } from "../lib/combat-presets.mjs";
import { CombatPresetSelector } from "./combat-preset-selector";

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
};

export function SupportPresetSelector({
  units,
  role,
  selectedUnitId,
  selectedIds,
  onUnitChange,
  onPresetChange,
  ...eligibility
}: Props) {
  const supportUnits = units.filter((unit) =>
    unit.combatPresets.some(
      (preset) =>
        preset.sourceRelationship === "supporting_unit" && combatPresetSupportsRole(preset, role),
    ),
  );
  if (!supportUnits.length) return null;
  const selectedUnit = supportUnits.find((unit) => unit.id === selectedUnitId);
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
        <CombatPresetSelector
          presets={selectedUnit.combatPresets}
          role={role}
          selectedIds={selectedIds}
          onChange={onPresetChange}
          title="Active supporting abilities"
          hint="Select an ability only when this unit is providing it to the attacker against this target."
          sourceRelationship="supporting_unit"
          {...eligibility}
        />
      ) : null}
    </div>
  );
}
