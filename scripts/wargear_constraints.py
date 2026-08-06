#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import re
import sqlite3
from pathlib import Path


CONSTRAINT_SCHEMA = """
CREATE TABLE IF NOT EXISTS wargear_constraints (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    option_position INTEGER NOT NULL,
    fixed_limit INTEGER NOT NULL CHECK (fixed_limit >= 0),
    limit_per_increment INTEGER NOT NULL CHECK (limit_per_increment >= 0),
    models_per_increment INTEGER NOT NULL CHECK (models_per_increment >= 1),
    description_text TEXT NOT NULL,
    PRIMARY KEY (datasheet_id, option_position),
    FOREIGN KEY (datasheet_id, option_position)
        REFERENCES wargear_options(datasheet_id, position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS wargear_constraint_weapons (
    datasheet_id TEXT NOT NULL,
    option_position INTEGER NOT NULL,
    weapon_group_id TEXT NOT NULL,
    weapon_group_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    PRIMARY KEY (datasheet_id, option_position, weapon_group_id),
    FOREIGN KEY (datasheet_id, option_position)
        REFERENCES wargear_constraints(datasheet_id, option_position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_wargear_constraint_weapons_datasheet
    ON wargear_constraint_weapons(datasheet_id, weapon_group_id);

CREATE TABLE IF NOT EXISTS wargear_choice_pools (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    option_position INTEGER NOT NULL,
    fixed_limit INTEGER NOT NULL CHECK (fixed_limit >= 0),
    limit_per_increment INTEGER NOT NULL CHECK (limit_per_increment >= 0),
    models_per_increment INTEGER NOT NULL CHECK (models_per_increment >= 1),
    description_text TEXT NOT NULL,
    PRIMARY KEY (datasheet_id, option_position),
    FOREIGN KEY (datasheet_id, option_position)
        REFERENCES wargear_options(datasheet_id, position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS wargear_choice_alternatives (
    datasheet_id TEXT NOT NULL,
    option_position INTEGER NOT NULL,
    alternative_position INTEGER NOT NULL,
    description_text TEXT NOT NULL,
    PRIMARY KEY (datasheet_id, option_position, alternative_position),
    FOREIGN KEY (datasheet_id, option_position)
        REFERENCES wargear_choice_pools(datasheet_id, option_position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS wargear_choice_alternative_weapons (
    datasheet_id TEXT NOT NULL,
    option_position INTEGER NOT NULL,
    alternative_position INTEGER NOT NULL,
    weapon_group_id TEXT NOT NULL,
    weapon_group_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    PRIMARY KEY (
        datasheet_id, option_position, alternative_position, weapon_group_id
    ),
    FOREIGN KEY (datasheet_id, option_position, alternative_position)
        REFERENCES wargear_choice_alternatives(
            datasheet_id, option_position, alternative_position
        ) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_wargear_choice_weapons_datasheet
    ON wargear_choice_alternative_weapons(datasheet_id, weapon_group_id);

CREATE TABLE IF NOT EXISTS wargear_choice_replaced_weapons (
    datasheet_id TEXT NOT NULL,
    option_position INTEGER NOT NULL,
    weapon_group_id TEXT NOT NULL,
    weapon_group_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    PRIMARY KEY (datasheet_id, option_position, weapon_group_id),
    FOREIGN KEY (datasheet_id, option_position)
        REFERENCES wargear_choice_pools(datasheet_id, option_position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_wargear_choice_replaced_datasheet
    ON wargear_choice_replaced_weapons(datasheet_id, weapon_group_id);

CREATE TABLE IF NOT EXISTS default_weapon_loadout (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    weapon_group_id TEXT NOT NULL,
    weapon_group_name TEXT NOT NULL,
    fixed_quantity INTEGER NOT NULL CHECK (fixed_quantity >= 0),
    quantity_per_model INTEGER NOT NULL CHECK (quantity_per_model >= 0),
    description_text TEXT NOT NULL,
    PRIMARY KEY (datasheet_id, weapon_group_id)
) WITHOUT ROWID;
"""

PROFILE_SEPARATORS = (" – ", " - ", " — ")
COMPLEX_MARKERS = (
    " additional ",
    " different weapons ",
    " duplicates",
    " cannot ",
    " only ",
    " instead of ",
)


