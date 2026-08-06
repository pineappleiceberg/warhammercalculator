import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.build_profiles_db import composition_range, plain_text
from scripts.export_profiles_json import export, profile_group_names


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data" / "warhammer_10e.sqlite"
CATALOGUE = ROOT / "web" / "public" / "profile-data.json"


class ProfileDataTests(unittest.TestCase):
    def test_composition_parser_handles_export_markup_and_unicode_hyphens(self):
        self.assertEqual(composition_range("10-20 Necron Warriors"), (10, 20))
        self.assertEqual(composition_range("3‑10 Kill Team Infiltrators"), (3, 10))
        self.assertEqual(
            plain_text('1 Hero – <span class="kwb">EPIC</span> <b>HERO</b>'),
            "1 Hero – EPIC HERO",
        )
        self.assertEqual(composition_range("OR"), (None, None))
        self.assertEqual(
            profile_group_names(
                ["Plasma pistol – standard", "Plasma pistol – supercharge"]
            ),
            ("Plasma pistol", ["standard", "supercharge"]),
        )

    def test_checked_database_preserves_loadout_sources_and_provenance(self):
        connection = sqlite3.connect(DATABASE)
        try:
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(
                connection.execute(
                    "SELECT value FROM metadata WHERE key = 'schema_version'"
                ).fetchone()[0],
                "3",
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
        self.assertEqual(len(grouped), 38)
        sisters = next(
            unit for unit in catalogue["units"] if unit["name"] == "Battle Sisters Squad"
        )
        plasma = [
            weapon for weapon in sisters["weapons"] if weapon["groupName"] == "Plasma pistol"
        ]
        self.assertEqual({weapon["profileName"] for weapon in plasma}, {"standard", "supercharge"})
        self.assertEqual(len({weapon["groupId"] for weapon in plasma}), 1)


if __name__ == "__main__":
    unittest.main()
