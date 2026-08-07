# Continuous improvement goal

Develop Warhammer Calculator into a rules-accurate, fast, reliable Warhammer
40,000 10th-edition analysis and play companion. Each cycle selects one
high-impact improvement, implements it coherently, verifies every affected
interface, and reprioritizes this backlog. Correctness and reproducibility take
priority over feature count.

## Guardrails

- Preserve editable profiles and existing workflows.
- Keep the base C code attributed to the repository owner and disclose AI help.
- Record profile-data provenance.
- Cover every rules or profile change with regression tests.
- Keep native C, WebAssembly, API, web, formal checks, and CI consistent.

## Prioritized backlog

1. Represent random and multiplicative Attacks, Strength, and Damage changes,
   context-dependent Attacks replacements, and limited-use single-attack Damage
   replacements exactly in native C and WebAssembly before importing them.
2. Extend the source-backed rules eligibility layer beyond exact target
   keywords to phase, range, attack-type, and other compound conditions that
   currently require manual interpretation.
3. Link bearer- and subset-model defensive abilities to structured wargear and
   unit composition so equipped defensive defaults can be applied without
   affecting models that do not have them.

## Completed cycles

- 2026-08-06: Added source-backed automatic target-keyword eligibility across
  SQLite, the browser catalogue, Model vs Model, Unit vs Unit, Play Mode, and
  static agent URLs. Culexus Assassin's Psychic Assassin now changes only
  Animus speculum to 6 Attacks against a selected PSYKER target; the weapon is
  linked through its published weapon-ability tag, the rule is not offered as
  a manual checkbox, non-PSYKER targets do not activate it, and the resulting
  numeric profile remains editable. Catalogue, parser, workflow composition,
  agent resolution, native/Wasm replacement, and generated-data regressions
  cover both eligible and ineligible cases.

- 2026-08-06: Added fixed Strength and Damage characteristic replacements in
  the official replace-before-add order across native C, WebAssembly, exact
  APIs, CSPRNG rolls, seeded simulations, editable profiles, and static agent
  URLs. Damage replacements use an explicit active state so 0 is represented
  exactly; the official exception keeps it below the normal minimum of 1 while
  later additions such as Melta still apply. The conservative source importer
  now exposes Shield-captain in Allarus Terminator Armour's phase-long Auramite
  and Adamantine replacement, while once-per-turn, phase, or battle
  single-attack replacements remain omitted until allocation-level uses can be
  tracked. Native/Wasm fractions, API exact results, URL round trips,
  catalogue snapshots, and generated sanitizer profiles cover the change.

- 2026-08-06: Added fixed Attacks characteristic replacement in the official
  replace-before-add order across native C, WebAssembly, exact APIs, complexity
  estimates, CSPRNG rolls, seeded simulations, editable profiles, and static
  agent URLs. Combat effects can now carry an exact weapon name, so Captain
  Tycho's Embittered replacement applies only to Dead Man's Hand, while Lelith
  Hesperax's Thrilling Spectacle applies to all of her melee weapons. The
  target-keyword-dependent Psychic Assassin replacement remained omitted in
  that cycle and was added later with exact eligibility metadata. Hand-derived native/Wasm
  fractions, deterministic simulations, URL round trips, catalogue snapshots,
  and generated fuzz profiles cover the change.

- 2026-08-06: Added exact signed fixed modifiers for Attacks, Strength, and
  Damage across native C, WebAssembly, exact APIs, CSPRNG rolls, seeded
  simulations, editable profiles, and static agent URLs. Base dice values now
  remain distinct from modifiers; Attacks penalties are floored at 1 for each
  weapon before weapon counts are combined, rather than incorrectly flooring a
  whole volley. The conservative source importer now includes two Paroxysm
  Attacks penalties and two conditional Damage penalties that were previously
  discarded. Hand-derived native and Wasm fractions, deterministic roll tests,
  URL round trips, catalogue snapshots, and formal parsing cover the change.

- 2026-08-06: Distinguished inherent defenses from situational combat presets.
  Twenty-eight unconditional, whole-model/unit damage-reduction abilities now
  load directly into every catalogue target profile and therefore reach Model
  vs Model, Unit vs Unit, Play Mode, the API, and parameterized agent URLs by
  default while remaining editable. Their source abilities retain an explicit
  `inherent` classification and no longer appear as activation checkboxes.
  Conditional defenses remain opt-in. The importer also removed one Psychic
  attack-type-limited reduction that could not be represented exactly rather
  than applying it to every attack. SQLite, catalogue, selector, API, agent,
  and C/WebAssembly regressions cover the distinction.

