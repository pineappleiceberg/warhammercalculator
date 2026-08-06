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

1. Classify the subject and recipient of imported ability clauses so selectors
   can distinguish self, led-unit, friendly-unit, and enemy-unit effects instead
   of relying only on the sign of a modifier.
2. Record the observed peak sparse-state count from exact Devastating Wounds
   volleys and use benchmark evidence to tighten the conservative preflight
   without ever hiding a valid exact option.

## Completed cycles

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
