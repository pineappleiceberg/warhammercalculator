#!/usr/bin/env python3
"""Export the SQLite profile catalogue as compact browser-friendly JSON."""

from __future__ import annotations

import argparse
import json
import re
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


def unit_model_range(composition: list[dict]) -> tuple[int | None, int | None]:
    separators = {
        index
        for index, row in enumerate(composition)
        if row["text"].strip().lower() in {"or", "or:"}
    }
    if separators:
        groups = []
        current = []
        for index, row in enumerate(composition):
            if index in separators:
                if current:
                    groups.append(current)
                    current = []
                continue
            if row["min"] is not None and row["max"] is not None:
                current.append(row)
        if current:
            groups.append(current)
        if groups:
            return (
                min(sum(row["min"] for row in group) for group in groups),
                max(sum(row["max"] for row in group) for group in groups),
            )

    numeric = [
        row for row in composition if row["min"] is not None and row["max"] is not None
    ]
    unknown = [row["text"] for row in composition if row not in numeric]
    if any("one of the following" in text.lower() for text in unknown) and numeric:
        return min(row["min"] for row in numeric), max(row["max"] for row in numeric)

    caps = []
    for text in unknown:
        match = re.search(
            r"(?:maximum of\s+(\d+)|\b(\d+)\s+models?\s+maximum)",
            text,
            re.IGNORECASE,
        )
        if match:
            caps.append(int(match.group(1) or match.group(2)))
        elif text.strip():
            return None, None
    if not numeric:
        return None, None
    minimum = sum(row["min"] for row in numeric)
    maximum = sum(row["max"] for row in numeric)
    return minimum, min([maximum, *caps]) if caps else maximum


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
                "compositionModels": [],
                "loadout": row["loadout_text"],
                "defaultWeapons": [],
                "unresolvedLoadoutSubjects": [],
                "wargearOptions": [],
                "weaponLimits": [],
                "wargearChoicePools": [],
                "combatPresets": [],
                "defensiveEquipment": [],
                "firingDeck": None,
                "firingDeckModelCost": 1,
                "transport": None,
                "transportKeywords": [],
                "suggestedModelCount": None,
                "maximumModelCount": None,
            }
            for row in connection.execute(
                """SELECT id, faction_id, name, loadout_text
                   FROM datasheets ORDER BY name COLLATE NOCASE"""
            )
        }

        keywords: dict[str, list[str]] = {}
        preset_lookup: dict[tuple[str, int, int], dict] = {}
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
                    "feelNoPain": 0,
                    "reduction": 0,
                    "damageDivisor": 1,
                    "wounds": row["wounds"],
                    "keywords": keywords.get(row["datasheet_id"], []),
                }
            )

        for row in connection.execute(
            """SELECT deck.datasheet_id, deck.capacity, abilities.ability_id
               FROM unit_firing_deck AS deck
               JOIN datasheet_abilities AS abilities
                 ON abilities.datasheet_id = deck.datasheet_id
                AND abilities.position = deck.ability_position
               ORDER BY deck.datasheet_id"""
        ):
            units[row["datasheet_id"]]["firingDeck"] = {
                "capacity": row["capacity"],
                "abilityId": row["ability_id"],
            }

        for row in connection.execute(
            """SELECT datasheet_id, model_cost
               FROM unit_firing_deck_passenger_costs ORDER BY datasheet_id"""
        ):
            units[row["datasheet_id"]]["firingDeckModelCost"] = row["model_cost"]

        transport_allowed: dict[tuple[str, int], list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, group_position, keyword
               FROM unit_transport_allowed_keywords
               ORDER BY datasheet_id, group_position, keyword_position"""
        ):
            transport_allowed.setdefault(
                (row["datasheet_id"], row["group_position"]), []
            ).append(row["keyword"])
        additional_pool_keywords: dict[tuple[str, int, int], list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, pool_position, group_position, keyword
               FROM unit_transport_additional_pool_keywords
               ORDER BY datasheet_id, pool_position, group_position, keyword_position"""
        ):
            additional_pool_keywords.setdefault(
                (
                    row["datasheet_id"],
                    row["pool_position"],
                    row["group_position"],
                ),
                [],
            ).append(row["keyword"])
        additional_pools: dict[str, list[dict]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, pool_position, capacity
               FROM unit_transport_additional_pools
               ORDER BY datasheet_id, pool_position"""
        ):
            datasheet_id = row["datasheet_id"]
            pool_position = row["pool_position"]
            allowed_groups = [
                keywords
                for (
                    candidate_id,
                    candidate_pool,
                    _,
                ), keywords in additional_pool_keywords.items()
                if candidate_id == datasheet_id and candidate_pool == pool_position
            ]
            additional_pools.setdefault(datasheet_id, []).append(
                {
                    "position": pool_position,
                    "capacity": row["capacity"],
                    "allowedKeywords": allowed_groups,
                }
            )
        alternative_pool_keywords: dict[tuple[str, int, int], list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, pool_position, group_position, keyword
               FROM unit_transport_alternative_pool_keywords
               ORDER BY datasheet_id, pool_position, group_position, keyword_position"""
        ):
            alternative_pool_keywords.setdefault(
                (
                    row["datasheet_id"],
                    row["pool_position"],
                    row["group_position"],
                ),
                [],
            ).append(row["keyword"])
        alternative_pools: dict[str, list[dict]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, pool_position, capacity, maximum_wounds
               FROM unit_transport_alternative_pools
               ORDER BY datasheet_id, pool_position"""
        ):
            datasheet_id = row["datasheet_id"]
            pool_position = row["pool_position"]
            allowed_groups = [
                keywords
                for (
                    candidate_id,
                    candidate_pool,
                    _,
                ), keywords in alternative_pool_keywords.items()
                if candidate_id == datasheet_id and candidate_pool == pool_position
            ]
            alternative_pools.setdefault(datasheet_id, []).append(
                {
                    "position": pool_position,
                    "capacity": row["capacity"],
                    "maximumWounds": row["maximum_wounds"],
                    "allowedKeywords": allowed_groups,
                }
            )
        shared_allowance_keywords: dict[tuple[str, int, int], list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, allowance_position, group_position, keyword
               FROM unit_transport_shared_allowance_keywords
               ORDER BY datasheet_id, allowance_position, group_position, keyword_position"""
        ):
            shared_allowance_keywords.setdefault(
                (
                    row["datasheet_id"],
                    row["allowance_position"],
                    row["group_position"],
                ),
                [],
            ).append(row["keyword"])
        shared_allowance_exclusions: dict[tuple[str, int, int], list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, allowance_position, group_position, keyword
               FROM unit_transport_shared_allowance_exclusion_keywords
               ORDER BY datasheet_id, allowance_position, group_position, keyword_position"""
        ):
            shared_allowance_exclusions.setdefault(
                (
                    row["datasheet_id"],
                    row["allowance_position"],
                    row["group_position"],
                ),
                [],
            ).append(row["keyword"])
        shared_allowances: dict[str, list[dict]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, allowance_position, maximum_models,
                      cost_equals_wounds, fixed_model_cost, consumes_primary_capacity,
                      primary_capacity_while_used, nested_passenger_policy
               FROM unit_transport_shared_allowances
               ORDER BY datasheet_id, allowance_position"""
        ):
            datasheet_id = row["datasheet_id"]
            allowance_position = row["allowance_position"]
            allowed_groups = [
                keywords
                for (
                    candidate_id,
                    candidate_allowance,
                    _,
                ), keywords in shared_allowance_keywords.items()
                if candidate_id == datasheet_id
                and candidate_allowance == allowance_position
            ]
            excluded_groups = [
                keywords
                for (
                    candidate_id,
                    candidate_allowance,
                    _,
                ), keywords in shared_allowance_exclusions.items()
                if candidate_id == datasheet_id
                and candidate_allowance == allowance_position
            ]
            shared_allowances.setdefault(datasheet_id, []).append(
                {
                    "position": allowance_position,
                    "maximumModels": row["maximum_models"],
                    "costEqualsWounds": bool(row["cost_equals_wounds"]),
                    "fixedModelCost": row["fixed_model_cost"],
                    "consumesPrimaryCapacity": bool(row["consumes_primary_capacity"]),
                    "primaryCapacityWhileUsed": row["primary_capacity_while_used"],
                    "nestedPassengerPolicy": row["nested_passenger_policy"],
                    "allowedKeywords": allowed_groups,
                    "excludedKeywords": excluded_groups,
                }
            )
        transport_excluded: dict[tuple[str, int], list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, group_position, keyword
               FROM unit_transport_exclusion_keywords
               ORDER BY datasheet_id, group_position, keyword_position"""
        ):
            transport_excluded.setdefault(
                (row["datasheet_id"], row["group_position"]), []
            ).append(row["keyword"])
        transport_exclusion_exceptions: dict[tuple[str, int, int], list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, group_position, exception_group_position, keyword
               FROM unit_transport_exclusion_exception_keywords
               ORDER BY datasheet_id, group_position, exception_group_position,
                        keyword_position"""
        ):
            transport_exclusion_exceptions.setdefault(
                (
                    row["datasheet_id"],
                    row["group_position"],
                    row["exception_group_position"],
                ),
                [],
            ).append(row["keyword"])
        transport_costs: dict[tuple[str, int], list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, group_position, keyword
               FROM unit_transport_model_cost_keywords
               ORDER BY datasheet_id, group_position, keyword_position"""
        ):
            transport_costs.setdefault(
                (row["datasheet_id"], row["group_position"]), []
            ).append(row["keyword"])
        exclusions: dict[str, list[dict]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, group_position, minimum_wounds,
                      requires_non_character, exception_required_passenger_keyword,
                      exception_forbidden_attached_keyword
               FROM unit_transport_exclusion_groups
               ORDER BY datasheet_id, group_position"""
        ):
            exclusions.setdefault(row["datasheet_id"], []).append(
                {
                    "keywords": transport_excluded.get(
                        (row["datasheet_id"], row["group_position"]), []
                    ),
                    "minimumWounds": row["minimum_wounds"],
                    "nonCharacter": bool(row["requires_non_character"]),
                    "attachmentException": (
                        {
                            "requiredPassengerKeyword": row[
                                "exception_required_passenger_keyword"
                            ],
                            "forbiddenAttachedKeyword": row[
                                "exception_forbidden_attached_keyword"
                            ],
                        }
                        if row["exception_required_passenger_keyword"] is not None
                        else None
                    ),
                    "keywordExceptions": [
                        keywords
                        for (
                            candidate_id,
                            candidate_group,
                            _,
                        ), keywords in transport_exclusion_exceptions.items()
                        if candidate_id == row["datasheet_id"]
                        and candidate_group == row["group_position"]
                    ],
                }
            )
        model_costs: dict[str, list[dict]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, group_position, model_cost, minimum_wounds
               FROM unit_transport_model_cost_groups
               ORDER BY datasheet_id, group_position"""
        ):
            model_costs.setdefault(row["datasheet_id"], []).append(
                {
                    "keywords": transport_costs.get(
                        (row["datasheet_id"], row["group_position"]), []
                    ),
                    "minimumWounds": row["minimum_wounds"],
                    "cost": row["model_cost"],
                }
            )
        modifiers: dict[str, list[dict]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, equipment_name, capacity
               FROM unit_transport_capacity_modifiers
               ORDER BY datasheet_id, position"""
        ):
            modifiers.setdefault(row["datasheet_id"], []).append(
                {"equipment": row["equipment_name"], "capacity": row["capacity"]}
            )
        for row in connection.execute(
            """SELECT datasheet_id, capacity, exact_rules, source_text
               FROM unit_transport ORDER BY datasheet_id"""
        ):
            datasheet_id = row["datasheet_id"]
            allowed_groups = [
                keywords
                for (candidate_id, _), keywords in transport_allowed.items()
                if candidate_id == datasheet_id
            ]
            units[datasheet_id]["transport"] = {
                "capacity": row["capacity"],
                "exactRules": bool(row["exact_rules"]),
                "source": row["source_text"],
                "allowedKeywords": allowed_groups,
                "additionalPools": additional_pools.get(datasheet_id, []),
                "alternativePools": alternative_pools.get(datasheet_id, []),
                "sharedAllowances": shared_allowances.get(datasheet_id, []),
                "excluded": exclusions.get(datasheet_id, []),
                "modelCosts": model_costs.get(datasheet_id, []),
                "capacityModifiers": modifiers.get(datasheet_id, []),
            }

        for unit in units.values():
            unit["transportKeywords"] = sorted(
                {
                    *(
                        keyword.casefold()
                        for model in unit["models"]
                        for keyword in model["keywords"]
                    ),
                    *(model["name"].casefold() for model in unit["models"]),
                    unit["name"].casefold(),
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

        supported_keywords: dict[tuple[str, int, int], list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, ability_position, preset_position, keyword
               FROM unit_combat_preset_supported_keywords
               ORDER BY datasheet_id, ability_position, preset_position, keyword_position"""
        ):
            supported_keywords.setdefault(
                (row["datasheet_id"], row["ability_position"], row["preset_position"]),
                [],
            ).append(row["keyword"])

        keyword_requirements: dict[tuple[str, int, int, str], list[str]] = {}
        for row in connection.execute(
            """SELECT datasheet_id, ability_position, preset_position,
                      requirement_kind, keyword
               FROM unit_combat_preset_keyword_requirements
               ORDER BY datasheet_id, ability_position, preset_position,
                        requirement_kind, keyword_position"""
        ):
            keyword_requirements.setdefault(
                (
                    row["datasheet_id"],
                    row["ability_position"],
                    row["preset_position"],
                    row["requirement_kind"],
                ),
                [],
            ).append(row["keyword"])

        for row in connection.execute(
            """SELECT datasheet_id, ability_position, preset_position, name, description_text,
                      is_exclusive_choice, activation, source_relationship, uses_per_battle,
                      weapon_scope,
                      maximum_target_distance, maximum_source_target_distance,
                      maximum_support_distance,
                      requires_attacker_charge, requires_attacker_stationary,
                      requires_attached_unit,
                      requires_waaagh_active,
                      requires_oath_target, requires_oath_wound_bonus,
                      requires_source_on_objective, requires_target_on_objective,
                      requires_source_controls_objective,
                      requires_target_on_objective_not_controlled_by_source,
                      requires_source_on_selected_objective,
                      requires_target_on_source_selected_objective,
                      requires_target_battle_shocked,
                      requires_attacker_not_battle_shocked, required_target_strength_state,
                      requires_source_not_battle_shocked,
                      requires_source_guided_against_target,
                      requires_target_spotted,
                      requires_target_spotted_by_markerlight_observer,
                      requires_target_closest_eligible, requires_source_target_visible,
                      hit_modifier, hit_modifier_role,
                      hit_modifier_subject, wound_modifier, wound_modifier_role,
                      wound_modifier_subject, reroll_hits, reroll_hit_ones, hit_reroll_role,
                      hit_reroll_subject, reroll_wounds, reroll_wound_ones, wound_reroll_role,
                      wound_reroll_subject
               FROM unit_combat_presets
               ORDER BY datasheet_id, ability_position, preset_position"""
        ):
            base_id = f"{row['datasheet_id']}:{row['ability_position']}"
            preset_key = (
                row["datasheet_id"],
                row["ability_position"],
                row["preset_position"],
            )
            exported_preset = {
                "id": base_id
                if row["preset_position"] == 1
                else f"{base_id}:{row['preset_position']}",
                "choiceGroup": base_id if row["is_exclusive_choice"] else None,
                "activation": row["activation"],
                "sourceRelationship": row["source_relationship"],
                **(
                    {"usesPerBattle": row["uses_per_battle"]}
                    if row["uses_per_battle"]
                    else {}
                ),
                "name": row["name"],
                "description": row["description_text"],
                "weaponScope": row["weapon_scope"],
                **(
                    {"maximumTargetDistance": row["maximum_target_distance"]}
                    if row["maximum_target_distance"]
                    else {}
                ),
                **(
                    {
                        "maximumSourceTargetDistance": row[
                            "maximum_source_target_distance"
                        ]
                    }
                    if row["maximum_source_target_distance"]
                    else {}
                ),
                **(
                    {"maximumSupportDistance": row["maximum_support_distance"]}
                    if row["maximum_support_distance"]
                    else {}
                ),
                **(
                    {"requiredSupportedKeywords": supported_keywords[preset_key]}
                    if preset_key in supported_keywords
                    else {}
                ),
                **(
                    {
                        "requiredAttackerKeywords": keyword_requirements[
                            (*preset_key, "attacker_all")
                        ]
                    }
                    if (*preset_key, "attacker_all") in keyword_requirements
                    else {}
                ),
                **(
                    {
                        "requiredTargetKeywords": keyword_requirements[
                            (*preset_key, "target_all")
                        ]
                    }
                    if (*preset_key, "target_all") in keyword_requirements
                    else {}
                ),
                **(
                    {
                        "requiredAttackKeywordsAny": keyword_requirements[
                            (*preset_key, "attack_any")
                        ]
                    }
                    if (*preset_key, "attack_any") in keyword_requirements
                    else {}
                ),
                **(
                    {"requiresAttackerCharge": True}
                    if row["requires_attacker_charge"]
                    else {}
                ),
                **(
                    {"requiresAttackerStationary": True}
                    if row["requires_attacker_stationary"]
                    else {}
                ),
                **(
                    {"requiresAttachedUnit": True}
                    if row["requires_attached_unit"]
                    else {}
                ),
                **(
                    {"requiresWaaaghActive": True}
                    if row["requires_waaagh_active"]
                    else {}
                ),
                **({"requiresOathTarget": True} if row["requires_oath_target"] else {}),
                **(
                    {"requiresOathWoundBonusEligible": True}
                    if row["requires_oath_wound_bonus"]
                    else {}
                ),
                **(
                    {"requiresSourceOnObjective": True}
                    if row["requires_source_on_objective"]
                    else {}
                ),
                **(
                    {"requiresTargetOnObjective": True}
                    if row["requires_target_on_objective"]
                    else {}
                ),
                **(
                    {"requiresSourceControlsObjective": True}
                    if row["requires_source_controls_objective"]
                    else {}
                ),
                **(
                    {"requiresTargetOnObjectiveNotControlledBySource": True}
                    if row["requires_target_on_objective_not_controlled_by_source"]
                    else {}
                ),
                **(
                    {"requiresSourceOnSelectedObjective": True}
                    if row["requires_source_on_selected_objective"]
                    else {}
                ),
                **(
                    {"requiresTargetOnSourceSelectedObjective": True}
                    if row["requires_target_on_source_selected_objective"]
                    else {}
                ),
                **(
                    {"requiresTargetBattleShocked": True}
                    if row["requires_target_battle_shocked"]
                    else {}
                ),
                **(
                    {"requiresAttackerNotBattleShocked": True}
                    if row["requires_attacker_not_battle_shocked"]
                    else {}
                ),
                **(
                    {"requiresSourceNotBattleShocked": True}
                    if row["requires_source_not_battle_shocked"]
                    else {}
                ),
                **(
                    {"requiresSourceGuidedAgainstTarget": True}
                    if row["requires_source_guided_against_target"]
                    else {}
                ),
                **(
                    {"requiresTargetSpotted": True}
                    if row["requires_target_spotted"]
                    else {}
                ),
                **(
                    {"requiresTargetSpottedByMarkerlightObserver": True}
                    if row["requires_target_spotted_by_markerlight_observer"]
                    else {}
                ),
                **(
                    {"requiresTargetClosestEligible": True}
                    if row["requires_target_closest_eligible"]
                    else {}
                ),
                **(
                    {"requiresSourceTargetVisible": True}
                    if row["requires_source_target_visible"]
                    else {}
                ),
                **(
                    {
                        "requiredTargetStrengthState": row[
                            "required_target_strength_state"
                        ]
                    }
                    if row["required_target_strength_state"]
                    else {}
                ),
                "hitModifier": row["hit_modifier"],
                "hitModifierRole": row["hit_modifier_role"],
                "hitModifierSubject": row["hit_modifier_subject"],
                "woundModifier": row["wound_modifier"],
                "woundModifierRole": row["wound_modifier_role"],
                "woundModifierSubject": row["wound_modifier_subject"],
                "rerollHits": bool(row["reroll_hits"]),
                "rerollHitOnes": bool(row["reroll_hit_ones"]),
                "hitRerollRole": row["hit_reroll_role"],
                "hitRerollSubject": row["hit_reroll_subject"],
                "rerollWounds": bool(row["reroll_wounds"]),
                "rerollWoundOnes": bool(row["reroll_wound_ones"]),
                "woundRerollRole": row["wound_reroll_role"],
                "woundRerollSubject": row["wound_reroll_subject"],
                "effects": [],
            }
            units[row["datasheet_id"]]["combatPresets"].append(exported_preset)
            preset_lookup[
                (row["datasheet_id"], row["ability_position"], row["preset_position"])
            ] = exported_preset

        for row in connection.execute(
            """SELECT datasheet_id, ability_position, preset_position, effect_type,
                      value, uses, dice_count, dice_sides, models_per_increment,
                      model_count_source, maximum_modifier, weapon_name, required_target_keyword,
                      required_attack_keyword, application_role, subject
               FROM unit_combat_preset_effects
               ORDER BY datasheet_id, ability_position, preset_position, effect_position"""
        ):
            preset_lookup[
                (row["datasheet_id"], row["ability_position"], row["preset_position"])
            ]["effects"].append(
                {
                    "type": row["effect_type"],
                    "value": row["value"],
                    **({"uses": row["uses"]} if row["uses"] else {}),
                    "diceCount": row["dice_count"],
                    "diceSides": row["dice_sides"],
                    **(
                        {"modelsPerIncrement": row["models_per_increment"]}
                        if row["models_per_increment"]
                        else {}
                    ),
                    **(
                        {"modelCountSource": row["model_count_source"]}
                        if row["model_count_source"]
                        else {}
                    ),
                    **(
                        {"maximumModifier": row["maximum_modifier"]}
                        if row["maximum_modifier"]
                        else {}
                    ),
                    **(
                        {"weaponName": row["weapon_name"]} if row["weapon_name"] else {}
                    ),
                    **(
                        {"requiredTargetKeyword": row["required_target_keyword"]}
                        if row["required_target_keyword"]
                        else {}
                    ),
                    **(
                        {"requiredAttackKeyword": row["required_attack_keyword"]}
                        if row["required_attack_keyword"]
                        else {}
                    ),
                    "role": row["application_role"],
                    "subject": row["subject"],
                }
            )

        equipment_lookup: dict[tuple[str, int], dict] = {}
        for row in connection.execute(
            """SELECT datasheet_id, ability_position, name, description_text,
                      effect_scope, guidance_text
               FROM unit_defensive_equipment_options
               ORDER BY datasheet_id, ability_position"""
        ):
            option = {
                "id": f"{row['datasheet_id']}:defensive-equipment:{row['ability_position']}",
                "name": row["name"],
                "description": row["description_text"],
                "scope": row["effect_scope"],
                **({"guidance": row["guidance_text"]} if row["guidance_text"] else {}),
                "effects": [],
            }
            units[row["datasheet_id"]]["defensiveEquipment"].append(option)
            equipment_lookup[(row["datasheet_id"], row["ability_position"])] = option

        for row in connection.execute(
            """SELECT datasheet_id, ability_position, effect_type, value, uses,
                      required_attack_keyword
               FROM unit_defensive_equipment_effects
               ORDER BY datasheet_id, ability_position, effect_position"""
        ):
            equipment_lookup[(row["datasheet_id"], row["ability_position"])][
                "effects"
            ].append(
                {
                    "type": row["effect_type"],
                    "value": row["value"],
                    **({"uses": row["uses"]} if row["uses"] else {}),
                    **(
                        {"requiredAttackKeyword": row["required_attack_keyword"]}
                        if row["required_attack_keyword"]
                        else {}
                    ),
                }
            )

        for unit in units.values():
            inherent_effects = [
                effect
                for preset in unit["combatPresets"]
                if preset["activation"] == "inherent"
                for effect in preset["effects"]
            ]
            for model in unit["models"]:
                for effect in inherent_effects:
                    value = effect["value"]
                    if effect["type"] == "save_target":
                        model["save"] = min(model["save"] or value, value)
                    elif effect["type"] == "invulnerable_save":
                        model["invuln"] = min(model["invuln"] or value, value)
                    elif effect["type"] == "feel_no_pain":
                        model["feelNoPain"] = min(model["feelNoPain"] or value, value)
                    elif effect["type"] == "damage_reduction":
                        model["reduction"] = max(model["reduction"], value)
                    elif effect["type"] == "damage_divisor":
                        model["damageDivisor"] *= value

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
            """SELECT datasheet_id, model_name, min_models, max_models,
                      description_text
               FROM unit_composition_models
               ORDER BY datasheet_id, composition_position, component_position"""
        ):
            units[row["datasheet_id"]]["compositionModels"].append(
                {
                    "name": row["model_name"],
                    "min": row["min_models"],
                    "max": row["max_models"],
                    "source": row["description_text"],
                }
            )

        for row in connection.execute(
            """SELECT datasheet_id, description_text
               FROM wargear_options
               ORDER BY datasheet_id, position"""
        ):
            units[row["datasheet_id"]]["wargearOptions"].append(row["description_text"])

        defaults: dict[tuple[str, str], dict] = {}
        for row in connection.execute(
            """SELECT datasheet_id, subject_position, weapon_group_id,
                      weapon_group_name, quantity, fixed_quantity,
                      quantity_per_model, quantity_per_increment,
                      models_per_increment, description_text
               FROM default_weapon_loadout
               ORDER BY datasheet_id, weapon_group_id, subject_position"""
        ):
            key = (row["datasheet_id"], row["weapon_group_id"])
            default = defaults.setdefault(
                key,
                {
                    "groupId": row["weapon_group_id"],
                    "groupName": row["weapon_group_name"],
                    "terms": [],
                },
            )
            default["terms"].append(
                {
                    "fixed": row["fixed_quantity"],
                    "perModel": row["quantity_per_model"],
                    "perIncrement": row["quantity_per_increment"],
                    "modelsPerIncrement": row["models_per_increment"],
                    "quantity": row["quantity"],
                    "source": row["description_text"],
                }
            )
        for (datasheet_id, _group_id), default in defaults.items():
            units[datasheet_id]["defaultWeapons"].append(default)

        unresolved_subjects: dict[tuple[str, int], dict] = {}
        for row in connection.execute(
            """SELECT subject.datasheet_id, subject.position,
                      subject.subject_text, subject.equipment_text,
                      weapon.weapon_group_id, weapon.weapon_group_name, weapon.quantity
               FROM default_loadout_subjects AS subject
               LEFT JOIN default_loadout_subject_weapons AS weapon
                 ON weapon.datasheet_id = subject.datasheet_id
                AND weapon.subject_position = subject.position
               WHERE subject.resolved = 0
               ORDER BY subject.datasheet_id, subject.position, weapon.weapon_group_id"""
        ):
            key = (row["datasheet_id"], row["position"])
            subject = unresolved_subjects.get(key)
            if subject is None:
                subject = {
                    "id": f"{row['datasheet_id']}:{row['position']}",
                    "subject": row["subject_text"],
                    "equipment": row["equipment_text"],
                    "weapons": [],
                }
                unresolved_subjects[key] = subject
                units[row["datasheet_id"]]["unresolvedLoadoutSubjects"].append(subject)
            if row["weapon_group_id"] is not None:
                subject["weapons"].append(
                    {
                        "groupId": row["weapon_group_id"],
                        "groupName": row["weapon_group_name"],
                        "quantity": row["quantity"],
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
            minimum, maximum = unit_model_range(composition)
            unit["suggestedModelCount"] = minimum
            unit["maximumModelCount"] = maximum

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
            source_lines = [
                row["source_line"]
                for row in rows_in_group
                if row["source_line"] is not None
            ]
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
                "defaultWeaponCount": len(defaults),
                "defaultWeaponTermCount": connection.execute(
                    "SELECT count(*) FROM default_weapon_loadout"
                ).fetchone()[0],
                "loadoutSubjectCount": connection.execute(
                    "SELECT count(*) FROM default_loadout_subjects"
                ).fetchone()[0],
                "resolvedLoadoutSubjectCount": connection.execute(
                    "SELECT count(*) FROM default_loadout_subjects WHERE resolved = 1"
                ).fetchone()[0],
                "unresolvedLoadoutSubjectCount": connection.execute(
                    "SELECT count(*) FROM default_loadout_subjects WHERE resolved = 0"
                ).fetchone()[0],
                "loadoutSubjectWeaponCount": connection.execute(
                    "SELECT count(*) FROM default_loadout_subject_weapons"
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
