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

SCHEMA = (
    """
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
    preset_position INTEGER NOT NULL CHECK (preset_position >= 1),
    name TEXT NOT NULL,
    description_text TEXT NOT NULL,
    is_exclusive_choice INTEGER NOT NULL CHECK (is_exclusive_choice IN (0, 1)),
    activation TEXT NOT NULL CHECK (activation IN ('inherent', 'automatic', 'situational')),
    weapon_scope TEXT NOT NULL CHECK (weapon_scope IN ('Any', 'Ranged', 'Melee')),
    maximum_target_distance INTEGER CHECK (maximum_target_distance > 0),
    requires_attacker_charge INTEGER NOT NULL DEFAULT 0
        CHECK (requires_attacker_charge IN (0, 1)),
    requires_attacker_stationary INTEGER NOT NULL DEFAULT 0
        CHECK (requires_attacker_stationary IN (0, 1)),
    requires_attached_unit INTEGER NOT NULL DEFAULT 0
        CHECK (requires_attached_unit IN (0, 1)),
    requires_waaagh_active INTEGER NOT NULL DEFAULT 0
        CHECK (requires_waaagh_active IN (0, 1)),
    requires_oath_target INTEGER NOT NULL DEFAULT 0
        CHECK (requires_oath_target IN (0, 1)),
    requires_oath_wound_bonus INTEGER NOT NULL DEFAULT 0
        CHECK (requires_oath_wound_bonus IN (0, 1)),
    requires_source_on_objective INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_on_objective IN (0, 1)),
    requires_target_on_objective INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_on_objective IN (0, 1)),
    requires_source_controls_objective INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_controls_objective IN (0, 1)),
    requires_target_on_objective_not_controlled_by_source INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_on_objective_not_controlled_by_source IN (0, 1)),
    requires_source_on_selected_objective INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_on_selected_objective IN (0, 1)),
    requires_target_on_source_selected_objective INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_on_source_selected_objective IN (0, 1)),
    requires_target_battle_shocked INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_battle_shocked IN (0, 1)),
    requires_attacker_not_battle_shocked INTEGER NOT NULL DEFAULT 0
        CHECK (requires_attacker_not_battle_shocked IN (0, 1)),
    requires_source_not_battle_shocked INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_not_battle_shocked IN (0, 1)),
    requires_source_guided_against_target INTEGER NOT NULL DEFAULT 0
        CHECK (requires_source_guided_against_target IN (0, 1)),
    requires_target_spotted INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_spotted IN (0, 1)),
    requires_target_spotted_by_markerlight_observer INTEGER NOT NULL DEFAULT 0
        CHECK (requires_target_spotted_by_markerlight_observer IN (0, 1)),
    required_target_strength_state TEXT
        CHECK (required_target_strength_state IN
            ('below_starting', 'below_half', 'not_below_half')),
    hit_modifier INTEGER NOT NULL CHECK (hit_modifier BETWEEN -1 AND 1),
    hit_modifier_role TEXT CHECK (hit_modifier_role IN ('attacker', 'target', 'either')),
    hit_modifier_subject TEXT CHECK (hit_modifier_subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    wound_modifier INTEGER NOT NULL CHECK (wound_modifier BETWEEN -1 AND 1),
    wound_modifier_role TEXT CHECK (wound_modifier_role IN ('attacker', 'target', 'either')),
    wound_modifier_subject TEXT CHECK (wound_modifier_subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    reroll_hits INTEGER NOT NULL CHECK (reroll_hits IN (0, 1)),
    reroll_hit_ones INTEGER NOT NULL CHECK (reroll_hit_ones IN (0, 1)),
    hit_reroll_role TEXT CHECK (hit_reroll_role IN ('attacker', 'target', 'either')),
    hit_reroll_subject TEXT CHECK (hit_reroll_subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    reroll_wounds INTEGER NOT NULL CHECK (reroll_wounds IN (0, 1)),
    reroll_wound_ones INTEGER NOT NULL CHECK (reroll_wound_ones IN (0, 1)),
    wound_reroll_role TEXT CHECK (wound_reroll_role IN ('attacker', 'target', 'either')),
    wound_reroll_subject TEXT CHECK (wound_reroll_subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    PRIMARY KEY (datasheet_id, ability_position, preset_position),
    FOREIGN KEY (datasheet_id, ability_position)
        REFERENCES datasheet_abilities(datasheet_id, position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE unit_combat_preset_effects (
    datasheet_id TEXT NOT NULL,
    ability_position INTEGER NOT NULL,
    preset_position INTEGER NOT NULL,
    effect_position INTEGER NOT NULL CHECK (effect_position >= 1),
    effect_type TEXT NOT NULL CHECK (effect_type IN
        ('lethal_hits', 'devastating_wounds', 'twin_linked', 'ignores_cover',
         'sustained_hits', 'rapid_fire', 'lance', 'heavy', 'ap_modifier', 'skill_modifier',
         'critical_hits', 'critical_wounds', 'attacks_replacement', 'strength_replacement',
         'damage_replacement', 'first_failed_save_damage_replacement',
         'allocated_attack_damage_replacement',
         'attacks_multiplier', 'strength_multiplier',
         'damage_multiplier', 'attacks_modifier', 'strength_modifier',
         'damage_modifier', 'save_target',
         'invulnerable_save', 'feel_no_pain', 'damage_reduction', 'damage_divisor')),
    value INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
    dice_count INTEGER NOT NULL DEFAULT 0 CHECK (dice_count >= 0),
    dice_sides INTEGER NOT NULL DEFAULT 0 CHECK (dice_sides >= 0),
    models_per_increment INTEGER CHECK (models_per_increment > 0),
    model_count_source TEXT CHECK (model_count_source IN ('source_unit', 'nearby_enemy')),
    weapon_name TEXT,
    required_target_keyword TEXT,
    required_attack_keyword TEXT,
    application_role TEXT NOT NULL CHECK (application_role IN ('attacker', 'target', 'either')),
    subject TEXT NOT NULL CHECK (subject IN
        ('self', 'led_unit', 'friendly_unit', 'enemy_unit', 'affected_unit', 'unknown')),
    CHECK ((models_per_increment IS NULL) = (model_count_source IS NULL)),
    PRIMARY KEY (datasheet_id, ability_position, preset_position, effect_position),
    FOREIGN KEY (datasheet_id, ability_position, preset_position)
        REFERENCES unit_combat_presets(datasheet_id, ability_position, preset_position)
        ON DELETE CASCADE
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
CREATE INDEX idx_unit_combat_preset_effects_datasheet
    ON unit_combat_preset_effects(datasheet_id);
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
"""
    + CONSTRAINT_SCHEMA
)


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


def combat_weapon_scope(text: str) -> str:
    lowered = text.casefold()
    has_melee = "melee attack" in lowered or "melee weapon" in lowered
    has_ranged = "ranged attack" in lowered or "ranged weapon" in lowered
    if has_melee != has_ranged:
        return "Melee" if has_melee else "Ranged"
    if has_melee:
        return "Any"

    phase_limited = bool(
        re.search(r"until (?:the )?end of (?:(?:the|that|this) )?phase\b", lowered)
    )
    shoots = bool(re.search(r"\b(?:selected to|eligible to) shoot\b", lowered))
    fights = bool(re.search(r"\bselected to fight\b", lowered))
    shoots_or_fights = bool(
        re.search(r"\bselected to (?:shoot or fight|fight or shoot)\b", lowered)
    )
    shooting_phase = "shooting phase" in lowered
    fight_phase = "fight phase" in lowered
    if phase_limited:
        if (shooting_phase and fight_phase) or shoots_or_fights:
            return "Any"
        ranged_only = shoots or (shooting_phase and not fight_phase)
        melee_only = fights or (fight_phase and not shooting_phase)
        if ranged_only != melee_only:
            return "Ranged" if ranged_only else "Melee"
    return "Any"


def combat_maximum_target_distance(
    text: str, effects: dict[str, object]
) -> int | None:
    modeled_effects = len(effects["additional_effects"])
    modeled_effects += sum(
        bool(effects[field])
        for field in (
            "hit_modifier",
            "wound_modifier",
            "reroll_hits",
            "reroll_hit_ones",
            "reroll_wounds",
            "reroll_wound_ones",
        )
    )
    if modeled_effects != 1:
        return None
    matches = list(
        re.finditer(
            r'\battacks?\b[^.;]{0,180}?\btargets?\s+'
            r'(?:an?\s+|the\s+)?(?:enemy\s+)?(?:model|unit)\s+'
            r'within\s+(\d+)\s*["”](?!\s+of\b)',
            text,
            re.IGNORECASE,
        )
    )
    if len(matches) != 1 or " with " in matches[0].group(0).casefold():
        return None
    return int(matches[0].group(1))


def combat_requires_attacker_charge(text: str) -> bool:
    lowered = text.casefold()
    if any(
        phrase in lowered
        for phrase in (
            "or was charged",
            "closest eligible target",
            "select both abilities",
        )
    ):
        return False
    triggered_until_end = re.search(
        r"each time (?:this model(?:[’']s unit)?|this unit|that unit|a model in this unit) "
        r"(?:makes|ends) a charge move, until the end of the (?:phase|turn),",
        lowered,
    )
    attack_condition = re.search(
        r"each time (?:this model|a model in this unit) makes a (?:melee )?attack, "
        r"if (?:this unit|it) made a charge move this turn,",
        lowered,
    )
    return bool(triggered_until_end or attack_condition)


def combat_requires_attacker_stationary(text: str) -> bool:
    normalized = plain_text(text).strip()
    return bool(
        re.fullmatch(
            r"(?:Each time (?:this model|this unit) Remains Stationary, until "
            r"(?:the end of the turn|the start of your next Movement phase)|"
            r"In your Movement phase, if this model Remains Stationary, until the end "
            r"of the turn), ranged weapons equipped by (?:this model|models in this unit) "
            r"have the \[(?:LETHAL HITS|DEVASTATING WOUNDS|IGNORES COVER|"
            r"SUSTAINED HITS 1)\] ability\.",
            normalized,
            re.IGNORECASE,
        )
    )