def normalized_name(value: str) -> str:
    value = html.unescape(re.sub(r"<[^>]+>", " ", value))
    value = value.lower().replace("’", "'").replace("‑", "-").replace("–", "-")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value)).strip()


def group_name(names: list[str]) -> str:
    if len(names) == 1:
        return names[0].strip()
    if len(set(names)) == 1:
        return names[0].strip()
    bases = [profile_base_name(name) for name in names]
    if len({normalized_name(name) for name in bases}) == 1:
        return bases[0]
    for separator in PROFILE_SEPARATORS:
        if separator not in names[0]:
            continue
        prefix = names[0].split(separator, 1)[0]
        if all(name.startswith(f"{prefix}{separator}") for name in names):
            return prefix.strip()
    raise ValueError(f"could not derive weapon group name from {names!r}")


def profile_base_name(name: str) -> str:
    for separator in PROFILE_SEPARATORS:
        if separator in name:
            return name.split(separator, 1)[0].strip()
    return name.strip()


def allowance(description: str) -> tuple[int, int, int] | None:
    value = normalized_name(description)
    if re.match(r"(?:any number of|each of) this model s ", value):
        return None
    match = re.match(r"this model s (\d+) .* can each be replaced", value)
    if match:
        return int(match.group(1)), 0, 1
    if re.match(r"this model s .* can each be replaced", value):
        return None
    match = re.match(r"for every (\d+) models? in this unit (?:up to )?(\d+) ", value)
    if match:
        return 0, int(match.group(2)), int(match.group(1))
    if re.match(r"any number of .* can each ", value) or re.match(r"each .* can ", value):
        return 0, 1, 1
    match = re.match(r"up to (\d+) .* can ", value)
    if match:
        return int(match.group(1)), 0, 1
    match = re.match(r"(\d+) (?:of )?.* can ", value)
    if match:
        return int(match.group(1)), 0, 1
    if re.match(r"(?:this model|this unit|the |one ).* can ", value):
        return 1, 0, 1
    return None


def option_choices(description_html: str, description_text: str) -> list[str]:
    items = re.findall(r"<li[^>]*>(.*?)</li>", description_html, re.IGNORECASE | re.DOTALL)
    if items:
        return items
    match = re.search(
        r"(?:replaced with|equipped with)(?: one of the following)?\s*:?\s*(.*?)(?:\.|$)",
        description_text,
        re.IGNORECASE,
    )
    return [match.group(1)] if match else []


def source_names(description: str, known_names: set[str]) -> set[str]:
    lower = normalized_name(description)
    operation = re.search(
        r" can (?:each )?(?:have .* )?(?:be |have .* )?(?:replaced|equipped)",
        lower,
    )
    prefix = lower[: operation.start()] if operation else lower
    return {name for name in known_names if re.search(rf"\b{re.escape(name)}s?\b", prefix)}


def choice_weapon_vector(
    choice: str,
    known: dict[str, tuple[str, str]],
    replaced_names: set[str],
) -> dict[str, tuple[str, int]]:
    value = normalized_name(choice)
    parsed: dict[str, tuple[str, int]] = {}
    for candidate, (weapon_group_id, weapon_name) in sorted(
        known.items(), key=lambda entry: len(entry[0]), reverse=True
    ):
        if candidate in replaced_names:
            continue
        match = re.search(rf"(?:^|\s)(\d+)\s+{re.escape(candidate)}s?(?:\s|$)", value)
        if not match:
            continue
        parsed[weapon_group_id] = (weapon_name, int(match.group(1)))
    return parsed


def weapon_vector(
    description: str,
    known: dict[str, tuple[str, str]],
) -> dict[str, tuple[str, int]]:
    value = normalized_name(description)
    parsed: dict[str, tuple[str, int]] = {}
    occupied: list[tuple[int, int]] = []
    for candidate, (weapon_group_id, weapon_name) in sorted(
        known.items(), key=lambda entry: len(entry[0]), reverse=True
    ):
        match = re.search(
            rf"(?<![a-z0-9])(?:(\d+)\s+)?{re.escape(candidate)}s?(?![a-z0-9])",
            value,
        )
        if not match or any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        parsed[weapon_group_id] = (weapon_name, int(match.group(1) or 1))
        occupied.append(match.span())
    return parsed


