from __future__ import annotations

import re


EXISTING_LEADER_KEYWORDS = {
    "one or more other cybernetica datasmith models": ["cybernetica datasmith"],
    "one warlocks unit": ["warlocks"],
    "one autarch or farseer model": ["autarch", "farseer"],
    "yvraine": ["yvraine"],
    "one death rider squadron commander lord marshal dreir or lord solar leontus model": [
        "death rider squadron commander",
        "lord marshal dreir",
        "lord solar leontus",
    ],
    "one inquisitor": ["inquisitor"],
    "one inquisitor unit": ["inquisitor"],
    "one canoness palatine junith eruita or aestred thurga model": [
        "canoness",
        "palatine",
        "junith eruita",
        "aestred thurga",
    ],
    "one other character model": ["character"],
    "one other leader unit": [],
    "a primus magus or acolyte iconward model": [
        "primus",
        "magus",
        "acolyte iconward",
    ],
    "nemesor zahndrekh": ["nemesor zahndrekh"],
    "one royal warden or noble model": ["royal warden", "noble"],
    "one captain or chapter master model": ["captain", "chapter master"],
    "one character model": ["character"],
    "one captain chapter master or lieutenant model": [
        "captain",
        "chapter master",
        "lieutenant",
    ],
    "one captain model": ["captain"],
    "one or more character units": ["character"],
    "canis wolfborn": ["canis wolfborn"],
    "one captain chapter master execrator or lieutenant model": [
        "captain",
        "chapter master",
        "execrator",
        "lieutenant",
    ],
    "a marneus calgar unit": ["marneus calgar"],
}


def normalized_phrase(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def classify_leader_footer(source: str) -> dict | None:
    text = re.sub(r"\s+", " ", source).strip()
    if not text:
        return None
    lowered = text.casefold()
    if " can join one " in lowered:
        bodyguards = re.search(
            r"this unit can join one (.+?) unit from your army", text, re.IGNORECASE
        )
        if not bodyguards:
            return {"kind": "unknown", "source": text}
        return {
            "kind": "bodyguard_join",
            "source": text,
            "bodyguardNames": [
                normalized_phrase(name)
                for name in re.split(r"\s+or\s+", bodyguards.group(1))
            ],
            "maximumSameJoiner": 1,
            "requiresUnattached": "if this unit is not an attached unit" in lowered,
            "increasesStartingStrength": "starting strength is increased accordingly"
            in lowered,
        }
    if "cannot be attached to a bladeguard veteran squad" in lowered:
        conditions = re.findall(
            r"cannot be attached to a (.+?) unless this model is equipped with "
            r"(?:a|an) (.+?)(?=,? and cannot|\.)",
            text,
            re.IGNORECASE,
        )
        if not conditions:
            return {"kind": "unknown", "source": text}
        return {
            "kind": "attachment_condition",
            "source": text,
            "conditions": [
                {
                    "bodyguardName": normalized_phrase(bodyguard),
                    "requiredEquipment": normalized_phrase(equipment),
                }
                for bodyguard, equipment in conditions
            ],
        }
    if "bodyguard unit is destroyed" in lowered and "even if" not in lowered:
        return {"kind": "separation_only", "source": text}
    if "even if" not in lowered:
        return {"kind": "unknown", "source": text}
    match = re.search(
        r"even if\s+(.+?)\s+(?:has|have) (?:already )?been attached", text, re.IGNORECASE
    )
    if not match:
        return {"kind": "unknown", "source": text}
    phrase = normalized_phrase(match.group(1))
    if phrase not in EXISTING_LEADER_KEYWORDS:
        return {"kind": "unknown", "source": text, "phrase": phrase}
    return {
        "kind": "attachment_exception",
        "source": text,
        "maximumLeaders": 2,
        "mandatory": lowered.startswith("you must attach"),
        "anyExistingLeader": phrase == "one other leader unit",
        "existingLeaderKeywords": EXISTING_LEADER_KEYWORDS[phrase],
        "forbidSameDatasheet": (
            "cannot have two " in lowered
            or "cannot attach more than one of the same leader" in lowered
        ),
        "forbiddenCompanionKeyword": (
            "pack leader" if "never include more than one pack leader" in lowered else None
        ),
    }


def parse_bodyguard_leader_rule(source: str) -> dict | None:
    text = re.sub(r"\s+", " ", source).strip()
    lowered = text.casefold()
    if "attach up to two leader units to it instead of one" in lowered:
        starting_strength = re.search(r"starting strength of (\d+)", lowered)
        required_keyword = None
        required = re.search(r"only if one of those is a ([a-z ]+) unit", lowered)
        if required:
            required_keyword = normalized_phrase(required.group(1))
        return {
            "source": text,
            "minimumLeaders": 0,
            "minimumLeaderKeywords": [],
            "maximumLeaders": 2,
            "maximumRequiredStartingStrength": (
                int(starting_strength.group(1)) if starting_strength else None
            ),
            "maximumRequiredLeaderKeyword": required_keyword,
            "leadersMustBeDistinct": "leaders are not duplicates" in lowered,
        }
    required = re.search(r"you must attach one (.+?) model to this unit", text, re.IGNORECASE)
    if required:
        phrase = normalized_phrase(required.group(1))
        keywords = {
            "captain or chapter master": ["captain", "chapter master"],
        }.get(phrase)
        if keywords is None:
            return {"kind": "unknown", "source": text, "phrase": phrase}
        return {
            "source": text,
            "minimumLeaders": 1,
            "minimumLeaderKeywords": keywords,
            "maximumLeaders": None,
            "maximumRequiredStartingStrength": None,
            "maximumRequiredLeaderKeyword": None,
            "leadersMustBeDistinct": False,
        }
    return None
