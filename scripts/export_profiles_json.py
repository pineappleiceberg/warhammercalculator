#!/usr/bin/env python3
"""Export the SQLite profile catalogue as compact browser-friendly JSON."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


PROFILE_SEPARATORS = (" – ", " - ", " — ")


def profile_base_name(name: str) -> str:
    for separator in PROFILE_SEPARATORS:
        if separator in name:
            return name.split(separator, 1)[0].strip()
    return name.strip()


def profile_group_names(names: list[str]) -> tuple[str, list[str | None]]:
    if len(names) == 1:
        return names[0], [None]
    if len(set(names)) == 1:
        return names[0], [None] * len(names)
    bases = [profile_base_name(name) for name in names]
    if len({name.casefold() for name in bases}) == 1:
        profiles = []
        for name in names:
            base = profile_base_name(name)
            profiles.append(name[len(base) :].lstrip(" –—-").strip() or None)
        return bases[0], profiles
    for separator in PROFILE_SEPARATORS:
        if separator not in names[0]:
            continue
        group_name = names[0].split(separator, 1)[0]
        prefix = f"{group_name}{separator}"
        if all(name.startswith(prefix) for name in names):
            return group_name, [name[len(prefix) :] for name in names]
    raise ValueError(f"could not derive profile modes for grouped weapon: {names!r}")


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
                "composition": [],
                "loadout": row["loadout_text"],
                "defaultWeapons": [],
                "wargearOptions": [],
                "weaponLimits": [],
                "wargearChoicePools": [],
                "suggestedModelCount": None,
                "maximumModelCount": None,
            }
            for row in connection.execute(
                """SELECT id, faction_id, name, loadout_text
                   FROM datasheets ORDER BY name COLLATE NOCASE"""
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
            """SELECT datasheet_id, description_text, min_models, max_models
               FROM unit_composition
               ORDER BY datasheet_id, position"""
        ):
            units[row["datasheet_id"]]["composition"].append(
                {
                    "text": row["description_text"],
                    "min": row["min_models"],
                    "max": row["max_models"],
                }
            )

        for row in connection.execute(
            """SELECT datasheet_id, description_text
               FROM wargear_options
               ORDER BY datasheet_id, position"""
        ):
            units[row["datasheet_id"]]["wargearOptions"].append(
                row["description_text"]
            )

        for row in connection.execute(
            """SELECT datasheet_id, weapon_group_id, weapon_group_name,
                      fixed_quantity, quantity_per_model, description_text
               FROM default_weapon_loadout
               ORDER BY datasheet_id, weapon_group_id"""
        ):
            units[row["datasheet_id"]]["defaultWeapons"].append(
                {
                    "groupId": row["weapon_group_id"],
                    "groupName": row["weapon_group_name"],
                    "fixed": row["fixed_quantity"],
                    "perModel": row["quantity_per_model"],
                    "source": row["description_text"],
                }
            )

        limits: dict[tuple[str, str], dict] = {}
        for row in connection.execute(
            """SELECT wc.datasheet_id, wc.fixed_limit, wc.limit_per_increment,
                      wc.models_per_increment, wc.description_text,
                      wcw.weapon_group_id, wcw.weapon_group_name, wcw.quantity
               FROM wargear_constraints AS wc
               JOIN wargear_constraint_weapons AS wcw
                 USING (datasheet_id, option_position)
               ORDER BY wc.datasheet_id, wcw.weapon_group_id, wc.option_position"""
        ):
            key = (row["datasheet_id"], row["weapon_group_id"])
            limit = limits.setdefault(
                key,
                {
                    "groupId": row["weapon_group_id"],
                    "groupName": row["weapon_group_name"],
                    "terms": [],
                },
            )
            limit["terms"].append(
                {
                    "fixed": row["fixed_limit"],
                    "perIncrement": row["limit_per_increment"],
                    "modelsPerIncrement": row["models_per_increment"],
                    "quantity": row["quantity"],
                    "source": row["description_text"],
                }
            )
        for (datasheet_id, _group_id), limit in limits.items():
            units[datasheet_id]["weaponLimits"].append(limit)

        pools: dict[tuple[str, int], dict] = {}
        alternatives: dict[tuple[str, int, int], dict] = {}
        for row in connection.execute(
            """SELECT pool.datasheet_id, pool.option_position, pool.fixed_limit,
                      pool.limit_per_increment, pool.models_per_increment,
                      pool.description_text AS source_text,
                      alternative.alternative_position,
                      alternative.description_text AS alternative_text,
                      weapon.weapon_group_id, weapon.weapon_group_name, weapon.quantity
               FROM wargear_choice_pools AS pool
               JOIN wargear_choice_alternatives AS alternative
                 USING (datasheet_id, option_position)
               JOIN wargear_choice_alternative_weapons AS weapon
                 USING (datasheet_id, option_position, alternative_position)
               ORDER BY pool.datasheet_id, pool.option_position,
                        alternative.alternative_position, weapon.weapon_group_id"""
        ):
            pool_key = (row["datasheet_id"], row["option_position"])
            pool = pools.setdefault(
                pool_key,
                {
                    "id": f"{row['datasheet_id']}:{row['option_position']}",
                    "fixed": row["fixed_limit"],
                    "perIncrement": row["limit_per_increment"],
                    "modelsPerIncrement": row["models_per_increment"],
                    "source": row["source_text"],
                    "replaces": [],
                    "alternatives": [],
                },
            )
            alternative_key = (*pool_key, row["alternative_position"])
            alternative = alternatives.get(alternative_key)
            if alternative is None:
                alternative = {
                    "id": f"{pool['id']}:{row['alternative_position']}",
                    "label": row["alternative_text"],
                    "weapons": [],
                }
                alternatives[alternative_key] = alternative
                pool["alternatives"].append(alternative)
            alternative["weapons"].append(
                {
                    "groupId": row["weapon_group_id"],
                    "groupName": row["weapon_group_name"],
                    "quantity": row["quantity"],
                }
            )
        for (datasheet_id, _position), pool in pools.items():
            units[datasheet_id]["wargearChoicePools"].append(pool)

        for row in connection.execute(
            """SELECT datasheet_id, option_position, weapon_group_id,
                      weapon_group_name, quantity
               FROM wargear_choice_replaced_weapons
               ORDER BY datasheet_id, option_position, weapon_group_id"""
        ):
            pool = pools.get((row["datasheet_id"], row["option_position"]))
            if pool is not None:
                pool["replaces"].append(
                    {
                        "groupId": row["weapon_group_id"],
                        "groupName": row["weapon_group_name"],
                        "quantity": row["quantity"],
                    }
                )

        for unit in units.values():
            composition = unit["composition"]
            if composition and all(
                row["min"] is not None and row["max"] is not None
                for row in composition
            ):
                unit["suggestedModelCount"] = sum(row["min"] for row in composition)
                unit["maximumModelCount"] = sum(row["max"] for row in composition)

        weapon_rows = list(
            connection.execute(
                """SELECT id, datasheet_id, name, weapon_type, attacks,
                          skill_target, strength, armour_penetration, damage,
                          abilities_text, source_line, profile_line
                   FROM weapon_profiles
                   ORDER BY datasheet_id, source_line, profile_line, name COLLATE NOCASE"""
            )
        )
        weapon_groups: dict[tuple[str, str], list[sqlite3.Row]] = {}
        for row in weapon_rows:
            key = (row["datasheet_id"], profile_base_name(row["name"]).casefold())
            weapon_groups.setdefault(key, []).append(row)

        group_metadata: dict[int, tuple[str, str, str | None, int, int]] = {}
        for (datasheet_id, _base_name), rows_in_group in weapon_groups.items():
            source_lines = [row["source_line"] for row in rows_in_group if row["source_line"] is not None]
            group_id = (
                f"{datasheet_id}:{min(source_lines)}"
                if source_lines
                else f"{datasheet_id}:profile:{min(row['id'] for row in rows_in_group)}"
            )
            group_name, profile_names = profile_group_names(
                [row["name"] for row in rows_in_group]
            )
            for index, (row, profile_name) in enumerate(
                zip(rows_in_group, profile_names, strict=True), start=1
            ):
                group_metadata[row["id"]] = (
                    group_id,
                    group_name,
                    profile_name,
                    index,
                    len(rows_in_group),
                )

        for row in weapon_rows:
            group_id, group_name, profile_name, profile_index, profile_count = (
                group_metadata[row["id"]]
            )
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
                    "groupId": group_id,
                    "groupName": group_name,
                    "profileName": profile_name,
                    "profileIndex": profile_index,
                    "profileCount": profile_count,
                }
            )

        source_updated_at = connection.execute(
            "SELECT value FROM metadata WHERE key = 'source_updated_at'"
        ).fetchone()[0]
        payload = {
            "sourceUpdatedAt": source_updated_at,
            "structuredWargear": {
                "constraintCount": connection.execute(
                    "SELECT count(*) FROM wargear_constraints"
                ).fetchone()[0],
                "constrainedWeaponCount": len(limits),
                "choicePoolCount": len(pools),
                "defaultWeaponCount": connection.execute(
                    "SELECT count(*) FROM default_weapon_loadout"
                ).fetchone()[0],
                "replacementWeaponCount": connection.execute(
                    "SELECT count(*) FROM wargear_choice_replaced_weapons"
                ).fetchone()[0],
                "compoundAlternativeCount": sum(
                    1
                    for alternative in alternatives.values()
                    if len(alternative["weapons"]) > 1
                ),
                "optionCount": connection.execute(
                    "SELECT count(*) FROM wargear_options"
                ).fetchone()[0],
                "conservative": True,
            },
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