def default_loadout_clauses(loadout_html: str) -> list[tuple[int, int, str]]:
    value = re.sub(r"<br\s*/?>", "\n", loadout_html, flags=re.IGNORECASE)
    value = html.unescape(re.sub(r"<[^>]+>", "", value))
    clauses = []
    for line in (re.sub(r"\s+", " ", item).strip() for item in value.splitlines()):
        match = re.match(r"(.+?)\s+(?:is|are) equipped with:\s*(.+)$", line, re.IGNORECASE)
        if not match:
            continue
        subject = normalized_name(match.group(1))
        if subject in {"this model"}:
            clauses.append((1, 0, match.group(2)))
        elif subject in {"every model", "each model", "every model in this unit", "each model in this unit"}:
            clauses.append((0, 1, match.group(2)))
    return clauses


def replaced_weapon_vector(
    description: str,
    known: dict[str, tuple[str, str]],
    replaced_names: set[str],
) -> dict[str, tuple[str, int]]:
    prefix = normalized_name(description).split(" can ", 1)[0]
    return {
        weapon_group_id: (weapon_name, quantity)
        for weapon_group_id, (weapon_name, quantity) in weapon_vector(prefix, known).items()
        if normalized_name(weapon_name) in replaced_names
    }


def populate_constraints(connection: sqlite3.Connection) -> int:
    connection.executescript(CONSTRAINT_SCHEMA)
    connection.execute("DELETE FROM default_weapon_loadout")
    connection.execute("DELETE FROM wargear_choice_replaced_weapons")
    connection.execute("DELETE FROM wargear_choice_alternative_weapons")
    connection.execute("DELETE FROM wargear_choice_alternatives")
    connection.execute("DELETE FROM wargear_choice_pools")
    connection.execute("DELETE FROM wargear_constraint_weapons")
    connection.execute("DELETE FROM wargear_constraints")

    rows = connection.execute(
        """SELECT id, datasheet_id, source_line, profile_line, name
           FROM weapon_profiles
           ORDER BY datasheet_id, source_line, profile_line, id"""
    ).fetchall()
    grouped: dict[tuple[str, str], list[tuple[int, int | None, str]]] = {}
    for weapon_id, datasheet_id, source_line, _profile_line, name in rows:
        key = normalized_name(profile_base_name(name))
        grouped.setdefault((datasheet_id, key), []).append((weapon_id, source_line, name))

    names_by_unit: dict[str, dict[str, tuple[str, str]]] = {}
    for (datasheet_id, _key), profiles in grouped.items():
        source_lines = [profile[1] for profile in profiles if profile[1] is not None]
        suffix = str(min(source_lines)) if source_lines else f"profile:{min(p[0] for p in profiles)}"
        name = group_name([profile[2] for profile in profiles])
        names_by_unit.setdefault(datasheet_id, {})[normalized_name(name)] = (
            f"{datasheet_id}:{suffix}",
            name,
        )

    options_by_unit: dict[str, list[tuple]] = {}
    for row in connection.execute(
        """SELECT datasheet_id, position, description_html, description_text
           FROM wargear_options ORDER BY datasheet_id, position"""
    ):
        options_by_unit.setdefault(row[0], []).append(row)

    loadouts = {
        row[0]: (row[1], row[2])
        for row in connection.execute(
            "SELECT id, loadout_html, loadout_text FROM datasheets"
        )
    }

    for datasheet_id, (loadout_html, loadout_text) in loadouts.items():
        known = names_by_unit.get(datasheet_id, {})
        totals: dict[str, tuple[str, int, int]] = {}
        for fixed, per_model, equipment in default_loadout_clauses(loadout_html):
            for weapon_group_id, (weapon_name, quantity) in weapon_vector(equipment, known).items():
                previous = totals.get(weapon_group_id, (weapon_name, 0, 0))
                totals[weapon_group_id] = (
                    weapon_name,
                    previous[1] + fixed * quantity,
                    previous[2] + per_model * quantity,
                )
        connection.executemany(
            """INSERT INTO default_weapon_loadout
               (datasheet_id, weapon_group_id, weapon_group_name, fixed_quantity,
                quantity_per_model, description_text)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                (datasheet_id, group_id, name, fixed, per_model, loadout_text)
                for group_id, (name, fixed, per_model) in totals.items()
            ),
        )

    inserted = 0
    for datasheet_id, options in options_by_unit.items():
        known = names_by_unit.get(datasheet_id, {})

        for _unit_id, position, description_html, description_text in options:
            normalized = f" {normalized_name(description_text)} "
            limit = allowance(description_text)
            choices = option_choices(description_html, description_text)
            if not limit or not choices or any(marker in normalized for marker in COMPLEX_MARKERS):
                continue
            replaced_names = (
                source_names(description_text, set(known))
                if "replaced" in normalized_name(description_text)
                else set()
            )
            alternatives = []
            for alternative_position, choice in enumerate(choices, start=1):
                vector = choice_weapon_vector(choice, known, replaced_names)
                if vector:
                    alternative_text = html.unescape(re.sub(r"<[^>]+>", " ", choice)).strip()
                    alternatives.append((alternative_position, alternative_text, vector))
            if alternatives:
                connection.execute(
                    """INSERT INTO wargear_choice_pools
                       (datasheet_id, option_position, fixed_limit, limit_per_increment,
                        models_per_increment, description_text)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (datasheet_id, position, *limit, description_text),
                )
                for alternative_position, alternative_text, vector in alternatives:
                    connection.execute(
                        """INSERT INTO wargear_choice_alternatives
                           (datasheet_id, option_position, alternative_position, description_text)
                           VALUES (?, ?, ?, ?)""",
                        (datasheet_id, position, alternative_position, alternative_text),
                    )
                    connection.executemany(
                        """INSERT INTO wargear_choice_alternative_weapons
                           (datasheet_id, option_position, alternative_position,
                            weapon_group_id, weapon_group_name, quantity)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (
                            (
                                datasheet_id,
                                position,
                                alternative_position,
                                weapon_group_id,
                                weapon_name,
                                quantity,
                            )
                            for weapon_group_id, (weapon_name, quantity) in vector.items()
                        ),
                    )
                replaced = replaced_weapon_vector(description_text, known, replaced_names)
                connection.executemany(
                    """INSERT INTO wargear_choice_replaced_weapons
                       (datasheet_id, option_position, weapon_group_id,
                        weapon_group_name, quantity)
                       VALUES (?, ?, ?, ?, ?)""",
                    (
                        (datasheet_id, position, group_id, name, quantity)
                        for group_id, (name, quantity) in replaced.items()
                    ),
                )
            parsed: dict[str, tuple[str, int]] = {}
            valid = True
            for choice in choices:
                value = normalized_name(choice)
                match = re.fullmatch(r"(?:up to )?(\d+) (.+)", value)
                if not match or " and " in f" {value} " or " or " in f" {value} ":
                    valid = False
                    break
                quantity = int(match.group(1))
                candidate = match.group(2)
                weapon = known.get(candidate) or (
                    known.get(candidate[:-1]) if candidate.endswith("s") else None
                )
                if not weapon or normalized_name(weapon[1]) in replaced_names:
                    continue
                previous = parsed.get(weapon[0])
                if previous and previous[1] != quantity:
                    valid = False
                    break
                parsed[weapon[0]] = (weapon[1], quantity)
            if not valid or not parsed:
                continue
            connection.execute(
                """INSERT INTO wargear_constraints
                   (datasheet_id, option_position, fixed_limit, limit_per_increment,
                    models_per_increment, description_text)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (datasheet_id, position, *limit, description_text),
            )
            connection.executemany(
                """INSERT INTO wargear_constraint_weapons
                   (datasheet_id, option_position, weapon_group_id,
                    weapon_group_name, quantity)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    (datasheet_id, position, weapon_group_id, weapon_name, quantity)
                    for weapon_group_id, (weapon_name, quantity) in parsed.items()
                ),
            )
            inserted += 1

    return inserted


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    args = parser.parse_args()
    connection = sqlite3.connect(args.database.resolve())
    try:
        with connection:
            count = populate_constraints(connection)
            connection.execute("UPDATE metadata SET value = '6' WHERE key = 'schema_version'")
        print(f"Structured {count} source-backed wargear constraints")
        pools = connection.execute("SELECT count(*) FROM wargear_choice_pools").fetchone()[0]
        print(f"Structured {pools} source-backed wargear choice pools")
        defaults = connection.execute("SELECT count(*) FROM default_weapon_loadout").fetchone()[0]
        print(f"Structured {defaults} source-backed default weapon quantities")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