- 2026-08-06: Added 90 conservatively classified defensive effects from the
  pinned source catalogue: 34 invulnerable saves, 24 unrestricted Feel No Pain
  thresholds, 31 per-attack damage reductions, and one replacement Save target.
  Bearer-only, subset-model, friendly-aura, affected-model, attack-type-limited,
  and conflicting values remain omitted instead of being applied to the wrong
  unit. Selected defenses preserve stronger editable values, reach exact and
  simulated single-profile calculations, and are composed onto every ordered
  target segment. Mixed ranged/melee volleys are rejected only when a scoped
  defense would require two incompatible target profiles. SQLite, catalogue,
  API, browser composition, and C/WebAssembly regressions cover the behavior.

- 2026-08-06: Added a versioned static `/agent/` URL interface for browser-capable
  AI agents. It resolves catalogue matchups by stable ID or unambiguous name,
  accepts complete editable profiles and conditional presets as query
  parameters, rejects ambiguous or malformed input, and publishes normalized
  machine-readable results through stable DOM and JavaScript contracts. The
  calculation runs locally in the existing C/WebAssembly engine, requiring
  only static hosting rather than an API service; parser, catalogue,
  C/WebAssembly, rendered-page, and GitHub Pages regressions cover the surface.

- 2026-08-06: Added source-backed direct positive Attacks, Strength, and Damage
  modifiers to conditional combat presets. The conservative parser imports 110
  exact effects across the pinned catalogue, detects melee/ranged weapon scope,
  classifies the affected unit, and composes the changes into editable profiles
  before native or WebAssembly calculation. Named-weapon-only clauses,
  conflicting alternative values, fixed replacements, random values, and
  negative dice modifiers remain explicitly omitted rather than approximated.
  Model vs Model resets native statlines before recomposition, and Play Mode now
  rebuilds from the selected source profiles when presets change so repeated
  toggles cannot compound modifiers.

- 2026-08-06: Instrumented the exact deferred-damage evaluator to record its
  true peak sparse-state count and exposed that evidence through native,
  WebAssembly, API, and Unit vs Unit results. Replaced the former all-weapons
  Cartesian preflight with a safe prefix-reachable bound. The benchmark case
  that formerly warned at 2,268 states is now proven within a 1,134-state bound
  and observes only 13 states, without changing the 2,047-state hard limit.
  Generated sanitizer inputs assert every successful observed peak remains
  below both the bound and engine limit.

- 2026-08-06: Extended source-backed conditional combat presets to weapon
  keyword grants, variable Sustained Hits and Rapid Fire, AP changes, and
  Critical Hit/Wound thresholds. A normalized effect table preserves dice
  values, application side, affected subject, source conditions, and stable
  preset IDs; unclassified effects are omitted instead of guessed. Exclusive
  keyword choices remain mutually exclusive, native weapon rules are restored
  when presets change, and the same composition now reaches Model vs Model,
  Unit vs Unit, Play Mode, saved lists, profile JSON, and the API.

- 2026-08-06: Replaced sign-based unit-ability role inference with clause-level
  subject classification. Hit modifiers, Wound modifiers, Hit re-rolls, and
  Wound re-rolls independently record whether their source belongs on the
  attacking or target side and whether they affect the source, a led unit, a
  friendly unit, an enemy attacker, or another affected unit. Mixed offensive
  and defensive abilities now apply only their relevant clauses, negative
  self-penalties and positive defensive effects no longer swap sides, and every
  imported effect is classified. Selectors expose the affected subject while
  preserving editable values and stable saved-list IDs; SQLite, API, UI, and
  C/WebAssembly composition regressions cover the behavior. The unchanged
  2,000-input sanitizer campaign also received a realistic harness ceiling after
  WSL timing proved the previous 120-second ceiling flaky without finding a
  sanitizer fault.
- 2026-08-06: Split imported abilities with named modes or rolled outcomes into
  atomic combat presets and added stable exclusive-choice groups to SQLite and
  the browser catalogue. Selecting one mode now replaces its sibling instead
  of combining impossible effects. Model vs Model gained explicit attacking
  and defensive ability selectors while retaining editable characteristics;
  parser, artifact, selection, build, and C/WebAssembly regressions cover the
  workflow.

- 2026-08-06: Added source-backed conditional ability selection to Unit vs
  Unit, saved lists, and Play Mode. Saved defaults follow a unit into battle,
  can be changed for the current matchup, survive Play Mode recovery, and leave
  all calculated characteristics editable. Shared rule composition applies
  positive modifiers and attack re-rolls only from the attacker, negative
  modifiers only from the target, respects melee/ranged scope, combines
  modifiers before the 10th-edition cap, and has persistence/API/Wasm
  regressions. Model vs Model no longer offers defensive abilities as attacker
  bonuses.