def combat_requires_attached_unit(text: str) -> bool:
    normalized = plain_text(text).strip()
    if re.fullmatch(
        r"While this model is leading a unit, add 2 to the Attacks characteristic "
        r"of this model[’']s Eyez of Mork weapon for every 5 models in that unit "
        r"\(rounding down\), but while that unit contains 10 or more models, that "
        r"weapon has the \[HAZARDOUS\] ability\.",
        normalized,
        re.IGNORECASE,
    ):
        return True
    match = re.fullmatch(
        r"While (?:this model|the bearer) is leading a unit, (.+)",
        normalized,
        re.IGNORECASE,
    )
    if not match:
        return False
    body = match.group(1).casefold()
    return not re.search(
        r"\b(?:if|unless|once|when|until|within|below|above|battle-shocked|"
        r"objective|closest|contains|selected to|leadership test|waaagh)\b",
        body,
    )


def combat_is_core_waaagh(text: str) -> bool:
    normalized = plain_text(text).strip()
    return bool(
        re.fullmatch(
            r"If your Army Faction is ORKS\s*, once per battle, at the start of your "
            r"Command phase, you can call a Waaagh!\. If you do, until the start of your "
            r"next Command phase, the Waaagh! is active for your army and: Units from "
            r"your army with this ability are eligible to declare a charge in a turn in "
            r"which they Advanced\. Add 1 to the Strength and Attacks characteristics of "
            r"melee weapons equipped by models from your army with this ability\. Models "
            r"from your army with this ability have a 5\+ invulnerable save\.",
            normalized,
            re.IGNORECASE,
        )
    )


def combat_requires_waaagh_active(text: str) -> bool:
    normalized = plain_text(text).strip()
    if combat_is_core_waaagh(normalized):
        return True
    direct_patterns = (
        r"Each time this model makes a (?:melee|ranged) attack, if the Waaagh! is "
        r"active for your army, add 1 to the Hit roll\.",
        r"While the Waaagh! is active for your army, models in this unit have the "
        r"Feel No Pain 5\+ ability\.",
        r"While this model is gaining the benefits of the Waaagh! ability, it has a "
        r"4\+ invulnerable save and an Objective Control characteristic of 5\.",
        r"While the Waaagh! is active for your army, add 4 to the Attacks "
        r"characteristic of this model[’']s melee weapons\.",
        r"While the Waaagh! is active for your army, this model[’']s [’']uge choppa "
        r"has a Damage characteristic of 3\.",
    )
    return any(re.fullmatch(pattern, normalized, re.IGNORECASE) for pattern in direct_patterns)


def combat_is_oath_of_moment(text: str) -> bool:
    normalized = plain_text(text).strip()
    return bool(
        re.fullmatch(
            r"If your Army Faction is ADEPTUS ASTARTES\s*, at the start of your "
            r"Command phase, select one unit from your opponent[’']s army\. Until the "
            r"start of your next Command phase, that enemy unit is your Oath of Moment "
            r"target\. Each time a model with this ability makes an attack that targets "
            r"your Oath of Moment target: You can re-roll the Hit roll\. If you are using "
            r"a Codex: Space Marines Detachment and your army does not include one or "
            r"more units with the Black Templars, Blood Angels, Dark Angels, Deathwatch "
            r"or Space Wolves keywords, add 1 to the Wound roll as well\.",
            normalized,
            re.IGNORECASE,
        )
    )


def combat_direct_objective_presets(
    name: str, text: str, allow_bearer_defenses: bool
) -> list[dict[str, object]] | None:
    normalized = plain_text(text).strip()
    if name == "Black Rage" and re.fullmatch(
        r"Each time this model makes a melee attack, you can re-roll the Hit roll\. "
        r"While this model[’']s unit is not within 6[\"”] of one or more friendly "
        r"Blood Angels Character models, or 12[\"”] of one or more friendly Chaplain "
        r"models, it cannot be selected to Fall Back and its Objective Control "
        r"characteristic is 0\.",
        normalized,
        re.IGNORECASE,
    ):
        effects = combat_preset(normalized.split(". ", 1)[0] + ".", allow_bearer_defenses)
        if effects:
            return [
                {
                    "name": name,
                    "description": normalized,
                    "is_exclusive_choice": 0,
                    "activation": "automatic",
                    **effects,
                }
            ]
    if name == "Voice of Experience" and re.fullmatch(
        r"While this model is leading a unit, improve the Objective Control "
        r"characteristic of models in that unit by 1 and each time a model in that "
        r"unit makes an attack, add 1 to the Hit roll\.",
        normalized,
        re.IGNORECASE,
    ):
        effects = combat_preset(normalized, allow_bearer_defenses)
        if effects:
            effects["requires_attached_unit"] = True
            return [
                {
                    "name": name,
                    "description": normalized,
                    "is_exclusive_choice": 0,
                    "activation": "automatic",
                    **effects,
                }
            ]
    ownership_patterns = {
        "Armoured Spearhead": (
            r"Each time this model makes an attack that targets an enemy unit, "
            r"re-roll a Hit roll of 1 and, if that unit is within range of an objective "
            r"marker you do not control, you can re-roll the Hit roll instead\.",
            "hit",
            "target_not_controlled",
        ),
        "Bringers of Change": (
            r"Each time a model in this unit makes a ranged attack, re-roll a Wound roll "
            r"of 1\. If that attack targets a unit within range of an objective marker "
            r"you do not control, you can re-roll the Wound roll instead\.",
            "wound",
            "target_not_controlled",
        ),
        "Stand Vigil": (
            r"Each time a model in this unit makes an attack, re-roll a Wound roll of 1\. "
            r"While this unit is within range of an objective marker you control, you can "
            r"re-roll the Wound roll instead\.",
            "wound",
            "source_controlled",
        ),
    }
    ownership_pattern = ownership_patterns.get(name)
    if ownership_pattern and re.fullmatch(
        ownership_pattern[0], normalized, re.IGNORECASE
    ):
        roll = ownership_pattern[1]
        base_text = re.split(
            r"(?: and, if|\. If|\. While)", normalized, maxsplit=1
        )[0]
        if not base_text.endswith("."):
            base_text += "."
        baseline = combat_preset(base_text, allow_bearer_defenses)
        if baseline:
            upgrade = {
                **baseline,
                f"reroll_{roll}_ones": 0,
                f"reroll_{roll}s": 1,
            }
            if ownership_pattern[2] == "target_not_controlled":
                upgrade[
                    "requires_target_on_objective_not_controlled_by_source"
                ] = True
            else:
                upgrade["requires_source_controls_objective"] = True
            return [
                {
                    "name": f"{name} — Base re-roll",
                    "description": normalized,
                    "is_exclusive_choice": 0,
                    "activation": "automatic",
                    **baseline,
                },
                {
                    "name": f"{name} — Objective-control re-roll",
                    "description": normalized,
                    "is_exclusive_choice": 0,
                    "activation": "automatic",
                    **upgrade,
                },
            ]
    if name == "Battlefield Control" and re.fullmatch(
        r"Each time this model makes a ranged attack, if it is within range of an "
        r"objective marker you control, re-roll a Hit roll of 1\.",
        normalized,
        re.IGNORECASE,
    ):
        effects = combat_preset(normalized, allow_bearer_defenses)
        if effects:
            effects["requires_source_controls_objective"] = True
            return [
                {
                    "name": name,
                    "description": normalized,
                    "is_exclusive_choice": 0,
                    "activation": "automatic",
                    **effects,
                }
            ]
    selected_objective_patterns = {
        "Archon’s Will": (
            r"At the start of the first battle round, select one objective marker on the "
            r"battlefield\. Until the end of the battle, while this unit is within range "
            r"of that objective marker, unless this unit is Battle-shocked, models in "
            r"this unit have a 5\+ invulnerable save and an Objective Control "
            r"characteristic of 3\.",
            "source",
        ),
        "Priority Objective Identified": (
            r"At the start of the first battle round, if your army includes one or more "
            r"models with this ability, you can select one objective marker on the "
            r"battlefield\. Until the end of the battle, while one or more models with "
            r"this ability are on the battlefield, each time a friendly ADEPTUS ASTARTES "
            r"model makes an attack that targets an enemy unit that is within range of "
            r"that objective marker, re-roll a Wound roll of 1\.",
            "target",
        ),
        "Seeker of the Unfound": (
            r"The first time this model is set up on the battlefield, select one objective "
            r"marker on the battlefield\. While this model is within range of that "
            r"objective marker, this model has an Objective Control characteristic of 10, "
            r"a Leadership characteristic of 5\+ and the Feel No Pain 4\+ ability\.",
            "source",
        ),
    }
    selected_pattern = selected_objective_patterns.get(name)
    if selected_pattern and re.fullmatch(selected_pattern[0], normalized, re.IGNORECASE):
        effects = combat_preset(normalized, allow_bearer_defenses)
        if effects:
            effects[
                "requires_source_on_selected_objective"
                if selected_pattern[1] == "source"
                else "requires_target_on_source_selected_objective"
            ] = True
            if name == "Archon’s Will":
                effects["requires_source_not_battle_shocked"] = True
            return [
                {
                    "name": name,
                    "description": normalized,
                    "is_exclusive_choice": 0,
                    "activation": "automatic",
                    **effects,
                }
            ]
    if re.search(
        r"objective marker (?:you|your opponent) (?:control|controls)|"
        r"objective marker you do not control|that objective marker|"
        r"closest eligible|Pain token|within 6[\"”] of one or more friendly",
        normalized,
        re.IGNORECASE,
    ):
        return None

    sentences = re.split(r"(?<=\.)\s+", normalized)
    if len(sentences) == 2:
        baseline_roll = re.search(
            r"re-roll a (Hit|Wound) roll of 1\.$", sentences[0], re.IGNORECASE
        )
        objective_upgrade = re.fullmatch(
            r"If (?:that attack targets (?:an enemy |a )?unit(?: that is)?|"
            r"the target(?: of that attack)? is(?: an enemy unit)?|that enemy unit is) "
            r"within range of (?:an |one or more )?objective markers?, you can re-roll "
            r"the (Hit|Wound) roll(?: instead)?\.",
            sentences[1],
            re.IGNORECASE,
        )
        if baseline_roll and objective_upgrade and (
            baseline_roll.group(1).casefold() == objective_upgrade.group(1).casefold()
        ):
            baseline = combat_preset(sentences[0], allow_bearer_defenses)
            if not baseline or baseline["maximum_target_distance"]:
                return None
            roll = baseline_roll.group(1).casefold()
            upgrade = {
                **baseline,
                f"reroll_{roll}_ones": 0,
                f"reroll_{roll}s": 1,
                "requires_target_on_objective": True,
            }
            baseline["requires_target_on_objective"] = False
            return [
                {
                    "name": f"{name} — Base re-roll",
                    "description": normalized,
                    "is_exclusive_choice": 0,
                    "activation": "automatic",
                    **baseline,
                },
                {
                    "name": f"{name} — Objective re-roll",
                    "description": normalized,
                    "is_exclusive_choice": 0,
                    "activation": "automatic",
                    **upgrade,
                },
            ]

        baseline_hit = re.search(
            r"re-roll a Hit roll of 1\.$", sentences[0], re.IGNORECASE
        )
        objective_wound = re.fullmatch(
            r"If the target is within range of (?:an |one or more )?objective markers?, "
            r"re-roll a Wound roll of 1 as well\.",
            sentences[1],
            re.IGNORECASE,
        )
        if baseline_hit and objective_wound:
            baseline = combat_preset(sentences[0], allow_bearer_defenses)
            if not baseline:
                return None
            upgrade = {
                **baseline,
                "reroll_hit_ones": 0,
                "hit_reroll_role": None,
                "hit_reroll_subject": None,
                "reroll_wound_ones": 1,
                "wound_reroll_role": baseline["hit_reroll_role"],
                "wound_reroll_subject": baseline["hit_reroll_subject"],
                "requires_target_on_objective": True,
            }
            baseline["requires_target_on_objective"] = False
            return [
                {
                    "name": f"{name} — Base re-roll",
                    "description": normalized,
                    "is_exclusive_choice": 0,
                    "activation": "automatic",
                    **baseline,
                },
                {
                    "name": f"{name} — Objective re-roll",
                    "description": normalized,
                    "is_exclusive_choice": 0,
                    "activation": "automatic",
                    **upgrade,
                },
            ]

        if name == "Aggressor Guardian":
            parsed: list[dict[str, object]] = []
            for suffix, sentence, source_required, target_required in (
                ("Defence", sentences[0], True, False),
                ("Offence", sentences[1], False, True),
            ):
                effects = combat_preset(sentence, allow_bearer_defenses)
                if not effects:
                    return None
                effects["requires_source_on_objective"] = source_required
                effects["requires_target_on_objective"] = target_required
                parsed.append(
                    {
                        "name": f"{name} — {suffix}",
                        "description": normalized,
                        "is_exclusive_choice": 0,
                        "activation": "automatic",
                        **effects,
                    }
                )
            return parsed

    effects = combat_preset(normalized, allow_bearer_defenses)
    if not effects:
        return None
    if re.fullmatch(
        r"Each time (?:this model|a model in this unit) makes a ranged attack "
        r"that targets (?:an enemy |a )?unit (?:(?:that )?is )?within range of "
        r"(?:an |one or more )?objective markers?, that attack has the "
        r"\[IGNORES COVER\] ability\.",
        normalized,
        re.IGNORECASE,
    ) or re.fullmatch(
        r"Each time a model in this unit makes a ranged attack that targets an "
        r"enemy unit within range of an objective marker, you can re-roll the Wound roll\.",
        normalized,
        re.IGNORECASE,
    ):
        effects["requires_target_on_objective"] = True
        return [
            {
                "name": name,
                "description": normalized,
                "is_exclusive_choice": 0,
                "activation": "automatic",
                **effects,
            }
        ]
    return None


