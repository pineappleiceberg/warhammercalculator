import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts.build_profiles_db import (
    combat_preset,
    combat_presets,
    composition_components,
    composition_range,
    plain_text,
    source_manifest_differences,
)
from scripts.export_profiles_json import export, profile_group_names, unit_model_range
from scripts.profile_freshness import (
    database_source_manifest,
    offline_report,
    table_snapshot,
)
from scripts.wargear_constraints import (
    allowance,
    choice_weapon_vector,
    default_loadout_clauses,
    normalized_name,
    option_choices,
    subject_count,
    weapon_vector,
)


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data" / "warhammer_10e.sqlite"
CATALOGUE = ROOT / "web" / "public" / "profile-data.json"
SOURCE_LOCK = ROOT / "data" / "profile-source-lock.json"


class ProfileDataTests(unittest.TestCase):
    def test_combat_preset_parser_preserves_scope_and_first_reroll_tier(self):
        self.assertEqual(
            combat_preset(
                "While this model is leading a unit, each time a model in that unit makes a melee attack, "
                "add 1 to the Hit roll and add 1 to the Wound roll."
            ),
            {
                "weapon_scope": "Melee",
                "hit_modifier": 1,
                "wound_modifier": 1,
                "reroll_hits": 0,
                "reroll_hit_ones": 0,
                "reroll_wounds": 0,
                "reroll_wound_ones": 0,
                "additional_effects": [],
                "hit_modifier_role": "attacker",
                "hit_modifier_subject": "led_unit",
                "wound_modifier_role": "attacker",
                "wound_modifier_subject": "led_unit",
            },
        )
        preset = combat_preset(
            "Each time this model makes a ranged attack, re-roll a Hit roll of 1. "
            "Against a unit on an objective, you can re-roll the Hit roll instead."
        )
        self.assertEqual(preset["weapon_scope"], "Ranged")
        self.assertEqual(preset["reroll_hit_ones"], 1)
        self.assertEqual(preset["reroll_hits"], 0)
        self.assertEqual(preset["hit_reroll_role"], "attacker")
        self.assertEqual(preset["hit_reroll_subject"], "self")
        self.assertIsNone(
            combat_preset("Add 1 to this model's Leadership characteristic.")
        )

    def test_combat_preset_parser_classifies_each_effect_without_using_its_sign(self):
        self_penalty = combat_preset(
            "Each time a model in this unit makes an attack, subtract 1 from the Hit roll."
        )
        self.assertEqual(
            (self_penalty["hit_modifier_role"], self_penalty["hit_modifier_subject"]),
            ("attacker", "self"),
        )
        defensive_bonus = combat_preset(
            "Each time an attack targets this unit, add 1 to the Wound roll."
        )
        self.assertEqual(
            (
                defensive_bonus["wound_modifier_role"],
                defensive_bonus["wound_modifier_subject"],
            ),
            ("target", "enemy_unit"),
        )
        mixed = combat_preset(
            "Each time this model makes an attack, add 1 to the Wound roll. "
            "Each time an attack is made against this model, subtract 1 from the Hit roll."
        )
        self.assertEqual(mixed["wound_modifier_role"], "attacker")
        self.assertEqual(mixed["hit_modifier_role"], "target")

    def test_combat_preset_parser_splits_exclusive_modes_and_roll_outcomes(self):
        dance = combat_presets(
            "Dance of Death",
            "At the start of the Fight phase, select one of the following abilities: "
            "Hero’s Prowess: Each time a model in this unit makes an attack, re-roll a Hit roll of 1. "
            "Villain’s Doom: Each time a model in this unit makes an attack, add 1 to the Wound roll. "
            "Trickster’s Grace: Each time an attack targets this unit, subtract 1 from the Hit roll.",
        )
        self.assertEqual(
            [preset["name"] for preset in dance],
            [
                "Dance of Death — Hero’s Prowess",
                "Dance of Death — Villain’s Doom",
                "Dance of Death — Trickster’s Grace",
            ],
        )
        self.assertEqual([preset["is_exclusive_choice"] for preset in dance], [1, 1, 1])
        self.assertEqual(dance[0]["reroll_hit_ones"], 1)
        self.assertEqual(dance[1]["wound_modifier"], 1)
        self.assertEqual(dance[2]["hit_modifier"], -1)

        outcomes = combat_presets(
            "Mind Control",
            "Select a unit and roll one D6: on a 1, nothing happens; on a 2-5, each time it "
            "makes an attack, subtract 1 from the Hit roll; on a 6, each time it makes an "
            "attack, subtract 1 from the Hit roll and subtract 1 from the Wound roll.",
        )
        self.assertEqual(
            [preset["name"] for preset in outcomes],
            [
                "Mind Control — roll 2–5",
                "Mind Control — roll 6",
            ],
        )
        self.assertEqual(outcomes[0]["wound_modifier"], 0)
        self.assertEqual(outcomes[1]["wound_modifier"], -1)

    def test_combat_preset_parser_extracts_weapon_rules_ap_and_critical_thresholds(
        self,
    ):
        preset = combat_preset(
            "Weapons equipped by models in this unit have the [SUSTAINED HITS D3] ability. "
            "Each time a model in this unit makes an attack, improve the Armour Penetration "
            "characteristic of that attack by 1, and an unmodified Hit roll of 5+ scores a Critical Hit."
        )
        effects = {effect["type"]: effect for effect in preset["additional_effects"]}
        self.assertEqual(
            (
                effects["sustained_hits"]["dice_count"],
                effects["sustained_hits"]["dice_sides"],
            ),
            (1, 3),
        )
        self.assertEqual(effects["ap_modifier"]["value"], 1)
        self.assertEqual(effects["critical_hits"]["value"], 5)
        self.assertTrue(
            all(effect["role"] == "attacker" for effect in effects.values())
        )
        self.assertTrue(all(effect["subject"] == "self" for effect in effects.values()))
        qualifier = combat_preset(
            "Provided it Remained Stationary, all [HEAVY] weapons equipped by models in this "
            "unit have the [LETHAL HITS] ability."
        )
        self.assertEqual(
            [effect["type"] for effect in qualifier["additional_effects"]],
            ["lethal_hits"],
        )

    def test_combat_preset_parser_extracts_generic_positive_characteristic_modifiers(
        self,
    ):
        preset = combat_preset(
            "While this model is leading a unit, add 1 to the Attacks and Strength "
            "characteristics of melee weapons equipped by models in that unit. Each time a "
            "model in that unit makes a melee attack, improve the Damage characteristic of "
            "that attack by 2."
        )
        effects = {effect["type"]: effect for effect in preset["additional_effects"]}
        self.assertEqual(preset["weapon_scope"], "Melee")
        self.assertEqual(
            {
                effect_type: (effect["value"], effect["role"], effect["subject"])
                for effect_type, effect in effects.items()
            },
            {
                "attacks_modifier": (1, "attacker", "led_unit"),
                "strength_modifier": (1, "attacker", "led_unit"),
                "damage_modifier": (2, "attacker", "led_unit"),
            },
        )

    def test_combat_preset_parser_extracts_conservative_defensive_effects(self):
        preset = combat_preset(
            "While this model is leading a unit, models in that unit have a 4+ invulnerable "
            "save and the Feel No Pain 5+ ability. Each time an attack is allocated to a "
            "model in that unit, subtract 1 from the Damage characteristic of that attack."
        )
        effects = {effect["type"]: effect for effect in preset["additional_effects"]}
        self.assertEqual(
            {
                effect_type: (effect["value"], effect["role"], effect["subject"])
                for effect_type, effect in effects.items()
            },
            {
                "invulnerable_save": (4, "target", "led_unit"),
                "feel_no_pain": (5, "target", "led_unit"),
                "damage_reduction": (1, "target", "enemy_unit"),
            },
        )
        save = combat_preset(
            "While this model is leading a unit, models in that unit have a Save characteristic of 2+."
        )
        self.assertEqual(save["additional_effects"][0]["type"], "save_target")
        self.assertEqual(save["additional_effects"][0]["value"], 2)

    def test_combat_preset_parser_classifies_only_unconditional_defenses_as_inherent(
        self,
    ):
        inherent = combat_presets(
            "Duty Eternal",
            "Each time an attack is allocated to this model, subtract 1 from the Damage characteristic of that attack.",
        )
        self.assertEqual(inherent[0]["activation"], "inherent")
        conditional = combat_presets(
            "Guardian of the Lost",
            "While this model is leading a unit, each time an attack is allocated to a model "
            "in that unit, subtract 1 from the Damage characteristic of that attack.",
        )
        self.assertEqual(conditional[0]["activation"], "situational")
        halved = combat_presets(
            "Molten Form",
            "Each time an attack is allocated to this model, halve the Damage characteristic of that attack.",
        )
        self.assertEqual(halved[0]["activation"], "inherent")
        self.assertEqual(
            halved[0]["additional_effects"],
            [
                {
                    "type": "damage_divisor",
                    "value": 2,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "target",
                    "subject": "self",
                }
            ],
        )

    def test_combat_preset_parser_omits_unsupported_defensive_effects(self):
        psychic = combat_presets(
            "Abomination",
            "This model has the Feel No Pain 3+ ability against Psychic Attacks.",
        )
        self.assertEqual(psychic[0]["activation"], "automatic")
        self.assertEqual(
            psychic[0]["additional_effects"],
            [
                {
                    "type": "feel_no_pain",
                    "value": 3,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "required_attack_keyword": "psychic",
                    "role": "target",
                    "subject": "self",
                }
            ],
        )
        self.assertIsNone(
            combat_preset(
                "This model has the Feel No Pain 3+ ability against Psychic Attacks and mortal wounds."
            )
        )
        self.assertIsNone(combat_preset("The bearer has a 4+ invulnerable save."))
        self.assertIsNone(
            combat_preset(
                'While a friendly VEHICLE unit is within 6" of this model, that unit has the Feel No Pain 6+ ability.'
            )
        )
        self.assertIsNone(
            combat_preset(
                "While a model is affected by this ability, each time an attack is allocated "
                "to that model, subtract 1 from the Damage characteristic of that attack."
            )
        )
        self.assertEqual(
            combat_preset(
                "Each time an attack is made by a model in this unit, subtract 1 from the "
                "Damage characteristic of that attack."
            )["additional_effects"][0]["value"],
            -1,
        )
        self.assertIsNone(
            combat_preset(
                "Each time an attack is made against this PSYKER (excluding Psychic Attacks), "
                "subtract 1 from the Damage characteristic of that attack."
            )
        )
        conflicting = combat_preset(
            "Models in this unit have the Feel No Pain 5+ ability. If empowered, models "
            "in this unit have the Feel No Pain 4+ ability instead."
        )
        self.assertIsNone(conflicting)

    def test_combat_preset_parser_supports_signed_generic_characteristic_modifiers(
        self,
    ):
        named_weapon = combat_preset(
            "Add 2 to the Attacks characteristic of this model’s Frostfang weapon."
        )
        self.assertIsNone(named_weapon)
        negative_dice_modifier = combat_preset(
            "Select one enemy unit. Subtract 1 from the Attacks characteristic of weapons "
            "equipped by models in that unit."
        )
        self.assertEqual(
            negative_dice_modifier["additional_effects"],
            [
                {
                    "type": "attacks_modifier",
                    "value": -1,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "target",
                    "subject": "enemy_unit",
                }
            ],
        )
        replacement = combat_preset(
            "Melee weapons equipped by models in this unit have an Attacks characteristic of 4."
        )
        self.assertIsNone(replacement)

        strength_replacement = combat_preset(
            "Until the end of the phase, change the Strength characteristic of melee weapons "
            "equipped by this model to 9."
        )
        self.assertEqual(
            strength_replacement["additional_effects"],
            [
                {
                    "type": "strength_replacement",
                    "value": 9,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "weapon_name": None,
                    "role": "attacker",
                    "subject": "self",
                }
            ],
        )
        damage_replacement = combat_preset(
            "Until the end of the phase, each time an attack is allocated to this model, "
            "change the Damage characteristic of that attack to 0."
        )
        self.assertEqual(
            damage_replacement["additional_effects"],
            [
                {
                    "type": "damage_replacement",
                    "value": 0,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "target",
                    "subject": "self",
                }
            ],
        )
        limited_damage_replacement = combat_preset(
            "Once per turn, the first time a saving throw is failed for this unit, change the "
            "Damage characteristic of that attack to 0."
        )
        self.assertEqual(
            limited_damage_replacement["additional_effects"],
            [
                {
                    "type": "first_failed_save_damage_replacement",
                    "value": 0,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "target",
                    "subject": "self",
                }
            ],
        )
        allocated_replacement = combat_preset(
            "Once per battle, when an attack is allocated to this model, you can change the "
            "Damage characteristic of that attack to 0."
        )
        self.assertEqual(
            allocated_replacement["additional_effects"],
            [
                {
                    "type": "allocated_attack_damage_replacement",
                    "value": 0,
                    "uses": 1,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "target",
                    "subject": "self",
                }
            ],
        )
        twice_allocated_replacement = combat_preset(
            "Twice per battle, after an attack has been allocated to this model, you can change "
            "the Damage characteristic of that attack to 0."
        )
        self.assertEqual(twice_allocated_replacement["additional_effects"][0]["uses"], 2)
        failed_save_timing = combat_preset(
            "Once per phase, when an attack is allocated to this model and the saving throw is "
            "failed, you can change the Damage characteristic of that attack to 0."
        )
        self.assertIsNone(failed_save_timing)
        psychic_assassin = combat_presets(
            "Psychic Assassin",
            "Each time you select a PSYKER unit as the target for this weapon, until those "
            "attacks are resolved, change the Attacks characteristic of this weapon to 6.",
        )
        self.assertEqual(len(psychic_assassin), 1)
        self.assertEqual(psychic_assassin[0]["activation"], "automatic")
        self.assertEqual(
            psychic_assassin[0]["additional_effects"],
            [
                {
                    "type": "attacks_replacement",
                    "value": 6,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "weapon_ability_name": True,
                    "required_target_keyword": "psyker",
                    "role": "attacker",
                    "subject": "self",
                }
            ],
        )
        conflicting = combat_preset(
            "Each time this model makes a melee attack that targets a MONSTER unit, add 1 to "
            "the Damage characteristic of that attack. If it targets a TITANIC unit, add 2 to "
            "the Damage characteristic of that attack instead."
        )
        self.assertIsNone(conflicting)
        named_attack = combat_preset(
            "Each time a model in this unit makes a melee attack with its Wolf Guard weapon, "
            "add 1 to the Damage characteristic of that attack."
        )
        self.assertIsNone(named_attack)

    def test_combat_preset_parser_supports_generic_characteristic_multipliers(self):
        doubled = combat_preset(
            "Until the end of the phase, double the Attacks characteristic of melee weapons "
            "equipped by models in this unit."
        )
        self.assertEqual(
            doubled["additional_effects"],
            [
                {
                    "type": "attacks_multiplier",
                    "value": 2,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "attacker",
                    "subject": "self",
                }
            ],
        )
        self.assertIsNone(
            combat_preset(
                "Double the Attacks characteristic of melee weapons equipped by Daemonhost "
                "models in that unit."
            )
        )

    def test_combat_preset_parser_preserves_shared_random_characteristic_rolls(self):
        random_strength = combat_preset(
            "Each time this model’s unit makes a Dark Pact, until the end of the phase, "
            "add D3 to the Strength characteristic of weapons equipped by this model."
        )
        self.assertEqual(
            random_strength["additional_effects"],
            [
                {
                    "type": "strength_modifier",
                    "value": 0,
                    "dice_count": 1,
                    "dice_sides": 3,
                    "role": "attacker",
                    "subject": "self",
                }
            ],
        )
        shared = combat_preset(
            "Until the end of the phase, add D3 to the Attacks and Strength "
            "characteristics of Psychic weapons equipped by this model."
        )
        self.assertEqual(
            shared["additional_effects"],
            [
                {
                    "type": "attacks_modifier",
                    "value": 0,
                    "dice_count": 1,
                    "dice_sides": 3,
                    "required_attack_keyword": "psychic",
                    "role": "attacker",
                    "subject": "self",
                },
                {
                    "type": "strength_modifier",
                    "value": 0,
                    "dice_count": 1,
                    "dice_sides": 3,
                    "required_attack_keyword": "psychic",
                    "role": "attacker",
                    "subject": "self",
                },
            ],
        )

    def test_combat_preset_parser_splits_keyword_choices(self):
        choices = combat_presets(
            "Weapon Doctrine",
            "Select one of the following abilities: [SUSTAINED HITS 1] or [LETHAL HITS]. "
            "Until the end of the phase, weapons equipped by models in this unit have the selected ability.",
        )
        self.assertEqual(len(choices), 2)
        self.assertEqual([choice["is_exclusive_choice"] for choice in choices], [1, 1])
        self.assertEqual(
            [choice["additional_effects"][0]["type"] for choice in choices],
            ["sustained_hits", "lethal_hits"],
        )
        self.assertEqual(
            combat_presets(
                "Unparsed doctrines",
                "Select one of the doctrines below. Protector: Weapons equipped by models in "
                "this unit have the [HEAVY] ability. Conqueror: Improve the Armour Penetration "
                "characteristic of that attack by 1.",
            ),
            [],
        )

    def test_checked_artifacts_match_the_pinned_source_manifest(self):
        lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        report = offline_report(lock, DATABASE, CATALOGUE)
        self.assertEqual(report["status"], "consistent")
        self.assertEqual(report["differences"], [])
        self.assertEqual(database_source_manifest(DATABASE), lock)

        changed = json.loads(json.dumps(lock))
        changed["files"]["Datasheets.csv"]["rowCount"] += 1
        self.assertEqual(
            source_manifest_differences(lock, changed),
            ["Datasheets.csv"],
        )

    def test_table_snapshots_ignore_generated_row_ids_but_detect_content(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.sqlite"
            second = Path(directory) / "second.sqlite"
            for path, row_id, value in ((first, 1, "same"), (second, 99, "same")):
                with closing(sqlite3.connect(path)) as connection:
                    connection.execute(
                        "CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT)"
                    )
                    connection.execute(
                        "INSERT INTO sample(id, value) VALUES (?, ?)", (row_id, value)
                    )
                    connection.commit()
            self.assertEqual(
                table_snapshot(first, "sample"), table_snapshot(second, "sample")
            )
            with closing(sqlite3.connect(second)) as connection:
                connection.execute("UPDATE sample SET value = 'changed'")
                connection.commit()
            self.assertNotEqual(
                table_snapshot(first, "sample"), table_snapshot(second, "sample")
            )

    def test_composition_parser_handles_export_markup_and_unicode_hyphens(self):
        self.assertEqual(composition_range("10-20 Necron Warriors"), (10, 20))
        self.assertEqual(composition_range("3‑10 Kill Team Infiltrators"), (3, 10))
        self.assertEqual(
            composition_components(
                "1 Master of Ordnance, 1 Officer of the Fleet and 1 Astropath."
            ),
            [
                ("Master of Ordnance", 1, 1),
                ("Officer of the Fleet", 1, 1),
                ("Astropath", 1, 1),
            ],
        )
        self.assertEqual(
            composition_range(
                "1 Master of Ordnance, 1 Officer of the Fleet and 1 Astropath."
            ),
            (3, 3),
        )
        self.assertEqual(
            plain_text('1 Hero – <span class="kwb">EPIC</span> <b>HERO</b>'),
            "1 Hero – EPIC HERO",
        )
        self.assertEqual(composition_range("OR"), (None, None))
        self.assertEqual(
            unit_model_range(
                [
                    {"text": "1 Sergeant and 9 Troopers", "min": 10, "max": 10},
                    {"text": "OR", "min": None, "max": None},
                    {"text": "2 Sergeants and 18 Troopers", "min": 20, "max": 20},
                ]
            ),
            (10, 20),
        )
        self.assertEqual(
            allowance("For every 5 models in this unit, 1 model can replace it."),
            (0, 1, 5),
        )
        self.assertEqual(
            allowance("Any number of models can each replace it."), (0, 1, 1)
        )
        self.assertEqual(
            normalized_name("Power weapon’s – profile"), "power weapon s profile"
        )
        self.assertEqual(
            option_choices(
                "Choose:<ul><li>1 flamer</li><li>1 meltagun</li></ul>", "Choose"
            ),
            ["1 flamer", "1 meltagun"],
        )
        self.assertEqual(
            profile_group_names(
                ["Plasma pistol – standard", "Plasma pistol – supercharge"]
            ),
            ("Plasma pistol", ["standard", "supercharge"]),
        )
        known = {
            "lastrum storm bolter": ("unit:1", "Lastrum storm bolter"),
            "infernus incinerator": ("unit:2", "Infernus incinerator"),
        }
        self.assertEqual(
            choice_weapon_vector(
                "1 lastrum storm bolter and 1 infernus incinerator",
                known,
                {"lastrum storm bolter"},
            ),
            {"unit:2": ("Infernus incinerator", 1)},
        )
        self.assertEqual(
            default_loadout_clauses(
                "<b>Every model is equipped with:</b> 1 gauss flayer; close combat weapon."
            ),
            [(0, 1, 0, 1, "1 gauss flayer; close combat weapon.")],
        )
        self.assertEqual(
            weapon_vector("2 lastrum storm bolters; Achillus dreadspear.", known),
            {"unit:1": ("Lastrum storm bolter", 2)},
        )
        boyz = [("Boss Nob", 1, 1, 1), ("Boyz", 9, 19, 2)]
        self.assertEqual(subject_count("The Boss Nob", boyz), (1, 0, 0, 1))
        self.assertEqual(subject_count("Every Boy", boyz), (-1, 1, 0, 1))
        shock_troops = [
            ("Shock Trooper Sergeant", 1, 1, 1),
            ("Shock Troopers", 9, 9, 1),
            ("Shock Trooper Sergeants", 2, 2, 3),
            ("Shock Troopers", 18, 18, 3),
        ]
        self.assertEqual(
            subject_count("Every Shock Trooper Sergeant", shock_troops),
            (0, 0, 1, 10),
        )

    def test_checked_database_preserves_loadout_sources_and_provenance(self):
        connection = sqlite3.connect(DATABASE)
        try:
            self.assertEqual(
                connection.execute("PRAGMA integrity_check").fetchone()[0], "ok"
            )
            self.assertEqual(
                connection.execute(
                    "SELECT value FROM metadata WHERE key = 'schema_version'"
                ).fetchone()[0],
                "25",
            )
            for filename, minimum_rows in (
                ("Abilities.csv", 80),
                ("Datasheets_abilities.csv", 7_000),
            ):
                row = connection.execute(
                    "SELECT row_count, sha256 FROM source_files WHERE filename = ?",
                    (filename,),
                ).fetchone()
                self.assertIsNotNone(row)
                self.assertGreater(row[0], minimum_rows)
                self.assertEqual(len(row[1]), 64)
            self.assertGreater(
                connection.execute(
                    "SELECT count(*) FROM unit_combat_presets"
                ).fetchone()[0],
                900,
            )
            self.assertGreater(
                connection.execute(
                    "SELECT count(*) FROM unit_combat_preset_effects"
                ).fetchone()[0],
                500,
            )
            self.assertEqual(
                connection.execute(
                    """SELECT preset.name, preset.weapon_scope, effect.value,
                              effect.weapon_name, effect.required_target_keyword,
                              effect.application_role, effect.subject
                       FROM unit_combat_preset_effects AS effect
                       JOIN unit_combat_presets AS preset
                         USING (datasheet_id, ability_position, preset_position)
                       WHERE effect.effect_type = 'attacks_replacement'
                       ORDER BY preset.name"""
                ).fetchall(),
                [
                    (
                        "Embittered",
                        "Any",
                        12,
                        "Dead Man’s Hand",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Psychic Assassin",
                        "Any",
                        6,
                        "Animus speculum",
                        "psyker",
                        "attacker",
                        "self",
                    ),
                    (
                        "Thrilling Spectacle",
                        "Melee",
                        12,
                        None,
                        None,
                        "attacker",
                        "self",
                    ),
                ],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT preset.name, effect.value, effect.uses,
                              effect.application_role, effect.subject, count(*)
                       FROM unit_combat_preset_effects AS effect
                       JOIN unit_combat_presets AS preset
                         USING (datasheet_id, ability_position, preset_position)
                       WHERE effect.effect_type = 'allocated_attack_damage_replacement'
                       GROUP BY preset.name, effect.value, effect.uses,
                                effect.application_role, effect.subject
                       ORDER BY preset.name"""
                ).fetchall(),
                [
                    ("Ablative Plating", 0, 1, "target", "self", 2),
                    ("Chaos Familiar", 0, 1, "target", "self", 2),
                    ("Inviolable Transport", 0, 1, "target", "self", 5),
                    ("Resilient Organism", 0, 1, "target", "self", 1),
                    ("Stealth Drones", 0, 2, "target", "self", 1),
                    ("Surgeon Acolyte", 0, 1, "target", "self", 1),
                ],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT preset.name, preset.weapon_scope, effect.value,
                              effect.application_role, effect.subject
                       FROM unit_combat_preset_effects AS effect
                       JOIN unit_combat_presets AS preset
                         USING (datasheet_id, ability_position, preset_position)
                       WHERE effect.effect_type = 'damage_replacement'
                       ORDER BY preset.name"""
                ).fetchall(),
                [
                    ("Auramite and Adamantine", "Any", 1, "target", "self"),
                ],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT preset.name, effect.value, effect.application_role,
                              effect.subject, count(*)
                       FROM unit_combat_preset_effects AS effect
                       JOIN unit_combat_presets AS preset
                         USING (datasheet_id, ability_position, preset_position)
                       WHERE effect.effect_type =
                           'first_failed_save_damage_replacement'
                       GROUP BY preset.name, effect.value, effect.application_role,
                                effect.subject
                       ORDER BY preset.name"""
                ).fetchall(),
                [
                    ("Channeller Stones", 0, "target", "led_unit", 2),
                    ("Stimm-needler", 0, "target", "led_unit", 1),
                ],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT effect_type, count(*) FROM unit_combat_preset_effects
                       WHERE effect_type IN
                           ('attacks_modifier', 'strength_modifier', 'damage_modifier')
                       GROUP BY effect_type ORDER BY effect_type"""
                ).fetchall(),
                [
                    ("attacks_modifier", 20),
                    ("damage_modifier", 5),
                    ("strength_modifier", 92),
                ],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT preset.name, effect.effect_type, effect.value,
                              effect.dice_count, effect.dice_sides,
                              effect.required_attack_keyword
                       FROM unit_combat_preset_effects AS effect
                       JOIN unit_combat_presets AS preset
                         USING (datasheet_id, ability_position, preset_position)
                       WHERE effect.dice_count > 0
                         AND effect.effect_type IN
                             ('attacks_modifier', 'strength_modifier', 'damage_modifier')
                       ORDER BY preset.name, effect.effect_position"""
                ).fetchall(),
                [
                    ("Aspire to Glory", "strength_modifier", 0, 1, 3, None),
                    ("Sacrificial Blessing", "attacks_modifier", 0, 1, 3, "psychic"),
                    ("Sacrificial Blessing", "strength_modifier", 0, 1, 3, "psychic"),
                ],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT effect_type, count(*) FROM unit_combat_preset_effects
                       WHERE value < 0 AND effect_type IN
                           ('attacks_modifier', 'strength_modifier', 'damage_modifier')
                       GROUP BY effect_type ORDER BY effect_type"""
                ).fetchall(),
                [("attacks_modifier", 2), ("damage_modifier", 2)],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT effect_type, count(*) FROM unit_combat_preset_effects
                       WHERE effect_type IN
                           ('save_target', 'invulnerable_save', 'feel_no_pain',
                            'damage_reduction', 'damage_divisor')
                       GROUP BY effect_type ORDER BY effect_type"""
                ).fetchall(),
                [
                    ("damage_divisor", 4),
                    ("damage_reduction", 30),
                    ("feel_no_pain", 39),
                    ("invulnerable_save", 34),
                    ("save_target", 1),
                ],
            )
            self.assertEqual(
                connection.execute(
                    "SELECT activation, count(*) FROM unit_combat_presets GROUP BY activation"
                ).fetchall(),
                [("automatic", 2), ("inherent", 32), ("situational", 1396)],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT preset.activation, effect.value, effect.subject, count(*)
                       FROM unit_combat_preset_effects AS effect
                       JOIN unit_combat_presets AS preset
                         USING (datasheet_id, ability_position, preset_position)
                       WHERE effect.effect_type = 'feel_no_pain'
                         AND effect.required_attack_keyword = 'psychic'
                       GROUP BY preset.activation, effect.value, effect.subject
                       ORDER BY preset.activation, effect.value, effect.subject"""
                ).fetchall(),
                [("automatic", 2, "self", 1), ("situational", 4, "led_unit", 14)],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*)
                       FROM unit_combat_preset_effects AS effect
                       JOIN unit_combat_presets AS preset
                         USING (datasheet_id, ability_position, preset_position)
                       WHERE preset.activation = 'inherent'
                         AND effect.effect_type = 'damage_reduction'"""
                ).fetchone()[0],
                28,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM unit_combat_preset_effects WHERE subject = 'unknown'"
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       WHERE (hit_modifier <> 0 AND
                              (hit_modifier_role IS NULL OR hit_modifier_subject IS NULL))
                          OR (wound_modifier <> 0 AND
                              (wound_modifier_role IS NULL OR wound_modifier_subject IS NULL))
                          OR ((reroll_hits OR reroll_hit_ones) AND
                              (hit_reroll_role IS NULL OR hit_reroll_subject IS NULL))
                          OR ((reroll_wounds OR reroll_wound_ones) AND
                              (wound_reroll_role IS NULL OR wound_reroll_subject IS NULL))"""
                ).fetchone()[0],
                0,
            )
            dance = connection.execute(
                """SELECT preset_position, name, hit_modifier, wound_modifier,
                          reroll_hit_ones, is_exclusive_choice
                   FROM unit_combat_presets
                   WHERE datasheet_id = '000002536' AND ability_position = 3
                   ORDER BY preset_position"""
            ).fetchall()
            self.assertEqual(len(dance), 3)
            self.assertEqual(
                [row[1] for row in dance],
                [
                    "Dance of Death — Hero’s Prowess",
                    "Dance of Death — Villain’s Doom",
                    "Dance of Death — Trickster’s Grace",
                ],
            )
            self.assertEqual([row[5] for row in dance], [1, 1, 1])
            self.assertEqual(
                connection.execute(
                    """SELECT weapon_scope, hit_modifier, wound_modifier
                       FROM unit_combat_presets
                       WHERE datasheet_id = '000000008' AND name = 'Prophet of Da Great Waaagh!'"""
                ).fetchone(),
                ("Melee", 1, 1),
            )
            for filename, minimum_rows in (
                ("Datasheets_unit_composition.csv", 2_000),
                ("Datasheets_options.csv", 2_500),
            ):
                row = connection.execute(
                    "SELECT row_count, sha256, source_url FROM source_files WHERE filename = ?",
                    (filename,),
                ).fetchone()
                self.assertIsNotNone(row)
                self.assertGreater(row[0], minimum_rows)
                self.assertEqual(len(row[1]), 64)
                self.assertTrue(row[2].endswith(filename))
            self.assertGreater(
                connection.execute("SELECT count(*) FROM unit_composition").fetchone()[
                    0
                ],
                2_000,
            )
            self.assertGreater(
                connection.execute("SELECT count(*) FROM wargear_options").fetchone()[
                    0
                ],
                2_500,
            )
            self.assertGreater(
                connection.execute(
                    "SELECT count(*) FROM default_weapon_loadout"
                ).fetchone()[0],
                4_400,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM default_loadout_subjects"
                ).fetchone()[0],
                1_971,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM default_loadout_subjects WHERE resolved = 1"
                ).fetchone()[0],
                1_883,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM default_loadout_subjects WHERE resolved = 0"
                ).fetchone()[0],
                88,
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*)
                       FROM default_loadout_subject_weapons AS weapon
                       JOIN default_loadout_subjects AS subject
                         ON subject.datasheet_id = weapon.datasheet_id
                        AND subject.position = weapon.subject_position
                       WHERE subject.resolved = 0"""
                ).fetchone()[0],
                207,
            )
            self.assertGreater(
                connection.execute(
                    "SELECT count(*) FROM wargear_choice_replaced_weapons"
                ).fetchone()[0],
                1_000,
            )
            self.assertGreater(
                connection.execute(
                    "SELECT count(*) FROM wargear_choice_pools"
                ).fetchone()[0],
                1_900,
            )
            self.assertGreater(
                connection.execute(
                    """SELECT count(*) FROM (
                           SELECT datasheet_id, option_position, alternative_position
                           FROM wargear_choice_alternative_weapons
                           GROUP BY 1, 2, 3 HAVING count(*) > 1
                       )"""
                ).fetchone()[0],
                200,
            )
            self.assertGreater(
                connection.execute(
                    "SELECT count(*) FROM wargear_constraints"
                ).fetchone()[0],
                1_500,
            )
            self.assertGreater(
                connection.execute(
                    "SELECT count(*) FROM wargear_constraint_weapons"
                ).fetchone()[0],
                2_500,
            )
        finally:
            connection.close()

    def test_browser_catalogue_exposes_editable_necron_loadout_guidance(self):
        catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))
        warriors = next(
            unit for unit in catalogue["units"] if unit["name"] == "Necron Warriors"
        )
        self.assertEqual(warriors["suggestedModelCount"], 10)
        self.assertEqual(warriors["maximumModelCount"], 20)
        self.assertEqual(warriors["composition"][0]["text"], "10-20 Necron Warriors")
        self.assertTrue(
            any(
                "gauss reaper" in option.lower()
                for option in warriors["wargearOptions"]
            )
        )
        reaper = next(
            limit
            for limit in warriors["weaponLimits"]
            if limit["groupName"] == "Gauss reaper"
        )
        self.assertEqual(reaper["terms"][0]["perIncrement"], 1)
        self.assertEqual(reaper["terms"][0]["modelsPerIncrement"], 1)

        assault = next(
            unit for unit in catalogue["units"] if unit["name"] == "Assault Squad"
        )
        eviscerator = next(
            limit
            for limit in assault["weaponLimits"]
            if limit["groupName"] == "Eviscerator"
        )
        self.assertEqual(eviscerator["terms"][0]["modelsPerIncrement"], 5)
        self.assertEqual(catalogue["structuredWargear"]["constraintCount"], 1798)
        self.assertEqual(catalogue["structuredWargear"]["choicePoolCount"], 2009)
        self.assertEqual(
            catalogue["structuredWargear"]["compoundAlternativeCount"], 241
        )
        self.assertEqual(catalogue["structuredWargear"]["defaultWeaponCount"], 4349)
        self.assertEqual(catalogue["structuredWargear"]["defaultWeaponTermCount"], 4494)
        self.assertEqual(catalogue["structuredWargear"]["loadoutSubjectCount"], 1971)
        self.assertEqual(
            catalogue["structuredWargear"]["resolvedLoadoutSubjectCount"], 1883
        )
        self.assertEqual(
            catalogue["structuredWargear"]["unresolvedLoadoutSubjectCount"], 88
        )
        self.assertEqual(
            catalogue["structuredWargear"]["loadoutSubjectWeaponCount"], 4701
        )
        self.assertEqual(catalogue["structuredWargear"]["replacementWeaponCount"], 1172)
        self.assertTrue(catalogue["structuredWargear"]["conservative"])
        warboss = next(unit for unit in catalogue["units"] if unit["name"] == "Warboss")
        might = next(
            preset
            for preset in warboss["combatPresets"]
            if preset["name"] == "Might is Right"
        )
        self.assertEqual(might["weaponScope"], "Melee")
        self.assertEqual(might["hitModifier"], 1)
        self.assertEqual(might["hitModifierRole"], "attacker")
        self.assertEqual(might["hitModifierSubject"], "led_unit")
        self.assertIn("leading a unit", might["description"])
        castigator = next(
            unit for unit in catalogue["units"] if unit["name"] == "Castigator"
        )
        rites = next(
            preset
            for preset in castigator["combatPresets"]
            if preset["name"] == "Rites of Castigation"
        )
        self.assertEqual(
            rites["effects"],
            [
                {
                    "type": "ap_modifier",
                    "value": 1,
                    "diceCount": 0,
                    "diceSides": 0,
                    "role": "attacker",
                    "subject": "friendly_unit",
                }
            ],
        )
        captain = next(unit for unit in catalogue["units"] if unit["id"] == "000000073")
        finest_hour = next(
            preset
            for preset in captain["combatPresets"]
            if preset["name"] == "Finest Hour"
        )
        self.assertEqual(finest_hour["weaponScope"], "Melee")
        self.assertEqual(
            finest_hour["effects"],
            [
                {
                    "type": "devastating_wounds",
                    "value": 1,
                    "diceCount": 0,
                    "diceSides": 0,
                    "role": "attacker",
                    "subject": "self",
                },
                {
                    "type": "attacks_modifier",
                    "value": 3,
                    "diceCount": 0,
                    "diceSides": 0,
                    "role": "attacker",
                    "subject": "self",
                },
            ],
        )
        winged_hive_tyrant = next(
            unit for unit in catalogue["units"] if unit["name"] == "Winged Hive Tyrant"
        )
        paroxysm = next(
            preset
            for preset in winged_hive_tyrant["combatPresets"]
            if preset["name"] == "Paroxysm (Psychic) — roll 2+"
        )
        self.assertEqual(
            paroxysm["effects"],
            [
                {
                    "type": "attacks_modifier",
                    "value": -1,
                    "diceCount": 0,
                    "diceSides": 0,
                    "role": "target",
                    "subject": "enemy_unit",
                }
            ],
        )
        captain_tycho = next(
            unit for unit in catalogue["units"] if unit["id"] == "000000152"
        )
        embittered = next(
            preset
            for preset in captain_tycho["combatPresets"]
            if preset["name"] == "Embittered"
        )
        self.assertEqual(
            embittered["effects"],
            [
                {
                    "type": "attacks_replacement",
                    "value": 12,
                    "diceCount": 0,
                    "diceSides": 0,
                    "weaponName": "Dead Man’s Hand",
                    "role": "attacker",
                    "subject": "self",
                }
            ],
        )
        lelith = next(unit for unit in catalogue["units"] if unit["id"] == "000000640")
        thrilling = next(
            preset
            for preset in lelith["combatPresets"]
            if preset["name"] == "Thrilling Spectacle"
        )
        replacement = next(
            effect
            for effect in thrilling["effects"]
            if effect["type"] == "attacks_replacement"
        )
        self.assertEqual(replacement["value"], 12)
        self.assertIsNone(replacement.get("weaponName"))
        allarus_captain = next(
            unit
            for unit in catalogue["units"]
            if unit["name"] == "Shield-captain In Allarus Terminator Armour"
        )
        auramite = next(
            preset
            for preset in allarus_captain["combatPresets"]
            if preset["name"] == "Auramite and Adamantine"
        )
        self.assertEqual(
            auramite["effects"],
            [
                {
                    "type": "damage_replacement",
                    "value": 1,
                    "diceCount": 0,
                    "diceSides": 0,
                    "role": "target",
                    "subject": "self",
                }
            ],
        )
        self.assertEqual(auramite["activation"], "situational")
        culexus = next(
            unit for unit in catalogue["units"] if unit["name"] == "Culexus Assassin"
        )
        psychic_assassin = next(
            preset
            for preset in culexus["combatPresets"]
            if preset["name"] == "Psychic Assassin"
        )
        self.assertEqual(psychic_assassin["activation"], "automatic")
        self.assertEqual(
            psychic_assassin["effects"],
            [
                {
                    "type": "attacks_replacement",
                    "value": 6,
                    "diceCount": 0,
                    "diceSides": 0,
                    "weaponName": "Animus speculum",
                    "requiredTargetKeyword": "psyker",
                    "role": "attacker",
                    "subject": "self",
                }
            ],
        )
        abomination = next(
            preset
            for preset in culexus["combatPresets"]
            if preset["name"] == "Abomination"
        )
        self.assertEqual(abomination["activation"], "automatic")
        self.assertEqual(
            abomination["effects"],
            [
                {
                    "type": "feel_no_pain",
                    "value": 2,
                    "diceCount": 0,
                    "diceSides": 0,
                    "requiredAttackKeyword": "psychic",
                    "role": "target",
                    "subject": "self",
                }
            ],
        )
        redemptor = next(
            unit
            for unit in catalogue["units"]
            if unit["name"] == "Redemptor Dreadnought"
        )
        duty_eternal = next(
            preset
            for preset in redemptor["combatPresets"]
            if preset["name"] == "Duty Eternal"
        )
        self.assertEqual(
            duty_eternal["effects"],
            [
                {
                    "type": "damage_reduction",
                    "value": 1,
                    "diceCount": 0,
                    "diceSides": 0,
                    "role": "target",
                    "subject": "enemy_unit",
                }
            ],
        )
        self.assertEqual(duty_eternal["activation"], "inherent")
        self.assertEqual(redemptor["models"][0]["reduction"], 1)
        self.assertEqual(redemptor["models"][0]["feelNoPain"], 0)
        avatar = next(
            unit for unit in catalogue["units"] if unit["name"] == "Avatar of Khaine"
        )
        molten_form = next(
            preset
            for preset in avatar["combatPresets"]
            if preset["name"] == "Molten Form"
        )
        self.assertEqual(molten_form["activation"], "inherent")
        self.assertEqual(
            molten_form["effects"],
            [
                {
                    "type": "damage_divisor",
                    "value": 2,
                    "diceCount": 0,
                    "diceSides": 0,
                    "role": "target",
                    "subject": "self",
                }
            ],
        )
        self.assertEqual(avatar["models"][0]["damageDivisor"], 2)
        self.assertFalse(
            any(
                preset["name"] == "Impossible Form (Psychic)"
                for unit in catalogue["units"]
                for preset in unit["combatPresets"]
            )
        )
        imagifier = next(
            unit for unit in catalogue["units"] if unit["name"] == "Imagifier"
        )
        martyrs = next(
            preset
            for preset in imagifier["combatPresets"]
            if preset["name"] == "Stanchion of Holy Martyrs"
        )
        self.assertEqual(
            [(effect["type"], effect["value"]) for effect in martyrs["effects"]],
            [("invulnerable_save", 4), ("save_target", 2)],
        )
        self.assertEqual(martyrs["activation"], "situational")
        troupe = next(unit for unit in catalogue["units"] if unit["id"] == "000002536")
        dance = [preset for preset in troupe["combatPresets"] if preset["choiceGroup"]]
        self.assertEqual(len(dance), 3)
        self.assertEqual(dance[0]["id"], "000002536:3")
        self.assertEqual(dance[1]["id"], "000002536:3:2")
        self.assertEqual({preset["choiceGroup"] for preset in dance}, {"000002536:3"})
        for unit in catalogue["units"]:
            weapon_group_ids = {weapon["groupId"] for weapon in unit["weapons"]}
            for limit in unit["weaponLimits"]:
                self.assertIn(limit["groupId"], weapon_group_ids)
                self.assertTrue(limit["terms"])
                for term in limit["terms"]:
                    self.assertIn(term["source"], unit["wargearOptions"])
            for pool in unit["wargearChoicePools"]:
                self.assertIn(pool["source"], unit["wargearOptions"])
                self.assertTrue(pool["alternatives"])
                for weapon in pool["replaces"]:
                    self.assertIn(weapon["groupId"], weapon_group_ids)
                    self.assertGreater(weapon["quantity"], 0)
                for alternative in pool["alternatives"]:
                    self.assertTrue(alternative["weapons"])
                    for weapon in alternative["weapons"]:
                        self.assertIn(weapon["groupId"], weapon_group_ids)
                        self.assertGreater(weapon["quantity"], 0)
            for weapon in unit["defaultWeapons"]:
                self.assertIn(weapon["groupId"], weapon_group_ids)
                self.assertTrue(weapon["terms"])
                for term in weapon["terms"]:
                    self.assertGreater(term["quantity"], 0)
                    self.assertGreater(term["modelsPerIncrement"], 0)
                    self.assertEqual(term["source"], unit["loadout"])
            for subject in unit["unresolvedLoadoutSubjects"]:
                self.assertTrue(subject["id"].startswith(f"{unit['id']}:"))
                self.assertTrue(subject["subject"])
                self.assertTrue(subject["equipment"])
                self.assertTrue(subject["weapons"])
                for weapon in subject["weapons"]:
                    self.assertIn(weapon["groupId"], weapon_group_ids)
                    self.assertGreater(weapon["quantity"], 0)

        accursed = next(
            unit for unit in catalogue["units"] if unit["name"] == "Accursed Cultists"
        )
        torment = next(
            subject
            for subject in accursed["unresolvedLoadoutSubjects"]
            if subject["subject"] == "Every Torment"
        )
        self.assertEqual(
            [
                (weapon["groupName"], weapon["quantity"])
                for weapon in torment["weapons"]
            ],
            [("Hideous mutations", 1)],
        )

        achillus = next(
            unit
            for unit in catalogue["units"]
            if unit["name"] == "Contemptor-achillus Dreadnought"
        )
        self.assertEqual(len(achillus["wargearChoicePools"]), 1)
        pool = achillus["wargearChoicePools"][0]
        self.assertEqual(
            [(weapon["groupName"], weapon["quantity"]) for weapon in pool["replaces"]],
            [("Lastrum storm bolter", 2)],
        )
        self.assertEqual(
            sorted(
                (
                    weapon["groupName"],
                    weapon["terms"][0]["fixed"] * weapon["terms"][0]["quantity"],
                    weapon["terms"][0]["perModel"],
                )
                for weapon in achillus["defaultWeapons"]
            ),
            [("Achillus dreadspear", 1, 0), ("Lastrum storm bolter", 2, 0)],
        )
        self.assertEqual(len(pool["alternatives"]), 5)
        mixed = next(
            alternative
            for alternative in pool["alternatives"]
            if "lastrum storm bolter and 1 infernus" in alternative["label"].lower()
        )
        self.assertEqual(
            mixed["weapons"],
            [
                {
                    "groupId": next(
                        weapon["groupId"]
                        for weapon in achillus["weapons"]
                        if weapon["groupName"] == "Infernus incinerator"
                    ),
                    "groupName": "Infernus incinerator",
                    "quantity": 1,
                }
            ],
        )

    def test_checked_browser_catalogue_matches_the_database_export(self):
        with tempfile.TemporaryDirectory() as directory:
            exported = Path(directory) / "profile-data.json"
            export(DATABASE, exported)
            self.assertEqual(exported.read_bytes(), CATALOGUE.read_bytes())

    def test_grouped_weapon_profiles_are_mutually_identifiable(self):
        catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))
        grouped = {
            weapon["groupId"]
            for unit in catalogue["units"]
            for weapon in unit["weapons"]
            if weapon["profileCount"] > 1
        }
        self.assertEqual(len(grouped), 787)
        sisters = next(
            unit
            for unit in catalogue["units"]
            if unit["name"] == "Battle Sisters Squad"
        )
        plasma = [
            weapon
            for weapon in sisters["weapons"]
            if weapon["groupName"] == "Plasma pistol"
        ]
        self.assertEqual(
            {weapon["profileName"] for weapon in plasma}, {"standard", "supercharge"}
        )
        self.assertEqual(len({weapon["groupId"] for weapon in plasma}), 1)
        drazhar = next(unit for unit in catalogue["units"] if unit["name"] == "Drazhar")
        demiklaives = [
            weapon
            for weapon in drazhar["weapons"]
            if weapon["groupName"] == "Executioner’s demiklaives"
        ]
        self.assertEqual(len(demiklaives), 2)
        self.assertEqual(len({weapon["groupId"] for weapon in demiklaives}), 1)
        self.assertEqual(
            next(
                weapon
                for weapon in drazhar["defaultWeapons"]
                if weapon["groupName"] == "Executioner’s demiklaives"
            )["terms"][0]["fixed"],
            1,
        )

        boyz = next(unit for unit in catalogue["units"] if unit["name"] == "Boyz")
        self.assertEqual(
            (boyz["suggestedModelCount"], boyz["maximumModelCount"]), (10, 20)
        )
        choppa = next(
            weapon
            for weapon in boyz["defaultWeapons"]
            if weapon["groupName"] == "Choppa"
        )
        self.assertEqual(
            (choppa["terms"][0]["fixed"], choppa["terms"][0]["perModel"]),
            (-1, 1),
        )
        cadian = next(
            unit for unit in catalogue["units"] if unit["name"] == "Cadian Shock Troops"
        )
        self.assertEqual(
            (cadian["suggestedModelCount"], cadian["maximumModelCount"]), (10, 20)
        )
        lasgun = next(
            weapon
            for weapon in cadian["defaultWeapons"]
            if weapon["groupName"] == "Lasgun"
        )
        self.assertEqual(
            (
                lasgun["terms"][0]["perIncrement"],
                lasgun["terms"][0]["modelsPerIncrement"],
            ),
            (9, 10),
        )
        attaches = next(
            unit for unit in catalogue["units"] if unit["name"] == "Regimental Attachés"
        )
        self.assertEqual(attaches["suggestedModelCount"], 3)
        laspistol = next(
            weapon
            for weapon in attaches["defaultWeapons"]
            if weapon["groupName"] == "Laspistol"
        )
        self.assertEqual(
            sum(term["fixed"] * term["quantity"] for term in laspistol["terms"]), 3
        )


if __name__ == "__main__":
    unittest.main()
