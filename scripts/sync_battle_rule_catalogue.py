#!/usr/bin/env python3

import argparse
import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COVERAGE_PATH = ROOT / "data" / "battle-rule-coverage.json"
SOURCES_PATH = ROOT / "data" / "battle-rule-sources.json"
PUBLIC_COVERAGE_PATH = ROOT / "web" / "public" / "battle-rule-coverage.json"
PUBLIC_SOURCES_PATH = ROOT / "web" / "public" / "battle-rule-sources.json"
PROFILE_PATH = ROOT / "web" / "public" / "profile-data.json"
PROFILE_LOCK_PATH = ROOT / "data" / "profile-source-lock.json"
SOURCE_ID = "wahapedia-profile-export-2026-06-13"
GENERATED_PREFIXES = ("faction.catalogue-", "datasheet.catalogue-")


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def encode(value):
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def token(value):
    normalized = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return normalized or "unknown"


def generated_rule(category, source_id, name):
    return {
        "id": f"{category}.catalogue-{token(source_id)}",
        "category": category,
        "name": f"{name} {category} rules",
        "status": "guided",
        "introducedBattleStateVersion": 24,
        "sources": [
            {
                "id": SOURCE_ID,
                "records": [{"type": category, "id": source_id}],
            }
        ],
    }


def expected_documents():
    coverage = load_json(COVERAGE_PATH)
    sources = load_json(SOURCES_PATH)
    profiles = load_json(PROFILE_PATH)
    profile_lock = load_json(PROFILE_LOCK_PATH)
    if profiles.get("sourceUpdatedAt") != profile_lock.get("sourceUpdatedAt"):
        raise ValueError("Profile catalogue and source lock have different snapshots")

    factions = sorted(profiles.get("factions", []), key=lambda entry: entry["id"])
    datasheets = sorted(profiles.get("units", []), key=lambda entry: entry["id"])
    for label, entries in (("faction", factions), ("datasheet", datasheets)):
        ids = [entry["id"] for entry in entries]
        if not ids or len(ids) != len(set(ids)):
            raise ValueError(f"Profile catalogue has missing or duplicate {label} ids")
    expected_factions = profile_lock["files"]["Factions.csv"]["rowCount"]
    expected_datasheets = profile_lock["files"]["Datasheets.csv"]["rowCount"]
    if len(factions) != expected_factions or len(datasheets) != expected_datasheets:
        raise ValueError("Profile catalogue counts do not match the pinned source lock")
    faction_ids = {entry["id"] for entry in factions}
    if any(entry.get("factionId") not in faction_ids for entry in datasheets):
        raise ValueError("Profile catalogue contains a datasheet with an unknown faction")

    lock_sha = hashlib.sha256(encode(profile_lock).encode("utf-8")).hexdigest()
    source = {
        "id": SOURCE_ID,
        "title": "Wahapedia structured profile export source lock",
        "edition": "Warhammer 40,000 10th Edition",
        "version": profile_lock["sourceUpdatedAt"],
        "url": profile_lock["baseUrl"],
        "retrievedAt": "2026-08-11",
        "sha256": lock_sha,
        "artifact": "profile-source-lock.json",
        "pages": [],
        "recordTypes": ["faction", "datasheet"],
        "usedFor": [
            "exact faction identities selected by saved lists",
            "exact datasheet identities and source-linked rules selected by saved units",
        ],
    }
    sources["sources"] = [entry for entry in sources["sources"] if entry["id"] != SOURCE_ID]
    sources["sources"].append(source)

    coverage["snapshotId"] = "wh40k-10e-core-2025-10-catalogue-2026-06-13-v24"
    coverage["sourceLocks"] = [
        lock for lock in coverage["sourceLocks"] if lock["id"] != SOURCE_ID
    ]
    coverage["sourceLocks"].append({"id": SOURCE_ID, "sha256": lock_sha})
    coverage["rules"] = [
        rule
        for rule in coverage["rules"]
        if not rule["id"].startswith(GENERATED_PREFIXES)
    ]
    coverage["rules"].extend(
        generated_rule("faction", entry["id"], entry["name"]) for entry in factions
    )
    coverage["rules"].extend(
        generated_rule("datasheet", entry["id"], entry["name"]) for entry in datasheets
    )
    rule_ids = [rule["id"] for rule in coverage["rules"]]
    if len(rule_ids) != len(set(rule_ids)):
        raise ValueError("Generated battle rule ids collide")
    return encode(coverage), encode(sources)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    coverage, sources = expected_documents()
    outputs = {
        COVERAGE_PATH: coverage,
        PUBLIC_COVERAGE_PATH: coverage,
        SOURCES_PATH: sources,
        PUBLIC_SOURCES_PATH: sources,
    }
    if args.check:
        stale = [str(path.relative_to(ROOT)) for path, content in outputs.items() if path.read_text(encoding="utf-8") != content]
        if stale:
            raise SystemExit("Stale generated battle rule catalogue: " + ", ".join(stale))
        return
    for path, content in outputs.items():
        path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
