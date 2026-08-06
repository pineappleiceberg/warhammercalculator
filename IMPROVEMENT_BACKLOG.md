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

1. Add an explicit per-model composition editor for the 88 conditional or
   multi-variable loadout subjects that total unit size alone cannot resolve.
2. Add data freshness checks, change reports, and source-version pinning.
3. Benchmark and profile large volleys in native and WebAssembly builds.
4. Improve mobile play-mode ergonomics and accessibility.
5. Add deployment health checks and clearer service-failure diagnostics.

## Completed cycles

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
