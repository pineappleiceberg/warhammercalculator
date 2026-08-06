# Warhammer 40,000 10th edition profile database

`warhammer_10e.sqlite` is generated from Wahapedia's structured 10th-edition
CSV exports. It contains calculator-relevant profile data only: factions,
datasheets, model defenses, weapon statlines, weapon ability tags, unit combat
abilities, unit composition, wargear-option text, source URLs, and import
metadata.

The main tables are:

- `datasheets` and `model_profiles` for units, their published starting
  equipment, and their model statlines
- `weapon_profiles` for attacks, skill, strength, AP, damage, and the original
  weapon-keyword list
- `weapon_abilities` for individually queryable tags such as `blast`,
  `lethal hits`, `sustained hits`, `rapid fire`, `melta`, and `anti-*`
- `abilities` and `datasheet_abilities` for resolved shared and unit-specific
  ability names, conditions, scope, and source ordering
- `unit_combat_presets` for conservatively extracted Hit/Wound modifiers and
  re-roll modes; mutually exclusive named modes and rolled outcomes are stored
  as separate ordered choices. Each extracted Hit, Wound, and re-roll effect
  records whether it applies from the attacking or target side and whether its
  subject is the source unit, a led unit, a friendly unit, an enemy unit, or an
  otherwise affected unit. Every choice preserves its full condition and is
  never assumed active
- `unit_composition` and `unit_composition_models` for source ordering, display
  text, safely parsed unit-size ranges, and the named model components within
  each composition row
- `wargear_options` for the complete published loadout guidance, preserved as
  both original HTML and plain text
- `wargear_constraints` and `wargear_constraint_weapons` for conservatively
  parsed fixed, per-model, and unit-size-dependent option allowances linked
  back to their exact source text
- `wargear_choice_pools`, `wargear_choice_alternatives`, and
  `wargear_choice_alternative_weapons` for shared allowances and exact
  multi-weapon bundles, with every alternative linked to its source option
- `default_loadout_subjects`, `default_loadout_subject_weapons`, `default_weapon_loadout`, and
  `wargear_choice_replaced_weapons` for audited loadout subjects, normalized
  starting-quantity formulas, and the equipment removed by a replacement
- `source_files` and `metadata` for URLs, timestamps, and source checksums

The source export can retain rows for datasheets that it no longer publishes.
Those orphan rows are excluded to preserve foreign-key integrity, and their
counts are recorded in `metadata`. Empty no-weapon placeholder rows are also
excluded and counted there. Wahapedia leaves the ordering field blank on some
otherwise complete weapon rows; those weapons are retained with a null
`source_line`.

Convenience views are provided for calculator selectors:

- `attacker_profiles`
- `attacker_weapon_profiles`
- `target_profiles`

Rebuild it from WSL with:

```sh
python3 scripts/build_profiles_db.py --output data/warhammer_10e.sqlite
```

That command accepts only the exact source files recorded in
`profile-source-lock.json`. This prevents a routine rebuild from silently
publishing changed rules or profiles. Check the current upstream exports and
write a machine-readable table/checksum report without modifying checked data:

```sh
python3 scripts/profile_freshness.py --output build/profile-freshness-report.json
```

After reviewing that report and adding regression tests for every relevant
rules/profile change, explicitly accept the new source identities, regenerate
the browser catalogue, and rerun the checked-data suite:

```sh
python3 scripts/build_profiles_db.py --update-source-lock
python3 scripts/export_profiles_json.py data/warhammer_10e.sqlite web/public/profile-data.json
python3 scripts/profile_freshness.py --offline
python3 -m unittest discover -s tests -p test_profiles_data.py
```

When only the derived combat-preset parser or schema changes, rebuild that table
without downloading or replacing the pinned source exports, then regenerate the
browser catalogue:

```sh
python3 scripts/rebuild_combat_presets.py data/warhammer_10e.sqlite
python3 scripts/export_profiles_json.py data/warhammer_10e.sqlite web/public/profile-data.json
```

CI verifies the lock against both SQLite and the browser catalogue without
network access. A daily and manually dispatchable workflow separately compares
the pin with upstream, uploads the complete JSON report, and fails visibly when
a reviewed update is available.

Values that can be dice expressions are preserved as text (`D6+1`, `2D3`, and
so on). Plain numeric values are also exposed in companion integer columns.
Weapon rows with the same base name before a standard profile separator are
profiles of the same physical weapon. This remains true when the source export
uses one line for every mode instead of repeating a line identifier. The
browser export records that group plus the profile label, allowing
standard/supercharge and frag/krak modes to share one equipped quantity without
forbidding different copies from choosing different profiles in the same volley.

The presence of a weapon on a datasheet does not by itself mean every model in
that datasheet can equip it. The UI therefore treats weapon quantities as
editable totals across the unit and shows the source wargear options beside
them. It never assumes every listed profile is equipped. A separate editable
"selected through wargear options" count remains available for conservative
single-weapon rules. Where the source is structurally clear, the browser
instead exposes each alternative within its shared choice pool. Selecting a
compound alternative records every weapon in that bundle and checks the pool
once, rather than incorrectly granting its full allowance to every weapon.
Exact `This model`, named-model, explicit-count, `Every/Each model`, and
unit-size-scaled forms pre-fill editable weapon totals. This includes mixed
units whose composition determines the named model count, such as Boyz and
Cadian Shock Troops. Selecting a structured replacement subtracts its source
equipment and adds the chosen alternative. All 1,971 loadout subjects are kept
in the audit table; 1,883 currently resolve to exact formulas. Conditional or
multi-variable clauses whose result cannot be inferred from total unit size
are exported with their source subject and exact weapon vector. The list and
unit editors ask for the number of models matching each clause, then derive
editable weapon totals from that explicit count instead of guessing.
