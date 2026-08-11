# Warhammer 40,000 10th edition profile database

`battle-rule-sources.json` pins the official rules documents used by the
canonical battle-state engine, including retrieval date, content hash, relevant
pages, and the executable behavior derived from each source. It is separate
from datasheet/profile provenance because battle timing and setup rules apply
across every catalogue faction.

`battle-rule-coverage.json` is the machine-readable coverage contract for that
source set. The checked generator maps every faction, detachment, enhancement,
and datasheet in the pinned structured export to one exact guided rule identity.
PDF-backed rules use page locators; structured-export entries use typed record
locators whose source-manifest checksum locks every contributing CSV checksum.
Every listed rule is classified as `executable`, `guided`, `irrelevant`, or
`unsupported` and records the battle-state version that introduced it. Every
unlisted terrain or mission rule defaults to `unsupported`; a guided rule is
permitted only with a non-empty player
acknowledgement. Guided catalogue coverage means the players explicitly retain
responsibility for non-executable faction, detachment, enhancement, and
datasheet text; it never makes that text appear implemented. The published
copies under `web/public/` must
remain byte-equivalent to these data files and are validated in the web test
suite. Regenerate or verify them with
`python3 scripts/sync_battle_rule_catalogue.py` and its `--check` option.

`warhammer_10e.sqlite` is generated from Wahapedia's structured 10th-edition
CSV exports. It contains calculator-relevant profiles and army-rule identities:
factions, detachments, enhancements, detachment abilities, Stratagems,
datasheets, model defenses, weapon statlines, weapon ability tags, unit combat
abilities, unit composition, wargear-option text, source URLs, and import
metadata.

The main tables are:

- `detachments`, `detachment_abilities`, `enhancements`, and `stratagems` for
  exact army-rule identities and source text; the three `datasheet_*` relation
  tables preserve which datasheets each detachment ability, enhancement, or
  detachment Stratagem can affect
- `datasheets` and `model_profiles` for units, their published starting
  equipment, and their model statlines
- `weapon_profiles` for attacks, skill, strength, AP, damage, and the original
  weapon-keyword list
- `weapon_abilities` for individually queryable tags such as `blast`,
  `lethal hits`, `sustained hits`, `rapid fire`, `melta`, and `anti-*`
- `abilities` and `datasheet_abilities` for resolved shared and unit-specific
  ability names, conditions, scope, and source ordering
- `unit_leader_eligibility` for the published Leader-to-Bodyguard datasheet
  pairs, retaining the first source row when the upstream export repeats a pair
- `leader_attachment_conditions` for the Captain's source-backed relic-shield
  and plasma-pistol requirements, resolved to exact structured choice or weapon
  group IDs
- `unit_bodyguard_joins` for the three exceptional Warlock Conclave and Warlock
  Skyrunners join pairs, including uniqueness, Attached-state, and Starting-
  Strength semantics
- `leader_attachment_exceptions` and its existing-keyword child table for 51
  source-backed exceptions to the normal Leader count, including mandatory
  attachment, companion-keyword, uniqueness, and Pack Leader restrictions
- `bodyguard_leader_rules` and its minimum-keyword child table for the Boyz,
  Kroot Carnivores, and Company Heroes formation conditions
- `unit_firing_deck` for the exact published Firing Deck model limit and its
  source ability, plus `unit_firing_deck_passenger_costs` for exact passenger
  exceptions whose models and weapons consume two Firing Deck slots
