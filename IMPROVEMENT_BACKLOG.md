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

1. Model complete unit loadouts and weapon quantities from datasheet options.
2. Combine complete multi-weapon volleys in player-selected order so casualties
   and existing wounds carry between weapon profiles and mixed model profiles.
3. Add phase-scale simulations with reproducible seeded runs
   alongside cryptographically random live rolls.
4. Add property-based and fuzz testing at the C and API boundaries.
5. Expand formal proofs from threshold helpers to attack-plan invariants and
   probability-mass conservation.
6. Improve list persistence, import/export, and mid-game state recovery.
7. Add data freshness checks, change reports, and source-version pinning.
8. Benchmark and profile large volleys in native and WebAssembly builds.
9. Improve mobile play-mode ergonomics and accessibility.
10. Add deployment health checks and clearer service-failure diagnostics.

## Completed cycles

- 2026-08-06: Imported datasheet keywords and made Anti abilities activate only
  when the selected target has the matching keyword.
- 2026-08-06: Added model-by-model damage allocation to C, WebAssembly, the API,
  expected distributions, and live rolls, including casualties and lost
  overkill damage.
