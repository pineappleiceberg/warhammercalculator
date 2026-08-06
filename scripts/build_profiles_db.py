#!/usr/bin/env python3
"""Build a calculator-focused Warhammer 40,000 10th edition SQLite database."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import re
import sqlite3
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from scripts.wargear_constraints import CONSTRAINT_SCHEMA, populate_constraints
except ModuleNotFoundError:
    from wargear_constraints import CONSTRAINT_SCHEMA, populate_constraints


BASE_URL = "https://wahapedia.ru/wh40k10ed"
FILES = (
    "Abilities.csv",
    "Last_update.csv",
    "Factions.csv",
    "Datasheets.csv",
    "Datasheets_models.csv",
    "Datasheets_keywords.csv",
    "Datasheets_wargear.csv",
    "Datasheets_unit_composition.csv",
    "Datasheets_options.csv",
    "Datasheets_abilities.csv",
)

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE source_files (
    filename TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    source_updated_at TEXT NOT NULL,
    row_count INTEGER NOT NULL CHECK (row_count >= 0)
) WITHOUT ROWID;

CREATE TABLE factions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_url TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE datasheets (
    id TEXT PRIMARY KEY,
    faction_id TEXT NOT NULL REFERENCES factions(id),
    name TEXT NOT NULL,
    battlefield_role TEXT,
    loadout_html TEXT NOT NULL DEFAULT '',
    loadout_text TEXT NOT NULL DEFAULT '',
    is_virtual INTEGER NOT NULL DEFAULT 0 CHECK (is_virtual IN (0, 1)),
    source_url TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE model_profiles (
    id INTEGER PRIMARY KEY,
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    source_line INTEGER NOT NULL,
    name TEXT NOT NULL,
    movement TEXT,
    movement_inches REAL,
    toughness INTEGER,
    save_target INTEGER,
    invulnerable_save_target INTEGER,
    invulnerable_save_note TEXT,
    wounds INTEGER,
    leadership_target INTEGER,
    objective_control INTEGER,
    base_size TEXT,
    base_size_note TEXT,
    UNIQUE (datasheet_id, source_line)
);

CREATE TABLE weapon_profiles (
    id INTEGER PRIMARY KEY,
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    source_line INTEGER,
    profile_line INTEGER,
    name TEXT NOT NULL,
    weapon_type TEXT NOT NULL CHECK (weapon_type IN ('Ranged', 'Melee')),
    range_text TEXT NOT NULL,
    range_inches INTEGER,
    attacks TEXT NOT NULL,
    skill_target INTEGER,
    strength TEXT NOT NULL,
    strength_value INTEGER,
    armour_penetration INTEGER,
    damage TEXT NOT NULL,
    abilities_text TEXT NOT NULL DEFAULT ''
);

CREATE TABLE datasheet_keywords (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    model TEXT,
    is_faction_keyword INTEGER NOT NULL CHECK (is_faction_keyword IN (0, 1)),
    PRIMARY KEY (datasheet_id, position)
) WITHOUT ROWID;

CREATE TABLE weapon_abilities (
    weapon_profile_id INTEGER NOT NULL REFERENCES weapon_profiles(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    value TEXT,
    raw_text TEXT NOT NULL,
    PRIMARY KEY (weapon_profile_id, position)
) WITHOUT ROWID;

CREATE TABLE abilities (
    id TEXT NOT NULL,
    faction_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    legend_text TEXT NOT NULL DEFAULT '',
    description_text TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (id, faction_id)
) WITHOUT ROWID;

CREATE TABLE datasheet_abilities (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    source_line INTEGER,
    ability_id TEXT,
    model TEXT,
    name TEXT NOT NULL,
    description_text TEXT NOT NULL,
    ability_type TEXT NOT NULL,
    parameter TEXT,
    PRIMARY KEY (datasheet_id, position)
) WITHOUT ROWID;

CREATE TABLE unit_combat_presets (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    ability_position INTEGER NOT NULL,
    name TEXT NOT NULL,
    description_text TEXT NOT NULL,
    weapon_scope TEXT NOT NULL CHECK (weapon_scope IN ('Any', 'Ranged', 'Melee')),
    hit_modifier INTEGER NOT NULL CHECK (hit_modifier BETWEEN -1 AND 1),
    wound_modifier INTEGER NOT NULL CHECK (wound_modifier BETWEEN -1 AND 1),
    reroll_hits INTEGER NOT NULL CHECK (reroll_hits IN (0, 1)),
    reroll_hit_ones INTEGER NOT NULL CHECK (reroll_hit_ones IN (0, 1)),
    reroll_wounds INTEGER NOT NULL CHECK (reroll_wounds IN (0, 1)),
    reroll_wound_ones INTEGER NOT NULL CHECK (reroll_wound_ones IN (0, 1)),
    PRIMARY KEY (datasheet_id, ability_position),
    FOREIGN KEY (datasheet_id, ability_position)
        REFERENCES datasheet_abilities(datasheet_id, position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE unit_composition (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    source_line INTEGER,
    description_html TEXT NOT NULL,
    description_text TEXT NOT NULL,
    min_models INTEGER,
    max_models INTEGER,
    PRIMARY KEY (datasheet_id, position)
) WITHOUT ROWID;

CREATE TABLE unit_composition_models (
    datasheet_id TEXT NOT NULL,
    composition_position INTEGER NOT NULL,
    component_position INTEGER NOT NULL,
    model_name TEXT NOT NULL,
    min_models INTEGER NOT NULL CHECK (min_models >= 0),
    max_models INTEGER NOT NULL CHECK (max_models >= min_models),
    description_text TEXT NOT NULL,
    PRIMARY KEY (datasheet_id, composition_position, component_position),
    FOREIGN KEY (datasheet_id, composition_position)
        REFERENCES unit_composition(datasheet_id, position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE wargear_options (
    datasheet_id TEXT NOT NULL REFERENCES datasheets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    source_line INTEGER,
    button TEXT,
    description_html TEXT NOT NULL,
    description_text TEXT NOT NULL,
    PRIMARY KEY (datasheet_id, position)
) WITHOUT ROWID;

CREATE INDEX idx_datasheets_faction_name ON datasheets(faction_id, name);
CREATE INDEX idx_models_datasheet_name ON model_profiles(datasheet_id, name);
CREATE INDEX idx_weapons_datasheet_name ON weapon_profiles(datasheet_id, name);
CREATE INDEX idx_weapons_type ON weapon_profiles(weapon_type);
CREATE INDEX idx_weapon_abilities_name ON weapon_abilities(name);
CREATE INDEX idx_datasheet_abilities_name ON datasheet_abilities(name);
CREATE INDEX idx_unit_combat_presets_datasheet ON unit_combat_presets(datasheet_id);
CREATE INDEX idx_datasheet_keywords_keyword ON datasheet_keywords(keyword);
CREATE INDEX idx_unit_composition_datasheet ON unit_composition(datasheet_id);
CREATE INDEX idx_unit_composition_models_datasheet
    ON unit_composition_models(datasheet_id, model_name);
CREATE INDEX idx_wargear_options_datasheet ON wargear_options(datasheet_id);

CREATE VIEW attacker_profiles AS
SELECT
    m.id AS model_profile_id,
    f.id AS faction_id,
    f.name AS faction_name,
    d.id AS datasheet_id,
    d.name AS datasheet_name,
    m.name AS model_name,
    d.source_url
FROM model_profiles AS m
JOIN datasheets AS d ON d.id = m.datasheet_id
JOIN factions AS f ON f.id = d.faction_id;

CREATE VIEW attacker_weapon_profiles AS
SELECT
    f.id AS faction_id,
    f.name AS faction_name,
    d.id AS datasheet_id,
    d.name AS datasheet_name,
    w.id AS weapon_profile_id,
    w.name AS weapon_name,
    w.weapon_type,
    w.range_text,
    w.range_inches,
    w.attacks,
    w.skill_target,
    w.strength,
    w.strength_value,
    w.armour_penetration,
    w.damage,
    w.abilities_text,
    d.source_url
FROM weapon_profiles AS w
JOIN datasheets AS d ON d.id = w.datasheet_id
JOIN factions AS f ON f.id = d.faction_id;

CREATE VIEW target_profiles AS
SELECT
    m.id AS target_profile_id,
    f.id AS faction_id,
    f.name AS faction_name,
    d.id AS datasheet_id,
    d.name AS datasheet_name,
    m.name AS model_name,
    m.movement,
    m.toughness,
    m.save_target,
    m.invulnerable_save_target,
    m.wounds,
    m.leadership_target,
    m.objective_control,
    d.source_url
FROM model_profiles AS m
JOIN datasheets AS d ON d.id = m.datasheet_id
JOIN factions AS f ON f.id = d.faction_id;
""" + CONSTRAINT_SCHEMA


def fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "warhammercalculator-profile-importer/1.0"},
    )
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read()
        except Exception as error:  # urllib exposes several transport exceptions
            last_error = error
            if attempt < 2:
                time.sleep(1 + attempt)
    raise RuntimeError(f"could not download {url}: {last_error}")


def read_rows(data: bytes) -> list[dict[str, str]]:
    text = data.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text), delimiter="|"))


def integer(text: str | None) -> int | None:
    if text is None:
        return None
    match = re.fullmatch(r"\s*(-?\d+)\+?\s*", text)
    return int(match.group(1)) if match else None


def decimal_inches(text: str | None) -> float | None:
    if text is None:
        return None
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)"?\s*', text)
    return float(match.group(1)) if match else None


def boolean(text: str | None) -> int:
    return int((text or "").strip().lower() in {"1", "true", "yes"})


def parse_ability(raw: str) -> tuple[str, str | None]:
    token = raw.strip()
    anti = re.fullmatch(r"(anti-[a-z0-9 -]+?)\s+(\d+\+)", token, re.IGNORECASE)
    if anti:
        return anti.group(1).lower(), anti.group(2)
    valued = re.fullmatch(
        r"(rapid fire|melta|sustained hits)\s+(.+)", token, re.IGNORECASE
    )
    if valued:
        return valued.group(1).lower(), valued.group(2).strip()
    return token.lower(), None


