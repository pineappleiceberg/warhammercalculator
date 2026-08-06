#!/usr/bin/env python3

import argparse
import sqlite3
from pathlib import Path

try:
    from scripts.build_profiles_db import rebuild_combat_presets
except ModuleNotFoundError:
    from build_profiles_db import rebuild_combat_presets


TABLE_SCHEMA = """
DROP TABLE unit_combat_presets;
CREATE TABLE unit_combat_presets (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    ability_position INTEGER NOT NULL,
    preset_position INTEGER NOT NULL CHECK (preset_position >= 1),
    name TEXT NOT NULL,
    description_text TEXT NOT NULL,
    is_exclusive_choice INTEGER NOT NULL CHECK (is_exclusive_choice IN (0, 1)),
    weapon_scope TEXT NOT NULL CHECK (weapon_scope IN ('Any', 'Ranged', 'Melee')),
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
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild derived unit combat presets in place")
    parser.add_argument("database", nargs="?", type=Path, default=Path("data/warhammer_10e.sqlite"))
    args = parser.parse_args()
    with sqlite3.connect(args.database) as connection:
        connection.executescript(TABLE_SCHEMA)
        count = rebuild_combat_presets(connection)
        connection.execute("UPDATE metadata SET value = '11' WHERE key = 'schema_version'")
    print(f"Rebuilt {count} unit combat presets in {args.database}")


if __name__ == "__main__":
    main()
