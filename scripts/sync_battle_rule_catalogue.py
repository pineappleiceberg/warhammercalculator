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
MISSION_PACK_PATH = ROOT / "data" / "chapter-approved-2025-26-v1.4.json"
PUBLIC_MISSION_PACK_PATH = ROOT / "web" / "public" / "chapter-approved-2025-26-v1.4.json"
SOURCE_ID = "wahapedia-profile-export-2026-06-13"
MISSION_SOURCE_ID = "chapter-approved-tournament-companion-2025-26-v1.4"
MISSION_PROCEDURES = {
    "sourcePages": [2, 3, 4, 5],
    "battleRounds": 5,
    "victoryPointCaps": {
        "total": 100,
        "primary": 50,
        "secondary": 40,
        "fixedPerCard": 20,
        "battleReady": 10,
    },
    "secondaryMissions": {
        "fixedCardCount": 2,
        "tacticalMaximumActive": 2,
        "newOrdersCommandPointCost": 1,
        "activeCardsDiscardAfterScoring": True,
        "activePlayerVoluntaryDiscardCommandPointGain": 1,
        "exhaustedDeckCannotGenerate": True,
    },
    "actions": {
        "aircraftCannotStart": True,
        "battleShockedCannotStart": True,
        "zeroObjectiveControlCannotStart": True,
        "engagementRangeBlocksUnlessTitanicCharacter": True,
        "advancedOrFellBackCannotStart": True,
        "mustBeEligibleToShoot": True,
        "alreadyShotCannotStart": True,
        "nonTitanicCannotShootWhilePerforming": True,
        "cannotChargeWhilePerforming": True,
        "movementOrLeavingBattlefieldFails": True,
        "pileInAndConsolidationDoNotFail": True,
    },
    "cardRulesAvailability": "player-supplied-physical-deck",
}
GENERATED_PREFIXES = (
    "faction.catalogue-",
    "detachment.catalogue-",
    "enhancement.catalogue-",
    "datasheet.catalogue-",
    "mission.catalogue-",
    "terrain.catalogue-",
)


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def encode(value):
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def token(value):
    normalized = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return normalized or "unknown"


def generated_rule(category, source_id, name):
    executable_orks = category == "faction" and source_id == "ORK"
    return {
        "id": f"{category}.catalogue-{token(source_id)}",
        "category": category,
        "name": f"{name} {category} rules",
        "status": "executable" if executable_orks else "guided",
        "introducedBattleStateVersion": 40 if executable_orks else 24,
        "sources": [
            {
                "id": SOURCE_ID,
                "records": [{"type": category, "id": source_id}],
            }
        ],
    }


def generated_pdf_rule(category, source_id, name, pages):
    return {
        "id": f"{category}.catalogue-{token(source_id)}",
        "category": category,
        "name": name,
        "status": "guided",
        "introducedBattleStateVersion": 24,
        "sources": [{"id": MISSION_SOURCE_ID, "pages": pages}],
    }