def plain_text(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def combat_preset(description: str) -> dict[str, int | str] | None:
    text = plain_text(description)
    lowered = text.casefold()
    effects: dict[str, int | str] = {
        "hit_modifier": 0,
        "wound_modifier": 0,
        "reroll_hits": 0,
        "reroll_hit_ones": 0,
        "reroll_wounds": 0,
        "reroll_wound_ones": 0,
    }
    for roll, field in (("hit", "hit_modifier"), ("wound", "wound_modifier")):
        modifier = re.search(
            rf"\b(add|subtract) 1 (?:to|from) the {roll} roll\b", lowered
        )
        if modifier:
            effects[field] = 1 if modifier.group(1) == "add" else -1
        rerolls = list(
            re.finditer(
                rf"\bre-roll (?:a|the) {roll} roll(?: of 1)?\b", lowered
            )
        )
        if rerolls:
            first = rerolls[0].group(0)
            effects[f"reroll_{roll}_ones"] = int(first.endswith("of 1"))
            effects[f"reroll_{roll}s"] = int(not first.endswith("of 1"))
    if not any(value for key, value in effects.items() if key != "weapon_scope"):
        return None
    has_melee = "melee attack" in lowered
    has_ranged = "ranged attack" in lowered
    effects["weapon_scope"] = (
        "Melee" if has_melee and not has_ranged else "Ranged" if has_ranged and not has_melee else "Any"
    )
    return effects


def composition_components(value: str) -> list[tuple[str, int, int]]:
    normalized = plain_text(value).replace("‑", "-").replace("–", "-")
    if re.search(r"\bor\b", normalized, re.IGNORECASE):
        return []
    pattern = re.compile(
        r"(?:^|,\s*|\s+and\s+)(\d+)(?:-(\d+))?\s+(.+?)"
        r"(?=(?:,\s*|\s+and\s+)\d+(?:-\d+)?\s+|$)",
        re.IGNORECASE,
    )
    components = []
    for match in pattern.finditer(normalized):
        name = re.sub(r"(?:\s+-\s+.*|[.*]+)$", "", match.group(3)).strip()
        if not name:
            return []
        minimum = int(match.group(1))
        maximum = int(match.group(2) or match.group(1))
        components.append((name, minimum, maximum))
    return components


def composition_range(value: str) -> tuple[int | None, int | None]:
    components = composition_components(value)
    if not components:
        return None, None
    return sum(row[1] for row in components), sum(row[2] for row in components)


def download_exports() -> tuple[dict[str, bytes], str, str]:
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    exports = {name: fetch(f"{BASE_URL}/{name}") for name in FILES}
    update_rows = read_rows(exports["Last_update.csv"])
    if not update_rows or not update_rows[0].get("last_update"):
        raise RuntimeError("Wahapedia export did not include a last-update timestamp")
    return exports, update_rows[0]["last_update"].strip(), fetched_at


def source_manifest(exports: dict[str, bytes], source_updated_at: str) -> dict:
    return {
        "schemaVersion": 1,
        "source": "Wahapedia structured CSV export",
        "baseUrl": BASE_URL,
        "sourceUpdatedAt": source_updated_at,
        "files": {
            name: {
                "sha256": hashlib.sha256(exports[name]).hexdigest(),
                "rowCount": len(read_rows(exports[name])),
            }
            for name in FILES
        },
    }


def source_manifest_differences(expected: dict, actual: dict) -> list[str]:
    differences = []
    for field in ("schemaVersion", "source", "baseUrl", "sourceUpdatedAt"):
        if expected.get(field) != actual.get(field):
            differences.append(field)
    expected_files = expected.get("files", {})
    actual_files = actual.get("files", {})
    for name in sorted(set(expected_files) | set(actual_files)):
        if expected_files.get(name) != actual_files.get(name):
            differences.append(name)
    return differences


def write_source_lock(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def create_database(
    output: Path,
    export_bundle: tuple[dict[str, bytes], str, str] | None = None,
) -> dict[str, int]:
    exports, source_updated_at, fetched_at = export_bundle or download_exports()
    rows = {name: read_rows(data) for name, data in exports.items()}
    datasheet_ids = {row["id"] for row in rows["Datasheets.csv"]}
    model_rows = [
        row
        for row in rows["Datasheets_models.csv"]
        if row["datasheet_id"] in datasheet_ids
    ]
    linked_weapon_rows = [
        row
        for row in rows["Datasheets_wargear.csv"]
        if row["datasheet_id"] in datasheet_ids
    ]
    weapon_rows = [
        row
        for row in linked_weapon_rows
        if row["type"].strip().title() in {"Ranged", "Melee"} and row["name"].strip()
    ]
    composition_rows = [
        row
        for row in rows["Datasheets_unit_composition.csv"]
        if row["datasheet_id"] in datasheet_ids
    ]
    option_rows = [
        row
        for row in rows["Datasheets_options.csv"]
        if row["datasheet_id"] in datasheet_ids
    ]
    ability_rows = [
        row
        for row in rows["Datasheets_abilities.csv"]
        if row["datasheet_id"] in datasheet_ids
    ]
    orphan_model_count = len(rows["Datasheets_models.csv"]) - len(model_rows)
    orphan_weapon_count = len(rows["Datasheets_wargear.csv"]) - len(linked_weapon_rows)
    placeholder_weapon_count = len(linked_weapon_rows) - len(weapon_rows)
    orphan_composition_count = (
        len(rows["Datasheets_unit_composition.csv"]) - len(composition_rows)
    )
    orphan_option_count = len(rows["Datasheets_options.csv"]) - len(option_rows)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.unlink(missing_ok=True)

    connection = sqlite3.connect(temporary)
    try:
        connection.executescript(SCHEMA)
        with connection:
            connection.executemany(
                "INSERT INTO metadata(key, value) VALUES (?, ?)",
                (
                    ("edition", "10"),
                    ("game", "Warhammer 40,000"),
                    ("source", "Wahapedia structured CSV export"),
                    ("source_base_url", BASE_URL),
                    ("source_updated_at", source_updated_at),
                    ("generated_at", fetched_at),
                    ("schema_version", "9"),
                    ("skipped_orphan_model_rows", str(orphan_model_count)),
                    ("skipped_orphan_weapon_rows", str(orphan_weapon_count)),
                    ("skipped_placeholder_weapon_rows", str(placeholder_weapon_count)),
                    ("skipped_orphan_composition_rows", str(orphan_composition_count)),
                    ("skipped_orphan_option_rows", str(orphan_option_count)),
                ),
            )
            connection.executemany(
                """INSERT INTO source_files
                   (filename, source_url, sha256, fetched_at, source_updated_at, row_count)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    (
                        name,
                        f"{BASE_URL}/{name}",
                        hashlib.sha256(exports[name]).hexdigest(),
                        fetched_at,
                        source_updated_at,
                        len(rows[name]),
                    )
                    for name in FILES
                ),
            )
            connection.executemany(
                "INSERT INTO factions(id, name, source_url) VALUES (?, ?, ?)",
                ((row["id"], row["name"], row["link"]) for row in rows["Factions.csv"]),
            )
            connection.executemany(
                """INSERT INTO datasheets
                   (id, faction_id, name, battlefield_role, loadout_html,
                    loadout_text, is_virtual, source_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    (
                        row["id"],
                        row["faction_id"],
                        row["name"],
                        row["role"] or None,
                        row["loadout"],
                        plain_text(row["loadout"]),
                        boolean(row["virtual"]),
                        row["link"],
                    )
                    for row in rows["Datasheets.csv"]
                ),
            )
            connection.executemany(
                """INSERT OR REPLACE INTO abilities
                   (id, faction_id, name, legend_text, description_text)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    (
                        row["id"],
                        row["faction_id"].strip(),
                        row["name"].strip(),
                        plain_text(row["legend"]),
                        plain_text(row["description"]),
                    )
                    for row in rows["Abilities.csv"]
                    if row["id"].strip() and row["name"].strip()
                ),
            )
            definitions: dict[str, list[dict[str, str]]] = {}
            for row in rows["Abilities.csv"]:
                definitions.setdefault(row["id"], []).append(row)
            datasheet_factions = {
                row["id"]: row["faction_id"] for row in rows["Datasheets.csv"]
            }
            ability_positions: dict[str, int] = {}
            for row in ability_rows:
                datasheet_id = row["datasheet_id"]
                position = ability_positions.get(datasheet_id, 0) + 1
                ability_positions[datasheet_id] = position
                name = row["name"].strip()
                description = plain_text(row["description"])
                if row["ability_id"].strip() and (not name or not description):
                    candidates = definitions.get(row["ability_id"], [])
                    faction_id = datasheet_factions[datasheet_id]
                    resolved = next(
                        (item for item in candidates if item["faction_id"] == faction_id),
                        next(
                            (item for item in candidates if not item["faction_id"]),
                            candidates[0] if candidates else None,
                        ),
                    )
                    if resolved:
                        name = name or resolved["name"].strip()
                        description = description or plain_text(resolved["description"])
                name = name or row["type"].strip() or row["ability_id"].strip()
                connection.execute(
                    """INSERT INTO datasheet_abilities
                       (datasheet_id, position, source_line, ability_id, model, name,
                        description_text, ability_type, parameter)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        datasheet_id,
                        position,
                        integer(row["line"]),
                        row["ability_id"].strip() or None,
                        row["model"].strip() or None,
                        name,
                        description,
                        row["type"].strip(),
                        row["parameter"].strip() or None,
                    ),
                )
                preset = combat_preset(description)
                if preset:
                    connection.execute(
                        """INSERT INTO unit_combat_presets
                           (datasheet_id, ability_position, name, description_text,
                            weapon_scope, hit_modifier, wound_modifier, reroll_hits,
                            reroll_hit_ones, reroll_wounds, reroll_wound_ones)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            datasheet_id,
                            position,
                            name,
                            description,
                            preset["weapon_scope"],
                            preset["hit_modifier"],
                            preset["wound_modifier"],
                            preset["reroll_hits"],
                            preset["reroll_hit_ones"],
                            preset["reroll_wounds"],
                            preset["reroll_wound_ones"],
                        ),
                    )
            connection.executemany(
                """INSERT INTO model_profiles
                   (datasheet_id, source_line, name, movement, movement_inches,
                    toughness, save_target, invulnerable_save_target,
                    invulnerable_save_note, wounds, leadership_target,
                    objective_control, base_size, base_size_note)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    (
                        row["datasheet_id"],
                        integer(row["line"]),
                        row["name"],
                        row["M"] or None,
                        decimal_inches(row["M"]),
                        integer(row["T"]),
                        integer(row["Sv"]),
                        integer(row["inv_sv"]),
                        row["inv_sv_descr"] or None,
                        integer(row["W"]),
                        integer(row["Ld"]),
                        integer(row["OC"]),
                        row["base_size"] or None,
                        row["base_size_descr"] or None,
                    )
                    for row in model_rows
                ),
            )
            keyword_positions: dict[str, int] = {}
            for row in rows["Datasheets_keywords.csv"]:
                datasheet_id = row["datasheet_id"]
                if datasheet_id not in datasheet_ids or not row["keyword"].strip():
                    continue
                position = keyword_positions.get(datasheet_id, 0) + 1
                keyword_positions[datasheet_id] = position
                connection.execute(
                    """INSERT INTO datasheet_keywords
                       (datasheet_id, position, keyword, model, is_faction_keyword)
                       VALUES (?, ?, ?, ?, ?)""",
                    (
                        datasheet_id,
                        position,
                        row["keyword"].strip().lower(),
                        row["model"].strip() or None,
                        boolean(row["is_faction_keyword"]),
                    ),
                )
            composition_positions: dict[str, int] = {}
            for row in composition_rows:
                datasheet_id = row["datasheet_id"]
                position = composition_positions.get(datasheet_id, 0) + 1
                composition_positions[datasheet_id] = position
                minimum, maximum = composition_range(row["description"])
                connection.execute(
                    """INSERT INTO unit_composition
                       (datasheet_id, position, source_line, description_html,
                        description_text, min_models, max_models)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        datasheet_id,
                        position,
                        integer(row["line"]),
                        row["description"],
                        plain_text(row["description"]),
                        minimum,
                        maximum,
                    ),
                )
                for component_position, (name, component_min, component_max) in enumerate(
                    composition_components(row["description"]), start=1
                ):
                    connection.execute(
                        """INSERT INTO unit_composition_models
                           (datasheet_id, composition_position, component_position,
                            model_name, min_models, max_models, description_text)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (
                            datasheet_id,
                            position,
                            component_position,
                            name,
                            component_min,
                            component_max,
                            plain_text(row["description"]),
                        ),
                    )

            option_positions: dict[str, int] = {}
            for row in option_rows:
                datasheet_id = row["datasheet_id"]
                position = option_positions.get(datasheet_id, 0) + 1
                option_positions[datasheet_id] = position
                connection.execute(
                    """INSERT INTO wargear_options
                       (datasheet_id, position, source_line, button, description_html,
                        description_text)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (
                        datasheet_id,
                        position,
                        integer(row["line"]),
                        row["button"].strip() or None,
                        row["description"],
                        plain_text(row["description"]),
                    ),
                )

            for row in weapon_rows:
                weapon_type = row["type"].strip().title()
                if weapon_type not in {"Ranged", "Melee"}:
                    raise RuntimeError(f"unknown weapon type: {row['type']!r}")
                cursor = connection.execute(
                    """INSERT INTO weapon_profiles
                       (datasheet_id, source_line, profile_line, name, weapon_type,
                        range_text, range_inches, attacks, skill_target, strength,
                        strength_value, armour_penetration, damage, abilities_text)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        row["datasheet_id"],
                        integer(row["line"]),
                        integer(row["line_in_wargear"]),
                        row["name"],
                        weapon_type,
                        row["range"],
                        integer(row["range"]),
                        row["A"],
                        integer(row["BS_WS"]),
                        row["S"],
                        integer(row["S"]),
                        integer(row["AP"]),
                        row["D"],
                        row["description"].strip(),
                    ),
                )
                weapon_id = cursor.lastrowid
                abilities = [
                    token.strip()
                    for token in row["description"].split(",")
                    if token.strip()
                ]
                for position, raw in enumerate(abilities, start=1):
                    name, value = parse_ability(raw)
                    connection.execute(
                        """INSERT INTO weapon_abilities
                           (weapon_profile_id, position, name, value, raw_text)
                           VALUES (?, ?, ?, ?, ?)""",
                        (weapon_id, position, name, value, raw),
                    )

            populate_constraints(connection)

        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")
        counts = {
            table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in (
                "factions",
                "datasheets",
                "model_profiles",
                "datasheet_keywords",
                "weapon_profiles",
                "weapon_abilities",
                "abilities",
                "datasheet_abilities",
                "unit_combat_presets",
                "unit_composition",
                "unit_composition_models",
                "wargear_options",
                "wargear_constraints",
                "wargear_constraint_weapons",
                "wargear_choice_pools",
                "wargear_choice_alternatives",
                "wargear_choice_alternative_weapons",
                "wargear_choice_replaced_weapons",
                "default_weapon_loadout",
                "default_loadout_subjects",
                "default_loadout_subject_weapons",
            )
        }
        connection.execute("PRAGMA optimize")
        connection.close()
        output.unlink(missing_ok=True)
        temporary.replace(output)
        return counts
    except Exception:
        connection.close()
        temporary.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/warhammer_10e.sqlite"),
        help="SQLite output path (default: data/warhammer_10e.sqlite)",
    )
    parser.add_argument(
        "--source-lock",
        type=Path,
        default=Path("data/profile-source-lock.json"),
        help="pinned source manifest (default: data/profile-source-lock.json)",
    )
    parser.add_argument(
        "--update-source-lock",
        action="store_true",
        help="accept the downloaded source identities after a successful build",
    )
    args = parser.parse_args()
    bundle = download_exports()
    manifest = source_manifest(bundle[0], bundle[1])
    source_lock = args.source_lock.resolve()
    if not args.update_source_lock:
        if not source_lock.exists():
            raise RuntimeError(
                f"source lock is missing: {source_lock}; review the source and rerun with "
                "--update-source-lock"
            )
        expected = json.loads(source_lock.read_text(encoding="utf-8"))
        differences = source_manifest_differences(expected, manifest)
        if differences:
            raise RuntimeError(
                "downloaded profile source differs from the pinned manifest: "
                + ", ".join(differences)
                + "; run scripts/profile_freshness.py for a change report"
            )
    counts = create_database(args.output.resolve(), bundle)
    if args.update_source_lock:
        write_source_lock(source_lock, manifest)
    print(f"Built {args.output.resolve()}")
    for table, count in counts.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()
