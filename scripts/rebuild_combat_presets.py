#!/usr/bin/env python3

import argparse
import sqlite3
from contextlib import closing
from pathlib import Path

try:
    from scripts.build_profiles_db import (
        populate_starting_size_ranges,
        rebuild_combat_presets,
    )
except ModuleNotFoundError:
    from build_profiles_db import populate_starting_size_ranges, rebuild_combat_presets


TABLE_SCHEMA = """
CREATE TABLE IF NOT EXISTS unit_starting_size_ranges (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 1),
    minimum_models INTEGER NOT NULL CHECK (minimum_models >= 1),
    maximum_models INTEGER NOT NULL CHECK (maximum_models >= minimum_models),
    source_text TEXT NOT NULL,
    PRIMARY KEY (datasheet_id, position),
    UNIQUE (datasheet_id, minimum_models, maximum_models)
) WITHOUT ROWID;
DROP TABLE IF EXISTS unit_defensive_equipment_wargear_alternatives;
DROP TABLE IF EXISTS unit_defensive_equipment_effects;
DROP TABLE IF EXISTS unit_defensive_equipment_default_terms;
DROP TABLE IF EXISTS unit_defensive_equipment_bearers;
DROP TABLE IF EXISTS unit_defensive_equipment_options;
DROP TABLE IF EXISTS unit_combat_preset_wargear_alternatives;
DROP TABLE IF EXISTS unit_combat_preset_effects;
DROP TABLE IF EXISTS unit_combat_preset_keyword_requirements;
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
    source_equipment_default INTEGER NOT NULL DEFAULT 0
        CHECK (source_equipment_default IN (0, 1)),
    source_equipment_choice_exact INTEGER NOT NULL DEFAULT 0
        CHECK (source_equipment_choice_exact IN (0, 1)),
    source_relationship TEXT NOT NULL DEFAULT 'self'
        CHECK (source_relationship IN ('self', 'supporting_unit', 'self_or_supporting_unit')),
    uses_per_battle INTEGER CHECK (uses_per_battle > 0),
    weapon_scope TEXT NOT NULL CHECK (weapon_scope IN ('Any', 'Ranged', 'Melee')),
    maximum_target_distance INTEGER CHECK (maximum_target_distance > 0),
    maximum_source_target_distance INTEGER CHECK (maximum_source_target_distance > 0),
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
    requires_target_closest_eligible INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_closest_eligible IN (0, 1)),
    requires_source_target_visible INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_target_visible IN (0, 1)),
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
CREATE TABLE unit_combat_preset_keyword_requirements (
    datasheet_id TEXT NOT NULL,
    ability_position INTEGER NOT NULL,
    preset_position INTEGER NOT NULL,
    requirement_kind TEXT NOT NULL
        CHECK (requirement_kind IN ('attacker_all', 'target_all', 'attack_any')),
    keyword_position INTEGER NOT NULL CHECK (keyword_position >= 1),
    keyword TEXT NOT NULL,
    PRIMARY KEY (
        datasheet_id, ability_position, preset_position, requirement_kind, keyword_position
    ),
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
         'damage_modifier', 'reroll_hits', 'reroll_hit_ones', 'save_target',
         'invulnerable_save', 'feel_no_pain', 'damage_reduction', 'damage_divisor')),
    value INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
    dice_count INTEGER NOT NULL DEFAULT 0 CHECK (dice_count >= 0),
    dice_sides INTEGER NOT NULL DEFAULT 0 CHECK (dice_sides >= 0),
    models_per_increment INTEGER CHECK (models_per_increment > 0),
    model_count_source TEXT CHECK (model_count_source IN
        ('source_unit', 'nearby_enemy', 'nearby_enemy_units',
         'embarked_models', 'embarked_wracks_models',
         'enemy_character_models_destroyed', 'destructive_fight_phases')),
    maximum_modifier INTEGER CHECK (maximum_modifier > 0),
    weapon_name TEXT,
    required_target_keyword TEXT,
    required_attack_keyword TEXT,
    application_role TEXT NOT NULL CHECK (application_role IN ('attacker', 'target', 'either')),
    subject TEXT NOT NULL CHECK (subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    CHECK ((models_per_increment IS NULL) = (model_count_source IS NULL)),
    CHECK (maximum_modifier IS NULL OR model_count_source IS NOT NULL),
    PRIMARY KEY (datasheet_id, ability_position, preset_position, effect_position),
    FOREIGN KEY (datasheet_id, ability_position, preset_position)
        REFERENCES unit_combat_presets(datasheet_id, ability_position, preset_position)
        ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX idx_unit_combat_preset_effects_datasheet
    ON unit_combat_preset_effects(datasheet_id);
CREATE TABLE unit_combat_preset_wargear_alternatives (
    datasheet_id TEXT NOT NULL,
    ability_position INTEGER NOT NULL,
    preset_position INTEGER NOT NULL,
    option_position INTEGER NOT NULL,
    alternative_position INTEGER NOT NULL,
    quantity_delta INTEGER NOT NULL,
    source_text TEXT NOT NULL,
    PRIMARY KEY (
        datasheet_id, ability_position, preset_position,
        option_position, alternative_position
    ),
    FOREIGN KEY (datasheet_id, ability_position, preset_position)
        REFERENCES unit_combat_presets(datasheet_id, ability_position, preset_position)
        ON DELETE CASCADE,
    FOREIGN KEY (datasheet_id, option_position, alternative_position)
        REFERENCES wargear_choice_alternatives(
            datasheet_id, option_position, alternative_position
        ) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX idx_unit_combat_preset_wargear_alternatives_choice
    ON unit_combat_preset_wargear_alternatives(
        datasheet_id, option_position, alternative_position
    );
CREATE TABLE unit_defensive_equipment_options (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    ability_position INTEGER NOT NULL,
    name TEXT NOT NULL,
    description_text TEXT NOT NULL,
    effect_scope TEXT NOT NULL CHECK (effect_scope IN ('bearer', 'unit')),
    guidance_text TEXT,
    selection_kind TEXT NOT NULL DEFAULT 'unknown' CHECK
        (selection_kind IN ('default', 'optional', 'mixed', 'conditional', 'unknown')),
    eligibility_exact INTEGER NOT NULL DEFAULT 0 CHECK (eligibility_exact IN (0, 1)),
    selection_source_text TEXT,
    minimum_kind TEXT NOT NULL DEFAULT 'none' CHECK
        (minimum_kind IN ('none', 'default')),
    maximum_kind TEXT NOT NULL DEFAULT 'one' CHECK
        (maximum_kind IN ('one', 'default', 'per_model', 'per_increment')),
    maximum_value INTEGER NOT NULL DEFAULT 1 CHECK (maximum_value >= 1),
    maximum_models_per_increment INTEGER NOT NULL DEFAULT 1 CHECK
        (maximum_models_per_increment >= 1),
    limit_exact INTEGER NOT NULL DEFAULT 0 CHECK (limit_exact IN (0, 1)),
    limit_source_text TEXT,
    choice_coverage_exact INTEGER NOT NULL DEFAULT 0 CHECK
        (choice_coverage_exact IN (0, 1)),
    PRIMARY KEY (datasheet_id, ability_position),
    FOREIGN KEY (datasheet_id, ability_position)
        REFERENCES datasheet_abilities(datasheet_id, position) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE unit_defensive_equipment_wargear_alternatives (
    datasheet_id TEXT NOT NULL,
    ability_position INTEGER NOT NULL,
    option_position INTEGER NOT NULL,
    alternative_position INTEGER NOT NULL,
    quantity_delta INTEGER NOT NULL,
    source_text TEXT NOT NULL,
    PRIMARY KEY (
        datasheet_id, ability_position, option_position, alternative_position
    ),
    FOREIGN KEY (datasheet_id, ability_position)
        REFERENCES unit_defensive_equipment_options(datasheet_id, ability_position)
        ON DELETE CASCADE,
    FOREIGN KEY (datasheet_id, option_position, alternative_position)
        REFERENCES wargear_choice_alternatives(
            datasheet_id, option_position, alternative_position
        ) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX idx_defensive_equipment_wargear_alternatives_choice
    ON unit_defensive_equipment_wargear_alternatives(
        datasheet_id, option_position, alternative_position
    );
CREATE TABLE unit_defensive_equipment_bearers (
    datasheet_id TEXT NOT NULL,
    ability_position INTEGER NOT NULL,
    model_profile_id INTEGER NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
    model_position INTEGER NOT NULL CHECK (model_position >= 1),
    PRIMARY KEY (datasheet_id, ability_position, model_profile_id),
    FOREIGN KEY (datasheet_id, ability_position)
        REFERENCES unit_defensive_equipment_options(datasheet_id, ability_position)
        ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE unit_defensive_equipment_default_terms (
    datasheet_id TEXT NOT NULL,
    ability_position INTEGER NOT NULL,
    term_position INTEGER NOT NULL CHECK (term_position >= 1),
    fixed_quantity INTEGER,
    quantity_per_model INTEGER,
    quantity_per_increment INTEGER,
    models_per_increment INTEGER,
    loadout_subject_position INTEGER,
    source_text TEXT NOT NULL,
    PRIMARY KEY (datasheet_id, ability_position, term_position),
    FOREIGN KEY (datasheet_id, ability_position)
        REFERENCES unit_defensive_equipment_options(datasheet_id, ability_position)
        ON DELETE CASCADE,
    FOREIGN KEY (datasheet_id, loadout_subject_position)
        REFERENCES default_loadout_subjects(datasheet_id, position) ON DELETE CASCADE,
    CHECK (
        (loadout_subject_position IS NULL AND fixed_quantity IS NOT NULL
         AND quantity_per_model IS NOT NULL AND quantity_per_increment IS NOT NULL
         AND models_per_increment IS NOT NULL)
        OR
        (loadout_subject_position IS NOT NULL AND fixed_quantity IS NULL
         AND quantity_per_model IS NULL AND quantity_per_increment IS NULL
         AND models_per_increment IS NULL)
    )
) WITHOUT ROWID;
CREATE TABLE unit_defensive_equipment_effects (
    datasheet_id TEXT NOT NULL,
    ability_position INTEGER NOT NULL,
    effect_position INTEGER NOT NULL CHECK (effect_position >= 1),
    effect_type TEXT NOT NULL CHECK (effect_type IN
        ('save_target', 'invulnerable_save', 'feel_no_pain',
         'damage_reduction', 'first_failed_save_damage_replacement')),
    value INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
    required_attack_keyword TEXT,
    PRIMARY KEY (datasheet_id, ability_position, effect_position),
    FOREIGN KEY (datasheet_id, ability_position)
        REFERENCES unit_defensive_equipment_options(datasheet_id, ability_position)
        ON DELETE CASCADE
) WITHOUT ROWID;
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
        connection.execute("DELETE FROM unit_starting_size_ranges")
        populate_starting_size_ranges(connection)
        count = rebuild_combat_presets(connection)
        schema_tables = {
            row[0]
            for row in connection.execute(
                """SELECT name FROM sqlite_schema
                   WHERE type = 'table' AND name IN
                       ('wargear_choice_item_limits', 'wargear_weapon_type_limits',
                        'wargear_choice_pairing_rules')"""
            )
        }
        schema_version = (
            "75"
            if len(schema_tables) == 3
            else "74"
            if len(schema_tables) == 2
            else "73"
        )
        connection.execute(
            "UPDATE metadata SET value = ? WHERE key = 'schema_version'",
            (schema_version,),
        )
        connection.execute("PRAGMA optimize")
        connection.commit()
    print(f"Rebuilt {count} unit combat presets in {args.database}")


if __name__ == "__main__":
    main()
