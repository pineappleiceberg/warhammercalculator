#!/usr/bin/env python3

import argparse
import sqlite3
from contextlib import closing
from pathlib import Path

try:
    from scripts.build_profiles_db import rebuild_combat_presets
except ModuleNotFoundError:
    from build_profiles_db import rebuild_combat_presets


TABLE_SCHEMA = """
DROP TABLE IF EXISTS unit_combat_preset_effects;
DROP TABLE IF EXISTS unit_combat_preset_supported_keywords;
DROP TABLE unit_combat_presets;
CREATE TABLE unit_combat_presets (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    ability_position INTEGER NOT NULL,
    preset_position INTEGER NOT NULL CHECK (preset_position >= 1),
    name TEXT NOT NULL,
    description_text TEXT NOT NULL,
    is_exclusive_choice INTEGER NOT NULL CHECK (is_exclusive_choice IN (0, 1)),
    activation TEXT NOT NULL CHECK (activation IN ('inherent', 'automatic', 'situational')),
    source_relationship TEXT NOT NULL DEFAULT 'self'
        CHECK (source_relationship IN ('self', 'supporting_unit')),
    uses_per_battle INTEGER CHECK (uses_per_battle > 0),
    weapon_scope TEXT NOT NULL CHECK (weapon_scope IN ('Any', 'Ranged', 'Melee')),
    maximum_target_distance INTEGER CHECK (maximum_target_distance > 0),
    maximum_support_distance INTEGER CHECK (maximum_support_distance > 0),
    requires_attacker_charge INTEGER NOT NULL DEFAULT 0
        CHECK (requires_attacker_charge IN (0, 1)),
    requires_attacker_stationary INTEGER NOT NULL DEFAULT 0
        CHECK (requires_attacker_stationary IN (0, 1)),
    requires_attached_unit INTEGER NOT NULL DEFAULT 0
        CHECK (requires_attached_unit IN (0, 1)),
    requires_waaagh_active INTEGER NOT NULL DEFAULT 0
        CHECK (requires_waaagh_active IN (0, 1)),
    requires_oath_target INTEGER NOT NULL DEFAULT 0
        CHECK (requires_oath_target IN (0, 1)),
    requires_oath_wound_bonus INTEGER NOT NULL DEFAULT 0
        CHECK (requires_oath_wound_bonus IN (0, 1)),
    requires_source_on_objective INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_on_objective IN (0, 1)),
    requires_target_on_objective INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_on_objective IN (0, 1)),
    requires_source_controls_objective INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_controls_objective IN (0, 1)),
    requires_target_on_objective_not_controlled_by_source INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_on_objective_not_controlled_by_source IN (0, 1)),
    requires_source_on_selected_objective INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_on_selected_objective IN (0, 1)),
    requires_target_on_source_selected_objective INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_on_source_selected_objective IN (0, 1)),
    requires_target_battle_shocked INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_battle_shocked IN (0, 1)),
    requires_attacker_not_battle_shocked INTEGER NOT NULL DEFAULT 0
        CHECK (requires_attacker_not_battle_shocked IN (0, 1)),
    requires_source_not_battle_shocked INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_not_battle_shocked IN (0, 1)),
    requires_source_guided_against_target INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_guided_against_target IN (0, 1)),
    requires_target_spotted INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_spotted IN (0, 1)),
    requires_target_spotted_by_markerlight_observer INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_spotted_by_markerlight_observer IN (0, 1)),
    required_target_strength_state TEXT
        CHECK (required_target_strength_state IN
            ('below_starting', 'below_half', 'not_below_half')),
    hit_modifier INTEGER NOT NULL CHECK (hit_modifier BETWEEN -1 AND 1),
    hit_modifier_role TEXT CHECK (hit_modifier_role IN ('attacker', 'target', 'either')),
    hit_modifier_subject TEXT CHECK (hit_modifier_subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    wound_modifier INTEGER NOT NULL CHECK (wound_modifier BETWEEN -1 AND 1),
    wound_modifier_role TEXT CHECK (wound_modifier_role IN ('attacker', 'target', 'either')),
    wound_modifier_subject TEXT CHECK (wound_modifier_subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    reroll_hits INTEGER NOT NULL CHECK (reroll_hits IN (0, 1)),
    reroll_hit_ones INTEGER NOT NULL CHECK (reroll_hit_ones IN (0, 1)),
    hit_reroll_role TEXT CHECK (hit_reroll_role IN ('attacker', 'target', 'either')),
    hit_reroll_subject TEXT CHECK (hit_reroll_subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    reroll_wounds INTEGER NOT NULL CHECK (reroll_wounds IN (0, 1)),
    reroll_wound_ones INTEGER NOT NULL CHECK (reroll_wound_ones IN (0, 1)),
    wound_reroll_role TEXT CHECK (wound_reroll_role IN ('attacker', 'target', 'either')),
    wound_reroll_subject TEXT CHECK (wound_reroll_subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    PRIMARY KEY (datasheet_id, ability_position, preset_position),
    FOREIGN KEY (datasheet_id, ability_position)
        REFERENCES datasheet_abilities(datasheet_id, position) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX idx_unit_combat_presets_datasheet ON unit_combat_presets(datasheet_id);
CREATE TABLE unit_combat_preset_supported_keywords (
    datasheet_id TEXT NOT NULL,
    ability_position INTEGER NOT NULL,
    preset_position INTEGER NOT NULL,
    keyword_position INTEGER NOT NULL CHECK (keyword_position >= 1),
    keyword TEXT NOT NULL,
    PRIMARY KEY (datasheet_id, ability_position, preset_position, keyword_position),
    FOREIGN KEY (datasheet_id, ability_position, preset_position)
        REFERENCES unit_combat_presets(datasheet_id, ability_position, preset_position)
        ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE unit_combat_preset_effects (
    datasheet_id TEXT NOT NULL,
    ability_position INTEGER NOT NULL,
    preset_position INTEGER NOT NULL,
    effect_position INTEGER NOT NULL CHECK (effect_position >= 1),
    effect_type TEXT NOT NULL CHECK (effect_type IN
        ('lethal_hits', 'devastating_wounds', 'twin_linked', 'ignores_cover',
         'sustained_hits', 'rapid_fire', 'lance', 'heavy', 'ap_modifier', 'skill_modifier',
         'critical_hits', 'critical_wounds', 'attacks_replacement', 'strength_replacement',
         'damage_replacement', 'first_failed_save_damage_replacement',
         'allocated_attack_damage_replacement',
         'attacks_multiplier', 'strength_multiplier',
         'damage_multiplier', 'attacks_modifier', 'strength_modifier',
         'damage_modifier', 'save_target',
         'invulnerable_save', 'feel_no_pain', 'damage_reduction', 'damage_divisor')),
    value INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
    dice_count INTEGER NOT NULL DEFAULT 0 CHECK (dice_count >= 0),
    dice_sides INTEGER NOT NULL DEFAULT 0 CHECK (dice_sides >= 0),
    models_per_increment INTEGER CHECK (models_per_increment > 0),
    model_count_source TEXT CHECK (model_count_source IN ('source_unit', 'nearby_enemy')),
    weapon_name TEXT,
    required_target_keyword TEXT,
    required_attack_keyword TEXT,
    application_role TEXT NOT NULL CHECK (application_role IN ('attacker', 'target', 'either')),
    subject TEXT NOT NULL CHECK (subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    CHECK ((models_per_increment IS NULL) = (model_count_source IS NULL)),
    PRIMARY KEY (datasheet_id, ability_position, preset_position, effect_position),
    FOREIGN KEY (datasheet_id, ability_position, preset_position)
        REFERENCES unit_combat_presets(datasheet_id, ability_position, preset_position)
        ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX idx_unit_combat_preset_effects_datasheet
    ON unit_combat_preset_effects(datasheet_id);
"""


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Rebuild derived unit combat presets in place"
    )
    parser.add_argument(
        "database", nargs="?", type=Path, default=Path("data/warhammer_10e.sqlite")
    )
    args = parser.parse_args()
    with closing(sqlite3.connect(args.database)) as connection:
        connection.executescript(TABLE_SCHEMA)
        count = rebuild_combat_presets(connection)
        connection.execute(
            "UPDATE metadata SET value = '44' WHERE key = 'schema_version'"
        )
        connection.execute("PRAGMA optimize")
        connection.commit()
    print(f"Rebuilt {count} unit combat presets in {args.database}")


if __name__ == "__main__":
    main()
