#!/usr/bin/env python3
"""Build a calculator-focused Warhammer 40,000 10th edition SQLite database."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import re
import sqlite3
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


BASE_URL = "https://wahapedia.ru/wh40k10ed"
FILES = (
    "Last_update.csv",
    "Factions.csv",
    "Datasheets.csv",
    "Datasheets_models.csv",
    "Datasheets_keywords.csv",
    "Datasheets_wargear.csv",
    "Datasheets_unit_composition.csv",
    "Datasheets_options.csv",
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
CREATE INDEX idx_datasheet_keywords_keyword ON datasheet_keywords(keyword);
CREATE INDEX idx_unit_composition_datasheet ON unit_composition(datasheet_id);
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
"""


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


def composition_range(value: str) -> tuple[int | None, int | None]:
    normalized = plain_text(value).replace("‑", "-").replace("–", "-")
    match = re.match(r"^(\d+)(?:-(\d+))?\s+", normalized)
    if not match:
        return None, None
    minimum = int(match.group(1))
    maximum = int(match.group(2) or match.group(1))
    return minimum, maximum


def download_exports() -> tuple[dict[str, bytes], str, str]:
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    exports = {name: fetch(f"{BASE_URL}/{name}") for name in FILES}
    update_rows = read_rows(exports["Last_update.csv"])
    if not update_rows or not update_rows[0].get("last_update"):
        raise RuntimeError("Wahapedia export did not include a last-update timestamp")
    return exports, update_rows[0]["last_update"].strip(), fetched_at


def create_database(output: Path) -> dict[str, int]:
    exports, source_updated_at, fetched_at = download_exports()
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
                    ("schema_version", "3"),
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
                   (id, faction_id, name, battlefield_role, is_virtual, source_url)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    (
                        row["id"],
                        row["faction_id"],
                        row["name"],
                        row["role"] or None,
                        boolean(row["virtual"]),
                        row["link"],
                    )
                    for row in rows["Datasheets.csv"]
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
                "unit_composition",
                "wargear_options",
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
    args = parser.parse_args()
    counts = create_database(args.output.resolve())
    print(f"Built {args.output.resolve()}")
    for table, count in counts.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()