def combat_battle_shock_requirements(text: str) -> tuple[bool, bool]:
    normalized = plain_text(text).strip()
    target_battle_shocked = bool(
        re.fullmatch(
            r"(?:At the start of the Fight phase, each enemy unit within Engagement Range "
            r"of one or more units with this ability must take a Battle-shock test\. )?"
            r"Each time (?:this model|a model in this unit) makes an? (?:melee )?attack "
            r"that targets (?:(?:an enemy |a )?unit that is Battle-shocked|a Battle-shocked unit), "
            r"(?:add 1 to the (?:Hit|Wound) roll|you can re-roll the (?:Hit|Wound) roll)\.",
            normalized,
            re.IGNORECASE,
        )
    )
    attacker_not_battle_shocked = bool(
        re.fullmatch(
            r"Each time this model makes an? (?:melee )?attack, unless this model(?:’s|'s) "
            r"unit is Battle-shocked, you can re-roll the (?:Hit|Wound) roll\.",
            normalized,
            re.IGNORECASE,
        )
    )
    return target_battle_shocked, attacker_not_battle_shocked


def combat_target_strength_requirement(text: str) -> str | None:
    normalized = plain_text(text).strip()
    match = re.fullmatch(
        r"Each time (?:this model|a model in this unit) makes an? "
        r"(?:(?:ranged|melee) )?attack that targets (?:an enemy |a )?unit "
        r"(?:that is )?(not )?Below Half-strength, "
        r"(?:add 1 to the (?:Hit|Wound) roll(?: and add 1 to the (?:Hit|Wound) roll)?|"
        r"you can re-roll the (?:Hit|Wound) roll(?: and you can re-roll the "
        r"(?:Hit|Wound) roll)?)\.",
        normalized,
        re.IGNORECASE,
    )
    if not match:
        return None
    return "not_below_half" if match.group(1) else "below_half"


def combat_effect_application(text: str, effect_start: int) -> tuple[str, str]:
    lowered = text.casefold()
    prefix = lowered[:effect_start]
    sentence_start = max(prefix.rfind(". "), prefix.rfind("; "))
    context = prefix[0 if sentence_start < 0 else sentence_start + 2 :]
    window = prefix[max(0, effect_start - 700) :]

    defensive = (
        r"(?:an |the )?attacks? (?:that )?(?:targets?|is made against|are made against) "
        r"(?:this|the bearer(?:’s|'s)|the bearer) (?:model|unit)(?![’'])\b|"
        r"(?:ranged |melee )?attack targets? the bearer|"
        r"attacks? targets? this model(?:’s|'s) unit|"
        r"attacks? (?:is |are )?allocated to (?:this|a model in this) (?:model|unit)"
    )
    if re.search(defensive, context):
        return "target", "enemy_unit"
    if "leading a unit" in window and re.search(
        r"attacks? (?:that )?targets? that unit", context
    ):
        return "target", "enemy_unit"
    if re.search(
        r"enemy unit[^.;]{0,180}targets? this (?:model|unit)|"
        r"model makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack that targets? "
        r"this model(?![’'])\b",
        context,
    ):
        return "target", "enemy_unit"
    if re.search(
        r"(?:that|the selected) (?:[a-z0-9-]+ )?(?:model|unit)[^.;]{0,120}"
        r"makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack",
        context,
    ):
        if "leading a unit" in window:
            return "attacker", "led_unit"
        if re.search(r"this (?:model|unit)(?:’s|'s) unit", window):
            return "attacker", "self"
        friendly_at = max(window.rfind("friendly "), window.rfind("your army"))
        enemy_at = max(window.rfind("enemy "), window.rfind("opponent"))
        if enemy_at > friendly_at:
            return "target", "enemy_unit"
        if friendly_at >= 0:
            return "attacker", "friendly_unit"
    if re.search(
        r"friendly[^.;]{0,180}(?:model|unit)[^.;]{0,100}"
        r"makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack",
        context,
    ):
        return "attacker", "friendly_unit"
    if re.search(
        r"(?:model in that unit|that unit)[^.;]{0,100}"
        r"makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack",
        context,
    ):
        if "leading a unit" in window:
            return "attacker", "led_unit"
        if re.search(r"this (?:model|unit)(?:’s|'s) unit", window):
            return "attacker", "self"
        friendly_at = max(window.rfind("friendly "), window.rfind("your army"))
        enemy_at = max(window.rfind("enemy "), window.rfind("opponent"))
        if enemy_at > friendly_at:
            return "target", "enemy_unit"
        if friendly_at >= 0:
            return "attacker", "friendly_unit"
    if re.search(
        r"(?:model in this unit|this (?:model|unit)|model with this ability|"
        r"model in the bearer(?:’s|'s) unit|bearer(?:’s|'s) unit)[^.;]{0,140}"
        r"makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack",
        context,
    ):
        return "attacker", "self"
    if re.search(
        r"(?:weapons? equipped by models? in this unit|weapons? equipped by this model|"
        r"this model(?:’s|'s) [^.;]{0,80}weapons?|(?:melee|ranged) weapons? "
        r"(?:it|this model) is equipped with|bearer(?:’s|'s) (?:melee|ranged)? ?weapons?)",
        context,
    ):
        return "attacker", "self"
    if re.search(r"weapons? equipped by models? in that unit", context):
        if "leading a unit" in window:
            return "attacker", "led_unit"
        friendly_at = max(window.rfind("friendly "), window.rfind("your army"))
        enemy_at = max(window.rfind("enemy "), window.rfind("opponent"))
        if enemy_at > friendly_at:
            return "target", "enemy_unit"
        return "attacker", "friendly_unit"
    if re.search(r"friendly[^.;]{0,180}(?:weapons?|attacks?)[^.;]{0,120}", context):
        return "attacker", "friendly_unit"
    if re.search(
        r"model in this unit targets? [^.;]{0,100} with (?:an? )?(?:melee|ranged|psychic) attack",
        context,
    ):
        return "attacker", "self"
    if re.search(
        r"(?:attack (?:made|is made) by a model in this unit|"
        r"attack made by this (?:model|unit)|the bearer makes? )",
        context,
    ):
        return "attacker", "self"
    if re.search(r"attack is made by a model in (?:a|their) [^.;]{0,80} unit", context):
        return "attacker", "friendly_unit"
    if re.search(
        r"model that disembarked from this [^.;]{0,80}makes? "
        r"(?:an? )?(?:(?:melee|ranged|psychic) )?attack",
        context,
    ):
        return "attacker", "friendly_unit"
    if (
        "selected as the target of ranged attacks" in window
        and "such an attack is made" in context
    ):
        return "attacker", "friendly_unit"
    if re.search(
        r"(?:model|unit) affected by this ability[^.;]{0,120}"
        r"makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack",
        context,
    ):
        return "attacker", "affected_unit"
    if "model is affected by this ability" in window and re.search(
        r"that model[^.;]{0,100}makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack",
        context,
    ):
        return "attacker", "affected_unit"
    if re.search(
        r"(?:friendly|model from your army)[^.;]{0,220}"
        r"makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack",
        context,
    ):
        return "attacker", "friendly_unit"
    if re.search(
        r"(?:enemy (?:[a-z0-9-]+ )?(?:model|unit)|opponent(?:’s|'s) unit) "
        r"makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack|"
        r"model in (?:that|the selected) enemy unit[^.;]{0,100}"
        r"makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack",
        context,
    ):
        return "target", "enemy_unit"
    if re.search(
        r"(?:each time|whenever)[^.;]{0,220}"
        r"makes? (?:an? )?(?:(?:melee|ranged|psychic) )?attack",
        context,
    ):
        return "either", "unknown"
    previous_effects = list(
        re.finditer(
            r"\b(?:add|subtract) 1 (?:to|from) the (?:hit|wound) roll\b|"
            r"\bre-roll (?:a|the) (?:hit|wound) roll(?: of 1)?\b",
            lowered[: sentence_start + 1],
        )
    )
    if previous_effects:
        return combat_effect_application(text, previous_effects[-1].start())
    return "either", "unknown"