def expected_documents():
    coverage = load_json(COVERAGE_PATH)
    sources = load_json(SOURCES_PATH)
    profiles = load_json(PROFILE_PATH)
    profile_lock = load_json(PROFILE_LOCK_PATH)
    mission_pack = load_json(MISSION_PACK_PATH)
    if profiles.get("sourceUpdatedAt") != profile_lock.get("sourceUpdatedAt"):
        raise ValueError("Profile catalogue and source lock have different snapshots")

    factions = sorted(profiles.get("factions", []), key=lambda entry: entry["id"])
    detachments = sorted(profiles.get("detachments", []), key=lambda entry: entry["id"])
    enhancements = sorted(profiles.get("enhancements", []), key=lambda entry: entry["id"])
    datasheets = sorted(profiles.get("units", []), key=lambda entry: entry["id"])
    for label, entries in (
        ("faction", factions),
        ("detachment", detachments),
        ("enhancement", enhancements),
        ("datasheet", datasheets),
    ):
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
    if any(entry.get("factionId") not in faction_ids for entry in detachments):
        raise ValueError("Rules catalogue contains a detachment with an unknown faction")
    detachment_ids = {entry["id"] for entry in detachments}
    if any(entry.get("detachmentId") not in detachment_ids for entry in enhancements):
        raise ValueError("Rules catalogue contains an enhancement with an unknown detachment")

    if (
        mission_pack.get("schemaVersion") != 2
        or mission_pack.get("edition") != "Warhammer 40,000 10th Edition"
        or mission_pack.get("version") != "1.4"
        or mission_pack.get("source", {}).get("id") != MISSION_SOURCE_ID
    ):
        raise ValueError("Mission pack identity is not the pinned 10th-edition v1.4 source")
    mission_source = mission_pack["source"]
    if not re.fullmatch(r"[0-9a-f]{64}", mission_source.get("sha256", "")):
        raise ValueError("Mission pack source checksum is invalid")
    source_pages = mission_source.get("pages")
    if source_pages != [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]:
        raise ValueError("Mission pack source pages are not the reviewed source boundary")
    if mission_pack.get("procedures") != MISSION_PROCEDURES:
        raise ValueError("Mission procedures do not match the reviewed source lock")
    terrain_layouts = mission_pack.get("terrainLayouts", [])
    missions = mission_pack.get("missions", [])
    if len(terrain_layouts) != 8 or len(missions) != 20:
        raise ValueError("Mission pack must contain 20 missions and 8 terrain layouts")
    terrain_ids = {entry["id"] for entry in terrain_layouts}
    if len(terrain_ids) != len(terrain_layouts):
        raise ValueError("Mission pack terrain ids are duplicated")
    if [entry.get("number") for entry in terrain_layouts] != list(range(1, 9)):
        raise ValueError("Mission pack terrain layouts are not in source order")
    if [entry.get("code") for entry in missions] != [chr(code) for code in range(65, 85)]:
        raise ValueError("Mission pack missions are not the exact A-T source pool")
    if len({entry["id"] for entry in missions}) != len(missions):
        raise ValueError("Mission pack mission ids are duplicated")
    for mission in missions:
        if mission.get("sourcePage") != 6:
            raise ValueError("Mission pack mission locator is invalid")
        compatible = mission.get("terrainLayoutIds", [])
        if not compatible or len(compatible) != len(set(compatible)) or not set(compatible) <= terrain_ids:
            raise ValueError("Mission pack terrain compatibility is invalid")
    for layout in terrain_layouts:
        pages = layout.get("sourcePages", [])
        if not pages or not set(pages) <= set(source_pages):
            raise ValueError("Mission pack terrain page locator is invalid")
        if not any(layout["id"] in mission["terrainLayoutIds"] for mission in missions):
            raise ValueError("Mission pack contains an unused terrain layout")

    lock_sha = hashlib.sha256(encode(profile_lock).encode("utf-8")).hexdigest()
    source = {
        "id": SOURCE_ID,
        "title": "Wahapedia structured profile and army-rules export source lock",
        "edition": "Warhammer 40,000 10th Edition",
        "version": profile_lock["sourceUpdatedAt"],
        "url": profile_lock["baseUrl"],
        "retrievedAt": "2026-08-11",
        "sha256": lock_sha,
        "artifact": "profile-source-lock.json",
        "pages": [],
        "recordTypes": ["faction", "detachment", "enhancement", "datasheet"],
        "usedFor": [
            "exact faction identities selected by saved lists",
            "exact detachment identities and their complete ability and Stratagem sets",
            "exact enhancement identities selected for each detachment",
            "exact datasheet identities and source-linked rules selected by saved units",
            "published per-model Objective Control characteristics used by exact battle formations",
        ],
    }
    sources["sources"] = [entry for entry in sources["sources"] if entry["id"] != SOURCE_ID]
    sources["sources"].append(source)
    mission_source_entry = {
        "id": MISSION_SOURCE_ID,
        "title": mission_source["title"],
        "edition": mission_pack["edition"],
        "version": mission_pack["version"],
        "url": mission_source["url"],
        "retrievedAt": mission_source["retrievedAt"],
        "sha256": mission_source["sha256"],
        "artifact": MISSION_PACK_PATH.name,
        "pages": source_pages,
        "usedFor": [
            "exact Chapter Approved Tournament Mission A-T identities, Primary Mission names, and deployment modes",
            "exact compatibility between each tournament mission and recommended terrain layouts",
            "exact Terrain Layout 1-8 identities and their published measurement maps",
            "exact Fixed and Tactical Secondary Mission lifecycle, New Orders timing and cost, and Victory Point caps",
            "exact universal Action eligibility, continuation, failure, and simultaneous-unit-limit procedures",
            "explicitly unavailable individual mission-card text that remains player supplied from the physical deck",
        ],
    }
    sources["sources"] = [
        entry for entry in sources["sources"] if entry["id"] != MISSION_SOURCE_ID
    ]
    sources["sources"].append(mission_source_entry)

    coverage["snapshotId"] = (
        "wh40k-10e-core-2025-10-army-rules-2026-06-13-chapter-approved-v1-4-v41"
    )
    coverage["sourceLocks"] = [
        lock for lock in coverage["sourceLocks"] if lock["id"] != SOURCE_ID
    ]
    coverage["sourceLocks"].append({"id": SOURCE_ID, "sha256": lock_sha})
    coverage["sourceLocks"] = [
        lock for lock in coverage["sourceLocks"] if lock["id"] != MISSION_SOURCE_ID
    ]
    coverage["sourceLocks"].append(
        {"id": MISSION_SOURCE_ID, "sha256": mission_source["sha256"]}
    )
    coverage["rules"] = [
        rule
        for rule in coverage["rules"]
        if not rule["id"].startswith(GENERATED_PREFIXES)
    ]
    coverage["rules"].extend(
        generated_rule("faction", entry["id"], entry["name"]) for entry in factions
    )
    coverage["rules"].extend(
        generated_rule("detachment", entry["id"], entry["name"]) for entry in detachments
    )
    coverage["rules"].extend(
        generated_rule("enhancement", entry["id"], entry["name"]) for entry in enhancements
    )
    coverage["rules"].extend(
        generated_rule("datasheet", entry["id"], entry["name"]) for entry in datasheets
    )
    coverage["rules"].extend(
        generated_pdf_rule(
            "mission",
            entry["id"],
            f"Mission {entry['code']}: {entry['primaryMission']} ({entry['deployment']})",
            [entry["sourcePage"]],
        )
        for entry in missions
    )
    coverage["rules"].extend(
        generated_pdf_rule(
            "terrain",
            entry["id"],
            entry["name"],
            entry["sourcePages"],
        )
        for entry in terrain_layouts
    )
    rule_ids = [rule["id"] for rule in coverage["rules"]]
    if len(rule_ids) != len(set(rule_ids)):
        raise ValueError("Generated battle rule ids collide")
    return encode(coverage), encode(sources), encode(mission_pack)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    coverage, sources, mission_pack = expected_documents()
    outputs = {
        COVERAGE_PATH: coverage,
        PUBLIC_COVERAGE_PATH: coverage,
        SOURCES_PATH: sources,
        PUBLIC_SOURCES_PATH: sources,
        MISSION_PACK_PATH: mission_pack,
        PUBLIC_MISSION_PACK_PATH: mission_pack,
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