- 2026-08-06: Added a C/WebAssembly exact-complexity preflight for ordered
  volleys. It distinguishes ordinary damage distributions from the 2,047-state
  sparse evaluator required by deferred Devastating Wounds, reports a
  saturating conservative upper bound through the API and Unit vs Unit, and
  lets users explicitly try exact or run the reproducible seeded fallback.
  Actual exhaustion now returns stable API code `EXACT_STATE_LIMIT`; native,
  Wasm, API, overflow, and formal saturating-arithmetic regressions cover the
  contract.
- 2026-08-06: Added pinned ability-source imports and 1,017 conservative unit
  combat presets for Hit/Wound modifiers and re-rolls. The model calculator
  filters presets by melee/ranged scope, shows the full published condition,
  requires explicit activation, and copies the effect into the existing
  editable fields. SQLite, browser-catalogue, provenance, and parser regressions
  cover both referenced and datasheet-specific abilities without treating a
  conditional rule as permanently active.
- 2026-08-06: Enforced the 10th-edition allocation order for Devastating Wounds
  across the exact C engine, WebAssembly, live CSPRNG rolls, seeded simulations,
  and API. A bounded sparse state machine retains deferred packets by source
  weapon while resolving ordinary attacks in user order, including Lethal plus
  variable Sustained Hits, saves, reduction, Feel No Pain, and non-spilling
  damage. Hand-derived native and API regressions distinguish the corrected
  order, and the sanitizer campaign locks a clean runtime bound for pathological
  profiles.
- 2026-08-06: Added a single reviewable 10th-edition interaction corpus shared
  by native C, WebAssembly, exact APIs, and seeded simulations. Thirteen
  hand-derived cases lock unmodified Critical Hits/Wounds under modifiers,
  specific and failed-roll re-rolls, Lethal plus Sustained Hits, Indirect Fire,
  Devastating Wounds against invulnerable saves and Feel No Pain, and its
  non-spilling damage allocation. The corpus records its official rule snapshot
  and exact derivations; deterministic simulations must converge on the same
  applied means.
- 2026-08-06: Added independent Hit and Wound re-roll modes for unmodified 1s
  or all failures, plus explicit cumulative roll modifiers capped to +1/-1.
  Native C, WebAssembly, exact and ordered APIs, editable/shared profiles, live
  CSPRNG rolls, and seeded simulations now use the same behavior. Formal proofs
  cover modifier bounds, generated and fuzz profiles exercise the new fields,
  and hand-derived fractions verify representative re-roll and modifier
  interactions across C and JavaScript.
- 2026-08-06: Added a dependency-aware API health endpoint for profile data,
  the C/WebAssembly engine, and list storage. Dependency outages now return
  retryable 503 errors with stable codes and request IDs, and failed asset loads
  are evicted so they recover without a worker restart. A standalone JSON health
  checker diagnoses network, HTTP, content, profile, Wasm, and API dependency
  failures; Pages runs it after deployments and every six hours with retained
  reports.
- 2026-08-06: Reworked Play Mode for at-the-table mobile use with semantic
  attacker/target groups, prerequisite-disabled selectors, collapsed optional
  overrides, 48 px touch inputs, and a safe-area-aware sticky resolve control.
  Live status regions and focused result announcements make repeated rolls
  usable with keyboards and screen readers while recovery remains unchanged.
- 2026-08-06: Added deterministic JSON benchmarks for an 80-attack workload and
  the maximum 32-weapon/16-target exact volley in both native and WebAssembly
  builds, with CI artifacts and tolerant regression limits. Profiling exposed
  millions of redundant target-layout scans; reusing known capacity and wound
  state cut the instrumented workload from 1.04 s to 0.65 s and the largest
  case from 13.59 ms to 5.84 ms without changing exact output.
- 2026-08-06: Pinned every imported source export by update timestamp, SHA-256,
  and row count. Routine rebuilds now reject unreviewed upstream drift, CI proves
  the SQLite database and browser catalogue share the pin without network
  access, and a daily/manual freshness workflow uploads a machine-readable
  source and semantic-table change report before failing visibly on an update.
- 2026-08-06: Added explicit, source-linked model-composition counts for all 88
  conditional or multi-variable loadout subjects across 37 datasheets. Their
  207 weapon vectors now derive editable starting totals in lists and Unit vs
  Unit, survive backup and device/cloud persistence, and are validated by the
  loadout API without guessing relationships absent from the published source.