def dice_effect_value(value: str) -> tuple[int, int, int] | None:
    match = re.fullmatch(
        r"\s*(?:(\d*)D(\d+)|0)(?:\s*\+\s*(\d+))?\s*", value, re.IGNORECASE
    )
    if match:
        if match.group(2):
            return (
                int(match.group(1) or "1"),
                int(match.group(2)),
                int(match.group(3) or "0"),
            )
        return 0, 0, int(match.group(3) or "0")
    if re.fullmatch(r"\s*\d+\s*", value):
        return 0, 0, int(value)
    return None


def keyword_is_granted(text: str, match: re.Match[str]) -> bool:
    lowered = text.casefold()
    before = lowered[max(0, match.start() - 240) : match.start()]
    if re.search(
        r"(?:have|has|gain|gains)\s+(?:the\s+)?"
        r"(?:\[[^\]]+\]\s*(?:,\s*|\band\s+)*)*$",
        before,
    ):
        return True
    if re.search(
        r"(?:weapons?|attacks?)[^.;]{0,180}(?:have|has|gain|gains)[^.;]{0,140}"
        r"\band (?:the )?$",
        before,
    ):
        return True
    bracket_count = len(re.findall(r"\[[^\]]+\]", text))
    return bracket_count == 1 and bool(
        re.search(
            r"(?:select|choose) one of the following|gain the ability below", lowered
        )
    )


