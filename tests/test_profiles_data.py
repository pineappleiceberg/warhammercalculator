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
                "maximum_target_distance": None,
                "requires_attacker_charge": False,
                "requires_attacker_stationary": False,
                "requires_attached_unit": True,
                "requires_waaagh_active": False,
                "requires_oath_target": False,
                "requires_oath_wound_bonus": False,
                "requires_source_on_objective": False,
                "requires_target_on_objective": False,
                "requires_source_controls_objective": False,
                "requires_target_on_objective_not_controlled_by_source": False,
                "requires_target_battle_shocked": False,
                "requires_attacker_not_battle_shocked": False,
                "required_target_strength_state": None,
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

    def test_combat_preset_parser_splits_and_gates_exact_waaagh_rules(self):
        description = (
            "If your Army Faction is ORKS , once per battle, at the start of your Command "
            "phase, you can call a Waaagh!. If you do, until the start of your next Command "
            "phase, the Waaagh! is active for your army and: Units from your army with this "
            "ability are eligible to declare a charge in a turn in which they Advanced. Add "
            "1 to the Strength and Attacks characteristics of melee weapons equipped by "
            "models from your army with this ability. Models from your army with this ability "
            "have a 5+ invulnerable save."
        )
        presets = combat_presets("Waaagh!", description)
        self.assertEqual(
            [(preset["name"], preset["weapon_scope"]) for preset in presets],
            [
                ("Waaagh! — Melee weapons", "Melee"),
                ("Waaagh! — Invulnerable save", "Any"),
            ],
        )
        self.assertTrue(all(preset["requires_waaagh_active"] for preset in presets))
        self.assertEqual(
            [(effect["type"], effect["value"]) for effect in presets[0]["additional_effects"]],
            [("attacks_modifier", 1), ("strength_modifier", 1)],
        )
        self.assertEqual(
            [(effect["type"], effect["value"]) for effect in presets[1]["additional_effects"]],
            [("invulnerable_save", 5)],
        )
        self.assertTrue(
            combat_preset(
                "Each time this model makes a melee attack, if the Waaagh! is active for "
                "your army, add 1 to the Hit roll."
            )["requires_waaagh_active"]
        )
        self.assertFalse(
            combat_preset(
                "While a friendly ORKS unit is within 12\" of Makari, if the Waaagh! is "
                "active for your army, melee weapons equipped by models in that unit have "
                "the [LETHAL HITS] ability."
            )["requires_waaagh_active"]
        )

    def test_combat_preset_parser_splits_exact_oath_of_moment_effects(self):
        description = (
            "If your Army Faction is ADEPTUS ASTARTES , at the start of your Command "
            "phase, select one unit from your opponent’s army. Until the start of your "
            "next Command phase, that enemy unit is your Oath of Moment target. Each time "
            "a model with this ability makes an attack that targets your Oath of Moment "
            "target: You can re-roll the Hit roll. If you are using a Codex: Space Marines "
            "Detachment and your army does not include one or more units with the Black "
            "Templars, Blood Angels, Dark Angels, Deathwatch or Space Wolves keywords, add "
            "1 to the Wound roll as well."
        )
        presets = combat_presets("Oath of Moment", description)
        self.assertEqual(
            [preset["name"] for preset in presets],
            [
                "Oath of Moment — Hit re-roll",
                "Oath of Moment — Codex Wound bonus",
            ],
        )
        self.assertTrue(all(preset["activation"] == "automatic" for preset in presets))
        self.assertTrue(all(preset["requires_oath_target"] for preset in presets))
        self.assertFalse(presets[0]["requires_oath_wound_bonus"])
        self.assertTrue(presets[1]["requires_oath_wound_bonus"])
        self.assertEqual(
            (presets[0]["reroll_hits"], presets[0]["wound_modifier"]),
            (1, 0),
        )
        self.assertEqual(
            (presets[1]["reroll_hits"], presets[1]["wound_modifier"]),
            (0, 1),
        )
        changed = description.replace("add 1 to the Wound roll as well", "re-roll the Wound roll")
        self.assertEqual(len(combat_presets("Oath of Moment", changed)), 1)
        self.assertFalse(combat_presets("Oath of Moment", changed)[0]["requires_oath_target"])

    def test_combat_preset_parser_splits_direct_objective_rerolls(self):
        description = (
            "Each time a model in this unit makes an attack, re-roll a Wound roll of 1. "
            "If the target is within range of an objective marker, you can re-roll the "
            "Wound roll instead."
        )
        presets = combat_presets("Breaching Team", description)
        self.assertEqual(
            [preset["name"] for preset in presets],
            ["Breaching Team — Base re-roll", "Breaching Team — Objective re-roll"],
        )
        self.assertEqual([preset["activation"] for preset in presets], ["automatic", "automatic"])
        self.assertEqual(
            [preset["requires_target_on_objective"] for preset in presets],
            [False, True],
        )
        self.assertEqual(
            [(preset["reroll_wounds"], preset["reroll_wound_ones"]) for preset in presets],
            [(0, 1), (1, 0)],
        )

        controlled = description.replace(
            "an objective marker", "an objective marker you do not control"
        )
        self.assertEqual(len(combat_presets("Breaching Team", controlled)), 1)
        self.assertFalse(
            combat_presets("Breaching Team", controlled)[0]["requires_target_on_objective"]
        )
        compound = description.replace(
            "If the target is", "If the target is the closest eligible target and is"
        )
        self.assertEqual(len(combat_presets("Breaching Team", compound)), 1)
        self.assertFalse(
            combat_presets("Breaching Team", compound)[0]["requires_target_on_objective"]
        )

        vanguard = combat_presets(
            "Vanguard Predator",
            "Each time a model in this unit makes an attack, re-roll a Hit roll of 1. "
            "If the target is within range of one or more objective markers, re-roll a "
            "Wound roll of 1 as well.",
        )
        self.assertEqual([preset["activation"] for preset in vanguard], ["automatic", "automatic"])
        self.assertEqual(
            [
                (preset["reroll_hit_ones"], preset["reroll_wound_ones"])
                for preset in vanguard
            ],
            [(1, 0), (0, 1)],
        )

    def test_combat_preset_parser_projects_combat_effects_from_objective_control_text(self):
        black_rage = (
            "Each time this model makes a melee attack, you can re-roll the Hit roll. "
            'While this model’s unit is not within 6" of one or more friendly Blood Angels '
            'Character models, or 12" of one or more friendly Chaplain models, it cannot '
            "be selected to Fall Back and its Objective Control characteristic is 0."
        )
        preset = combat_presets("Black Rage", black_rage)[0]
        self.assertEqual(preset["activation"], "automatic")
        self.assertEqual(preset["weapon_scope"], "Melee")
        self.assertEqual((preset["reroll_hits"], preset["reroll_hit_ones"]), (1, 0))

    def test_combat_preset_parser_splits_exact_objective_ownership_rules(self):
        armoured = combat_presets(
            "Armoured Spearhead",
            "Each time this model makes an attack that targets an enemy unit, re-roll a Hit "
            "roll of 1 and, if that unit is within range of an objective marker you do not "
            "control, you can re-roll the Hit roll instead.",
        )
        self.assertEqual(len(armoured), 2)
        self.assertEqual(
            [(preset["reroll_hits"], preset["reroll_hit_ones"]) for preset in armoured],
            [(0, 1), (1, 0)],
        )
        self.assertEqual(
            [
                preset["requires_target_on_objective_not_controlled_by_source"]
                for preset in armoured
            ],
            [False, True],
        )
        battlefield = combat_presets(
            "Battlefield Control",
            "Each time this model makes a ranged attack, if it is within range of an "
            "objective marker you control, re-roll a Hit roll of 1.",
        )
        self.assertEqual(len(battlefield), 1)
        self.assertTrue(battlefield[0]["requires_source_controls_objective"])
        self.assertEqual(battlefield[0]["activation"], "automatic")
        closest = (
            "Each time a model in this unit makes a ranged attack that targets the closest "
            "eligible enemy unit, re-roll a Hit roll of 1. If the target of that attack is "
            "within range of an objective marker your opponent controls, you can re-roll "
            "the Hit roll instead."
        )
        self.assertEqual(len(combat_presets("Hard-wired for Destruction", closest)), 1)
        self.assertFalse(
            combat_presets("Hard-wired for Destruction", closest)[0][
                "requires_target_on_objective_not_controlled_by_source"
            ]
        )

        voice = (
            "While this model is leading a unit, improve the Objective Control "
            "characteristic of models in that unit by 1 and each time a model in that "
            "unit makes an attack, add 1 to the Hit roll."
        )
        preset = combat_presets("Voice of Experience", voice)[0]
        self.assertEqual(preset["activation"], "automatic")
        self.assertTrue(preset["requires_attached_unit"])
        self.assertEqual(preset["hit_modifier"], 1)

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

    def test_combat_preset_parser_scopes_phase_bounded_effects_conservatively(self):
        shooting_defense = combat_preset(
            "Once per battle, in your opponent's Shooting phase, before making a saving "
            "throw for this unit, use this ability. Until the end of the phase, models "
            "in this unit have a 5+ invulnerable save."
        )
        self.assertEqual(shooting_defense["weapon_scope"], "Ranged")

        fight_defense = combat_preset(
            "At the start of the Fight phase, select one stance to take effect until the "
            "end of the phase. Each time an attack targets this unit, subtract 1 from "
            "the Hit roll."
        )
        self.assertEqual(fight_defense["weapon_scope"], "Melee")

        selected_to_shoot = combat_preset(
            "Once per battle, when this model is selected to shoot, use this ability. "
            "Until the end of the phase, its Payback weapon has an Attacks "
            "characteristic of 6."
        )
        self.assertEqual(selected_to_shoot["weapon_scope"], "Ranged")

        both_phases = combat_preset(
            "In your Shooting phase or the Fight phase, when this unit is selected to "
            "shoot or fight, use this ability. Until the end of the phase, weapons "
            "equipped by models in this unit have the [LETHAL HITS] ability."
        )
        self.assertEqual(both_phases["weapon_scope"], "Any")

        either_activation = combat_preset(
            "When this unit is selected to shoot or fight, use this ability. Until the "
            "end of the phase, weapons equipped by models in this unit have the "
            "[LETHAL HITS] ability."
        )
        self.assertEqual(either_activation["weapon_scope"], "Any")

        lasts_beyond_phase = combat_preset(
            "In your Shooting phase, select one enemy unit. Until the end of the turn, "
            "each time a friendly model makes an attack that targets that enemy unit, "
            "improve the Armour Penetration characteristic of that attack by 1."
        )
        self.assertEqual(lasts_beyond_phase["weapon_scope"], "Any")

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
        self.assertEqual(conditional[0]["activation"], "automatic")
        self.assertTrue(conditional[0]["requires_attached_unit"])
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
        bearer = combat_preset(
            "The bearer has a 4+ invulnerable save.",
            allow_bearer_defenses=True,
        )
        self.assertEqual(
            bearer["additional_effects"],
            [
                {
                    "type": "invulnerable_save",
                    "value": 4,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "target",
                    "subject": "self",
                }
            ],
        )
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
        self.assertEqual(
            replacement["additional_effects"],
            [
                {
                    "type": "attacks_replacement",
                    "value": 4,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "attacker",
                    "subject": "self",
                    "weapon_name": None,
                }
            ],
        )

        closest_target = combat_preset(
            "Each time a model in this unit targets the closest eligible target with its "
            "snazzgun, until the end of the phase, that weapon has an Attacks "
            "characteristic of 4."
        )
        self.assertEqual(
            closest_target["additional_effects"][0],
            {
                "type": "attacks_replacement",
                "value": 4,
                "dice_count": 0,
                "dice_sides": 0,
                "role": "attacker",
                "subject": "self",
                "weapon_name": "snazzgun",
            },
        )
        stateful_compound = combat_preset(
            "Once per battle, when this model is selected to shoot, it can use this ability. "
            "If it does, until the end of the phase, its Payback weapon has an Attacks "
            "characteristic of 6 and the [SUSTAINED HITS 3] ability instead of the "
            "[SUSTAINED HITS 1] ability."
        )
        self.assertEqual(
            stateful_compound["additional_effects"],
            [
                {
                    "type": "attacks_replacement",
                    "value": 6,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "role": "attacker",
                    "subject": "self",
                    "weapon_name": "Payback",
                },
                {
                    "type": "sustained_hits",
                    "value": 3,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "weapon_name": "Payback",
                    "role": "attacker",
                    "subject": "self",
                },
            ],
        )
        self.assertIsNone(
            combat_preset(
                "Melee weapons equipped by non-CHARACTER models in this unit have an "
                "Attacks characteristic of 4."
            )
        )

        charged = combat_preset(
            "Each time this model makes a melee attack, if it made a Charge move this "
            "turn, you can re-roll the Hit roll and you can re-roll the Wound roll."
        )
        self.assertTrue(charged["requires_attacker_charge"])
        self.assertFalse(
            combat_preset(
                "Each time a model in this unit makes a melee attack, if this unit made "
                "a Charge move or was charged this turn, add 1 to the Wound roll."
            )["requires_attacker_charge"]
        )

        stationary = combat_preset(
            "Each time this unit Remains Stationary, until the start of your next "
            "Movement phase, ranged weapons equipped by models in this unit have the "
            "[DEVASTATING WOUNDS] ability."
        )
        self.assertTrue(stationary["requires_attacker_stationary"])
        stationary_in_movement = combat_preset(
            "In your Movement phase, if this model Remains Stationary, until the end "
            "of the turn, ranged weapons equipped by this model have the "
            "[SUSTAINED HITS 1] ability."
        )
        self.assertTrue(stationary_in_movement["requires_attacker_stationary"])
        self.assertFalse(
            combat_preset(
                "While this unit is being affected by an Order, provided it Remained "
                "Stationary this turn, all Heavy weapons equipped by models in this "
                "unit have the [SUSTAINED HITS 1] ability."
            )["requires_attacker_stationary"]
        )
        self.assertFalse(
            combat_preset(
                "Each time this unit Remains Stationary, if it includes a Long Fang "
                "Pack Leader, each time a model in this unit makes a ranged attack, "
                "re-roll a Hit roll of 1."
            )["requires_attacker_stationary"]
        )
        self.assertFalse(
            combat_preset(
                "Each time a model in this unit makes a ranged attack that targets the "
                "closest eligible target, or makes a melee attack in a turn in which it "
                "made a Charge move, improve the Strength characteristic of that attack by 2."
            )["requires_attacker_charge"]
        )

        target_battle_shocked = combat_preset(
            "Each time a model in this unit makes a melee attack that targets a "
            "Battle-shocked unit, add 1 to the Hit roll."
        )
        self.assertTrue(target_battle_shocked["requires_target_battle_shocked"])
        self.assertFalse(
            target_battle_shocked["requires_attacker_not_battle_shocked"]
        )
        attacker_not_battle_shocked = combat_preset(
            "Each time this model makes a melee attack, unless this model’s unit is "
            "Battle-shocked, you can re-roll the Hit roll."
        )
        self.assertTrue(
            attacker_not_battle_shocked["requires_attacker_not_battle_shocked"]
        )
        self.assertFalse(
            combat_preset(
                "While an enemy unit is within 12\" of this model, if that unit is "
                "Battle-shocked: each time a friendly model makes an attack that targets "
                "that unit, add 1 to the Wound roll."
            )["requires_target_battle_shocked"]
        )

        attached = combat_preset(
            "While this model is leading a unit, each time a model in that unit makes "
            "a melee attack, add 1 to the Wound roll."
        )
        self.assertTrue(attached["requires_attached_unit"])
        self.assertFalse(
            combat_preset(
                "While this model is leading a unit, each time a model in that unit makes "
                "an attack, if the target is Battle-shocked, add 1 to the Wound roll."
            )["requires_attached_unit"]
        )
        nearby_scaling = combat_preset(
            "Each time this model fights, until that fight is resolved, add 1 to the "
            "Attacks characteristic of this model’s Blood Reaver for every 5 enemy "
            'models within 6" of this model.'
        )
        self.assertEqual(
            nearby_scaling["additional_effects"],
            [
                {
                    "type": "attacks_modifier",
                    "value": 1,
                    "dice_count": 0,
                    "dice_sides": 0,
                    "models_per_increment": 5,
                    "model_count_source": "nearby_enemy",
                    "weapon_name": "Blood Reaver",
                    "role": "attacker",
                    "subject": "self",
                }
            ],
        )
        source_scaling = combat_preset(
            "While this model is leading a unit, add 2 to the Attacks characteristic "
            "of this model’s Eyez of Mork weapon for every 5 models in that unit "
            "(rounding down), but while that unit contains 10 or more models, that "
            "weapon has the [HAZARDOUS] ability."
        )
        self.assertTrue(source_scaling["requires_attached_unit"])
        self.assertEqual(
            source_scaling["additional_effects"][0]["model_count_source"],
            "source_unit",
        )
        self.assertIsNone(
            combat_preset(
                "Each time this model fights, add 1 to its Attacks characteristic for "
                "every enemy model nearby."
            )
        )
        below_half = combat_preset(
            "Each time this model makes an attack that targets an enemy unit that is "
            "Below Half-strength, add 1 to the Hit roll and add 1 to the Wound roll."
        )
        self.assertEqual(below_half["required_target_strength_state"], "below_half")
        not_below_half = combat_preset(
            "Each time this model makes a ranged attack that targets a unit that is not "
            "Below Half-strength, you can re-roll the Hit roll."
        )
        self.assertEqual(
            not_below_half["required_target_strength_state"], "not_below_half"
        )
        self.assertIsNone(
            combat_preset(
                "While this model is leading a unit, each time a model in that unit makes "
                "an attack that targets a unit that is Below Half-strength, add 1 to the "
                "Hit roll."
            )["required_target_strength_state"]
        )
        self.assertIsNone(
            combat_preset(
                "Each time this model makes an attack with its executioner plasma cannon "
                "that targets a unit that is Below Half-strength, add 1 to the Hit roll."
            )["required_target_strength_state"]
        )
        self.assertIsNone(
            combat_preset(
                "Each time this model makes an attack that targets a unit that is below its "
                "Starting Strength, you can re-roll the Hit roll. If that target is Below "
                "Half-strength, you can re-roll the Wound roll as well."
            )["required_target_strength_state"]
        )
        self.assertFalse(
            combat_preset(
                "While this model is leading a unit, each time a model in that unit makes "
                "an attack, add 1 to the Hit roll. If the target is Battle-shocked, add 1 "
                "to the Wound roll as well."
            )["requires_target_battle_shocked"]
        )

        moment_shackle = combat_presets(
            "Moment Shackle",
            "Once per battle, at the start of the Fight phase, you can select one of the "
            "following to take effect until the end of the phase: This model’s Watcher’s "
            "Axe melee weapon has an Attacks characteristic of 12. This model has a 2+ "
            "invulnerable save.",
        )
        self.assertEqual(
            [preset["name"] for preset in moment_shackle],
            [
                "Moment Shackle — Attacks 12",
                "Moment Shackle — Invulnerable 2+",
            ],
        )
        self.assertTrue(all(preset["is_exclusive_choice"] for preset in moment_shackle))

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
                "39",
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
                    """SELECT datasheet.name, preset.name, preset.weapon_scope, effect.value,
                              effect.weapon_name, effect.required_target_keyword,
                              effect.application_role, effect.subject
                       FROM unit_combat_preset_effects AS effect
                       JOIN unit_combat_presets AS preset
                         USING (datasheet_id, ability_position, preset_position)
                       JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                       WHERE effect.effect_type = 'attacks_replacement'
                       ORDER BY datasheet.name, preset.name"""
                ).fetchall(),
                [
                    (
                        "Arco-flagellants",
                        "Extremis Trigger Word",
                        "Melee",
                        6,
                        "arco-flails",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Captain Tycho",
                        "Embittered",
                        "Any",
                        12,
                        "Dead Man’s Hand",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Culexus Assassin",
                        "Psychic Assassin",
                        "Any",
                        6,
                        "Animus speculum",
                        "psyker",
                        "attacker",
                        "self",
                    ),
                    (
                        "Fire Prism",
                        "Linked Fire",
                        "Any",
                        1,
                        "Prism cannon – focused lances",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Flash Gitz",
                        "Gun-crazy Show-offs",
                        "Any",
                        4,
                        "snazzgun",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Iron Priest On Thunderwolf",
                        "Vengeance of the Omnissiah",
                        "Any",
                        6,
                        "Iron Priest hammer",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Lelith Hesperax",
                        "Thrilling Spectacle",
                        "Melee",
                        12,
                        None,
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Sergeant Harker",
                        "Payback Time",
                        "Ranged",
                        6,
                        "Payback",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Tech-Priest Enginseer",
                        "Vengeance for the Omnissiah",
                        "Any",
                        6,
                        "Enginseer axe",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Tech-priest Enginseer",
                        "Vengeance for the Omnissiah",
                        "Any",
                        6,
                        "Omnissian axe",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Techmarine",
                        "Vengeance of the Omnissiah",
                        "Any",
                        7,
                        "Omnissian power axe",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Techmarine on Bike",
                        "Vengeance of the Omnissiah",
                        "Any",
                        7,
                        "Omnissian power axe",
                        None,
                        "attacker",
                        "self",
                    ),
                    (
                        "Trajann Valoris",
                        "Moment Shackle — Attacks 12",
                        "Melee",
                        12,
                        "Watcher’s Axe",
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
                    ("Dead Brutal", "Any", 3, "attacker", "self"),
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
                    ("attacks_modifier", 110),
                    ("damage_modifier", 5),
                    ("strength_modifier", 179),
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
                    ("damage_reduction", 32),
                    ("feel_no_pain", 41),
                    ("invulnerable_save", 140),
                    ("save_target", 3),
                ],
            )
            self.assertEqual(
                connection.execute(
                    "SELECT activation, count(*) FROM unit_combat_presets GROUP BY activation"
                ).fetchall(),
                [("automatic", 1011), ("inherent", 32), ("situational", 904)],
            )
            self.assertEqual(
                connection.execute(
                    "SELECT weapon_scope, count(*) FROM unit_combat_presets "
                    "GROUP BY weapon_scope ORDER BY weapon_scope"
                ).fetchall(),
                [("Any", 1199), ("Melee", 402), ("Ranged", 346)],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT datasheet.name, preset.name, preset.activation,
                              preset.requires_attached_unit, effect.value,
                              effect.models_per_increment, effect.model_count_source,
                              effect.weapon_name
                       FROM unit_combat_preset_effects AS effect
                       JOIN unit_combat_presets AS preset
                         USING (datasheet_id, ability_position, preset_position)
                       JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                       WHERE effect.model_count_source IS NOT NULL
                       ORDER BY datasheet.name"""
                ).fetchall(),
                [
                    (
                        "Gabriel Seth",
                        "Whirlwind of Gore",
                        "automatic",
                        0,
                        1,
                        5,
                        "nearby_enemy",
                        "Blood Reaver",
                    ),
                    (
                        "Wurrboy",
                        "Unstable Oracle",
                        "automatic",
                        1,
                        2,
                        5,
                        "source_unit",
                        "Eyez of Mork",
                    ),
                ],
            )
            charge_rows = connection.execute(
                """SELECT datasheet.name, preset.name
                   FROM unit_combat_presets AS preset
                   JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                   WHERE preset.requires_attacker_charge = 1
                   ORDER BY datasheet.name, preset.name"""
            ).fetchall()
            self.assertEqual(len(charge_rows), 17)
            self.assertIn(("Beastboss", "Beastly Rage"), charge_rows)
            self.assertIn(("Captain With Jump Pack", "Angel’s Wrath"), charge_rows)
            self.assertIn(("‘Iron Hand’ Straken", "Been There, Seen it, Killed it"), charge_rows)
            self.assertNotIn(("Catachan Jungle Fighters", "Jungle Fighters"), charge_rows)
            self.assertNotIn(("Indomitor Kill Team", "Indomitor Doctrines"), charge_rows)
            self.assertNotIn(("Zephyrim Squad", "Embodied Prophecy"), charge_rows)
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       WHERE requires_attacker_charge = 1 AND activation != 'automatic'"""
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                connection.execute(
                    """SELECT sum(requires_source_controls_objective),
                              sum(requires_target_on_objective_not_controlled_by_source)
                       FROM unit_combat_presets"""
                ).fetchone(),
                (4, 11),
            )
            ownership_rows = connection.execute(
                """SELECT name, requires_source_controls_objective,
                          requires_target_on_objective_not_controlled_by_source, count(*)
                   FROM unit_combat_presets
                   WHERE requires_source_controls_objective = 1
                      OR requires_target_on_objective_not_controlled_by_source = 1
                   GROUP BY name, requires_source_controls_objective,
                            requires_target_on_objective_not_controlled_by_source
                   ORDER BY name"""
            ).fetchall()
            self.assertIn(
                ("Armoured Spearhead — Objective-control re-roll", 0, 1, 9),
                ownership_rows,
            )
            self.assertIn(("Battlefield Control", 1, 0, 2), ownership_rows)
            self.assertIn(
                ("Bringers of Change — Objective-control re-roll", 0, 1, 2),
                ownership_rows,
            )
            self.assertIn(
                ("Stand Vigil — Objective-control re-roll", 1, 0, 2), ownership_rows
            )
            oath_rows = connection.execute(
                """SELECT preset.name, preset.requires_oath_wound_bonus,
                          preset.wound_modifier, preset.reroll_hits, count(*)
                   FROM unit_combat_presets AS preset
                   WHERE preset.requires_oath_target = 1
                   GROUP BY preset.name, preset.requires_oath_wound_bonus,
                            preset.wound_modifier, preset.reroll_hits
                   ORDER BY preset.name"""
            ).fetchall()
            self.assertEqual(
                oath_rows,
                [
                    ("Oath of Moment — Codex Wound bonus", 1, 1, 0, 275),
                    ("Oath of Moment — Hit re-roll", 0, 0, 1, 275),
                ],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       WHERE requires_oath_target = 1 AND activation != 'automatic'"""
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                connection.execute(
                    """SELECT sum(requires_source_on_objective),
                              sum(requires_target_on_objective)
                       FROM unit_combat_presets"""
                ).fetchone(),
                (1, 21),
            )
            objective_rows = connection.execute(
                """SELECT name, requires_source_on_objective,
                          requires_target_on_objective, count(*)
                   FROM unit_combat_presets
                   WHERE requires_source_on_objective = 1
                      OR requires_target_on_objective = 1
                   GROUP BY name, requires_source_on_objective,
                            requires_target_on_objective
                   ORDER BY name"""
            ).fetchall()
            self.assertIn(("Aggressor Guardian — Defence", 1, 0, 1), objective_rows)
            self.assertIn(("Breach and Clear", 0, 1, 1), objective_rows)
            self.assertIn(("Reavers of the Void — Objective re-roll", 0, 1, 2), objective_rows)
            self.assertIn(("Veterans of the Long War — Objective re-roll", 0, 1, 2), objective_rows)
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       WHERE (requires_source_on_objective = 1
                           OR requires_target_on_objective = 1)
                         AND activation != 'automatic'"""
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                connection.execute(
                    """SELECT activation, count(*) FROM unit_combat_presets
                       WHERE name = 'Black Rage' GROUP BY activation"""
                ).fetchall(),
                [("automatic", 10)],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT activation, requires_attached_unit
                       FROM unit_combat_presets WHERE name = 'Voice of Experience'"""
                ).fetchone(),
                ("automatic", 1),
            )
            waaagh_rows = connection.execute(
                """SELECT datasheet.name, preset.name, preset.weapon_scope
                   FROM unit_combat_presets AS preset
                   JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                   WHERE preset.requires_waaagh_active = 1
                   ORDER BY datasheet.name, preset.name"""
            ).fetchall()
            self.assertEqual(len(waaagh_rows), 180)
            self.assertIn(("Boyz", "Waaagh! — Melee weapons", "Melee"), waaagh_rows)
            self.assertIn(("Boyz", "Waaagh! — Invulnerable save", "Any"), waaagh_rows)
            self.assertIn(("Gorkanaut", "Big an’ Stompy", "Melee"), waaagh_rows)
            self.assertIn(("Meganobz", "Krumpin’ Time", "Any"), waaagh_rows)
            self.assertIn(("Warboss", "Da Biggest and da Best", "Melee"), waaagh_rows)
            self.assertIn(("Warboss In Mega Armour", "Dead Brutal", "Any"), waaagh_rows)
            self.assertNotIn(
                ("Ghazghkull Thraka", "Ghazghkull’s Waaagh! Banner (Aura)", "Melee"),
                waaagh_rows,
            )
            self.assertNotIn(
                ("Ghazghkull Thraka", "Prophet of Da Great Waaagh!", "Melee"),
                waaagh_rows,
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       WHERE requires_waaagh_active = 1
                         AND activation != 'automatic'"""
                ).fetchone()[0],
                0,
            )
            attached_rows = connection.execute(
                """SELECT datasheet.name, preset.name
                   FROM unit_combat_presets AS preset
                   JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                   WHERE preset.requires_attached_unit = 1
                   ORDER BY datasheet.name, preset.name"""
            ).fetchall()
            self.assertEqual(len(attached_rows), 157)
            self.assertIn(("Chaplain", "Litany of Hate"), attached_rows)
            self.assertIn(("Chronomancer", "Timesplinter Mantle"), attached_rows)
            self.assertIn(("Imagifier", "Stanchion of Holy Martyrs"), attached_rows)
            self.assertIn(("Wurrboy", "Unstable Oracle"), attached_rows)
            self.assertNotIn(("Aleya", "Tenacious Spirit"), attached_rows)
            self.assertNotIn(("Commander Farsight", "Way of the Short Blade"), attached_rows)
            self.assertNotIn(("Ghazghkull Thraka", "Prophet of Da Great Waaagh!"), attached_rows)
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       WHERE requires_attached_unit = 1
                         AND activation != 'automatic'"""
                ).fetchone()[0],
                0,
            )
            stationary_rows = connection.execute(
                """SELECT datasheet.name, preset.name
                   FROM unit_combat_presets AS preset
                   JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                   WHERE preset.requires_attacker_stationary = 1
                   ORDER BY datasheet.name, preset.name"""
            ).fetchall()
            self.assertEqual(len(stationary_rows), 8)
            self.assertIn(
                ("Acastus Knight Porphyrion", "Bastion of Firepower"),
                stationary_rows,
            )
            self.assertIn(("Devastator Squad", "Signum"), stationary_rows)
            self.assertIn(("Knight Crusader", "Punishing Salvoes"), stationary_rows)
            self.assertNotIn(("Long Fangs", "Fire Discipline"), stationary_rows)
            self.assertNotIn(
                ("Field Ordnance Battery", "Rearm, Reload, Fire"), stationary_rows
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       WHERE requires_attacker_stationary = 1
                         AND activation != 'automatic'"""
                ).fetchone()[0],
                0,
            )
            strength_rows = connection.execute(
                """SELECT datasheet.name, preset.name,
                          preset.required_target_strength_state
                   FROM unit_combat_presets AS preset
                   JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                   WHERE preset.required_target_strength_state IS NOT NULL
                   ORDER BY preset.required_target_strength_state,
                            datasheet.name, preset.name"""
            ).fetchall()
            self.assertEqual(len(strength_rows), 15)
            self.assertIn(
                ("Cyberwolf", "Close In for the Kill", "below_half"), strength_rows
            )
            self.assertIn(
                ("Vigilant Squad", "Merciless Judgement", "below_half"),
                strength_rows,
            )
            self.assertIn(
                ("Ballistus Dreadnought", "Ballistus Strike", "not_below_half"),
                strength_rows,
            )
            self.assertEqual(
                sum(row[2] == "below_half" for row in strength_rows), 6
            )
            self.assertEqual(
                sum(row[2] == "not_below_half" for row in strength_rows), 9
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       WHERE required_target_strength_state IS NOT NULL
                         AND activation != 'automatic'"""
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets AS preset
                       JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                       WHERE datasheet.name IN ('Drazhar', 'Inquisitor Greyfax',
                                                'Leman Russ Executioner', 'Maleceptor')
                         AND preset.required_target_strength_state IS NOT NULL"""
                ).fetchone()[0],
                0,
            )
            battle_shock_rows = connection.execute(
                """SELECT datasheet.name, preset.name,
                          preset.requires_target_battle_shocked,
                          preset.requires_attacker_not_battle_shocked
                   FROM unit_combat_presets AS preset
                   JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                   WHERE preset.requires_target_battle_shocked = 1
                      OR preset.requires_attacker_not_battle_shocked = 1
                   ORDER BY datasheet.name, preset.name"""
            ).fetchall()
            self.assertEqual(
                battle_shock_rows,
                [
                    ("Furies", "Prey on the Weak", 1, 0),
                    ("Hierophant", "Apex-beast", 1, 0),
                    ("Incubi", "Tormentors", 1, 0),
                    ("Ministorum Priest", "Holy Piety", 0, 1),
                ],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       WHERE (requires_target_battle_shocked = 1
                              OR requires_attacker_not_battle_shocked = 1)
                         AND activation != 'automatic'"""
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets AS preset
                       JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                       WHERE datasheet.name IN ('Neurolictor', 'Neurotyrant',
                                                'Hand of the Archon')
                         AND (preset.requires_target_battle_shocked = 1
                              OR preset.requires_attacker_not_battle_shocked = 1)"""
                ).fetchone()[0],
                0,
            )
            self.assertEqual(
                connection.execute(
                    """SELECT effect.effect_type, effect.value
                       FROM unit_combat_preset_effects AS effect
                       JOIN unit_combat_presets AS preset
                         USING (datasheet_id, ability_position, preset_position)
                       JOIN datasheets AS datasheet ON datasheet.id = preset.datasheet_id
                       WHERE datasheet.name = 'Red Corsairs Reave-Captain'
                         AND preset.name = 'Brutal Raider'
                       ORDER BY effect.effect_type"""
                ).fetchall(),
                [("ap_modifier", 1), ("strength_modifier", 1)],
            )
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       WHERE weapon_scope = 'Any'
                         AND lower(description_text) LIKE '%until the end of the phase%'
                         AND ((lower(description_text) LIKE '%shooting phase%'
                               AND lower(description_text) NOT LIKE '%fight phase%')
                              OR (lower(description_text) LIKE '%fight phase%'
                                  AND lower(description_text) NOT LIKE '%shooting phase%'))"""
                ).fetchone()[0],
                0,
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
                [
                    ("automatic", 2, "self", 1),
                    ("automatic", 4, "led_unit", 12),
                    ("situational", 3, "self", 1),
                    ("situational", 4, "led_unit", 2),
                ],
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

    def test_checked_database_has_only_unambiguous_target_distance_presets(self):
        connection = sqlite3.connect(DATABASE)
        try:
            self.assertEqual(
                connection.execute(
                    """SELECT datasheets.name, unit_combat_presets.name,
                              unit_combat_presets.maximum_target_distance
                       FROM unit_combat_presets
                       JOIN datasheets ON datasheets.id = unit_combat_presets.datasheet_id
                       WHERE maximum_target_distance IS NOT NULL
                       ORDER BY datasheets.name"""
                ).fetchall(),
                [
                    ("Commander Farsight", "Way of the Short Blade", 9),
                    ("Warbikers", "Drive-by Dakka", 9),
                    ("Wartrakks", "Drive-by Dakka", 9),
                ],
            )
        finally:
            connection.close()

    def test_bearer_defenses_are_limited_to_single_model_datasheets(self):
        connection = sqlite3.connect(DATABASE)
        try:
            rows = connection.execute(
                """SELECT datasheets.name, unit_combat_presets.name,
                          count(DISTINCT unit_combat_presets.datasheet_id || ':' ||
                              unit_combat_presets.ability_position || ':' ||
                              unit_combat_presets.preset_position),
                          count(unit_combat_preset_effects.effect_position)
                   FROM unit_combat_presets
                   JOIN datasheets ON datasheets.id = unit_combat_presets.datasheet_id
                   LEFT JOIN unit_combat_preset_effects USING
                       (datasheet_id, ability_position, preset_position)
                   WHERE lower(unit_combat_presets.description_text) LIKE 'the bearer has%'
                     AND unit_combat_presets.datasheet_id IN
                         (SELECT datasheet_id FROM unit_composition
                          GROUP BY datasheet_id
                          HAVING SUM(max_models IS NULL) = 0 AND SUM(max_models) = 1)
                   GROUP BY datasheets.name, unit_combat_presets.name
                   ORDER BY datasheets.name, unit_combat_presets.name"""
            ).fetchall()
            self.assertEqual(len(rows), 20)
            self.assertEqual(sum(row[2] for row in rows), 21)
            self.assertEqual(sum(row[3] for row in rows), 23)
            self.assertIn(("Impulsor", "Shield Dome", 2, 2), rows)
            self.assertIn(("Wraithknight", "Scattershield", 1, 2), rows)
            self.assertEqual(
                connection.execute(
                    """SELECT count(*) FROM unit_combat_presets
                       JOIN datasheets ON datasheets.id = unit_combat_presets.datasheet_id
                       WHERE datasheets.name = 'Lychguard'
                         AND unit_combat_presets.name = 'Dispersion Shield'"""
                ).fetchone()[0],
                0,
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
        self.assertEqual(paroxysm["weaponScope"], "Melee")
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
        flash_gitz = next(
            unit for unit in catalogue["units"] if unit["name"] == "Flash Gitz"
        )
        show_offs = next(
            preset
            for preset in flash_gitz["combatPresets"]
            if preset["name"] == "Gun-crazy Show-offs"
        )
        self.assertEqual(show_offs["activation"], "situational")
        self.assertEqual(show_offs["effects"][0]["weaponName"], "snazzgun")
        self.assertEqual(show_offs["effects"][0]["value"], 4)

        harker = next(
            unit for unit in catalogue["units"] if unit["name"] == "Sergeant Harker"
        )
        payback = next(
            preset
            for preset in harker["combatPresets"]
            if preset["name"] == "Payback Time"
        )
        self.assertEqual(payback["weaponScope"], "Ranged")
        self.assertEqual(
            [
                (effect["type"], effect["value"], effect["weaponName"])
                for effect in payback["effects"]
            ],
            [
                ("attacks_replacement", 6, "Payback"),
                ("sustained_hits", 3, "Payback"),
            ],
        )

        kommandos = next(
            unit for unit in catalogue["units"] if unit["name"] == "Kommandos"
        )
        distraction_grot = next(
            preset
            for preset in kommandos["combatPresets"]
            if preset["name"] == "Distraction Grot"
        )
        self.assertEqual(distraction_grot["weaponScope"], "Ranged")

        ridgerunners = next(
            unit for unit in catalogue["units"] if unit["name"] == "Achilles Ridgerunners"
        )
        crossfire = next(
            preset
            for preset in ridgerunners["combatPresets"]
            if preset["name"] == "Crossfire"
        )
        self.assertEqual(crossfire["weaponScope"], "Any")

        fire_prism = next(
            unit for unit in catalogue["units"] if unit["name"] == "Fire Prism"
        )
        linked_fire = next(
            preset
            for preset in fire_prism["combatPresets"]
            if preset["name"] == "Linked Fire"
        )
        self.assertEqual(
            linked_fire["effects"][0]["weaponName"],
            "Prism cannon – focused lances",
        )

        trajann = next(
            unit for unit in catalogue["units"] if unit["name"] == "Trajann Valoris"
        )
        moment_shackle = [
            preset
            for preset in trajann["combatPresets"]
            if preset["name"].startswith("Moment Shackle —")
        ]
        self.assertEqual(len(moment_shackle), 2)
        self.assertEqual(len({preset["choiceGroup"] for preset in moment_shackle}), 1)
        self.assertIsNotNone(moment_shackle[0]["choiceGroup"])
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
        self.assertEqual(martyrs["activation"], "automatic")
        self.assertTrue(martyrs["requiresAttachedUnit"])
        gabriel = next(unit for unit in catalogue["units"] if unit["name"] == "Gabriel Seth")
        whirlwind = next(
            preset for preset in gabriel["combatPresets"] if preset["name"] == "Whirlwind of Gore"
        )
        self.assertEqual(whirlwind["activation"], "automatic")
        self.assertEqual(
            whirlwind["effects"],
            [
                {
                    "type": "attacks_modifier",
                    "value": 1,
                    "diceCount": 0,
                    "diceSides": 0,
                    "modelsPerIncrement": 5,
                    "modelCountSource": "nearby_enemy",
                    "weaponName": "Blood Reaver",
                    "role": "attacker",
                    "subject": "self",
                }
            ],
        )
        wurrboy = next(unit for unit in catalogue["units"] if unit["name"] == "Wurrboy")
        unstable = next(
            preset for preset in wurrboy["combatPresets"] if preset["name"] == "Unstable Oracle"
        )
        self.assertTrue(unstable["requiresAttachedUnit"])
        self.assertEqual(unstable["effects"][0]["modelCountSource"], "source_unit")
        boyz = next(unit for unit in catalogue["units"] if unit["name"] == "Boyz")
        waaagh = [
            preset for preset in boyz["combatPresets"] if preset["name"].startswith("Waaagh! —")
        ]
        self.assertEqual(len(waaagh), 2)
        self.assertTrue(all(preset["activation"] == "automatic" for preset in waaagh))
        self.assertTrue(all(preset["requiresWaaaghActive"] for preset in waaagh))
        self.assertEqual(
            [(preset["name"], preset["weaponScope"]) for preset in waaagh],
            [
                ("Waaagh! — Melee weapons", "Melee"),
                ("Waaagh! — Invulnerable save", "Any"),
            ],
        )
        mega_warboss = next(
            unit for unit in catalogue["units"] if unit["name"] == "Warboss In Mega Armour"
        )
        dead_brutal = next(
            preset for preset in mega_warboss["combatPresets"] if preset["name"] == "Dead Brutal"
        )
        self.assertTrue(dead_brutal["requiresWaaaghActive"])
        self.assertEqual(dead_brutal["effects"][0]["weaponName"], "’uge choppa")
        intercessors = next(
            unit for unit in catalogue["units"] if unit["name"] == "Intercessor Squad"
        )
        oath = [
            preset
            for preset in intercessors["combatPresets"]
            if preset["name"].startswith("Oath of Moment —")
        ]
        self.assertEqual(len(oath), 2)
        self.assertTrue(all(preset["requiresOathTarget"] for preset in oath))
        self.assertEqual(
            [preset.get("requiresOathWoundBonusEligible", False) for preset in oath],
            [False, True],
        )
        self.assertEqual(
            [(preset["rerollHits"], preset["woundModifier"]) for preset in oath],
            [(True, 0), (False, 1)],
        )
        breachers = next(unit for unit in catalogue["units"] if unit["name"] == "Breacher Team")
        breach = next(
            preset for preset in breachers["combatPresets"] if preset["name"] == "Breach and Clear"
        )
        self.assertTrue(breach["requiresTargetOnObjective"])
        self.assertTrue(breach["rerollWounds"])
        self.assertEqual(breach["activation"], "automatic")
        sentinel = next(
            unit for unit in catalogue["units"] if unit["name"] == "Canoptek Tomb Sentinel"
        )
        guardian = {
            preset["name"]: preset for preset in sentinel["combatPresets"]
            if preset["name"].startswith("Aggressor Guardian —")
        }
        self.assertTrue(guardian["Aggressor Guardian — Defence"]["requiresSourceOnObjective"])
        self.assertTrue(guardian["Aggressor Guardian — Offence"]["requiresTargetOnObjective"])
        brigand = next(
            unit for unit in catalogue["units"] if unit["name"] == "Leman Russ Battle Tank"
        )
        spearhead = {
            preset["name"]: preset
            for preset in brigand["combatPresets"]
            if preset["name"].startswith("Armoured Spearhead —")
        }
        self.assertEqual(len(spearhead), 2)
        self.assertTrue(spearhead["Armoured Spearhead — Base re-roll"]["rerollHitOnes"])
        self.assertTrue(
            spearhead["Armoured Spearhead — Objective-control re-roll"][
                "requiresTargetOnObjectiveNotControlledBySource"
            ]
        )
        stand_vigil = next(
            preset
            for unit in catalogue["units"]
            for preset in unit["combatPresets"]
            if preset["name"] == "Stand Vigil — Objective-control re-roll"
        )
        self.assertTrue(stand_vigil["requiresSourceControlsObjective"])
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