- 2026-08-06: Added resilient army-list persistence with D1 as the hosted source
  of truth, validated device caching for offline and static-site use, automatic
  reconciliation of newer edits, and deletion tombstones. Versioned JSON
  backups preserve IDs, timestamps, loadout choices, and profile-source
  provenance across cloud and device storage. Unfinished roster drafts plus
  Play Mode selections, overrides, and attack history now recover after reloads.
- 2026-08-06: Strengthened formal verification from threshold helpers to
  compiled attack plans and actual Q31 probability-mass conservation. The C
  validators reject unknown plan flags, invalid reroll masks, malformed
  sustained-hit dice, null damage transforms, incorrect bin sums, and mass
  outside declared support; public probability consumers enforce the stronger
  boundary. Frama-C proves the validator contracts, while native property tests
  and E-ACSL exercise valid outputs and deliberately corrupted states.
- 2026-08-06: Added deterministic native and API property tests plus a bounded
  Clang libFuzzer campaign instrumented with AddressSanitizer and
  UndefinedBehaviorSanitizer. Generated cases check probability mass,
  quantiles, allocation bounds, AP and defensive monotonicity, ordered volleys,
  and malformed API types; explicit null profile fields now fail validation
  instead of silently selecting defaults.
- 2026-08-06: Added reproducible seeded simulations over complete ordered unit
  volleys while preserving cryptographically random live rolls. The web and API
  report kill and zero-damage chances, variance, quartiles, roll-stage means,
  and full damage histograms; a pinned PRNG vector and convergence against the
  C/Wasm exact mean guard reproducibility and statistical correctness.
- 2026-08-06: Parsed named models from unit compositions and normalized default
  loadouts into size-dependent terms. Exact source defaults now cover 1,883 of
  1,971 loadout subjects, including fixed leaders, mixed-model units, and
  alternative unit sizes; all unresolved subjects remain explicitly audited
  instead of being guessed.
- 2026-08-06: Imported datasheet keywords and made Anti abilities activate only
  when the selected target has the matching keyword.
- 2026-08-06: Added model-by-model damage allocation to C, WebAssembly, the API,
  expected distributions, and live rolls, including casualties and lost
  overkill damage.
- 2026-08-06: Corrected Indirect Fire so unmodified Hit rolls of 1–3 always fail
  and Torrent weapons cannot fire indirectly at a non-visible target.
- 2026-08-06: Preserved variable Sustained Hits and Rapid Fire catalogue values
  such as D3 and D6+3 across the C engine, WebAssembly, API, editable profiles,
  shared matchups, exact distributions, and cryptographically random live rolls.
- 2026-08-06: Imported complete unit-composition and wargear-option exports with
  checksums and source timestamps; added safe model-count defaults, editable
  total weapon quantities, source guidance, and a loadout API without assuming
  every model carries every profile listed on its datasheet.
- 2026-08-06: Grouped all source-defined multi-profile weapons so equipped
  quantities are stored once, standard/supercharge and frag/krak modes cannot
  be mistaken for separate weapons, individual copies can still split across
  profiles in a volley, and Play Mode selects the firing profile explicitly.
- 2026-08-06: Compiled 1,704 unambiguous wargear options into source-linked
  fixed, per-model, and unit-size-dependent constraints covering 2,709 unit
  weapon groups; separated total equipped quantities from option-selected
  copies so editors and the API can flag illegal allowances without mistaking
  standard equipment for an upgrade, while retaining explicit overrides.
- 2026-08-06: Added exact and cryptographically random ordered multi-weapon
  volleys across the C engine, WebAssembly, API, and Unit vs Unit workflow.
  Mixed target profiles, casualties, existing wounds, damage reduction, Feel
  No Pain, and lost overkill now carry through an editable attack sequence;
  regressions prove that weapon order can change the resulting distribution.
- 2026-08-06: Structured 1,923 source-backed wargear choice pools and 3,419
  alternatives, including 204 compound multi-weapon bundles. Unit editors,
  saved lists, and the API now preserve per-alternative selections, enforce
  each shared allowance once, derive bundled weapon quantities, and retain the
  original source text while leaving total equipment editable.
- 2026-08-06: Imported the published `loadout` field and compiled 3,825 exact
  starting weapon quantities covering every weapon-bearing `This model` and
  `Every/Each model` loadout. Added 1,172 source-weapon replacement vectors so
  structured choices subtract old equipment and add the selected bundle while
  remaining editable. Corrected cross-line weapon grouping from 38 to 787
  multi-profile groups, including standard/supercharge modes assigned different
  source-line identifiers.