def combat_additional_effects(
    text: str, allow_bearer_defenses: bool = False
) -> list[dict[str, int | str]]:
    effects: list[dict[str, int | str]] = []
    normalized = plain_text(text).strip()
    for match in re.finditer(
        r"improve the Ballistic Skill characteristic of (?:that|this) attack by 1",
        normalized,
        re.IGNORECASE,
    ):
        role, subject = combat_effect_application(normalized, match.start())
        effects.append(
            {
                "type": "skill_modifier",
                "value": 1,
                "dice_count": 0,
                "dice_sides": 0,
                "role": role,
                "subject": subject,
            }
        )
    if combat_is_core_waaagh(normalized):
        effects.extend(
            (
                {
                    "type": "attacks_modifier",
                    "value": 1,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "attacker",
                    "subject": "self",
                },
                {
                    "type": "strength_modifier",
                    "value": 1,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "attacker",
                    "subject": "self",
                },
                {
                    "type": "invulnerable_save",
                    "value": 5,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "target",
                    "subject": "self",
                },
            )
        )
    if re.fullmatch(
        r"While the Waaagh! is active for your army, add 4 to the Attacks "
        r"characteristic of this model[’']s melee weapons\.",
        normalized,
        re.IGNORECASE,
    ):
        effects.append(
            {
                "type": "attacks_modifier",
                "value": 4,
                "dice_count": 0,
                "dice_sides": 0,
                "role": "attacker",
                "subject": "self",
            }
        )
    if re.fullmatch(
        r"While the Waaagh! is active for your army, this model[’']s [’']uge choppa "
        r"has a Damage characteristic of 3\.",
        normalized,
        re.IGNORECASE,
    ):
        effects.append(
            {
                "type": "damage_replacement",
                "value": 3,
                "dice_count": 0,
                "dice_sides": 0,
                "weapon_name": "’uge choppa",
                "role": "attacker",
                "subject": "self",
            }
        )
    if re.fullmatch(
        r"While this model is gaining the benefits of the Waaagh! ability, it has a "
        r"4\+ invulnerable save and an Objective Control characteristic of 5\.",
        normalized,
        re.IGNORECASE,
    ):
        effects.append(
            {
                "type": "invulnerable_save",
                "value": 4,
                "dice_count": 0,
                "dice_sides": 0,
                "role": "target",
                "subject": "self",
            }
        )
    keyword_patterns = (
        ("lethal_hits", r"\[LETHAL HITS\]", None),
        ("devastating_wounds", r"\[DEVASTATING WOUNDS\]", None),
        ("twin_linked", r"\[TWIN-LINKED\]", None),
        ("ignores_cover", r"\[IGNORES COVER\]", None),
        ("lance", r"\[LANCE\]", None),
        ("heavy", r"\[HEAVY\]", None),
        ("sustained_hits", r"\[SUSTAINED HITS\s+([^\]]+)\]", 1),
        ("rapid_fire", r"\[RAPID FIRE\s+([^\]]+)\]", 1),
    )
    for effect_type, pattern, value_group in keyword_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match or not keyword_is_granted(text, match):
            continue
        dice_count, dice_sides, value = (0, 0, 1)
        if value_group is not None:
            parsed = dice_effect_value(match.group(value_group))
            if not parsed:
                continue
            dice_count, dice_sides, value = parsed
        role, subject = combat_effect_application(text, match.start())
        if subject == "unknown":
            role, subject = combat_effect_application(text, len(text))
        effects.append(
            {
                "type": effect_type,
                "value": value,
                "dice_count": dice_count,
                "dice_sides": dice_sides,
                "role": role,
                "subject": subject,
            }
        )

    ap_pattern = re.compile(
        r"\b(improve|worsen) the (?:Armour|Armor) Penetration characteristics? of "
        r"(?:that|the) attack by (\d+)\b|"
        r"\b(improve|worsen) the (?:Armour|Armor) Penetration characteristics? of "
        r"(?:those )?(?:weapons|attacks)[^.;]{0,100}? by (\d+)\b",
        re.IGNORECASE,
    )
    seen_ap: set[tuple[str, str]] = set()
    for match in ap_pattern.finditer(text):
        direction = match.group(1) or match.group(3)
        amount = int(match.group(2) or match.group(4))
        role, subject = combat_effect_application(text, match.start())
        identity = (role, subject)
        if identity in seen_ap:
            continue
        seen_ap.add(identity)
        effects.append(
            {
                "type": "ap_modifier",
                "value": amount if direction.casefold() == "improve" else -amount,
                "dice_count": 0,
                "dice_sides": 0,
                "role": role,
                "subject": subject,
            }
        )

    for roll, effect_type in (("Hit", "critical_hits"), ("Wound", "critical_wounds")):
        threshold = re.search(
            rf"(?:an? )?(?:successful )?unmodified {roll} roll of (\d)\+ "
            rf"scores a Critical {roll}|"
            rf"a Critical {roll} is scored on a (?:successful )?unmodified {roll} roll of (\d)\+",
            text,
            re.IGNORECASE,
        )
        if threshold:
            role, subject = combat_effect_application(text, threshold.start())
            effects.append(
                {
                    "type": effect_type,
                    "value": int(threshold.group(1) or threshold.group(2)),
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": role,
                    "subject": subject,
                }
            )

    characteristic_list = (
        r"((?:Attacks|Strength|Damage)"
        r"(?:(?:\s*,\s*|\s+and\s+)(?:Attacks|Strength|Damage))*)"
    )
    characteristic_patterns = (
        re.compile(
            rf"\b(add|subtract) (\d+) (?:to|from) the {characteristic_list} "
            r"characteristics? of ([^.;]+)",
            re.IGNORECASE,
        ),
        re.compile(
            rf"\b(improve|worsen) the {characteristic_list} characteristics? of "
            r"([^.;]+?) by (\d+)\b",
            re.IGNORECASE,
        ),
    )
    characteristic_types = {
        "attacks": "attacks_modifier",
        "strength": "strength_modifier",
        "damage": "damage_modifier",
    }
    random_characteristic_pattern = re.compile(
        rf"\badd (?:(\d+))?D(\d+)(?:\+(\d+))? to the {characteristic_list} "
        r"characteristics? of ([^.;]+)",
        re.IGNORECASE,
    )
    for match in random_characteristic_pattern.finditer(text):
        dice_count_text, dice_sides_text, bonus_text, names, subject_text = (
            match.groups()
        )
        lowered_subject = subject_text.casefold().strip()
        generic_subject = bool(
            re.match(
                r"(?:(?:melee|ranged|psychic) )?weapons equipped by "
                r"(?:this model|models? in (?:this|that|the|the bearer’s|the bearer's) unit)",
                lowered_subject,
            )
            or re.match(
                r"(?:this|that|the|the bearer’s|the bearer's) unit(?:’s|'s) "
                r"(?:melee|ranged|psychic) weapons\b",
                lowered_subject,
            )
        )
        if not generic_subject:
            continue
        role, subject = combat_effect_application(text, match.start())
        if subject == "unknown":
            role, subject = combat_effect_application(text, match.end())
        if subject == "unknown":
            continue
        required_attack_keyword = (
            "psychic" if re.match(r"psychic weapons\b", lowered_subject) else None
        )
        for characteristic in re.findall(
            r"Attacks|Strength|Damage", names, re.IGNORECASE
        ):
            effects.append(
                {
                    "type": characteristic_types[characteristic.casefold()],
                    "value": int(bonus_text or 0),
                    "dice_count": int(dice_count_text or 1),
                    "dice_sides": int(dice_sides_text),
                    **(
                        {"required_attack_keyword": required_attack_keyword}
                        if required_attack_keyword
                        else {}
                    ),
                    "role": role,
                    "subject": subject,
                }
            )
    characteristic_effects: dict[tuple[str, str, str], dict[str, int | str] | None] = {}
    characteristic_values: dict[str, set[int]] = {}
    for pattern_index, pattern in enumerate(characteristic_patterns):
        for match in pattern.finditer(text):
            if pattern_index == 0:
                direction, amount_text, names, subject_text = match.groups()
            else:
                direction, names, subject_text, amount_text = match.groups()
            lowered_subject = subject_text.casefold().strip()
            generic_subject = bool(
                re.match(r"(?:that|the) attack\b", lowered_subject)
                or re.match(
                    r"(?:(?:melee|ranged) )?weapons equipped by "
                    r"(?:this model|models? in (?:this|that|the|the bearer’s|the bearer's) unit)",
                    lowered_subject,
                )
                or re.match(
                    r"(?:this|that|the|the bearer’s|the bearer's) unit(?:’s|'s) "
                    r"(?:melee|ranged) weapons\b",
                    lowered_subject,
                )
            )
            if not generic_subject:
                continue
            sentence_start = max(
                text.rfind(".", 0, match.start()),
                text.rfind(";", 0, match.start()),
            )
            clause_prefix = text[sentence_start + 1 : match.start()]
            if re.search(
                r"makes? (?:an? )?(?:(?:melee|ranged) )?attack with "
                r"(?:its|their|a|the) (?!melee\b|ranged\b|weapon\b)[^,.;]{1,100} weapon",
                clause_prefix,
                re.IGNORECASE,
            ):
                continue
            amount = int(amount_text)
            if direction.casefold() in {"subtract", "worsen"}:
                amount = -amount
            parsed_characteristics = re.findall(
                r"Attacks|Strength|Damage", names, re.IGNORECASE
            )
            for characteristic in parsed_characteristics:
                effect_type = characteristic_types[characteristic.casefold()]
                characteristic_values.setdefault(effect_type, set()).add(amount)
            role, subject = combat_effect_application(text, match.start())
            if subject == "unknown":
                role, subject = combat_effect_application(text, match.end())
            if subject == "unknown":
                continue
            for characteristic in parsed_characteristics:
                effect_type = characteristic_types[characteristic.casefold()]
                if (
                    effect_type == "damage_modifier"
                    and amount < 0
                    and re.search(
                        r"attack[^.;]{0,180}\b(?:allocated to|made against)\b",
                        clause_prefix,
                        re.IGNORECASE,
                    )
                ):
                    continue
                identity = (effect_type, role, subject)
                existing = characteristic_effects.get(identity)
                if identity in characteristic_effects and (
                    existing is None or existing["value"] != amount
                ):
                    characteristic_effects[identity] = None
                elif identity not in characteristic_effects:
                    characteristic_effects[identity] = {
                        "type": effect_type,
                        "value": amount,
                        "dice_count": 0,
                        "dice_sides": 0,
                        "role": role,
                        "subject": subject,
                    }
    effects.extend(
        effect
        for effect in characteristic_effects.values()
        if effect is not None and len(characteristic_values[effect["type"]]) == 1
    )

    nearby_enemy_scaling = re.fullmatch(
        r"Each time this model fights, until that fight is resolved, add (\d+) to the "
        r"Attacks characteristic of this model[’']s (.+?) for every (\d+) enemy models "
        r"within \d+[\"”] of this model\.",
        plain_text(text).strip(),
        re.IGNORECASE,
    )
    source_unit_scaling = re.fullmatch(
        r"While this model is leading a unit, add (\d+) to the Attacks characteristic "
        r"of this model[’']s (.+?) weapon for every (\d+) models in that unit "
        r"\(rounding down\), but while that unit contains \d+ or more models, that "
        r"weapon has the \[HAZARDOUS\] ability\.",
        plain_text(text).strip(),
        re.IGNORECASE,
    )
    scaling = nearby_enemy_scaling or source_unit_scaling
    if scaling:
        effects.append(
            {
                "type": "attacks_modifier",
                "value": int(scaling.group(1)),
                "dice_count": 0,
                "dice_sides": 0,
                "models_per_increment": int(scaling.group(3)),
                "model_count_source": (
                    "nearby_enemy" if nearby_enemy_scaling else "source_unit"
                ),
                "weapon_name": scaling.group(2).strip(),
                "role": "attacker",
                "subject": "self",
            }
        )

    multiplier_pattern = re.compile(
        r"\bdouble the (Attacks|Strength|Damage) characteristic of ([^.;]+)",
        re.IGNORECASE,
    )
    multiplier_types = {
        "attacks": "attacks_multiplier",
        "strength": "strength_multiplier",
        "damage": "damage_multiplier",
    }
    for match in multiplier_pattern.finditer(text):
        lowered_subject = match.group(2).casefold().strip()
        generic_subject = bool(
            re.match(
                r"(?:(?:melee|ranged) )?weapons equipped by "
                r"(?:this model|models? in (?:this|that|the|the bearer’s|the bearer's) unit)",
                lowered_subject,
            )
            or re.match(
                r"(?:this|that|the|the bearer’s|the bearer's) unit(?:’s|'s) "
                r"(?:melee|ranged) weapons\b",
                lowered_subject,
            )
        )
        if not generic_subject:
            continue
        role, subject = combat_effect_application(text, match.start())
        if subject == "unknown":
            role, subject = combat_effect_application(text, match.end())
        if subject == "unknown":
            continue
        effects.append(
            {
                "type": multiplier_types[match.group(1).casefold()],
                "value": 2,
                "dice_count": 0,
                "dice_sides": 0,
                "role": role,
                "subject": subject,
            }
        )

    replacement_pattern = re.compile(
        r"\bchange the (Attacks|Strength) characteristic of ([^.;]+?) to (\d+)\b",
        re.IGNORECASE,
    )
    for match in replacement_pattern.finditer(text):
        characteristic = match.group(1).casefold()
        affected = match.group(2).strip()
        weapon_name = None
        if affected.casefold() == "this weapon":
            continue
        if not re.fullmatch(
            r"(?:melee|ranged) weapons equipped by "
            r"(?:this model|models? in (?:this|that|the) unit)",
            affected,
            re.IGNORECASE,
        ):
            named = re.fullmatch(r"this model[’']s (.+)", affected, re.IGNORECASE)
            if not named:
                continue
            weapon_name = named.group(1).strip()
        effects.append(
            {
                "type": f"{characteristic}_replacement",
                "value": int(match.group(3)),
                "dice_count": 0,
                "dice_sides": 0,
                "weapon_name": weapon_name,
                "role": "attacker",
                "subject": "self",
            }
        )

    fixed_attacks_pattern = re.compile(
        r"\b((?:melee|ranged) weapons equipped by "
        r"(?:this model|models? in (?:this|that|the) unit)|"
        r"[A-Za-z0-9À-ÖØ-öø-ÿ’' -]{1,80}? equipped by models? in this unit|"
        r"(?:(?:this model|the bearer)[’']s|its) [^,.;]{1,100}?|"
        r"(?:this|that) weapon) (?:has|have) an Attacks characteristic of (\d+)\b",
        re.IGNORECASE,
    )
    fixed_attacks_effects = []
    for match in fixed_attacks_pattern.finditer(text):
        affected = match.group(1).strip()
        lowered_affected = affected.casefold()
        effect = {
            "type": "attacks_replacement",
            "value": int(match.group(2)),
            "dice_count": 0,
            "dice_sides": 0,
            "role": "attacker",
            "subject": "self",
        }
        if re.fullmatch(
            r"(?:melee|ranged) weapons equipped by "
            r"(?:this model|models? in (?:this|that|the) unit)",
            affected,
            re.IGNORECASE,
        ):
            effect["weapon_name"] = None
        elif lowered_affected == "this weapon":
            effect["weapon_ability_name"] = True
        elif lowered_affected == "that weapon":
            prefix = text[max(0, match.start() - 240) : match.start()]
            antecedent = re.search(
                r"\bwith (?:its|their|the) ([^,.;]{1,100}?)(?:,\s*until[^,.;]*)?,?\s*$",
                prefix,
                re.IGNORECASE,
            )
            if not antecedent:
                continue
            effect["weapon_name"] = antecedent.group(1).strip()
        else:
            equipped = re.fullmatch(
                r"(.+?) equipped by models? in this unit", affected, re.IGNORECASE
            )
            if equipped:
                weapon_name = equipped.group(1).strip()
            else:
                named = re.fullmatch(
                    r"(?:(?:this model|the bearer)[’']s|its) (.+)",
                    affected,
                    re.IGNORECASE,
                )
                if not named:
                    continue
                weapon_name = named.group(1).strip()
                weapon_name = re.sub(
                    r"\s+(?:(?:melee|ranged) )?weapon$",
                    "",
                    weapon_name,
                    flags=re.IGNORECASE,
                )
            effect["weapon_name"] = weapon_name
        effects.append(effect)
        fixed_attacks_effects.append(effect)

    sustained_hits_replacement = re.search(
        r"\[SUSTAINED HITS\s+([^\]]+)\] ability instead of the "
        r"\[SUSTAINED HITS\s+[^\]]+\] ability",
        text,
        re.IGNORECASE,
    )
    if sustained_hits_replacement and len(fixed_attacks_effects) == 1:
        parsed = dice_effect_value(sustained_hits_replacement.group(1))
        if parsed:
            dice_count, dice_sides, value = parsed
            replacement = fixed_attacks_effects[0]
            effects.append(
                {
                    "type": "sustained_hits",
                    "value": value,
                    "dice_count": dice_count,
                    "dice_sides": dice_sides,
                    **(
                        {"weapon_name": replacement["weapon_name"]}
                        if "weapon_name" in replacement
                        else {"weapon_ability_name": replacement["weapon_ability_name"]}
                    ),
                    "role": "attacker",
                    "subject": "self",
                }
            )
    damage_replacement_pattern = re.compile(
        r"\beach time an attack is allocated to this model, change the Damage "
        r"characteristic of that attack to (\d+)\b",
        re.IGNORECASE,
    )
    for match in damage_replacement_pattern.finditer(text):
        effects.append(
            {
                "type": "damage_replacement",
                "value": int(match.group(1)),
                "dice_count": 0,
                "dice_sides": 0,
                "role": "target",
                "subject": "self",
            }
        )

    first_failed_save_damage_replacement_pattern = re.compile(
        r"\bonce per (?:turn|phase), the first time a saving throw is failed for "
        r"(this unit|the bearer[’']s unit|a model in the bearer[’']s unit), change the "
        r"Damage characteristic of that attack to (\d+)\b",
        re.IGNORECASE,
    )
    for match in first_failed_save_damage_replacement_pattern.finditer(text):
        subject = "self" if match.group(1).casefold() == "this unit" else "led_unit"
        effects.append(
            {
                "type": "first_failed_save_damage_replacement",
                "value": int(match.group(2)),
                "dice_count": 0,
                "dice_sides": 0,
                "role": "target",
                "subject": subject,
            }
        )

    allocated_attack_damage_replacement_pattern = re.compile(
        r"\b(once|twice) per (?:battle|turn|battle round), "
        r"(?:when an attack is|after an attack has been) allocated to "
        r"(this model|the bearer|a model in this unit)"
        r"(?:, if [^,]+,)?(?:,)? you (?:can )?change the Damage characteristic"
        r"(?: of that attack)? to (\d+)\b",
        re.IGNORECASE,
    )
    for match in allocated_attack_damage_replacement_pattern.finditer(text):
        effects.append(
            {
                "type": "allocated_attack_damage_replacement",
                "value": int(match.group(3)),
                "uses": 2 if match.group(1).casefold() == "twice" else 1,
                "dice_count": 0,
                "dice_sides": 0,
                "role": "target",
                "subject": "self",
            }
        )

    keyword_attacks_replacement_pattern = re.compile(
        r"\beach time you select an? ([A-Z][A-Z0-9 -]+) unit as the target for this weapon, "
        r"until those attacks are resolved, change the Attacks characteristic of this weapon "
        r"to (\d+)\b",
        re.IGNORECASE,
    )
    for match in keyword_attacks_replacement_pattern.finditer(text):
        effects.append(
            {
                "type": "attacks_replacement",
                "value": int(match.group(2)),
                "dice_count": 0,
                "dice_sides": 0,
                "weapon_ability_name": True,
                "required_target_keyword": match.group(1).strip().casefold(),
                "role": "attacker",
                "subject": "self",
            }
        )

    def defensive_subject(subject_text: str, effect_start: int) -> tuple[str, str]:
        subject = subject_text.casefold()
        context = text[max(0, effect_start - 300) : effect_start].casefold()
        if "bearer’s unit" in subject or "bearer's unit" in subject:
            return "target", "led_unit"
        if "that unit" in subject:
            if "leading a unit" in context:
                return "target", "led_unit"
            if "friendly" in context:
                return "target", "friendly_unit"
            if "affected by this ability" in context:
                return "target", "affected_unit"
            return "target", "affected_unit"
        if "that model" in subject:
            if "friendly" in context:
                return "target", "friendly_unit"
            return "target", "affected_unit"
        return "target", "self"

    defensive_subject_pattern = (
        r"((?<![A-Za-z] )(?:all )?models? in "
        r"(?:this|that|the bearer’s|the bearer's) unit|"
        r"(?<!in )(?<!to )(?<!of )(?:this|that) (?:model|unit)"
        + (r"|the bearer" if allow_bearer_defenses else "")
        + r")"
    )
    defensive_patterns = (
        (
            "invulnerable_save",
            re.compile(r"([2-6])\+ invulnerable save", re.IGNORECASE),
        ),
        (
            "feel_no_pain",
            re.compile(r"Feel No Pain ([2-6])\+ ability", re.IGNORECASE),
        ),
        (
            "save_target",
            re.compile(r"Save characteristic of ([2-6])\+", re.IGNORECASE),
        ),
    )
    for effect_type, pattern in defensive_patterns:
        candidates: dict[int, dict[str, int | str]] = {}
        for match in pattern.finditer(text):
            sentence_start = max(
                text.rfind(".", 0, match.start()),
                text.rfind(";", 0, match.start()),
            )
            clause = text[sentence_start + 1 : match.start()]
            subjects = list(
                re.finditer(
                    defensive_subject_pattern + r" (?:has|have)\b",
                    clause,
                    re.IGNORECASE,
                )
            )
            if not subjects:
                continue
            clause_tail = text[match.end() : match.end() + 80]
            required_attack_keyword = None
            if effect_type == "feel_no_pain" and re.match(
                r"\s+against\b", clause_tail, re.IGNORECASE
            ):
                scoped = re.match(
                    r"\s+against Psychic Attacks\.", clause_tail, re.IGNORECASE
                )
                if not scoped:
                    continue
                required_attack_keyword = "psychic"
            value = int(match.group(1))
            source = subjects[-1]
            role, subject = defensive_subject(
                source.group(1), sentence_start + 1 + source.start()
            )
            if subject not in {"self", "led_unit"}:
                continue
            candidates[value] = {
                "type": effect_type,
                "value": value,
                "dice_count": 0,
                "dice_sides": 0,
                **(
                    {"required_attack_keyword": required_attack_keyword}
                    if required_attack_keyword
                    else {}
                ),
                "role": role,
                "subject": subject,
            }
        if len(candidates) == 1:
            effects.append(next(iter(candidates.values())))

    damage_reduction_pattern = re.compile(
        r"each time an attack[^.;]{0,180}?"
        r"subtract (\d+) from (?:the |that attack’s |that attack's )?"
        r"Damage characteristic(?: of that attack)?",
        re.IGNORECASE,
    )
    damage_reductions: dict[int, dict[str, int | str]] = {}
    for match in damage_reduction_pattern.finditer(text):
        context = text[max(0, match.start() - 240) : match.end()].casefold()
        attack_clause = match.group(0).casefold()
        if (
            not re.search(r"\b(?:allocated to|made against)\b", attack_clause)
            or ("bearer" in attack_clause and not allow_bearer_defenses)
            or "excluding" in attack_clause
            or "affected by this ability" in context
        ):
            continue
        value = int(match.group(1))
        damage_reductions[value] = {
            "type": "damage_reduction",
            "value": value,
            "dice_count": 0,
            "dice_sides": 0,
            "role": "target",
            "subject": "enemy_unit",
        }
    if len(damage_reductions) == 1:
        effect = next(iter(damage_reductions.values()))
        if "bearer" in text.casefold():
            effect = {**effect, "subject": "self"}
        effects.append(effect)
    damage_divisor_pattern = re.compile(
        r"each time an attack is allocated to (?:this model|a model in this unit), "
        r"halve the Damage characteristic of that attack\.",
        re.IGNORECASE,
    )
    if damage_divisor_pattern.fullmatch(text.strip()):
        effects.append(
            {
                "type": "damage_divisor",
                "value": 2,
                "dice_count": 0,
                "dice_sides": 0,
                "role": "target",
                "subject": "self",
            }
        )
    return [effect for effect in effects if effect["subject"] != "unknown"]


