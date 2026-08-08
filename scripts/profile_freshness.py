#!/usr/bin/env python3
"""Verify pinned profile inputs or report upstream profile-data changes."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

try:
    from scripts.build_profiles_db import (
        create_database,
        download_exports,
        source_manifest,
        source_manifest_differences,
    )
except ModuleNotFoundError:
    from build_profiles_db import (
        create_database,
        download_exports,
        source_manifest,
        source_manifest_differences,
    )


SNAPSHOT_TABLES = (
    "factions",
    "datasheets",
    "model_profiles",
    "datasheet_keywords",
    "weapon_profiles",
    "weapon_abilities",
    "abilities",
    "datasheet_abilities",
    "unit_leader_eligibility",
    "leader_attachment_conditions",
    "unit_bodyguard_joins",
    "leader_attachment_exceptions",
    "leader_attachment_exception_existing_keywords",
    "bodyguard_leader_rules",
    "bodyguard_leader_rule_minimum_keywords",
    "unit_combat_presets",
    "unit_combat_preset_effects",
    "unit_defensive_equipment_options",
    "unit_defensive_equipment_bearers",
    "unit_defensive_equipment_default_terms",
    "unit_defensive_equipment_effects",
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


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def database_source_manifest(database: Path) -> dict:
    with closing(sqlite3.connect(database)) as connection:
        metadata = dict(connection.execute("SELECT key, value FROM metadata"))
        files = {
            filename: {"sha256": sha256, "rowCount": row_count}
            for filename, sha256, row_count in connection.execute(
                "SELECT filename, sha256, row_count FROM source_files ORDER BY filename"
            )
        }
    return {
        "schemaVersion": 1,
        "source": metadata["source"],
        "baseUrl": metadata["source_base_url"],
        "sourceUpdatedAt": metadata["source_updated_at"],
        "files": files,
    }


def table_snapshot(database: Path, table: str) -> dict:
    with closing(sqlite3.connect(database)) as connection:
        columns = [
            row[1]
            for row in connection.execute(f'PRAGMA table_info("{table}")')
            if row[1] != "id"
        ]
        quoted = ", ".join(f'"{column}"' for column in columns)
        rows = connection.execute(
            f'SELECT {quoted} FROM "{table}" ORDER BY {quoted}'
        ).fetchall()
    encoded = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode()
    return {"rows": len(rows), "sha256": hashlib.sha256(encoded).hexdigest()}


def compare_databases(baseline: Path, candidate: Path) -> dict:
    result = {}
    for table in SNAPSHOT_TABLES:
        before = table_snapshot(baseline, table)
        after = table_snapshot(candidate, table)
        result[table] = {
            "changed": before != after,
            "baselineRows": before["rows"],
            "upstreamRows": after["rows"],
            "baselineSha256": before["sha256"],
            "upstreamSha256": after["sha256"],
        }
    return result


def offline_report(lock: dict, database: Path, catalogue: Path) -> dict:
    database_manifest = database_source_manifest(database)
    catalogue_data = load_json(catalogue)
    differences = source_manifest_differences(lock, database_manifest)
    if catalogue_data.get("sourceUpdatedAt") != lock.get("sourceUpdatedAt"):
        differences.append("profile-data.json:sourceUpdatedAt")
    return {
        "schemaVersion": 1,
        "status": "consistent" if not differences else "inconsistent",
        "differences": differences,
        "pinnedSource": lock,
    }


def upstream_report(lock: dict, database: Path) -> dict:
    bundle = download_exports()
    upstream = source_manifest(bundle[0], bundle[1])
    changed_files = source_manifest_differences(lock, upstream)
    report = {
        "schemaVersion": 1,
        "checkedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "status": "current" if not changed_files else "update_available",
        "changedSourceFields": changed_files,
        "pinnedSource": lock,
        "upstreamSource": upstream,
        "changedTables": [],
        "tables": {},
    }
    if changed_files:
        with tempfile.TemporaryDirectory(prefix="whc-profile-freshness-") as directory:
            candidate = Path(directory) / "candidate.sqlite"
            create_database(candidate, bundle)
            report["tables"] = compare_databases(database, candidate)
            report["changedTables"] = [
                table for table, details in report["tables"].items() if details["changed"]
            ]
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, default=Path("data/profile-source-lock.json"))
    parser.add_argument("--database", type=Path, default=Path("data/warhammer_10e.sqlite"))
    parser.add_argument(
        "--catalogue", type=Path, default=Path("web/public/profile-data.json")
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--fail-on-update", action="store_true")
    args = parser.parse_args()

    lock = load_json(args.lock)
    report = (
        offline_report(lock, args.database, args.catalogue)
        if args.offline
        else upstream_report(lock, args.database)
    )
    encoded = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    failed = report["status"] == "inconsistent" or (
        args.fail_on_update and report["status"] == "update_available"
    )
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
