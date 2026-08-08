#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import math
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
    datasheet_id TEXT NOT NULL,
    subject_position INTEGER NOT NULL,
    weapon_group_id TEXT NOT NULL,
    weapon_group_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    fixed_quantity INTEGER NOT NULL,
    quantity_per_model INTEGER NOT NULL CHECK (quantity_per_model >= 0),
    quantity_per_increment INTEGER NOT NULL CHECK (quantity_per_increment >= 0),
    models_per_increment INTEGER NOT NULL CHECK (models_per_increment >= 1),
    description_text TEXT NOT NULL,
    PRIMARY KEY (datasheet_id, subject_position, weapon_group_id),
    FOREIGN KEY (datasheet_id, subject_position)
        REFERENCES default_loadout_subjects(datasheet_id, position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS default_loadout_subjects (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    subject_text TEXT NOT NULL,
    equipment_text TEXT NOT NULL,
    fixed_quantity INTEGER,
    quantity_per_model INTEGER,
    quantity_per_increment INTEGER,
    models_per_increment INTEGER,
    resolved INTEGER NOT NULL CHECK (resolved IN (0, 1)),
    PRIMARY KEY (datasheet_id, position),
    CHECK (
        (resolved = 0 AND fixed_quantity IS NULL AND quantity_per_model IS NULL
         AND quantity_per_increment IS NULL AND models_per_increment IS NULL)
        OR
        (resolved = 1 AND fixed_quantity IS NOT NULL AND quantity_per_model IS NOT NULL
         AND quantity_per_increment IS NOT NULL AND models_per_increment IS NOT NULL)
    )
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS default_loadout_subject_weapons (
    datasheet_id TEXT NOT NULL,
    subject_position INTEGER NOT NULL,
    weapon_group_id TEXT NOT NULL,
    weapon_group_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    PRIMARY KEY (datasheet_id, subject_position, weapon_group_id),
    FOREIGN KEY (datasheet_id, subject_position)
        REFERENCES default_loadout_subjects(datasheet_id, position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_default_loadout_subject_weapons_datasheet
    ON default_loadout_subject_weapons(datasheet_id, subject_position);
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


def singular_model_name(value: str) -> str:
    words = normalized_name(value).split()
    if not words:
        return ""
    word = words[-1]
    if word.endswith("ies") and len(word) > 3:
        words[-1] = f"{word[:-3]}y"
    elif word.endswith("men") and len(word) > 3:
        words[-1] = f"{word[:-3]}man"
    elif word.endswith(("sses", "xes", "zes", "ches", "shes", "oes")) and len(word) > 3:
        words[-1] = word[:-2]
    elif word.endswith(("s", "z")) and len(word) > 1:
        words[-1] = word[:-1]
    return " ".join(words)


def model_name_matches(subject: str, component: str) -> bool:
    left = singular_model_name(subject)
    right = singular_model_name(component)
    return left == right or left.endswith(f" {right}") or right.endswith(f" {left}")


def subject_count(
    subject: str,
    components: list[tuple[str, int, int, int]],
) -> tuple[int, int, int, int] | None:
    value = normalized_name(subject)
    if value in {"every model", "each model", "every model in this unit", "each model in this unit"}:
        return 0, 1, 0, 1

    def part_count(part: str, inherited: str | None = None) -> tuple[int, int, int, int] | None:
        mode = inherited
        item = normalized_name(part)
        every = re.match(r"^(?:every|each)\s+(.+)$", item)
        explicit = re.match(r"^(?:the\s+)?(?:(\d+)|one)(?:\s+other)?\s+(.+)$", item)
        if every:
            mode = "every"
            item = every.group(1)
        elif explicit:
            mode = "explicit"
            explicit_count = int(explicit.group(1) or 1)
            item = explicit.group(2)
        else:
            item = re.sub(r"^(?:the|a|an)\s+", "", item)
            mode = mode or "single"
        item = re.sub(r"\s+models?$", "", item)
        matches = [row for row in components if model_name_matches(item, row[0])]
        if not matches:
            return None
        if mode == "explicit":
            return (
                (explicit_count, 0, 0, 1)
                if any(row[1] >= explicit_count for row in matches)
                else None
            )
        if mode == "single":
            return (
                (1, 0, 0, 1)
                if all(row[1:3] == (1, 1) for row in matches)
                else None
            )
        if len(matches) > 1:
            if any(row[1] != row[2] for row in matches):
                return None
            if len({row[1] for row in matches}) == 1:
                return matches[0][1], 0, 0, 1
            row_totals = {
                position: sum(row[1] for row in components if row[3] == position)
                for position in {row[3] for row in matches}
            }
            divisor = 0
            for row in matches:
                divisor = math.gcd(divisor, row[1])
            if divisor <= 0:
                return None
            increments = {
                row_totals[row[3]] // (row[1] // divisor)
                for row in matches
                if row[1] > 0 and row_totals[row[3]] % (row[1] // divisor) == 0
            }
            if len(increments) == 1 and all(row[1] > 0 for row in matches):
                return 0, 0, divisor, increments.pop()
            return None
        _name, minimum, maximum, _position = matches[0]
        if minimum == maximum:
            return minimum, 0, 0, 1
        variable = [row for row in components if row[1] != row[2]]
        if len(variable) != 1 or variable[0] != matches[0]:
            return None
        fixed_others = sum(row[1] for row in components if row != matches[0])
        return -fixed_others, 1, 0, 1

    if " and " not in value:
        whole = part_count(value)
        if whole is not None:
            return whole
    parts = re.split(r"\s+and\s+", value)
    if len(parts) < 2:
        return None
    inherited = "every" if re.match(r"^(?:every|each)\s+", parts[0]) else "single"
    expressions = [part_count(part, inherited) for part in parts]
    if any(expression is None for expression in expressions):
        return None
    increments = {
        expression[3]
        for expression in expressions
        if expression is not None and expression[2] > 0
    }
    if len(increments) > 1:
        return None
    return (
        sum(expression[0] for expression in expressions if expression is not None),
        sum(expression[1] for expression in expressions if expression is not None),
        sum(expression[2] for expression in expressions if expression is not None),
        next(
            (
                expression[3]
                for expression in expressions
                if expression is not None and expression[2] > 0
            ),
            1,
        ),
    )


def loadout_subjects(loadout_html: str) -> list[tuple[str, str]]:
    value = re.sub(r"<br\s*/?>", "\n", loadout_html, flags=re.IGNORECASE)
    value = html.unescape(re.sub(r"<[^>]+>", "", value))
    clauses = []
    for line in (re.sub(r"\s+", " ", item).strip() for item in value.splitlines()):
        match = re.match(
            r"(.+?)\s+(?:is|are)(?: both)?(?: additionally)? equipped with:\s*(.+)$",
            line,
            re.IGNORECASE,
        )
        if not match:
            continue
        clauses.append((match.group(1).strip(), match.group(2).strip()))
    return clauses


def default_loadout_clauses(
    loadout_html: str,
    components: list[tuple[str, int, int, int]] | None = None,
) -> list[tuple[int, int, int, int, str]]:
    clauses = []
    for subject_text, equipment in loadout_subjects(loadout_html):
        subject = normalized_name(subject_text)
        expression = (
            (1, 0, 0, 1)
            if subject in {"this model", "this unit"}
            else subject_count(subject, components or [])
        )
        if expression is not None:
            clauses.append((*expression, equipment))
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
    connection.execute("DELETE FROM default_loadout_subject_weapons")
    connection.execute("DELETE FROM default_loadout_subjects")
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
    composition = {}
    for row in connection.execute(
        """SELECT datasheet_id, model_name, min_models, max_models,
                  composition_position
           FROM unit_composition_models
           ORDER BY datasheet_id, composition_position, component_position"""
    ):
        composition.setdefault(row[0], []).append((row[1], row[2], row[3], row[4]))

    for datasheet_id, (loadout_html, loadout_text) in loadouts.items():
        known = names_by_unit.get(datasheet_id, {})
        components = composition.get(datasheet_id, [])
        subjects = loadout_subjects(loadout_html)
        for position, (subject_text, equipment) in enumerate(subjects, start=1):
            subject = normalized_name(subject_text)
            expression = (
                (1, 0, 0, 1)
                if subject in {"this model", "this unit"}
                else subject_count(subject, components)
            )
            connection.execute(
                """INSERT INTO default_loadout_subjects
                   (datasheet_id, position, subject_text, equipment_text,
                    fixed_quantity, quantity_per_model, quantity_per_increment,
                    models_per_increment, resolved)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    datasheet_id,
                    position,
                    subject_text,
                    equipment,
                    expression[0] if expression is not None else None,
                    expression[1] if expression is not None else None,
                    expression[2] if expression is not None else None,
                    expression[3] if expression is not None else None,
                    int(expression is not None),
                ),
            )
            weapons = weapon_vector(equipment, known)
            connection.executemany(
                """INSERT INTO default_loadout_subject_weapons
                   (datasheet_id, subject_position, weapon_group_id,
                    weapon_group_name, quantity)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    (datasheet_id, position, weapon_group_id, weapon_name, quantity)
                    for weapon_group_id, (weapon_name, quantity) in weapons.items()
                ),
            )
            if expression is None:
                continue
            for weapon_group_id, (weapon_name, quantity) in weapons.items():
                connection.execute(
                    """INSERT INTO default_weapon_loadout
                       (datasheet_id, subject_position, weapon_group_id,
                        weapon_group_name, quantity, fixed_quantity,
                        quantity_per_model, quantity_per_increment,
                        models_per_increment, description_text)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        datasheet_id,
                        position,
                        weapon_group_id,
                        weapon_name,
                        quantity,
                        *expression,
                        loadout_text,
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
            connection.execute("UPDATE metadata SET value = '8' WHERE key = 'schema_version'")
        print(f"Structured {count} source-backed wargear constraints")
        pools = connection.execute("SELECT count(*) FROM wargear_choice_pools").fetchone()[0]
        print(f"Structured {pools} source-backed wargear choice pools")
        defaults = connection.execute("SELECT count(*) FROM default_weapon_loadout").fetchone()[0]
        print(f"Structured {defaults} source-backed default weapon quantities")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
