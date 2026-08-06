#!/usr/bin/env python3
"""Export the SQLite profile catalogue as compact browser-friendly JSON."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def export(database: Path, output: Path) -> None:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        factions = [
            dict(row)
            for row in connection.execute(
                "SELECT id, name FROM factions ORDER BY name COLLATE NOCASE"
            )
        ]
        units = {
            row["id"]: {
                "id": row["id"],
                "factionId": row["faction_id"],
                "name": row["name"],
                "models": [],
                "weapons": [],
            }
            for row in connection.execute(
                "SELECT id, faction_id, name FROM datasheets ORDER BY name COLLATE NOCASE"
            )
        }

        keywords: dict[str, list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, keyword
               FROM datasheet_keywords
               ORDER BY datasheet_id, position"""
        ):
            values = keywords.setdefault(row["datasheet_id"], [])
            if row["keyword"] not in values:
                values.append(row["keyword"])

        for row in connection.execute(
            """SELECT id, datasheet_id, name, toughness, save_target,
                      invulnerable_save_target, wounds
               FROM model_profiles
               ORDER BY datasheet_id, source_line, name COLLATE NOCASE"""
        ):
            units[row["datasheet_id"]]["models"].append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "t": row["toughness"],
                    "save": row["save_target"],
                    "invuln": row["invulnerable_save_target"],
                    "wounds": row["wounds"],
                    "keywords": keywords.get(row["datasheet_id"], []),
                }
            )

        abilities: dict[int, list[dict[str, str | None]]] = {}
        for row in connection.execute(
            """SELECT weapon_profile_id, name, value
               FROM weapon_abilities
               ORDER BY weapon_profile_id, position"""
        ):
            abilities.setdefault(row["weapon_profile_id"], []).append(
                {"name": row["name"], "value": row["value"]}
            )

        for row in connection.execute(
            """SELECT id, datasheet_id, name, weapon_type, attacks,
                      skill_target, strength, armour_penetration, damage,
                      abilities_text
               FROM weapon_profiles
               ORDER BY datasheet_id, source_line, profile_line, name COLLATE NOCASE"""
        ):
            units[row["datasheet_id"]]["weapons"].append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "type": row["weapon_type"],
                    "attacks": row["attacks"],
                    "skill": row["skill_target"],
                    "strength": row["strength"],
                    "ap": row["armour_penetration"],
                    "damage": row["damage"],
                    "rules": row["abilities_text"],
                    "abilities": abilities.get(row["id"], []),
                }
            )

        source_updated_at = connection.execute(
            "SELECT value FROM metadata WHERE key = 'source_updated_at'"
        ).fetchone()[0]
        payload = {
            "sourceUpdatedAt": source_updated_at,
            "factions": factions,
            "units": list(units.values()),
        }
    finally:
        connection.close()

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    export(args.database.resolve(), args.output.resolve())
    print(f"Exported {args.output.resolve()}")


if __name__ == "__main__":
    main()