def combat_preset(
    description: str, allow_bearer_defenses: bool = False
) -> dict[str, object] | None:
    text = plain_text(description)
    lowered = text.casefold()
    effects: dict[str, object] = {
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
            role, subject = combat_effect_application(text, modifier.start())
            effects[f"{field}_role"] = role
            effects[f"{field}_subject"] = subject
        rerolls = list(
            re.finditer(rf"\bre-roll (?:a|the) {roll} roll(?: of 1)?\b", lowered)
        )
        if rerolls:
            first = rerolls[0].group(0)
            effects[f"reroll_{roll}_ones"] = int(first.endswith("of 1"))
            effects[f"reroll_{roll}s"] = int(not first.endswith("of 1"))
            role, subject = combat_effect_application(text, rerolls[0].start())
            effects[f"{roll}_reroll_role"] = role
            effects[f"{roll}_reroll_subject"] = subject
    effects["additional_effects"] = combat_additional_effects(
        text, allow_bearer_defenses
    )
    if not any(value for key, value in effects.items() if key != "weapon_scope"):
        return None
    effects["weapon_scope"] = combat_weapon_scope(text)
    effects["maximum_target_distance"] = combat_maximum_target_distance(text, effects)
    effects["requires_attacker_charge"] = combat_requires_attacker_charge(text)
    effects["requires_attacker_stationary"] = combat_requires_attacker_stationary(text)
    effects["requires_attached_unit"] = combat_requires_attached_unit(text)
    effects["requires_waaagh_active"] = combat_requires_waaagh_active(text)
    effects["requires_oath_target"] = combat_is_oath_of_moment(text)
    effects["requires_oath_wound_bonus"] = False
    effects["requires_source_on_objective"] = False
    effects["requires_target_on_objective"] = False
    effects["requires_source_controls_objective"] = False
    effects["requires_target_on_objective_not_controlled_by_source"] = False
    effects["requires_source_on_selected_objective"] = False
    effects["requires_target_on_source_selected_objective"] = False
    effects["requires_source_not_battle_shocked"] = False
    effects["requires_source_guided_against_target"] = False
    effects["requires_target_spotted"] = False
    effects["requires_target_spotted_by_markerlight_observer"] = False
    (
        effects["requires_target_battle_shocked"],
        effects["requires_attacker_not_battle_shocked"],
    ) = combat_battle_shock_requirements(text)
    effects["required_target_strength_state"] = combat_target_strength_requirement(text)
    return effects


def combat_preset_activation(description: str, preset: dict[str, object]) -> str:
    additional = preset["additional_effects"]
    if any(
        preset.get(field)
        for field in (
            "requires_attacker_charge",
            "requires_attacker_stationary",
            "requires_attached_unit",
            "requires_waaagh_active",
            "requires_oath_target",
            "requires_oath_wound_bonus",
            "requires_source_on_objective",
            "requires_target_on_objective",
            "requires_source_controls_objective",
            "requires_target_on_objective_not_controlled_by_source",
            "requires_source_on_selected_objective",
            "requires_target_on_source_selected_objective",
            "requires_target_battle_shocked",
            "requires_attacker_not_battle_shocked",
            "requires_source_not_battle_shocked",
            "requires_source_guided_against_target",
            "requires_target_spotted",
            "requires_target_spotted_by_markerlight_observer",
            "required_target_strength_state",
        )
    ):
        return "automatic"
    if any(effect.get("model_count_source") for effect in additional):
        return "automatic"
    if (
        len(additional) == 1
        and additional[0].get("required_target_keyword")
        and re.fullmatch(
            r"each time you select an? [A-Z][A-Z0-9 -]+ unit as the target for this weapon, "
            r"until those attacks are resolved, change the Attacks characteristic of this "
            r"weapon to \d+\.",
            plain_text(description).strip(),
            re.IGNORECASE,
        )
    ):
        return "automatic"
    if (
        len(additional) == 1
        and additional[0].get("required_attack_keyword") == "psychic"
        and additional[0]["type"] == "feel_no_pain"
        and additional[0]["subject"] == "self"
        and re.fullmatch(
            r"(?:this model|this unit|models in this unit) (?:has|have) the Feel No Pain "
            r"[2-6]\+ ability against Psychic Attacks\.",
            plain_text(description).strip(),
            re.IGNORECASE,
        )
    ):
        return "automatic"
    if not additional or any(
        preset.get(field)
        for field in (
            "hit_modifier",
            "wound_modifier",
            "reroll_hits",
            "reroll_hit_ones",
            "reroll_wounds",
            "reroll_wound_ones",
        )
    ):
        return "situational"
    if any(
        effect["type"]
        not in {
            "save_target",
            "invulnerable_save",
            "feel_no_pain",
            "damage_reduction",
            "damage_divisor",
            "damage_replacement",
            "first_failed_save_damage_replacement",
            "allocated_attack_damage_replacement",
        }
        or effect["role"] != "target"
        or effect["subject"] not in {"self", "enemy_unit"}
        for effect in additional
    ):
        return "situational"

    text = plain_text(description).strip()
    lowered = text.casefold()
    if re.search(
        r"\b(?:while|if|once per|until|at the start|provided|unless|within|against|excluding|bearer)\b",
        lowered,
    ):
        return "situational"
    if lowered.startswith(
        ("this model has ", "this unit has ", "models in this unit have ")
    ):
        return "inherent"
    if re.fullmatch(
        r"Each time an attack is allocated to "
        r"(?:this model|a model in this unit|this FORTIFICATION\s*), subtract \d+ from "
        r"(?:(?:the|that) attack(?:’s|'s) Damage characteristic|"
        r"the Damage characteristic of that attack)\.",
        text,
        re.IGNORECASE,
    ):
        return "inherent"
    if re.fullmatch(
        r"Each time an attack is allocated to "
        r"(?:this model|a model in this unit), halve the Damage characteristic of that attack\.",
        text,
        re.IGNORECASE,
    ):
        return "inherent"
    return "situational"


def combat_guidance_presets(
    name: str, description: str, allow_bearer_defenses: bool = False
) -> list[dict[str, object]]:
    text = plain_text(description).strip()
    effects = combat_preset(text, allow_bearer_defenses)
    if not effects:
        return []

    if name == "For the Greater Good" and all(
        phrase.casefold() in text.casefold()
        for phrase in (
            "Units from your army with the For the Greater Good ability (excluding Observer units) are Guided units while targeting one or more Spotted units.",
            "each time a model from your army in a Guided unit makes an attack that targets a Spotted unit, improve the Ballistic Skill characteristic of that attack by 1",
            "if the Spotted unit was marked by an Observer unit that has the Markerlight keyword, that attack has the [IGNORES COVER] ability.",
        )
    ):
        skill_effects = [
            effect
            for effect in effects["additional_effects"]
            if effect["type"] == "skill_modifier"
        ]
        cover_effects = [
            effect
            for effect in effects["additional_effects"]
            if effect["type"] == "ignores_cover"
        ]
        if len(skill_effects) != 1 or len(cover_effects) != 1:
            return []
        return [
            {
                "name": f"{name} — Guided Ballistic Skill",
                "description": text,
                "is_exclusive_choice": 0,
                "activation": "automatic",
                **effects,
                "additional_effects": skill_effects,
                "requires_source_guided_against_target": True,
            },
            {
                "name": f"{name} — Markerlight Ignores Cover",
                "description": text,
                "is_exclusive_choice": 0,
                "activation": "automatic",
                **effects,
                "additional_effects": cover_effects,
                "requires_source_guided_against_target": True,
                "requires_target_spotted_by_markerlight_observer": True,
            },
        ]

    exact_requirements = {
        "Coordinated Strike": (
            r"While this model is a Guided unit, each time it makes an attack that targets "
            r"its Spotted unit, re-roll a Hit roll of 1\.",
            {"requires_source_guided_against_target": True},
        ),
        "Precise Targeting": (
            r"Each time a model in this unit makes an attack that targets a Spotted unit, "
            r"you can re-roll the Hit roll\.",
            {"requires_target_spotted": True},
        ),
        "Target Uploaded": (
            r"Each time a model in this unit makes an attack that targets their Spotted unit, "
            r"improve the Ballistic Skill characteristic of that attack by 1 and that attack "
            r"has the \[IGNORES COVER\] ability\.",
            {"requires_target_spotted": True},
        ),
    }
    exact = exact_requirements.get(name)
    if exact and re.fullmatch(exact[0], text, re.IGNORECASE):
        return [
            {
                "name": name,
                "description": text,
                "is_exclusive_choice": 0,
                "activation": "automatic",
                **effects,
                **exact[1],
            }
        ]
    return []


def combat_presets(
    name: str, description: str, allow_bearer_defenses: bool = False
) -> list[dict[str, object]]:
    text = plain_text(description)
    guidance_presets = combat_guidance_presets(name, text, allow_bearer_defenses)
    if guidance_presets:
        return guidance_presets
    if combat_is_oath_of_moment(text):
        effects = combat_preset(text, allow_bearer_defenses)
        if not effects:
            return []
        hit_reroll = {
            **effects,
            "wound_modifier": 0,
            "wound_modifier_role": None,
            "wound_modifier_subject": None,
        }
        wound_bonus = {
            **effects,
            "reroll_hits": 0,
            "hit_reroll_role": None,
            "hit_reroll_subject": None,
            "requires_oath_wound_bonus": True,
        }
        return [
            {
                "name": f"{name} — Hit re-roll",
                "description": text,
                "is_exclusive_choice": 0,
                "activation": "automatic",
                **hit_reroll,
            },
            {
                "name": f"{name} — Codex Wound bonus",
                "description": text,
                "is_exclusive_choice": 0,
                "activation": "automatic",
                **wound_bonus,
            },
        ]
    if combat_is_core_waaagh(text):
        effects = combat_preset(text, allow_bearer_defenses)
        if not effects:
            return []
        offensive = {
            **effects,
            "additional_effects": effects["additional_effects"][:2],
            "weapon_scope": "Melee",
        }
        defensive = {
            **effects,
            "additional_effects": effects["additional_effects"][2:],
            "weapon_scope": "Any",
        }
        return [
            {
                "name": f"{name} — Melee weapons",
                "description": text,
                "is_exclusive_choice": 0,
                "activation": "automatic",
                **offensive,
            },
            {
                "name": f"{name} — Invulnerable save",
                "description": text,
                "is_exclusive_choice": 0,
                "activation": "automatic",
                **defensive,
            },
        ]
    objective_presets = combat_direct_objective_presets(
        name, text, allow_bearer_defenses
    )
    if objective_presets:
        return objective_presets
    has_choice = bool(
        re.search(
            r"\b(?:select|choose) one of (?:the )?[^.]{0,160}(?:following|below)",
            text,
            re.IGNORECASE,
        )
    )
    choice = re.search(
        r"\b(?:select|choose) one of the following\b[^:]{0,160}:\s*",
        text,
        re.IGNORECASE,
    )
    candidates: list[tuple[str, str]] = []
    if choice:
        tail = text[choice.end() :]
        modes = list(
            re.finditer(
                r"(?:^|(?<=[.:]))\s*([A-Z][A-Za-z0-9À-ÖØ-öø-ÿ’'&(), -]{1,80}):\s*",
                tail,
            )
        )
        if len(modes) >= 2:
            introduction = text[: choice.end()]
            for index, mode in enumerate(modes):
                body_end = (
                    modes[index + 1].start() if index + 1 < len(modes) else len(tail)
                )
                mode_name = mode.group(1).strip()
                mode_text = (
                    f"{introduction}{mode_name}: {tail[mode.end() : body_end].strip()}"
                )
                candidates.append((mode_name, mode_text))

        if not candidates:
            tail = text[choice.end() :]
            until = re.search(r"\bUntil\b", tail, re.IGNORECASE)
            option_text = tail[: until.start()] if until else tail
            remainder = tail[until.start() :] if until else ""
            supported = re.findall(
                r"\[(?:LETHAL HITS|DEVASTATING WOUNDS|TWIN-LINKED|IGNORES COVER|LANCE|HEAVY|"
                r"SUSTAINED HITS\s+[^\]]+|RAPID FIRE\s+[^\]]+)\]",
                option_text,
                re.IGNORECASE,
            )
            if len(supported) >= 2:
                introduction = text[: choice.end()]
                for token in supported:
                    label = token.strip("[]")
                    candidates.append(
                        (label.title(), f"{introduction}{token}. {remainder}".strip())
                    )

        if not candidates:
            option_sentences = [
                sentence.strip()
                for sentence in re.split(r"(?<=\.)\s+", tail)
                if sentence.strip()
            ]
            if 2 <= len(option_sentences) <= 3:
                sentence_candidates = []
                for index, sentence in enumerate(option_sentences, start=1):
                    candidate_text = f"{text[: choice.end()]}{sentence}"
                    candidate_effects = combat_preset(
                        candidate_text, allow_bearer_defenses
                    )
                    if not candidate_effects:
                        sentence_candidates = []
                        break
                    attacks = re.search(
                        r"Attacks characteristic of (\d+)", sentence, re.IGNORECASE
                    )
                    invulnerable = re.search(
                        r"(\d+)\+ invulnerable save", sentence, re.IGNORECASE
                    )
                    label = (
                        f"Attacks {attacks.group(1)}"
                        if attacks
                        else f"Invulnerable {invulnerable.group(1)}+"
                        if invulnerable
                        else f"Option {index}"
                    )
                    sentence_candidates.append((label, candidate_text))
                if len(sentence_candidates) == len(option_sentences):
                    candidates = sentence_candidates

    if not candidates:
        outcomes = list(
            re.finditer(r"\bon (?:a |an )?(\d+(?:-\d+)?\+?),\s*", text, re.IGNORECASE)
        )
        if len(outcomes) >= 2:
            introduction = text[: outcomes[0].start()]
            for index, outcome in enumerate(outcomes):
                body_end = (
                    outcomes[index + 1].start()
                    if index + 1 < len(outcomes)
                    else len(text)
                )
                outcome_text = text[outcome.start() : body_end].strip(" ;")
                candidates.append(
                    (
                        f"roll {outcome.group(1).replace('-', '–')}",
                        f"{introduction}{outcome_text}",
                    )
                )

    parsed = []
    for variant_name, variant_description in candidates:
        effects = combat_preset(variant_description, allow_bearer_defenses)
        if effects:
            parsed.append(
                {
                    "name": f"{name} — {variant_name}",
                    "description": variant_description,
                    "activation": "situational",
                    **effects,
                }
            )
    if parsed:
        for preset in parsed:
            preset["is_exclusive_choice"] = int(len(parsed) > 1)
        return parsed

    if has_choice:
        return []

    effects = combat_preset(text, allow_bearer_defenses)
    if not effects:
        return []
    return [
        {
            "name": name,
            "description": text,
            "is_exclusive_choice": 0,
            "activation": combat_preset_activation(text, effects),
            **effects,
        }
    ]


def rebuild_combat_presets(connection: sqlite3.Connection) -> int:
    connection.execute("DELETE FROM unit_combat_preset_effects")
    connection.execute("DELETE FROM unit_combat_presets")
    inserted = 0
    single_model_datasheets = {
        datasheet_id
        for (datasheet_id,) in connection.execute(
            """SELECT datasheet_id
               FROM unit_composition
               GROUP BY datasheet_id
               HAVING COUNT(*) > 0
                  AND SUM(max_models IS NULL) = 0
                  AND SUM(max_models) = 1"""
        )
    }
    abilities = connection.execute(
        """SELECT datasheet_id, position, name, description_text
           FROM datasheet_abilities ORDER BY datasheet_id, position"""
    ).fetchall()
    for datasheet_id, ability_position, name, description in abilities:
        for preset_position, preset in enumerate(
            combat_presets(
                name,
                description,
                allow_bearer_defenses=datasheet_id in single_model_datasheets,
            ),
            start=1,
        ):
            resolved_effects = []
            for effect in preset["additional_effects"]:
                ability_name = effect.get("weapon_ability_name")
                if not ability_name:
                    resolved_effects.append(effect)
                    continue
                if ability_name is True:
                    ability_name = name
                weapon_names = connection.execute(
                    """SELECT DISTINCT weapon_profiles.name
                       FROM weapon_profiles
                       JOIN weapon_abilities
                         ON weapon_abilities.weapon_profile_id = weapon_profiles.id
                       WHERE weapon_profiles.datasheet_id = ?
                         AND lower(weapon_abilities.name) = lower(?)
                       ORDER BY weapon_profiles.name""",
                    (datasheet_id, ability_name),
                ).fetchall()
                resolved_effects.extend(
                    {**effect, "weapon_name": weapon_name}
                    for (weapon_name,) in weapon_names
                )
            if preset["additional_effects"] and not resolved_effects:
                continue
            connection.execute(
                """INSERT INTO unit_combat_presets
                   (datasheet_id, ability_position, preset_position, name, description_text,
                    is_exclusive_choice, activation, weapon_scope, maximum_target_distance,
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
                    requires_attacker_not_battle_shocked,
                    requires_source_not_battle_shocked,
                    requires_source_guided_against_target,
                    requires_target_spotted,
                    requires_target_spotted_by_markerlight_observer,
                    required_target_strength_state,
                    hit_modifier, hit_modifier_role,
                    hit_modifier_subject, wound_modifier, wound_modifier_role,
                    wound_modifier_subject, reroll_hits, reroll_hit_ones, hit_reroll_role,
                    hit_reroll_subject, reroll_wounds, reroll_wound_ones, wound_reroll_role,
                    wound_reroll_subject)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    datasheet_id,
                    ability_position,
                    preset_position,
                    preset["name"],
                    preset["description"],
                    preset["is_exclusive_choice"],
                    preset["activation"],
                    preset["weapon_scope"],
                    preset["maximum_target_distance"],
                    int(preset["requires_attacker_charge"]),
                    int(preset["requires_attacker_stationary"]),
                    int(preset["requires_attached_unit"]),
                    int(preset["requires_waaagh_active"]),
                    int(preset["requires_oath_target"]),
                    int(preset["requires_oath_wound_bonus"]),
                    int(preset["requires_source_on_objective"]),
                    int(preset["requires_target_on_objective"]),
                    int(preset["requires_source_controls_objective"]),
                    int(preset["requires_target_on_objective_not_controlled_by_source"]),
                    int(preset["requires_source_on_selected_objective"]),
                    int(preset["requires_target_on_source_selected_objective"]),
                    int(preset["requires_target_battle_shocked"]),
                    int(preset["requires_attacker_not_battle_shocked"]),
                    int(preset["requires_source_not_battle_shocked"]),
                    int(preset["requires_source_guided_against_target"]),
                    int(preset["requires_target_spotted"]),
                    int(preset["requires_target_spotted_by_markerlight_observer"]),
                    preset["required_target_strength_state"],
                    preset["hit_modifier"],
                    preset.get("hit_modifier_role"),
                    preset.get("hit_modifier_subject"),
                    preset["wound_modifier"],
                    preset.get("wound_modifier_role"),
                    preset.get("wound_modifier_subject"),
                    preset["reroll_hits"],
                    preset["reroll_hit_ones"],
                    preset.get("hit_reroll_role"),
                    preset.get("hit_reroll_subject"),
                    preset["reroll_wounds"],
                    preset["reroll_wound_ones"],
                    preset.get("wound_reroll_role"),
                    preset.get("wound_reroll_subject"),
                ),
            )
            for effect_position, effect in enumerate(resolved_effects, start=1):
                connection.execute(
                    """INSERT INTO unit_combat_preset_effects
                       (datasheet_id, ability_position, preset_position, effect_position,
                        effect_type, value, uses, dice_count, dice_sides,
                        models_per_increment, model_count_source, weapon_name,
                        required_target_keyword, required_attack_keyword,
                        application_role, subject)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        datasheet_id,
                        ability_position,
                        preset_position,
                        effect_position,
                        effect["type"],
                        effect["value"],
                        effect.get("uses", 0),
                        effect["dice_count"],
                        effect["dice_sides"],
                        effect.get("models_per_increment"),
                        effect.get("model_count_source"),
                        effect.get("weapon_name"),
                        effect.get("required_target_keyword"),
                        effect.get("required_attack_keyword"),
                        effect["role"],
                        effect["subject"],
                    ),
                )
            inserted += 1
    return inserted


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
    orphan_composition_count = len(rows["Datasheets_unit_composition.csv"]) - len(
        composition_rows
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
                    ("schema_version", "41"),
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
                        (
                            item
                            for item in candidates
                            if item["faction_id"] == faction_id
                        ),
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
                for component_position, (
                    name,
                    component_min,
                    component_max,
                ) in enumerate(composition_components(row["description"]), start=1):
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

            rebuild_combat_presets(connection)
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
                "unit_combat_preset_effects",
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
                f"source lock is missing: {source_lock}; review the source and rerun with --update-source-lock"
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