- `unit_transport` for published capacity, source text, and conservative exact-
  coverage state; its allowed-keyword, exclusion, model-cost, and conditional-
  capacity child tables retain normalized OR/AND groups, Wounds thresholds,
  non-Character exclusions, fixed space costs, and equipped-wargear capacity
  changes. Exclusion rows can additionally require a Character passenger to be
  attached to a unit without a named keyword, or contain explicit passenger-
  keyword exceptions. This preserves the exact Tacticus and Aeldari/Ynnari
  exceptions instead of weakening their exclusions globally.
  `unit_transport_additional_pools` and its keyword child table preserve
  independent passenger allowances such as “12 Infantry and 1 Dreadnought”.
  `unit_transport_alternative_pools` and its keyword child table preserve
  mutually exclusive passenger modes, their separate capacities, and optional
  maximum-Wounds limits
  `unit_transport_shared_allowances` and its keyword child table preserve
  exceptional passengers that consume the primary capacity, including an
  aggregate passenger-model ceiling, fixed or Wounds-based space costs, whether
  the allowance consumes primary capacity, conditional primary-capacity
  reductions, and the
  published treatment of passengers nested inside a transported Transport.
  Its exclusion-keyword child table limits special Vehicle allowances without
  weakening the primary passenger rules
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
- exact count-scaled Attacks modifiers store the count source, count per
  increment, optional cap, and affected named weapon. Source-unit models,
  nearby enemy models or units, enemy Character models destroyed, prior Fight
  phases that triggered a cumulative bonus, all embarked models, and embarked
  Wracks models are explicit browser and API state; zero is conservative
  unknown state and never invents a bonus. The Wracks subset cannot exceed the
  total transport contents
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
  objective state. Ownership rules additionally carry
  `requires_source_controls_objective` or
  `requires_target_on_objective_not_controlled_by_source`; exact ownership is
  required. Three exact selected-marker rules additionally carry
  `requires_source_on_selected_objective` or
  `requires_target_on_source_selected_objective`; Archon’s Will also carries
  `requires_source_not_battle_shocked`. Compound alternatives remain
  situational rather than being inferred
- exact bearer Save, invulnerable-save, Feel No Pain, and Damage-reduction
  effects are imported as optional situational presets when structured
  composition proves that the datasheet contains exactly one model;
  multi-model datasheets instead expose normalized bearer- or unit-scoped
  defensive equipment for explicit per-target-segment selection
- fixed Attacks replacements gated by a phase, selected target, or battlefield
  event are stored as named-weapon situational effects; compound Sustained Hits
  changes and mutually exclusive replacement/defense modes remain grouped with
  the source ability
- `unit_composition` and `unit_composition_models` for source ordering, display
  text, safely parsed unit-size ranges, and the named model components within
  each composition row
- `unit_starting_size_ranges` for exact inclusive legal starting ranges;
  separate rows preserve discrete `OR` and `one of the following` alternatives
  instead of filling the gaps between them
- `wargear_options` for the complete published loadout guidance, preserved as
  both original HTML and plain text
- `wargear_constraints` and `wargear_constraint_weapons` for conservatively
  parsed fixed, per-model, and unit-size-dependent option allowances linked
  back to their exact source text
- `wargear_choice_pools`, `wargear_choice_alternatives`, and
  `wargear_choice_alternative_weapons` for shared allowances and exact
  multi-weapon bundles, with every alternative linked to its source option.
  Choice slots and per-alternative maxima preserve mutually exclusive branches
  such as one twin-lightning-claw selection versus two distinct weapons, while
  `selections_per_replacement` prevents their shared starting weapons from
  being removed twice
- `wargear_choice_pairing_rules`, `wargear_choice_pairing_requirements`, and
  `wargear_choice_pairing_requirement_matches` for exact multi-weapon
  restrictions. Requirements can match a weapon ability or one of several
  weapon groups, and can evaluate either the source pool or a single-model
  unit's resulting loadout; this preserves both Pistol pairings and the
  cyclone-missile-launcher plus storm-bolter/combi-weapon rule
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

The global maximum of two attached Leaders is separately pinned in database
metadata to the official Core Rules Updates / Rules Commentary PDF by URL,
version, page, and SHA-256. Datasheet `leader_footer_html` and
`leader_footer_text` retain the source wording behind normalized exception
records.

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
