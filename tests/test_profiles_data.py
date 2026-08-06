import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.build_profiles_db import composition_components, composition_range, plain_text
from scripts.export_profiles_json import export, profile_group_names, unit_model_range
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


class ProfileDataTests(unittest.TestCase):
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
        self.assertEqual(allowance("Any number of models can each replace it."), (0, 1, 1))
        self.assertEqual(normalized_name("Power weapon’s – profile"), "power weapon s profile")
        self.assertEqual(
            option_choices("Choose:<ul><li>1 flamer</li><li>1 meltagun</li></ul>", "Choose"),
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
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(
                connection.execute(
                    "SELECT value FROM metadata WHERE key = 'schema_version'"
                ).fetchone()[0],
                "8",
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
                connection.execute("SELECT count(*) FROM unit_composition").fetchone()[0],
                2_000,
            )
            self.assertGreater(
                connection.execute("SELECT count(*) FROM wargear_options").fetchone()[0],
                2_500,
            )
            self.assertGreater(
                connection.execute("SELECT count(*) FROM default_weapon_loadout").fetchone()[0],
                4_400,
            )
            self.assertEqual(
                connection.execute("SELECT count(*) FROM default_loadout_subjects").fetchone()[0],
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
                connection.execute("SELECT count(*) FROM wargear_choice_pools").fetchone()[0],
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
                connection.execute("SELECT count(*) FROM wargear_constraints").fetchone()[0],
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
        warriors = next(unit for unit in catalogue["units"] if unit["name"] == "Necron Warriors")
        self.assertEqual(warriors["suggestedModelCount"], 10)
        self.assertEqual(warriors["maximumModelCount"], 20)
        self.assertEqual(warriors["composition"][0]["text"], "10-20 Necron Warriors")
        self.assertTrue(
            any("gauss reaper" in option.lower() for option in warriors["wargearOptions"])
        )
        reaper = next(
            limit
            for limit in warriors["weaponLimits"]
            if limit["groupName"] == "Gauss reaper"
        )
        self.assertEqual(reaper["terms"][0]["perIncrement"], 1)
        self.assertEqual(reaper["terms"][0]["modelsPerIncrement"], 1)

        assault = next(unit for unit in catalogue["units"] if unit["name"] == "Assault Squad")
        eviscerator = next(
            limit for limit in assault["weaponLimits"] if limit["groupName"] == "Eviscerator"
        )
        self.assertEqual(eviscerator["terms"][0]["modelsPerIncrement"], 5)
        self.assertEqual(catalogue["structuredWargear"]["constraintCount"], 1798)
        self.assertEqual(catalogue["structuredWargear"]["choicePoolCount"], 2009)
        self.assertEqual(catalogue["structuredWargear"]["compoundAlternativeCount"], 241)
        self.assertEqual(catalogue["structuredWargear"]["defaultWeaponCount"], 4349)
        self.assertEqual(catalogue["structuredWargear"]["defaultWeaponTermCount"], 4494)
        self.assertEqual(catalogue["structuredWargear"]["loadoutSubjectCount"], 1971)
        self.assertEqual(catalogue["structuredWargear"]["resolvedLoadoutSubjectCount"], 1883)
        self.assertEqual(catalogue["structuredWargear"]["unresolvedLoadoutSubjectCount"], 88)
        self.assertEqual(catalogue["structuredWargear"]["loadoutSubjectWeaponCount"], 4701)
        self.assertEqual(catalogue["structuredWargear"]["replacementWeaponCount"], 1172)
        self.assertTrue(catalogue["structuredWargear"]["conservative"])
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

        accursed = next(unit for unit in catalogue["units"] if unit["name"] == "Accursed Cultists")
        torment = next(
            subject
            for subject in accursed["unresolvedLoadoutSubjects"]
            if subject["subject"] == "Every Torment"
        )
        self.assertEqual(
            [(weapon["groupName"], weapon["quantity"]) for weapon in torment["weapons"]],
            [("Hideous mutations", 1)],
        )

        achillus = next(
            unit for unit in catalogue["units"] if unit["name"] == "Contemptor-achillus Dreadnought"
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
            unit for unit in catalogue["units"] if unit["name"] == "Battle Sisters Squad"
        )
        plasma = [
            weapon for weapon in sisters["weapons"] if weapon["groupName"] == "Plasma pistol"
        ]
        self.assertEqual({weapon["profileName"] for weapon in plasma}, {"standard", "supercharge"})
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
        self.assertEqual((boyz["suggestedModelCount"], boyz["maximumModelCount"]), (10, 20))
        choppa = next(weapon for weapon in boyz["defaultWeapons"] if weapon["groupName"] == "Choppa")
        self.assertEqual(
            (choppa["terms"][0]["fixed"], choppa["terms"][0]["perModel"]),
            (-1, 1),
        )
        cadian = next(unit for unit in catalogue["units"] if unit["name"] == "Cadian Shock Troops")
        self.assertEqual((cadian["suggestedModelCount"], cadian["maximumModelCount"]), (10, 20))
        lasgun = next(
            weapon for weapon in cadian["defaultWeapons"] if weapon["groupName"] == "Lasgun"
        )
        self.assertEqual(
            (
                lasgun["terms"][0]["perIncrement"],
                lasgun["terms"][0]["modelsPerIncrement"],
            ),
            (9, 10),
        )
        attaches = next(unit for unit in catalogue["units"] if unit["name"] == "Regimental Attachés")
        self.assertEqual(attaches["suggestedModelCount"], 3)
        laspistol = next(
            weapon for weapon in attaches["defaultWeapons"] if weapon["groupName"] == "Laspistol"
        )
        self.assertEqual(sum(term["fixed"] * term["quantity"] for term in laspistol["terms"]), 3)


if __name__ == "__main__":
    unittest.main()
