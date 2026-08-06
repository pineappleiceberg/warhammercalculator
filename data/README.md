# Warhammer 40,000 10th edition profile database

`warhammer_10e.sqlite` is generated from Wahapedia's structured 10th-edition
CSV exports. It contains calculator-relevant profile data only: factions,
datasheets, model defenses, weapon statlines, weapon ability tags, unit
composition, wargear-option text, source URLs, and import metadata. It
intentionally excludes lore and unrelated full rules text.

The main tables are:

- `datasheets` and `model_profiles` for units, their published starting
  equipment, and their model statlines
- `weapon_profiles` for attacks, skill, strength, AP, damage, and the original
  weapon-keyword list
- `weapon_abilities` for individually queryable tags such as `blast`,
  `lethal hits`, `sustained hits`, `rapid fire`, `melta`, and `anti-*`
- `unit_composition` for source ordering, display text, and safely parsed
  minimum/maximum model counts
- `wargear_options` for the complete published loadout guidance, preserved as
  both original HTML and plain text
- `wargear_constraints` and `wargear_constraint_weapons` for conservatively
  parsed fixed, per-model, and unit-size-dependent option allowances linked
  back to their exact source text
- `wargear_choice_pools`, `wargear_choice_alternatives`, and
  `wargear_choice_alternative_weapons` for shared allowances and exact
  multi-weapon bundles, with every alternative linked to its source option
- `default_weapon_loadout` and `wargear_choice_replaced_weapons` for safely
  parsed starting quantities and the equipment removed by a replacement
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
Exact `This model is equipped with` and `Every/Each model is equipped with`
forms pre-fill editable weapon totals. Selecting a structured replacement
subtracts its source equipment and adds the chosen alternative. Mixed-unit
clauses and conditional prose that depend on model identity or another option
remain visible but are not guessed.
