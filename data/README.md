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
- `unit_combat_presets` and `unit_combat_preset_effects` for conservatively
  extracted Hit/Wound modifiers, re-roll modes, weapon-keyword grants, AP
  changes, Critical Hit/Wound thresholds, direct signed Attacks, Strength, and
  Damage modifiers, one-roll dice modifiers shared across affected Attacks,
  Strength, Damage, and weapon profiles, and fixed Attacks, Strength, and Damage
  replacements and multipliers with optional exact weapon names and required
  target or attack keywords, plus
  defensive Save targets, invulnerable saves, unrestricted Feel No Pain
  thresholds, per-attack damage reduction, and unconditional incoming-Damage
  divisors; mutually exclusive named modes
  and rolled outcomes are stored as separate ordered choices. Each extracted
  Hit, Wound, and re-roll effect
  records whether it applies from the attacking or target side and whether its
  subject is the source unit, a led unit, a friendly unit, an enemy unit, or an
  otherwise affected unit. Unclassified effects are omitted instead of guessed.
  Every row has an `activation` classification. Strictly unconditional,
  whole-model/unit defenses are `inherent` and become editable model-profile
  defaults. Rules whose complete eligibility is an exact selected-target,
  attacking-weapon keyword, unambiguous attacker-charge or stationary test, or
  direct attacker/target Battle-shock, target unit-strength, simple
  Attached-unit, exact direct Waaagh-benefit, exact Oath of Moment, or direct
  any-objective-marker test are
  `automatic`;
  they apply only to matching weapon, target, and battlefield state. Charge-or-
  charged, Order-dependent, aura-, compound leader-, controlled/selected-objective-, observer-,
  alternative-branch, and combined-mode wording remains situational. Target
  strength is stored as an
  exact `below_half` or `not_below_half` requirement; the calculator preserves
  full strength, below Starting Strength, and Below Half-strength separately.
  All other rows are `situational`, preserve their
  full condition, and are never assumed active. Their `weapon_scope` also
  preserves conservative phase eligibility: an effect explicitly bounded to a
  Shooting or Fight phase is restricted to ranged or melee attacks, while
  dual-phase and end-of-turn effects remain unrestricted
- exact model-count-scaled Attacks modifiers store the count source and models
  per increment on the affected named weapon. The browser and API provide the
  current count; zero is conservative unknown state and never invents a bonus
- the universal Orks Waaagh! ability is stored as separate automatic melee
  offense and unrestricted defense presets so +1 Strength/Attacks cannot leak
  onto ranged weapons and its 5+ invulnerable save cannot be limited to melee
  attacks. Direct dependent abilities carry `requires_waaagh_active`; compound
  aura and leader clauses remain situational
- Oath of Moment is stored as two automatic effects across its 275 source
  datasheets. `requires_oath_target` gates the Hit re-roll, while the +1 Wound
  row additionally carries `requires_oath_wound_bonus`. This preserves the
  published Codex-detachment and excluded-chapter condition instead of treating
  both benefits as one manual toggle
- direct objective-marker rules carry `requires_source_on_objective` or
  `requires_target_on_objective`. Seventeen baseline/upgrade abilities are split
  so their re-roll of 1 remains automatic while the full re-roll requires the
  objective state. Control ownership, selected markers, and compound alternatives
  remain situational rather than being inferred
- exact bearer Save, invulnerable-save, Feel No Pain, and Damage-reduction
  effects are imported as optional situational presets only when structured
  composition proves that the datasheet contains exactly one model; bearer
  defenses on multi-model datasheets remain omitted
- fixed Attacks replacements gated by a phase, selected target, or battlefield
  event are stored as named-weapon situational effects; compound Sustained Hits
  changes and mutually exclusive replacement/defense modes remain grouped with
  the source ability
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
