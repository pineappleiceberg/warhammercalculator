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

1. Compile structured constraints from wargear-option prose so the editor can
   flag illegal replacements, per-model limits, and unit-size-dependent
   quantities.
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
