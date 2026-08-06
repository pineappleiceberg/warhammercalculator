# Warhammer 40,000 10th edition profile database

`warhammer_10e.sqlite` is generated from Wahapedia's structured 10th-edition
CSV exports. It contains calculator-relevant profile data only: factions,
datasheets, model defenses, weapon statlines, weapon ability tags, unit
composition, wargear-option text, source URLs, and import metadata. It
intentionally excludes lore and unrelated full rules text.

The main tables are:

- `datasheets` and `model_profiles` for units and their model statlines
- `weapon_profiles` for attacks, skill, strength, AP, damage, and the original
  weapon-keyword list
- `weapon_abilities` for individually queryable tags such as `blast`,
  `lethal hits`, `sustained hits`, `rapid fire`, `melta`, and `anti-*`
- `unit_composition` for source ordering, display text, and safely parsed
  minimum/maximum model counts
- `wargear_options` for the complete published loadout guidance, preserved as
  both original HTML and plain text
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
Weapon rows sharing `(datasheet_id, source_line)` are profiles of the same
physical weapon. The browser export records that source-defined group plus the
profile label, allowing standard/supercharge and frag/krak modes to share one
equipped quantity without forbidding different copies from choosing different
profiles in the same volley.

The presence of a weapon on a datasheet does not by itself mean every model in
that datasheet can equip it. The UI therefore treats weapon quantities as
editable totals across the unit and shows the source wargear options beside
them. It never assumes every listed profile is equipped. Automatically
enforcing every natural-language replacement and per-model constraint remains
a separate structured-rules task.
