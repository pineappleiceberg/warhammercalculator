from __future__ import annotations

import re
import unicodedata


def normalized_term(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).replace("’", "'").replace("‑", "-")
    value = re.sub(r"\s+", " ", value).strip(" .,;:-").casefold()
    return value


def split_list(value: str) -> list[str]:
    value = re.sub(r"\b(?:and|or)\b", ",", value, flags=re.IGNORECASE)
    return [part.strip() for part in value.split(",") if part.strip()]


def keyword_partition(value: str, vocabulary: set[str]) -> tuple[str, ...] | None:
    value = normalized_term(value)
    if value in vocabulary:
        return (value,)
    value = re.sub(r"^(?:the|a|an)\s+", "", value)
    value = re.sub(r"\bmodels?\b", "", value)
    value = re.sub(r"\bunits?\b", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return ()
    aliases = {
        "flawless blade": "flawless blades",
        "grotesque": "grotesques",
        "hernkyn yaegir": "hernkyn yaegirs",
        "inquisitorial agent": "inquisitorial agents",
        "necron warrior": "necron warriors",
        "obliterator": "obliterators",
        "possessed": "possessed",
        "veteran heavy weapons team": "veteran heavy weapons team",
    }
    if value in aliases and (
        aliases[value] in vocabulary or value == "veteran heavy weapons team"
    ):
        return (aliases[value],)
    words = value.split()
    memo: dict[int, tuple[str, ...] | None] = {}

    def partition(position: int) -> tuple[str, ...] | None:
        if position == len(words):
            return ()
        if position in memo:
            return memo[position]
        for end in range(len(words), position, -1):
            candidate = " ".join(words[position:end])
            if candidate not in vocabulary:
                continue
            suffix = partition(end)
            if suffix is not None:
                memo[position] = (candidate, *suffix)
                return memo[position]
        memo[position] = None
        return None

    return partition(0)


def groups_from_phrase(
    value: str, vocabulary: set[str]
) -> list[tuple[str, ...]] | None:
    value = value.strip()
    if not value:
        return []
    if "models from the following units:" in value.casefold():
        value = value.split(":", 1)[1]
        parts = split_list(value)
    elif re.search(r"\b(?:and|or)\b|,", value, re.IGNORECASE):
        parts = split_list(value)
    else:
        parts = [value]
    groups = []
    for part in parts:
        resolved = keyword_partition(part, vocabulary)
        if resolved is None:
            return None
        groups.append(resolved)
    return groups


def parse_transport_rule(source: str, vocabulary: set[str]) -> dict:
    source = re.sub(r"\s+", " ", source).strip()
    result = {
        "capacity": None,
        "allowed": [],
        "excluded": [],
        "costs": [],
        "additionalPools": [],
        "capacityModifiers": [],
        "exact": True,
    }
    match = re.match(
        r"This (?:model|FORTIFICATION) has a transport capacity of (\d+) (.+?)(?:\.|$)",
        source,
        re.IGNORECASE,
    )
    if not match:
        result["exact"] = False
        return result
    result["capacity"] = int(match.group(1))
    allowed_text = match.group(2).strip()
    additional_pool = re.fullmatch(
        r"(.+?) models? and (\d+) (.+?) models?", allowed_text, re.IGNORECASE
    )
    if additional_pool:
        allowed_text = additional_pool.group(1).strip()
        additional_allowed = groups_from_phrase(additional_pool.group(3), vocabulary)
        if additional_allowed is None:
            result["exact"] = False
        else:
            result["additionalPools"].append(
                {
                    "capacity": int(additional_pool.group(2)),
                    "allowed": [list(group) for group in additional_allowed],
                }
            )
    parenthetical = re.search(r"\(excluding (.+?)\)", allowed_text, re.IGNORECASE)
    if parenthetical:
        excluded = groups_from_phrase(parenthetical.group(1), vocabulary)
        if excluded is None:
            result["exact"] = False
        else:
            result["excluded"].extend(
                {"keywords": list(group), "minimumWounds": None, "nonCharacter": False}
                for group in excluded
            )
        allowed_text = (
            allowed_text[: parenthetical.start()] + allowed_text[parenthetical.end() :]
        ).strip()
    if normalized_term(allowed_text) not in {"model", "models"}:
        allowed = groups_from_phrase(allowed_text, vocabulary)
        if allowed is None:
            result["exact"] = False
        else:
            result["allowed"] = [list(group) for group in allowed]

    only_match = re.search(
        r"It can only transport (.+?) models?\.", source, re.IGNORECASE
    )
    if only_match:
        only = groups_from_phrase(only_match.group(1), vocabulary)
        if only is None:
            result["exact"] = False
        else:
            result["allowed"] = [list(group) for group in only]

    for exclusion in re.finditer(
        r"(?:It|This model) cannot transport (.+?)(?:\.|$)", source, re.IGNORECASE
    ):
        phrase = exclusion.group(1).strip()
        wounds = re.fullmatch(
            r"non-?\s*CHARACTER models with a Wounds characteristic of (\d+) or more",
            phrase,
            re.IGNORECASE,
        )
        if wounds:
            result["excluded"].append(
                {
                    "keywords": [],
                    "minimumWounds": int(wounds.group(1)),
                    "nonCharacter": True,
                }
            )
            continue
        if normalized_term(phrase) == "models that can fly":
            result["excluded"].append(
                {"keywords": ["fly"], "minimumWounds": None, "nonCharacter": False}
            )
            continue
        attachment_exception = None
        exception = re.search(
            r"\((?:excluding|except for)\s+TACTICUS CHARACTER models that "
            r"(?:began|begin) the battle attached to a non-\s*TACTICUS unit\)",
            phrase,
            re.IGNORECASE,
        )
        if exception:
            phrase = (phrase[: exception.start()] + phrase[exception.end() :]).strip()
            attachment_exception = {
                "requiredPassengerKeyword": "character",
                "forbiddenAttachedKeyword": "tacticus",
            }
        groups = groups_from_phrase(phrase, vocabulary)
        if groups is None:
            result["exact"] = False
        else:
            for group in groups:
                result["excluded"].append(
                    {
                        "keywords": list(group),
                        "minimumWounds": None,
                        "nonCharacter": False,
                        "attachmentException": (
                            attachment_exception if group == ("tacticus",) else None
                        ),
                    }
                )

    recognized_cost_sentences = 0
    for sentence in source.split(". "):
        wounds = re.search(
            r"Each model with a Wounds characteristic of (\d+) or more takes up the space of (\d+) models",
            sentence,
            re.IGNORECASE,
        )
        if wounds:
            result["costs"].append(
                {
                    "keywords": [],
                    "minimumWounds": int(wounds.group(1)),
                    "cost": int(wounds.group(2)),
                }
            )
            recognized_cost_sentences += 1
            continue
        cost_found = False
        for clause in re.split(
            r"\s+and\s+(?=(?:each|the)\s+)", sentence, flags=re.IGNORECASE
        ):
            cost = re.search(
                r"^(?:Each|The)?\s*(.+?)(?:\s+model)? takes? up the space of (\d+) models",
                clause,
                re.IGNORECASE,
            )
            if not cost:
                cost = re.search(
                    r"^(?:Each|The)?\s*(.+?)(?:\s+model)? takes? the space of (\d+) models",
                    clause,
                    re.IGNORECASE,
                )
            if not cost:
                continue
            cost_found = True
            phrase = re.sub(r"\bmodel\b", "", cost.group(1), flags=re.IGNORECASE)
            groups = groups_from_phrase(phrase, vocabulary)
            if groups is None:
                result["exact"] = False
            else:
                result["costs"].extend(
                    {
                        "keywords": list(group),
                        "minimumWounds": None,
                        "cost": int(cost.group(2)),
                    }
                    for group in groups
                )
        if cost_found:
            recognized_cost_sentences += 1

    for modifier in re.finditer(
        r"If this model is equipped with an? (.+?), it has a transport capacity of (\d+)",
        source,
        re.IGNORECASE,
    ):
        result["capacityModifiers"].append(
            {
                "equipment": normalized_term(modifier.group(1)),
                "capacity": int(modifier.group(2)),
            }
        )
    cost_sentence_count = sum(
        "takes up the space" in sentence.casefold()
        or "takes the space" in sentence.casefold()
        for sentence in source.split(". ")
    )
    if recognized_cost_sentences != cost_sentence_count:
        result["exact"] = False
    if source.casefold().count("has a transport capacity of") != 1 + len(
        result["capacityModifiers"]
    ):
        result["exact"] = False
    if re.search(
        r"This model can also transport|This model can instead transport",
        source,
        re.IGNORECASE,
    ):
        result["exact"] = False
    return result
