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

## Complete battle target

The persistent goal now includes a complete guided and automated battle engine,
not only matchup and attack resolution. The authoritative completion criteria,
required state, rules coverage, geometry, automation boundaries, verification
evidence, and delivery order are defined in
[`BATTLE_ENGINE_REQUIREMENTS.md`](BATTLE_ENGINE_REQUIREMENTS.md). The goal is not
complete while a supported full game still requires the calculator to silently
ignore a mandatory rule or while attack results do not update canonical battle
state.

## Prioritized backlog

1. Preserve canonical initial and rerolled Advance and Charge dice so Hostile
   Acquisition mobility can move from guided input to executable replay.
2. Add source-backed faction and detachment state transitions to canonical
   battle replay, apply their consequences to attacks, objectives, and bounded
   resources, and lock each transition into another full-game faction/mission
   fixture. Then continue across every supported faction, mission, and
   composition boundary.
3. Add reviewed curved surface primitives only when a supported physical terrain
   set cannot be represented exactly by panels and simple polygon solids.
4. Add deterministic automated policies and calibrated batch battle simulation
   only after the guided replay corpus closes the same rules boundaries.

## Completed cycles

- 2026-08-17: Advanced canonical battle replay to version 50 with the Leagues of
  Votann Prioritised Efficiency economy. Source-locked Command-phase objective
  state now awards each applicable Yield Point condition once, normal Oathbands
  switch between Hostile Acquisition and Fortify Takeover at the published
  boundary, and Mercenary Oathband can spend exactly 3YP to toggle its mode.
  Guided Play and the replay API apply the resulting Hit and Wound modifiers,
  with every award and attack fact independently checked through ACSL-specified
  C/WebAssembly predicates. A complete five-round Ûthar-versus-Brutalis golden
  replay covers ten awards, 26YP, and the Hostile-to-Fortify transition. Advance
  and Charge rerolls remain explicitly guided because the current event model
  records only the accepted movement result. Next, preserve both initial and
  rerolled dice so that mobility boundary becomes executable.

- 2026-08-17: Advanced canonical battle replay to version 49 with the complete
  Core Rules Desperate Escape trigger. Every Fall Back now records a reviewed
  per-model path plan and surviving enemy-model crossing witness before movement;
  replay combines crossing and Battle-shock triggers, applies the Titanic and Fly
  crossing exemptions, binds each D6 to its exact model, and schedules no more
  than one test per model in the phase. Guided Play blocks the move until required
  tests and exact casualties resolve. The public API independently cross-checks
  each trigger and roll through the ACSL-specified C/WebAssembly predicates.
  Official Core Rules pages 11 and 14, version-48 migration coverage, exhaustive
  Wasm differential cases, native/property/fuzz/formal checks, and a five-round
  Necrons-versus-Space-Marines enemy-crossing Fall Back replay lock the boundary.
  Next, add another source-backed faction or detachment transition.

- 2026-08-12: Advanced canonical battle replay to version 48 with executable
  Attached-unit separation. Destroying the last Bodyguard or attached Character
  now produces independently selectable surviving units only after the attacking
  unit finishes all attacks; multiple Characters split separately and retain
  exact health, model and weapon identity, battlefield state, Battle-shock,
  completed-activation state, Oath of Moment, Grim Resolve, and bounded
  persisting effects. Joined Bodyguard components prevent premature separation,
  and a mandatory split now precedes and remaps any Counter-offensive window.
  Desperate Escape and destroyed-Transport casualties can trigger the same transition atomically.
  Guided Play resolves saved-roster
  selections to the appropriate child, and Fire Overwatch exposes a target
  choice when multiple triggering survivors result. The public API reconstructs
  each child through its parent's damage history, while native C and WebAssembly
  validate an explicit no-health-change separation event. The pinned official
  October 2025 Core Rules Updates pages 1 and 9, migration tests, regenerated
  full-game fixtures, tamper tests, and cross-surface regression tests lock the
  boundary. Next, execute Desperate Escape caused by moving over enemy models.

- 2026-08-12: Advanced canonical battle replay to version 43 with source-locked
  Necrons Reanimation Protocols. At the end of each owning Command phase, every
  eligible surviving on-table Necrons unit must activate once, use a secure D3,
  and resolve the result one wound at a time. Replay heals an already-wounded
  model before returning a destroyed model with one wound, stops at full
  strength, and preserves mixed profiles and exact model identity. Attached
  units share healing while a Bodyguard model remains; the official Necrons FAQ
  boundary prevents a surviving Leader from returning a fully destroyed
  Bodyguard unit. Versioned migration never invents legacy activations. Guided
  Play, public API output, native replay event kinds, C/WebAssembly predicates,
  source manifests, the 214-, 260-, and 228-event golden games, and tamper and
  differential tests cover the transition. The full 375-test web suite, 48
  profile-data tests, native tests, a seeded 2,000-run fuzz campaign, 1,192 WP
  proof obligations, EVA with zero alarms, and E-ACSL checks pass. Next,
  source-lock another high-impact faction or detachment transition and its
  downstream combat, objective, or resource effects.

- 2026-08-12: Advanced canonical faction-rule replay to battle-state version 40
  with Orks' Waaagh! as the first executable army transition. A source-locked
  ORK player can call it once per battle only at the start of their Command
  phase; replay keeps it active through the opposing turn and expires it at the
  start of that player's next Command phase. Only formations whose locked
  source profiles contain the ability gain the Advance-charge exception, +1
  melee Attacks, +1 melee Strength, and granted 5+ invulnerable save; Fall Back
  remains disallowed. Guided Play owns the call/spent state and disables manual
  combat toggles during an active battle. The replay API exposes per-formation
  state checked against an ACSL-specified C/WebAssembly predicate. Native,
  differential, migration, tamper, UI, API, fuzz, and formal gates cover the
  transition, and the Aeldari-versus-Orks golden replay now source-locks the
  call in 228 append-only events. The next boundary is an executable
  detachment-level choice with objective or bounded-resource consequences.

- 2026-08-12: Added the first full-game attached and mixed-profile golden
  replay. A Farseer attached to Guardian Defenders faces a Warboss attached to
  Boyz under source-locked Aeldari Guardian Battlehost, Orks Green Tide, Supply
  Drop, and Terrain Layout 2 identities. The 228-event replay preserves both
  Leaders as distinct models, exact Guardian/platform and Boy/Nob profiles,
  reviewed weapon bearers, a completed and scored physical-card Mission Action,
  a legal round-two Rangers Strategic Reserves arrival, every active clock
  state, and final Battle Ready scoring. A physically possible ordered Slugga
  and Rokkit volley removes all eleven Bodyguard models across one-wound and
  two-wound profiles while proving that the attached Farseer cannot receive
  damage first. SHA-256 fixture generation, source-lock checks, JavaScript
  replay, public API replay, and C/WebAssembly health and clock checks cover all
  four formations and now records the Orks player's canonical Waaagh! call. The
  next corpus boundary is executable detachment
  state changes and their downstream combat, objective, and resource effects.

- 2026-08-12: Added the first action-heavy, source-locked full-game replay. A
  Canoptek Doomstalker versus five Intercessors now records exact deployment and
  movement geometry, Fire Overwatch, Go to Ground, four ranged/melee attack
  resolutions, three Intercessor casualties, a successful Charge, Pile In and
  Consolidation for both sides, three objective-control changes, two Tactical
  draws, scoring, discard, every one of the 170 active clock states, and final
  Battle Ready scoring in 244 append-only events. The fixture is SHA-256 bound,
  regenerated in CI, and replayed for both formations through the public API
  and C/WebAssembly health and clock ABIs. This broader replay exposed and fixed
  two cross-surface defects: C clock verification now validates each canonical
  transition from its action-mutated `from` state, and Tactical card scores no
  longer masquerade as a Fixed-card high score in tracker facts. The next
  corpus boundary is attached/mixed composition, Mission Actions, Reserves,
  and explicit faction/detachment decisions on another faction/mission pair.

- 2026-08-12: Established the current full-game golden replay format and first
  real-catalogue fixture. A Necrons Doom Scythe and Space Marines Brutalis
  Dreadnought pair now binds the current battle-state version and four source
  checksums, selects exact faction, detachment, datasheet, Chapter Approved
  mission, and terrain identities, records reviewed battlefield geometry,
  deployment, and Reserve decisions, visits every one of the 170 active phase/step states
  across five rounds, resolves every offered Rapid Ingress window, applies
  capped Primary, Fixed Secondary, and Battle Ready scoring, and reaches the
  canonical complete state in 209 append-only events. SHA-256-bound state and
  expected summaries reject corpus drift and tampering. The worker replay API
  sends the same complete clock and selected formation through C/WebAssembly,
  while CI regenerates the fixture in check mode before the full suite. The
  next corpus fixture must exercise on-table combat and Tactical missions rather
  than treating clock completeness as complete battle-rule coverage.

- 2026-08-12: Made executable battlefield geometry inspectable without changing
  battle-state serialization. Guided Play can select a formation and exact model
  to plot its reviewed path, start and end envelope, terrain footprints, panels,
  polygon solids, collision highlights, endpoint support, and every recorded
  clearance reason. The same inspector selects an observer/target model pair,
  plots the sampled line-of-sight witness and conservative full-visibility
  corridor, identifies the first terrain or model blocker, and summarizes all
  tested blocked rays. Versioned validators and copyable JSON exports make both
  proof forms machine-readable. Adversarial movement traces are fairly bounded
  per model and globally while the complete ruling still runs and reports any
  omitted display checks explicitly. Movement, visibility, replay, UI, API,
  C/WebAssembly summary, formal, CI, and deployment gates share regression
  coverage.

- 2026-08-12: Advanced reviewed terrain movement to battle-state version 39.
  Elevated floors, ceilings, and overhangs can now use either legacy convex
  polygons or reviewed three-to-thirty-two-vertex simple counter-clockwise
  polygons. Concave solids are validated against duplicate, collinear,
  out-of-frame, clockwise, and self-intersecting boundaries, decomposed into
  exact convex pieces for swept whole-model collision, and tested against their
  true boundary for full-base elevated support so cut-outs are never filled by
  a convex hull. Guided Play, replay migration, native C, WebAssembly, and an
  ACSL-specified cross-surface validator share regression and differential
  coverage. Curved primitives remain reviewed until their geometry is explicit.

- 2026-08-12: Advanced source-locked Chapter Approved play to battle-state
  version 38. Both players now lock Fixed or Tactical Secondary Mission plans
  before an exact game starts. Tactical draws, the two-active-card limit, deck
  exhaustion, one-use-per-Command-phase New Orders with its 1 CP cost,
  achieved and voluntary turn-end discards, and the active player's 1 CP gain
  are replayable. Primary, Secondary, Fixed-card, Battle Ready, and 100-point
  total caps are enforced rather than merely displayed. Physical card names,
  scoring conditions, Action timings, and completion conditions remain
  reason-backed player input because individual card text is unavailable.
  Universal Action eligibility, simultaneous-unit limits, movement,
  battlefield departure, destruction, shooting, and Charge interactions are
  replayed; attack undo restores an Action failed by the reverted destruction.
  Guided Play, persistence, API output, native C, WebAssembly, and an
  ACSL-specified cross-surface summary validator share lifecycle, cap,
  migration, tamper, and differential coverage.

- 2026-08-12: Advanced exact terrain movement to battle-state version 37. Each
  terrain section now records its movement semantics, complete panel/opening
  geometry, and optional convex elevated solids. Replay checks deployment
  endpoints and the complete path of every surviving circular, elliptical,
  rectangular, or reviewed convex-prism model envelope, including strict wall crossings, openings,
  vertical climbs, overhang clearance, supported elevated endpoints, and Ruins
  keyword restrictions. Incomplete geometry, unsupported semantics, pivots, and
  version-36 histories remain explicit player-reviewed fallbacks rather than
  false proofs. Guided Play and the replay API expose the same reason-bearing
  facts, and JavaScript is differentially checked against an ACSL-specified
  C/WebAssembly summary predicate.

- 2026-08-11: Advanced exact battlefield geometry to battle-state version 36.
  Replay now compares every current circular, elliptical, or rotated rectangular
  base or hull in three dimensions against every other current model and the
  recommended 40 mm objective-marker footprint. Positive endpoint overlap is
  rejected after deployment, movement, Reserve arrival, Charge, Fight movement,
  and disembarkation, while exact boundary contact remains legal. Stale geometry
  and version-35 snapshots migrate to an explicit reviewed unknown rather than a
  false proof. Guided Play and the replay API expose the same collision pairs,
  and JavaScript is differentially checked against an ACSL-specified
  C/WebAssembly summary predicate. Complete-path terrain clearance remains the
  next geometry boundary.

- 2026-08-11: Advanced exact objective state to battle-state version 35. The
  checked catalogue now carries the published Objective Control characteristic
  for all 1,868 model profiles into exact mixed and Attached battle formations.
  Replay sums every surviving model currently within range of each marker,
  applies Battle-shock as OC 0, treats every equal total (including 0-0) as
  contested, and establishes control only at the end of a phase or turn. Guided
  Play and the replay API expose per-player and per-formation contributions. A
  player-recorded override remains
  available for guided flavour rules and can be cleared back to the geometric
  result. Missing geometry or legacy OC fails closed; version-34 games retain
  absent characteristics rather than receiving current catalogue values.
  JavaScript and an ACSL-specified C/WebAssembly predicate share source-data,
  casualty, Battle-shock, tie, override, migration, malformed, and API coverage.

- 2026-08-11: Advanced reviewed model geometry to battle-state version 34.
  Players can optionally replace a model's conservative primitive envelope with
  a three-to-sixteen-vertex strictly convex counter-clockwise outline extruded
  through its reviewed height. Exact rotated segment/prism intersection removes
  false line-of-sight blockers, while bounding-volume proofs can establish full
  visibility only when every possible model obstruction is safely excluded;
  ambiguous terrain or model geometry remains unknown. Version-33 games migrate
  without invented outlines. Guided Play, persistence, replay/API output,
  JavaScript, and an ACSL-specified C/WebAssembly validator share malformed,
  rotation, migration, integration, and differential coverage.

- 2026-08-11: Advanced exact battlefield geometry to battle-state version 31.
  Circular, elliptical, and rotated rectangular model boundaries now derive
  unit coherency, Engagement Range, and objective-marker proximity from their
  closest points with separate horizontal and vertical Core Rules thresholds.
  Units of seven or more models require two neighbours, the recommended 40 mm
  objective footprint is included, and newly recorded incoherent snapshots fail
  closed. Based models measure to their base; baseless hulls require a measured
  vertical extent. Legacy hulls and stale casualty geometry report unknown
  instead of inventing facts. Guided Play, replay/API output, JavaScript, and an
  ACSL-specified C/WebAssembly summary predicate share threshold, migration,
  malformed-input, and differential coverage. Visibility and cover remain
  reviewed until the state contains real 3D walls, openings, and silhouettes.

- 2026-08-11: Advanced exact Transport geometry to battle-state version 30.
  Starting-embarked declarations and later embarkation now record every stable
  model identity inside the named Transport, while later embarkation removes
  obsolete battlefield coordinates. Destroyed Transports queue
  each surviving passenger formation independently, preserving the Core Rules
  distinction between normal placement wholly within 3 inches and Emergency
  Disembarkation wholly within 6 inches. Unplaceable and mortal-wound
  casualties are applied before the snapshot, fully destroyed passengers
  receive an explicit destroyed location, and multiple passenger or nested
  Transport resolutions retain immediate-disembarkation priority. Guided Play,
  replay/API output, version-29 migration, and C/WebAssembly aggregate position
  validation have regression and differential coverage.

- 2026-08-11: Advanced exact guided geometry to battle-state version 29 across
  successful Charge and Heroic Intervention moves, non-zero Pile In and
  Consolidation moves, and normal disembarkation. Source-locked games now pause
  each action before its reaction, attack, or completion boundary until every
  surviving stable model identity has a reviewed path or endpoint. Charge and
  Fight snapshots must use the exact maximum distance from their referenced
  action; mismatched contexts, stages, unsuccessful references, stale starts,
  survivor identities, endpoints, paths, and allowances fail closed.
  Disembarking units record their first tabletop footprints before the set-up
  Fire Overwatch window. Version-28 histories migrate without invented extended
  movement, while custom games retain the lightweight confirmation workflow.
  Guided Play, replay/API serialization, and the existing ACSL-specified
  C/WebAssembly aggregate validator share integration and differential coverage.

- 2026-08-11: Advanced exact guided geometry to battle-state version 28 with
  replayable per-model movement and Reinforcement positions. Normal, Advance,
  and Fall Back actions in source-locked Chapter Approved games now pause before
  their end reaction until every surviving stable model identity records its
  locked footprint, full reviewed path, endpoint, measured farthest-part
  distance, and reviewed maximum. Reserves and Rapid Ingress record the same
  formation's first exact positions before play continues, and Fire Overwatch
  set-up/end windows open only after the snapshot exists. Replay rejects wrong
  per-segment survivor counts, changed footprints, mismatched starts or
  endpoints, paths outside the battlefield, measured distances shorter than
  the centre path, over-limit movement, and incomplete physical reviews.
  Casualties explicitly mark prior geometry stale until a later snapshot names
  the surviving models; compensating attack undo restores freshness when the
  snapshot matches again. A later move from geometry made stale by Charge or
  Fight movement now carries an explicit reconciliation flag and verified
  per-model starting points instead of overwriting the earlier snapshot.
  Version-27 games migrate without invented paths, and
  custom games preserve their existing confirmation workflow. Guided Play,
  replay/API output, JavaScript, and an ACSL-specified C/WebAssembly predicate
  share movement, arrival, casualty, migration, malformed-input, and
  differential coverage.

- 2026-08-11: Advanced canonical battle setup to version 27 with replayable
  exact-model deployment snapshots. After each battlefield formation is placed
  in an exact Chapter Approved game, Guided Play now requires every stable model
  identity, its base or baseless-model measurement boundary, circular, elliptical,
  or rectangular footprint dimensions, centre, elevation, and rotation before
  alternating deployment can continue or the battle can start. Exact rotated
  extents must remain inside the 60-by-44-inch frame; missing, duplicate,
  unrecognized, undimensioned, unsupported, or out-of-bounds models and incomplete
  reviews fail closed. Physical model/model and model/objective non-overlap remain
  explicit player-reviewed facts rather than unsafe flat-geometry guesses. Manual,
  UWB, camera, and imported provenance remain reviewable. Version-26 games migrate
  without invented geometry and can append snapshots against their historical
  deployment events. Custom games preserve their confirmation-only workflow.
  Guided Play, replay/API output, JavaScript, and an ACSL-specified C/WebAssembly
  predicate share migration, rotation, edge, malformed-input, and differential
  coverage. The next geometry boundary is replayable movement and Reserve-arrival
  placement using these same stable model identities.

- 2026-08-11: Advanced canonical battle setup to version 26 with replayable
  terrain footprints. Exact Chapter Approved games now require all twelve
  official rectangular area-terrain outlines before deployment: four 6-by-4,
  two 10-by-5, and six 12-by-6 outlines, each with a centre, rotation, and
  source-reviewable area-terrain section ID. Rotated corners must stay inside
  the 60-by-44-inch frame; positive-area overlaps, missing or duplicate
  outlines, wrong size counts, incomplete reviews, and source mismatches fail
  closed, while touching outlines remain legal. Shared section IDs preserve the
  companion's single-versus-separate connected-outline semantics. Manual, UWB,
  camera, and imported provenance remain editable until locked. Version-25
  games migrate without invented footprints and can append one reviewed record.
  Guided Play, API replay, JavaScript, and a new ACSL-specified C/WebAssembly
  aggregate predicate share regression coverage. This boundary was extended by
  version 27's exact-model deployment snapshots.

- 2026-08-11: Advanced canonical battle setup to version 25 with a replayable
  Chapter Approved table frame. Exact 2025-26 v1.4 mission/layout games now
  fail closed before deployment until a player reviews the 60-by-44-inch
  battlefield, every configured objective centre, the named deployment map,
  and the official 12-section terrain inventory (four 6-by-4, two 10-by-5,
  and six 12-by-6 sections). Coordinates use a stable Attacker-left-near origin
  and preserve manual, UWB, camera, or imported provenance plus a reason-backed
  review. Mission/layout mismatches, duplicate or out-of-bounds coordinates,
  incomplete reviews, late mutations, and missing objectives are rejected;
  custom missions keep their prior deployment workflow. Version-24 games
  migrate without invented geometry and may append one reviewed binding.
  Guided Play records and displays the frame, the replay API returns it, and a
  new ACSL-specified C/WebAssembly predicate is differentially checked against
  JavaScript. The next geometry boundary is exact terrain footprints and model
  or hull positions within this frame.

- 2026-08-11: Pinned the final 10th-edition Chapter Approved 2025-26 Tournament
  Companion v1.4 by official URL, SHA-256, retrieval date, and reviewed pages.
  The checked catalogue preserves all 20 A-T Primary Mission/deployment
  combinations, all eight recommended terrain layouts, and their exact
  compatibility relationships without copying paid mission-card prose. The
  version-24 coverage snapshot now contains 2,970 rules, with every mission and
  layout classified as guided. Guided Play uses exact mission and filtered
  terrain menus; canonical setup rejects unknown and incompatible pairs. Static
  clients and the hosted API expose the same discovery data, and deployment
  health verifies the published catalogue. Physical geometry and mission-card
  scoring remain explicitly guided and are the next correctness boundaries.

- 2026-08-11: Ingested the pinned 10th-edition army-rule export into SQLite
  schema 78: 262 exact detachment identities, 284 detachment abilities, 927
  enhancements, 1,453 detachment Stratagems, and their datasheet applicability
  relations. The source lock now covers all seven contributing rule exports and
  the importer repairs the export's single embedded physical newline while
  still failing closed on malformed record widths. The generated version-24
  coverage matrix now contains 2,942 source-locked entries, including every
  detachment and enhancement as guided rather than falsely executable. Guided
  Play uses faction-filtered detachment and eligible-bearer enhancement menus;
  canonical setup rejects invalid relationships and duplicate selections. The
  API publishes equivalent detachment and enhancement discovery endpoints.
  Mission-pack and terrain-layout ingestion is now the highest-priority setup
  blocker.

- 2026-08-11: Connected every one of the pinned profile catalogue's 26 factions
  and 1,712 datasheets to canonical battle setup. A deterministic generator
  emits 1,738 exact guided coverage entries from the checked profile snapshot,
  locks them through the manifest that pins every contributing Wahapedia CSV,
  publishes typed faction/datasheet record locators, and rejects stale generated
  artifacts in CI. Saved lists now select those exact rule IDs automatically;
  the shared guided-review reason acknowledges each selected non-executable
  faction and datasheet rule without making it appear executable. Unknown IDs
  still fail closed, and detachment, enhancement, terrain, and mission rules
  remain explicit blockers until their own source sets are ingested.

- 2026-08-11: Advanced canonical battle setup to version 24 with an append-only,
  source-locked rule selection boundary. Every new battle now records the exact
  faction identity and datasheet identity for each saved unit, explicit
  detachment and enhancement declarations for each player, the mission and
  terrain selections, and the complete known Core Rules and universal
  Stratagem set. The binding stores the exact source snapshot and checks every
  selected rule through the four-state coverage contract; absent, stale,
  unsupported, or unacknowledged guided rules block battle start before turn
  one. Guided Play displays each blocking rule and records a reason-backed
  physical-table acknowledgement. The replay API recomputes the complete
  binding from the deployed source catalogue, independently cross-checks every
  result through C/WebAssembly, and rejects altered hashes or reports. Versions
  1-23 migrate behind an explicit sequence boundary, preserving already-started
  games while gating the next new start. The next priority is pinned faction,
  detachment, enhancement, datasheet, terrain, and mission ingestion so real
  matchups can move from precise unsupported reports to supported play.

- 2026-08-11: Added the first source-locked rule coverage contract. The
  machine-readable matrix classifies 15 implemented Core Rules and universal
  Stratagem boundaries as executable or guided, locks every entry to the exact
  official source checksum and page set, and explicitly defaults unlisted core,
  faction, detachment, enhancement, datasheet, Stratagem, terrain, and mission
  rules to unsupported. Guided entries require a reason-backed player
  acknowledgement; unknown or stale-source entries fail closed. Static clients
  can fetch the matrix directly, while the hosted API exposes discovery and
  bounded coverage-check endpoints and reports the matrix in dependency health.
  A formally specified C predicate is exported to WebAssembly and
  differentially checked against JavaScript. The next cycle records exact rules
  selections in canonical battle setup so omission cannot bypass the gate.

- 2026-08-11: Advanced guided play to battle-state version 23 with canonical
  Rapid Ingress. At the end of the opposing Movement phase, replay now opens a
  blocking response for each eligible formation in Reserves. Resolution spends
  1CP atomically, enforces Battle-shock and same-Stratagem once-per-phase
  restrictions, records Deep Strike, Strategic Reserves, or source-rule
  placement facts, deploys the complete nested Transport tree as Reinforcements,
  and keeps passengers embarked. Round-one source exceptions require explicit
  out-of-phase permission. The large-model Strategic Reserves exception records
  the own-edge placement and enforces its move, shoot, and charge restriction
  for the turn. Guided Play exposes resolve and decline controls; the replay API
  reports pending, resolved, and passed windows and independently cross-checks
  the ACSL-specified predicate through C and WebAssembly. Version-22 histories
  migrate without retroactively opening a response window. Official Core Rules
  pages 42-43 and Core Rules Updates pages 10, 12, and 14 define the source
  boundary. Release evidence includes three native suites, 247 web/API/Wasm
  tests, the static Pages build, 2,000 ASan/UBSan fuzz inputs, E-ACSL runtime
  checks, zero Eva alarms, and 683 proved WP goals.

- 2026-08-11: Advanced guided play to battle-state version 22 with canonical
  Smokescreen. Closing an activation-wide ranged declaration now offers every
  eligible enemy Smoke target before attack dice, blocks unrelated events,
  spends 1CP atomically, enforces Battle-shock and once-per-phase restrictions,
  and grants Benefit of Cover plus Stealth until the end of the phase. When Go
  to Ground and Smokescreen trigger together, the active player explicitly
  chooses their Core Rules sequencing order; either order is replayed and the
  second window is recomputed after the first decision. Guided Play composes
  cover and the capped -1 Hit modifier into editable attack snapshots, and the
  replay API exposes pending, resolved, declined, active-effect, and sequencing
  state. An ACSL-specified predicate is proved and differentially checked across
  C, WebAssembly, JavaScript, the API, native tests, 2,000 sanitizer fuzz runs,
  E-ACSL runtime checks, Eva, and 663 WP goals. Version-21 histories migrate
  without retroactive response windows. Official Core Rules pages 9, 20, 42,
  and 44 plus Core Rules Updates page 21 define the source boundary.

- 2026-08-11: Advanced guided play to battle-state version 21 with canonical
  Counter-offensive. Every completed enemy Fight activation can now open the
  responding player's 2CP decision window when at least one living, on-board,
  non-Battle-shocked formation has not fought. Resolution records reviewed
  Engagement Range, spends CP atomically, enforces once-per-phase use, and
  forces the selected formation to fight next even during the Fights First
  step; declining preserves normal Fight priority. Guided Play blocks unrelated
  actions until the choice is made, and the replay API exposes pending,
  resolved, declined, and forced-activation state. An ACSL-specified predicate
  is proved and differentially checked across C, WebAssembly, JavaScript, the
  API, native tests, fuzzing, and formal runtime checks. Version-20 histories
  migrate without retroactively opening response windows. Official Core Rules
  page 41 and the October 2025 Core Rules Updates define the source boundary.

- 2026-08-11: Advanced guided play to battle-state version 20 with executable
  empty Dedicated Transport and Aircraft/Hover setup exceptions. Locked
  catalogue registrations preserve Dedicated Transport and Aircraft keywords
  plus the source-derived Hover ability. An empty Dedicated Transport must be
  marked not deployed and becomes destroyed when round one begins; an occupied
  one deploys normally. Aircraft mode must start in Reserves, while a model with
  Hover can declare that mode and deploy on the battlefield or enter Strategic
  Reserves. Guided Play derives the legal defaults, the replay API exposes each
  setup report and round-one destruction, and an ACSL-specified predicate is
  differentially checked across C, WebAssembly, JavaScript, the API, fuzz, and
  formal runtime checks. Version-19 histories migrate without retroactive rule
  rejection. Official Core Rules pages 53 and 56 provide the source boundary.

- 2026-08-11: Advanced guided play to battle-state version 19 with executable
  datasheet-permitted nested Transport deployment. The event replay now follows
  complete passenger-to-carrier ancestry, rejects cycles, applies Reserve
  eligibility and Strategic Reserves points to every nested formation, marks
  the full tree deployed when the outer carrier deploys or arrives, and reports
  every descendant destroyed if its Reserve root never arrives. A transported
  Transport can disembark before its own phase-start passengers disembark, while
  normal movement, setup, and forced-destruction timing remain enforced.
  Guided Play resolves nested form choices to the outermost location. The replay
  API exposes each resolved chain and independently cross-checks an
  ACSL-specified ancestry predicate through C/WebAssembly. Native, migration,
  cycle, battlefield, Strategic Reserves, API, Wasm differential, fuzz, formal,
  and rendered workflow regressions cover the rule. Version-18 histories
  migrate without rewriting their event logs. The Core Rules pages 17 and 43
  and locked Stormbird/Thunderhawk datasheet Transport text provide the source
  boundary.

- 2026-08-11: Advanced guided play to battle-state version 18 with immutable
  source-compatible Transport choices instead of treating a roster preset as a
  rules restriction. Setup derives every compatible friendly carrier for the
  complete formation, including Attached formation components, and Guided Play
  offers those alternatives during deployment and later embarkation while still
  identifying the roster preset. Replay recalculates occupied space from each
  component's surviving models, preserves independent capacity pools, rejects
  mixed alternative modes, applies shared model allowances and primary-capacity
  reductions, and keeps nested passengers from being double-counted by an outer
  carrier. Compatibility and live occupancy are exposed by the replay API. A
  shared ACSL-specified capacity predicate is differentially checked across C,
  WebAssembly, JavaScript, and the API, with native, migration, casualty,
  compound-pool, fuzz, and rendered workflow regressions. Version-17 histories
  migrate behind an explicit Transport-compatibility boundary. Official Core
  Rules page 17 is source-locked for the friendly compatible Transport and live
  capacity requirements.

- 2026-08-11: Advanced guided play to battle-state version 17 with immutable,
  activation-wide Shooting declarations. Every weapon copy, selected profile,
  and split-fire target is now declared before any attack dice are generated.
  Closing the set groups resolution by first-selected target and then
  first-selected weapon profile, rejects duplicate or aggregate-over-count
  declarations, and locks each queued attack to its activation, source,
  profile, count, target, reviewed eligibility facts, and editable combat
  snapshot. Go to Ground now opens once from the complete eligible Infantry
  target set, allowing the defender to choose the affected unit before the
  queue resolves. Later casualties update surviving target counts without
  changing attack facts, destroyed targets are skipped, undo restores the
  declaration's queue position, and Hazardous tests count all declared
  Hazardous copies. Guided Play exposes draft, retract, finish, reaction, and
  ordered-roll controls. The replay API exposes draft, closed, ready,
  retracted, and auto-skipped state and independently cross-checks the
  ACSL-specified declaration predicate through C/WebAssembly. Version-16 and
  older histories migrate behind an explicit ranged-declaration boundary.
  Official Core Rules pages 19-20 are source-locked for activation-wide target
  selection, split fire, and target/profile-contiguous resolution.

- 2026-08-11: Advanced guided play to battle-state version 16 with an executable
  Go to Ground reaction at the current single-weapon declaration boundary. The
  first reviewed ranged target in an activation now pauses before attack dice
  are generated when an eligible enemy Infantry formation can use the
  Stratagem. Replay enforces the opponent's Shooting-phase timing, target-player
  1CP deduction, Battle-shock restriction, same-Stratagem once-per-phase
  restriction, pass path, and exact declaration-to-attack binding. Resolution
  gives every target model a 6+ invulnerable save and Benefit of Cover until
  phase end; better invulnerable saves remain better and Ignores Cover removes
  only the cover benefit. The play UI resumes the locked attack after the
  defender's choice. The replay API exposes pending, ready, resolved, declined,
  and active-effect state, and an ACSL-specified native predicate is exported to
  WebAssembly and differentially checked. Version-15 and older histories
  migrate behind an explicit Go to Ground boundary. Official Core Rules pages
  25, 41, 42, and 44 and Core Rules Updates page 18 are source-locked for the
  implemented interaction. Activation-wide target declaration remains the next
  correctness slice so a split-fire unit can expose every eligible target to
  the defender before any attack is rolled.

- 2026-08-11: Advanced guided play to battle-state version 15 with canonical
  Hazardous self-damage. Locked weapon profiles and exact bearer segments now
  preserve Hazardous identity and model keywords. Replay requires one test for
  every used Hazardous weapon copy, records optional reason-bearing re-rolls,
  resolves failed tests one at a time in wounded/non-Character/Character
  priority across all surviving Hazardous bearers in the unit (including those
  whose weapons were not used), applies three mortal wounds to the selected
  model with Feel No Pain, and prevents spillover. Charge-phase Fire Overwatch records tests after
  shooting but defers mortal-wound allocation until the triggering charger ends
  its Charge move; when Heroic Intervention shares that timing, both actions
  remain pending so the active player chooses their resolution order.
  Guided Play rolls tests and Feel No Pain with rejection-sampled browser CSPRNG
  values. The replay API includes pending, deferred, tested, and damaged state,
  and native health replay plus an ACSL-specified C/WebAssembly predicate
  independently cross-check the JavaScript result. Version-14 and older
  histories migrate behind an explicit Hazardous boundary. Native, UI, API,
  migration, tamper, Wasm differential, fuzz, provenance, and formal regressions
  cover the cycle.

- 2026-08-11: Advanced guided play to battle-state version 14 with canonical
  Fire Overwatch. Enemy setup, Normal/Advance/Fall Back starts and ends, and
  charge declarations now open immediate responder windows that block the
  interrupted action until resolved or declined. Resolution enforces the
  October 2025 Core Rules Update boundary: 1CP by default, once per turn, one
  living non-Titanic responding formation with a surviving ranged weapon, a
  visible triggering formation within 24 inches, reviewed Shooting eligibility,
  and explicit exclusion of Shooting-phase-only rules and Firing Deck. The
  resulting activation is target-locked and forces unmodified 6s for Hit and
  Critical Hit rolls while preserving applicable weapon rules. CP spending,
  activation identity, weapon use, attack undo, trigger resumption, and target
  destruction are replay invariants. Hazardous use fails closed until deferred
  self-damage is executable. Version-13 and older histories migrate behind an
  explicit boundary. Guided Play exposes begin and decline paths; the replay
  API returns pending, active, resolved, and declined state and independently
  cross-checks an ACSL-specified native predicate exported to WebAssembly.
  Native, migration, timing, UI, API, Wasm differential, provenance, fuzz, and
  568-goal formal regressions cover the cycle.

- 2026-08-11: Advanced guided play to battle-state version 13 with canonical
  Heroic Intervention. Every successful enemy Charge now opens an immediate
  responder window that blocks unrelated events and clock advancement until it
  is resolved or declined. Resolution enforces the October 2025 10th-edition
  Core Rules Update boundary: 1CP by default, one eligible responding formation
  within 6 inches, only the triggering charger as a target, a reviewed Charge
  roll and move, Walker-only Vehicle use, and no Charge Bonus. CP spending is an
  atomic replay invariant; nonstandard costs, repeat uses, Battle-shocked or
  Aircraft eligibility require source-rule reasons. Guided Play presents the
  decision, CSPRNG roll, physical-table confirmations, success/failure, and pass
  paths. Version-12 and older histories migrate behind an explicit reaction
  boundary. The replay API returns pending, resolved, and declined reactions and
  independently cross-checks an ACSL-specified native predicate exported to
  WebAssembly. Native, migration, timing, tamper, UI, API, Wasm differential,
  provenance, fuzz, and formal regressions cover the cycle.

- 2026-08-10: Advanced guided play to battle-state version 12 with canonical
  Fight movement. Every new Fight activation records a reviewed Pile In before
  melee attacks and a reviewed Consolidation after attacks are complete. Each
  stage captures the longest model move, stationary base-contact models,
  coherency, closer-model and maximum-base-contact facts, and one exact Core
  Rules destination branch: Engagement Range, the closest objective when the
  enemy branch is impossible, or no movement when both are impossible. Replay
  rejects moves over 3 inches, reordered or repeated stages, unknown objectives,
  melee attacks outside the Pile-In-to-Consolidation window, and premature
  activation completion. Version-11 and older histories retain legacy Fight
  behavior behind an explicit migration boundary. Guided Play presents the full
  sequence, while an ACSL-specified native predicate is proved, exported to
  WebAssembly, differentially checked against JavaScript, and independently
  cross-checked by the replay API. Native, migration, tamper, UI, API, Wasm,
  provenance, and formal regressions cover the cycle.

- 2026-08-10: Advanced guided play to battle-state version 11 with canonical
  charge-roll and charge-movement facts. New attempts record both D6, modifiers,
  effective distance, every target's declared distance and final Engagement
  Range state, the longest model move, phase-start eligibility, coherency,
  non-target avoidance, closer-model movement, maximum possible base contact,
  player review, and explained overrides or failures. Successful movement is
  rejected unless every required Core Rules page 29 fact is present; failed
  charges record no movement. Browser rolls use rejection-sampled CSPRNG values,
  while manually entered dice remain editable and recompute canonical distance.
  Version-10 and older attempts retain their historical aggregate behavior
  behind an explicit migration boundary. A new ACSL-specified native predicate
  is proved, exported to WebAssembly, differentially checked against JavaScript,
  and independently cross-checked by the replay API. Native, migration, tamper,
  UI, API, Wasm, provenance, and formal regressions cover the cycle.

- 2026-08-10: Advanced guided play to battle-state version 10 with exact
  weapon-bearer identity. Every saved formation now has stable model instances,
  and each equipped weapon copy is assigned to one of those instances. Optional
  assignments require player review before battle start. Models with identical
  profiles are grouped only when their complete bearer loadouts match, so
  casualty allocation removes the exact weapon copies carried by the destroyed
  loadout. Target allocation exposes those loadout groups, setup equipment
  corrections preserve reviewed assignments, and new attacks cannot declare
  more copies than the surviving bearers. Version-1 through version-9 logs
  retain their historical aggregate behavior behind explicit migration
  provenance. A new ACSL-specified native predicate is proved and exported to
  WebAssembly; the replay API reports bearer tracking and event-time surviving
  copies and cross-checks JavaScript against C/Wasm. Exact splitting fails
  closed before exceeding the native 16-segment allocation limit. Native, web,
  UI, API, migration, tamper, Wasm differential, and formal regressions cover
  the cycle.

- 2026-08-10: Advanced guided play to battle-state version 9 with immutable
  weapon provenance. Every formation registration now freezes equipped group
  counts, mutually exclusive profile IDs, published Range, Assault and Indirect
  Fire abilities, and the exact source saved unit. New measurements and attacks
  reference that locked identity. Replay rejects invented weapons, changed
  names or Range, forged abilities, destroyed source units, unrelated Firing
  Deck sources, and reuse beyond the remaining group copies; reverting an
  attack restores its allowance. Guided Play disables exhausted groups and
  reports remaining copies. A new ACSL-specified native predicate is exported
  to WebAssembly and differentially tested against JavaScript, while version-1
  through version-8 histories migrate behind an explicit legacy boundary.
  Native, web, migration, tamper, API, Wasm, and formal regressions cover the
  cycle.

- 2026-08-10: Advanced guided play to battle-state version 8 with canonical
  ranged target measurements. Browser catalogue exports now preserve Range text
  for all 9,163 weapon profiles and numeric Range for every supported ranged
  profile (retaining two explicit unavailable values), and
  catalogue-mode agent URLs reject positive distances beyond the selected
  weapon's Range. Guided Play records published and effective Range, measured
  closest-point distance to thousandths, visibility/full visibility, direct or
  Indirect Fire, eligible selected weapon count, measurement source, player
  review, and explained Range overrides. Every new ranged attack references the
  exact replayed fact, weapon, formations, clock, mode, and declared count;
  unknown, stale, out-of-range, non-visible, unsupported Indirect Fire, and
  over-count attacks fail closed. The replay API exposes eligibility facts and
  cross-checks them against the same C/WebAssembly predicate. ACSL specifies the
  predicate, WP proves it, E-ACSL exercises it, and native, fuzz, Wasm
  differential, migration, catalogue, UI, API, and source-lock regressions cover
  the change. Core Rules pages 7, 8, 19, and 26 join the pinned official source.

- 2026-08-10: Advanced guided play to battle-state version 7 with canonical
  Transport occupancy. Legal saved assignments now lock exact passenger and
  carrier formations. Declare Battle Formations supports starting embarked;
  normal embark/disembark timing enforces completed movement, 3-inch placement,
  start-of-phase occupancy, same-phase restrictions, Transport movement, and
  downstream movement/charge eligibility. Firing Deck uses current occupancy.
  Destroying an occupied Transport blocks all other transitions until every
  passenger resolves normal or Emergency Disembarkation, CSPRNG per-model rolls,
  applicable Feel No Pain, unplaceable models, mixed-profile casualty allocation,
  casualties, Battle-shock, and movement/charge restrictions. Deadly Demise
  ordering is an explicit fail-closed confirmation instead of a silently skipped
  tabletop fact. Native C, WebAssembly, and the replay API
  independently cross-check passenger health transitions. Version-1 through
  version-6 logs migrate as explicitly unembarked. Core Rules pages 17, 18, 23,
  and 53 join the pinned deployment source, with state, migration, timing,
  tamper, UI, API, C/Wasm, fuzz, and formal regressions covering the cycle.

- 2026-08-10: Advanced guided play to battle-state version 6 with replayed
  deployment and Reserves. Every formation declares battlefield, Reserves, or
  Strategic Reserves before deployment; Strategic Reserves enforce the
  per-player 25% points cap, round-two minimum, and Fortification exclusion.
  Battlefield formations deploy one at a time in alternating player order.
  Reserve arrivals are restricted to the owning active player's Reinforcements
  step and recorded as a Normal move. Off-battlefield formations cannot move,
  charge, activate, attack, or be targeted, and undeployed formations are
  reported destroyed at battle end. Physical deployment-zone, board-edge,
  enemy-distance, Deep Strike, and source-rule facts require explicit
  reason-bearing confirmation. Play Mode guides declarations, placement, and
  arrivals; the replay API exposes complete deployment state. Version-1 through
  version-5 logs migrate without rewriting prior events. The official Core
  Rules PDF identity and relevant pages are source-locked, and replay,
  migration, cap, timing, API, UI, native, WebAssembly, and formal release gates
  cover the cycle.

- 2026-08-10: Advanced guided play to battle-state version 5 with replayed
  movement, charge, and formation-activation legality. Every active formation
  now records Remain Stationary, Normal Move, Advance, or Fall Back; every
  charge attempt records targets, roll, success, and any explicit rules
  exception. Shooting and Fight attacks require an open activation, weapon type
  must match the phase, Advanced formations are restricted to Assault weapons,
  formations cannot activate twice, and time cannot advance mid-activation.
  Both Fight steps begin with the non-active player's priority, alternate after
  each completed activation, and record a pass when no eligible formation is
  available. Each charge and attack fails closed until the player separately
  confirms target range, visibility, Engagement Range, and table state;
  not-yet-executable faction exceptions use a distinct reason-bearing override.
  Version-1 through
  version-4 logs migrate with explicit unactioned provenance. The replay API
  exposes movement, charge, and activation state alongside C/WebAssembly-
  verified health and clock data. State, tamper, phase, migration, API, UI,
  native, WebAssembly, and formal release gates cover the cycle.

- 2026-08-10: Advanced guided play to battle-state version 4 with integrity-
  checked mission and game accounting. Mission setup now records its name,
  objective markers, starting Command Points, and configurable Command-phase CP
  gain. Both players receive the configured CP automatically at every Command
  phase. Play Mode records CP spending and gains, categorized primary,
  secondary, correction, and other VP scoring, controlled/contested/uncontrolled
  objectives, and capped or uncapped faction resources. Battle-shock belongs to
  the exact saved formation, feeds attack-rule state, and expires at the start
  of its owner's next Command phase. Every change records before/after values
  and timing; replay rejects negative, over-cap, unknown, mistimed, and tampered
  transitions. Version-1 through version-3 battles migrate without changing
  legacy timing provenance. The replay API returns the complete tracker state
  alongside C/WebAssembly-verified health and clock state. State, migration,
  API, rendered workflow, native, WebAssembly, fuzz, and formal gates cover the
  cycle.

- 2026-08-10: Normalized the remaining mixed twin-lightning-claw branches and
  the Wolf Guard Terminator cyclone pairing in SQLite schema 77. Tactical
  Sergeants, Wolf Scout Pack Leaders, Deathwing Strikemasters, and Crusader
  Sword Brothers now preserve one twin-claw branch that consumes both source
  choice slots alongside individually capped two-distinct-weapon alternatives.
  Shared starting weapons are removed once per branch instead of once per
  selected alternative. Generic pairing requirements now match abilities or
  exact weapon-group sets and can evaluate a source pool or the resulting
  single-model loadout. The Terminator rule therefore accepts exactly cyclone
  plus storm bolter or a cross-option combi-weapon replacement, while rejecting
  other two-ranged combinations and all three-ranged combinations. Army Lists,
  Unit vs Unit, the static catalogue, and the validation API share weighted
  choice-slot limits, per-alternative caps, reconciled cross-option
  replacements, and editable warnings. Parser, database, UI-library, API,
  native, WebAssembly, formal, benchmark, and fuzz regressions cover the cycle.

- 2026-08-10: Advanced guided play to battle-state version 3 with a canonical
  five-round clock. Every game now has two ordered turns per round and explicit
  Command, Movement, Shooting, Charge, and Fight steps; exactly 170 validated
  transitions lead from battle start to completion. Only the active player's
  registered formations can attack, and only in the Shooting resolve-attacks or
  Fight attack steps. Pending bounded choices block attacks and time, while
  named effects expire deterministically at their recorded step, phase, turn,
  round, or battle boundary. Setup-only equipment freezes when the battle starts.
  Existing version-1 and version-2 logs migrate without invented timing and mark
  their preserved events as explicitly legacy-untimed. Native C and WebAssembly
  expose the same eight-field clock ABI; the replay API independently walks every
  version-3 transition through Wasm and returns the clock, pending choices, and
  active effects. Differential tests cover both first players through all 170
  transitions, migration tests cover both older schemas, expiry and tamper tests
  cover every duration, sanitizer fuzzing covers bounded advances, and ACSL/WP
  proves all 477 selected obligations including start state and transition
  failure atomicity.

- 2026-08-10: Advanced Play Mode to battle-state version 2 and made roster
  setup canonical. Selecting both lists now registers every exact formation on
  both sides before the first attack, using player-qualified saved-unit IDs and
  binding each player to the selected list revision. Roster edits fail closed
  instead of silently changing an active battle. A checked version-1 migration
  fixture preserves registration snapshots, attack IDs, damage allocations,
  wounds, and casualties while inserting missing attacker and target
  registrations ahead of combat. Defensive-equipment counts are stored with
  each formation and remain editable until that formation is targeted, then
  freeze to protect replay. JavaScript and API replay accept both JSON schema
  versions while the native/WebAssembly engine retains the explicitly named
  version-1 flat event ABI. Setup, stable identity, side matching, equipment
  correction and locking, migration, replay, API, and C regressions cover the
  change. Pre-target equipment corrections are themselves append-only
  `formation_configured` events, so setup edits remain auditable.

- 2026-08-10: Made canonical formation-health replay portable across native C,
  WebAssembly, and the API. A dedicated bounded C module accepts the same 32
  formation segments and 10,000-event limit as battle-state version 1, validates
  before/after health, damage and casualty totals, the one-wounded-model
  invariant, and last-in-first-out compensating undo, and leaves caller output
  unchanged on rejection. The new `POST /api/v1/battle/replay` endpoint validates
  the complete canonical log, replays a requested formation in Wasm, and fails
  closed if it differs from JavaScript replay. One versioned golden fixture now
  crosses JavaScript, direct Wasm, and the API, with equivalent native C vectors.
  ACSL specifies valid output, empty-log initialization, and failure atomicity;
  WP proves the empty replay property and E-ACSL exercises successful and rejected
  streams. Native, fuzz, rendered API, and cross-runtime regressions cover the ABI.

- 2026-08-10: Introduced Play Mode battle-state version 1 and recovery version 3. Target formations register their exact mixed-model and defensive-equipment
  segments on first resolution; later attacks inherit wounds, casualties,
  destroyed segments, and mandatory wounded-model allocation. The two player
  identities survive a side swap, while changing to a different list pair
  starts a separate battle. Every resolved attack stores exact before/after
  segment health in an append-only rules-snapshot-bound event log. Undo uses a
  validated compensating event, and JSON export/import provides portable,
  fail-closed replay when both referenced lists and the catalogue snapshot are
  available. Replay rejects non-contiguous events, unknown segments, healing,
  multiple wounded models, out-of-order undo, and damage or casualty summaries
  that disagree with their allocations. Pure replay, mixed-profile allocation,
  tamper, recovery migration, rendered workflow, full web, C/WebAssembly
  differential, API, and deployment regressions cover the foundation.

- 2026-08-10: Unified limited self-unit and supporting-unit resources in Play
  Mode. Oversight Drone now spends its once-per-battle use when activated,
  remains active across every affected weapon, disables after exhaustion, and
  exposes an editable remaining-use correction alongside Blacklight Marker
  Drones. Uses are keyed to the exact saved unit, including unique source units
  inside formations. Ambiguous duplicate sources fail closed. Limited abilities
  saved as list defaults start inactive instead of receiving a free use. Play
  recovery version 2 preserves prior supporting-unit counts and conservatively
  spends an already-active legacy self-unit ability during migration. Generic
  resource, formation-source, Vespid equipment, exhaustion, correction,
  persistence, migration, and rendered workflow regressions cover the change.

- 2026-08-08: Bound the remaining named wargear-derived combat rules in SQLite
  schema 76. Survey Augur, Rod of Office, both Panspectral Scanner rules,
  Grav-talons, Oversight Drone, and both Death Totem rules now derive equipment
  counts from exact default terms and structured source choices. Canoness and
  Hernkyn prerequisites fail closed, the Vespid option requires ten models,
  Hekaton and Wulfen replacements subtract their default equipment, and Survey
  Augur is correctly exposed as a Genestealer Cults support effect. Passive
  unit-wide gear activates automatically, activated gear remains an available
  manual condition, and bearer-only Reaver and Wulfen attacks split into
  independently resolved weapon lines. Reaver Grav-talons also replace AP with
  2 instead of merely granting Lethal Hits. Army Lists, Play, Unit vs Unit, the
  loadout API, and the static catalogue share equipment counts, availability,
  prerequisites, and false-positive behavior. Parser, database, API, saved-list,
  browser-library, native, WebAssembly, and formal regressions cover the change.

- 2026-08-08: Normalized equipment-only and distinct-weapon choices in SQLite
  schema 75. Both Keeper of Secrets records, the Lokhust Lord, Wazbom
  Blastajet, and both Wolf Guard Pack Leaders now bind Shining Aegis,
  Nanoscarab Amulet, Blastajet Force Field, and Storm Shield defenses directly
  to their published selections. Implicit one-item weapon choices retain their
  weapon profiles. Three exact “two different weapons” pools enforce one copy
  per item, and source-backed pairing rules reject two non-Pistol ranged
  weapons or two Pistols. Catalogue, saved-list, Play, Unit vs Unit, and API
  consumers share the same choices and warnings while preserving editable
  overrides. Parser, database, false-positive, UI, API, native, WebAssembly,
  and formal regressions cover the change.

- 2026-08-08: Structured the duplicate-capable battlesuit equipment pools and
  their linked footnotes in SQLite schema 74. Crisis Battlesuits and all three
  T’au Commanders now expose both the weapon-replacement path and the separate
  three-item path. Eighteen normalized item limits enforce starred no-duplicate
  rules across both pools, and the Crisis ranged-weapon limit scales at three
  per model. Shield Generator bearer counts and Commander defensive presets now
  derive from either published path with complete source coverage while staying
  editable. Army Lists, Unit vs Unit attacker and target choices, Play defaults,
  and the loadout API share the same warnings and selected-item counts. Parser,
  database, provenance, saved-list, UI, API, native, WebAssembly, and formal
  regressions cover the change.

- 2026-08-08: Normalized legal starting-size ranges in SQLite schema 73. All
  1,711 datasheets with published composition data now have exact inclusive
  ranges: 1,724 rows preserve 13 datasheets with discrete alternatives,
  including the 5-or-10-model Kill Teams, 10-or-20-model Astra Militarum units,
  Gretchin, Jakhals, Wolf Scouts, and both Grenadier composition forms. Army
  Lists now labels editable counts as current models and identifies off-range
  values as possible battlefield casualties rather than legal roster starts.
  Catalogue and loadout APIs expose the ranges and their source text, and the
  shared validator applies the same distinction. Parser, cap, database-plan,
  continuous-range, discrete-gap, UI, and API regressions cover the change.

- 2026-08-08: Linked single-model defensive wargear to situational combat
  presets in SQLite schema 72. Fifty-one normalized alternative links cover 15
  presets; 12 have complete source-equipment coverage, while all three T’au
  Commanders expose their exact structured replacement-path grant and remain
  conservative about the separate duplicate-capable pool. Impulsor shield
  domes, Ogryn brute shields, Lieutenant and Dreadnought shields, and Commander
  shield generators now activate from their source choices. Default
  weavefield crests and scattershields deactivate when replaced, and Karanak’s
  always-equipped Collar of Khorne initializes active. Army Lists derives
  source-linked defaults, Play Mode initializes them while preserving local
  overrides, Unit vs Unit reconciles target choices immediately, and the
  loadout API returns the derived preset IDs. Database plans, exact/partial
  coverage, false-positive exclusions, saved formations, default removal,
  direct target selection, API, and full workflow regressions cover the change.

- 2026-08-08: Linked defensive equipment to structured source choices in SQLite
  schema 71. Ninety-eight normalized alternative links cover 32 defensive
  equipment options, with complete source-choice coverage for 31. Equipment-only
  alternatives are retained, common and alternative-specific weapon
  replacements are distinct, and replacement parsing now handles possessive,
  `can have`, `can replace`, per-five, and all-model source forms. Aquila and
  Decimus shields now exchange heavy thunder hammers for power weapons,
  Lychguard and Wraithblade shield swaps reconcile both weapons, and Assault
  Sergeant twin lightning claws remove the pistol and chainsword without making
  the shield-only alternative do so. Default Storm Shields and Weavefield Crests
  decrease when their paired-weapons or teleport-crest choices are selected.
  Saved defaults rebase untouched equipment counts while preserving explicit
  edits, and exact mismatches use the existing casualty/narrative override
  workflow. Database, parser, catalogue, API, saved-list, Play Mode, legacy-key,
  and source-limit regressions cover the change.

- 2026-08-08: Resolved the final six conservative defensive-equipment bearer
  mappings in SQLite schema 70, making all 44 options exact. Forty normalized
  catalogue-composition terms split both Kill Team Cassius datasheets into all
  eleven named models, Aquila and Decimus Kill Teams into their Sergeant,
  Gravis, and four Deathwatch Veteran loadouts, and Wardens of Ultramar into all
  six named models while retaining the grouped source statline as provenance.
  Psychic Hood now maps only to Jensus Natorian, Astartes Shield only to the
  heavy thunder hammer Veteran, Refractor Field only to Gaius Silva, and Storm
  Shield only to Veteran Sergeant Metaurus. Five- and ten-model Kill Team
  formulas also correct an older mixed-unit error that multiplied Gravis
  weapons by the total unit size; every named loadout now contributes weapons
  from its actual model count. Source-drift guards, database invariants, exact
  composition and saved-formation tests, defensive defaults, API rejection of
  illegal intermediate compositions, and static agent aliases cover the
  change.

- 2026-08-08: Normalized optional specialist compositions and increased exact
  defensive-equipment bearer identity to 38 of 44 options in SQLite schema 69.
  Both Corsair Voidscarred datasheets now distinguish the Felarch, base
  Voidscarred, Shade Runner, Soul Weaver, and Way Seeker, while both Spectrus
  Kill Teams distinguish every published weapon-specialist category. Nineteen
  normalized composition/loadout links make the existing model-composition
  controls drive source weapon totals, exact target segments, saved lists, and
  Play recovery together; derived base-model counts reconcile automatically
  when specialists or unit size change, and impossible combinations fail
  closed. Channeller Stones map only to the Soul Weaver, Mistshield only to the
  Felarch, and Helix Gauntlet only to the marksman-carbine Infiltrators. The
  composition parser also rejects eight source headings that previously
  appeared as bogus `MODELS MAXIMUM` models. Source-drift guards, schema and
  provenance assertions, exact/default/invalid composition tests, API
  validation, agent aliases, saved formations, and rendered catalogue
  regressions cover the change. Six named-model mappings remain conservative.

- 2026-08-08: Expanded exact defensive-equipment bearer identity to 32 of 44
  options in SQLite schema 68. Ten additional uniform source statlines now
  produce 20 composition-derived catalogue profiles for Assault Squads,
  Infiltrators, Corsair Voidreavers, Imperial Navy Breachers, Hearthkyn
  Warriors, Einhyr Hearthguard, Veteran Bike Squad, and Hand of the Archon.
  Thirteen equipment options now distinguish their published Sergeant,
  Felarch, Hesyr, Theyn, Armsman, Infiltrator, Agent, or any-model bearer
  exactly; Deathwatch and Mortifier rules need no split because every grouped
  model is eligible. Legacy grouped model IDs remain valid in shared model
  matchups, static agent URLs, saved equipment, and Play recovery, including
  equipment-segment suffixes. Source drift assertions, schema/view provenance,
  exact composition, defaults, API catalogue, agent alias, and recovery
  regressions cover the change. Twelve specialist or named-group mappings
  remain explicitly conservative.

- 2026-08-08: Made every defensive-equipment count limit exact in SQLite schema 67. Command Squad and Company Veterans on Bikes now expose six stable,
  composition-derived catalogue models linked to their two original uniform
  source statlines. Shield eligibility distinguishes the Company Champion and
  Company Veterans from the Apothecary and Ancient, and excludes the Veteran
  Biker Sergeant, so the respective five-model maxima are exactly three and
  four. The hidden source templates remain queryable for provenance while
  catalogue views expose only playable derived models. Existing saved lists
  using the former grouped model IDs migrate deterministically to eligible
  segments. Database, catalogue, formation, legacy persistence, and list API
  regressions cover the split and both excessive-count boundaries.

- 2026-08-08: Added source-backed defensive-equipment count validation in
  SQLite schema 66. All 44 equipment options now publish legal minimum and
  maximum formulas, including fixed bearer limits, every-model allowances, and
  per-five-model Deathwatch limits; 42 are exact and the two grouped Veteran
  profiles remain explicitly conservative. Army Lists warns when required gear
  is removed, too many bearers are selected, or a stale/ineligible selection is
  imported, and requires a persisted battlefield-casualty or narrative reason
  before saving. Changing the relevant composition or equipment clears the old
  acknowledgement. Play Mode surfaces the same source check while preserving
  fast battle-local edits. Database, bounds, formation, backup, cloud API, and
  malformed-input regressions cover the workflow.

- 2026-08-08: Normalized defensive-equipment selection provenance and bearer
  eligibility in SQLite schema 65. All 44 equipment options now retain their
  exact source text, default/optional/mixed/conditional classification, and a
  source-backed eligible model profile; 16 published default terms are stored
  as fixed, per-model, per-increment, or structured loadout-subject expressions.
  Army Lists derives only provable defaults, keeps conditional defaults reactive
  until a user makes an explicit override, and limits bearer controls throughout
  Model vs Model, Unit vs Unit, Army Lists, and Play Mode. Ambiguous grouped
  profiles remain marked inexact instead of inventing bearer identities.

- 2026-08-08: Persisted defensive-equipment selections with each Army List
  unit. Whole-unit choices and bounded bearer counts now initialize a newly
  selected Play Mode target, while battle-local edits and recovered battles
  retain precedence. Joined formations merge defaults from every saved
  component, stale or unknown choices are filtered, counts clamp to current
  model composition, and the optional field round-trips through device/cloud
  storage and version-1 backups without breaking legacy backups. Persistence,
  clamping, allocation, and local-override regressions cover the workflow.

- 2026-08-08: Split Unit vs Unit bearer-only defensive equipment into exact
  equipped and unequipped target segments. The allocation count is bounded by
  eligible models, mutually exclusive bearer choices remain disjoint, and both
  segments retain independent ordering for damage allocation. Unit-scoped
  equipment applies across the full target formation, and the existing
  16-segment safety limit fails closed. Regression coverage exercises splits,
  count changes, reordering, conflicting bearer choices, and the segment cap.

- 2026-08-08: Extended normalized defensive equipment to Model vs Model and
  Play Mode. Model matchups expose explicit equipment choices and preserve them
  in shared URLs. Play Mode accepts whole-unit equipment independently from
  per-profile bearer counts, splits equipped and unequipped models into exact
  allocation segments, preserves those choices in battle recovery, and applies
  attack-keyword restrictions such as Psychic-only Feel No Pain. Overlapping
  bearer selections and ambiguous source compositions fail closed. Focused
  profile, formation-allocation, keyword, and recovery regressions cover the
  behavior.

- 2026-08-08: Added source-backed joined Bodyguard formations to Unit vs Unit.
  Guardian Defenders, Storm Guardians, and Windriders now offer only their
  published Warlock joiner, with independent editable model counts, structured
  loadouts, weapons, abilities, and source guidance for each component. Target
  formations preserve exact mixed-model composition and expose every component
  profile in the editable allocation order. Formation discovery and exact
  composition regressions cover the new workflow.

- 2026-08-08: Resolved valid saved formations as one Play Mode unit without
  merging their editable Army List records. A shared formation resolver groups
  published Leader attachments and exceptional Warlock joins, exposes every
  component's saved weapons and abilities, derives uniquely provable model
  composition from the source catalogue, and preserves the combined Starting
  Strength for count-based rules. Target selection now chooses the first legal
  allocation profile, carries damage through the remaining mixed profiles in
  roster order, applies defensive abilities to every segment, and keeps Leader
  models protected behind Bodyguard and joined models. Ambiguous source
  compositions fail closed instead of becoming homogeneous. Formation,
  composition, weapon-access, rendered Play UI, full web, Wasm, and ordered
  allocation regressions cover the change.

- 2026-08-08: Made every actionable Leader footer classification executable.
  SQLite schema 64 normalizes the Captain's relic-shield and plasma-pistol
  requirements to exact structured loadout IDs and preserves three exceptional
  Warlock-to-Bodyguard join pairs separately from Leader attachments. Army
  Lists filters equipment-gated Captain targets, retains stale invalid links,
  offers legal Warlock joins, enforces the one-copy and not-already-Attached
  restrictions, increases Starting Strength, propagates valid Attached state,
  persists joins, and requires joined components to embark together. The API
  exposes loadout-aware Leader checks and `/api/v1/bodyguard-join`. Parser,
  database, catalogue, roster, persistence, Transport, UI, and API regressions
  cover every new rule. Combined mixed-profile resolution in Play Mode remains
  the next explicit correctness item.

- 2026-08-08: Enforced source-backed Leader-formation cardinality. SQLite
  schema 63 classifies all 55 Leader footers, normalizes 51 multi-Leader or
  mandatory-attachment exceptions, and captures the Boyz, Kroot Carnivores,
  and Company Heroes Bodyguard rules. The official Rules Commentary's global
  two-Leader ceiling is pinned by URL, version, page, and SHA-256. Army Lists
  filters prospective legal formations, preserves invalid imported links for
  repair, and reports mandatory, starting-strength, required-keyword,
  uniqueness, and global-cap failures. Play Mode only derives Attached state
  from valid formations, and `/api/v1/leader-formation` exposes the same
  decision with source rules. Parser, database, catalogue, roster, UI, and API
  regressions cover legal and illegal exception combinations.

- 2026-08-08: Added source-backed Leader-to-Bodyguard eligibility. SQLite
  schema 62 pins `Datasheets_leader.csv`, deduplicates its 1,918 source rows
  into 1,902 exact pairs covering 411 Leaders and 297 Bodyguard datasheets, and
  proves that all referenced IDs resolve. Army Lists offers only published
  Bodyguards, preserves stale invalid links for repair, and reports missing,
  circular, non-Leader, and illegal cross-datasheet attachments. Play Mode
  derives Attached-unit state from valid saved formations, and the API exposes
  both discovery lists and direct pair checks. Database provenance, catalogue,
  legal/illegal pair, Transport integration, UI build, and API regressions
  cover the change.

- 2026-08-08: Completed exact Transport coverage. SQLite schema 61 normalizes
  the Orion Assault Dropship's independent one-model allowance for its three
  named Contemptor Dreadnoughts and the resulting primary Infantry capacity
  reduction from 12 to 6. All 178 Transport datasheets now have exact normalized
  rules. Army Lists exposes the active conditional capacity and rejects the
  seventh Infantry model or a second named Dreadnought only when appropriate;
  the Transport API exposes the same allowance condition. Parser exactness and
  altered-clause behavior, schema/catalogue snapshots, inactive and active
  boundaries, overflow, model ceiling, saved-formation, and API regressions
  cover the change.

- 2026-08-08: Added exact nested-Transport capacity semantics. SQLite schema 60
  normalizes fixed shared-capacity costs, independent Vehicle allowances,
  allowance-specific exclusions, and nested-passenger policies for five
  Sokar-pattern Stormbirds and the
  Thunderhawk Transporter, increasing exact Transport coverage from 171 to 177
  of 178 datasheets. Army Lists charges a Rhino and its contents 25 Stormbird
  spaces, excludes those contents from Thunderhawk capacity, still validates
  each inner Transport independently, enforces one- or two-Vehicle ceilings,
  and rejects Aircraft and Titanic Vehicles. Parser, schema/catalogue, nested
  boundary, double-counting, exclusion, ceiling, UI, and API regressions cover
  the change.

- 2026-08-08: Added exact shared-capacity Transport allowances with dynamic
  Wounds-based space costs and aggregate model ceilings. SQLite schema 59
  normalizes the five Mastodon datasheets and the Orca Dropship, increasing
  exact Transport coverage from 165 to 171 of 178 datasheets. Army Lists and
  the Transport API now charge Dreadnoughts, Helbrutes, and Battlesuits space
  equal to their Wounds and reject more than the published two or six matching
  models even when total capacity remains. Parser negatives, schema/catalogue
  snapshots, current-profile Wounds homogeneity, legal boundary, capacity,
  model-ceiling, and API regressions cover the change.

- 2026-08-08: Added exact mutually exclusive Transport modes and the Wounds-
  based passenger cost required by them. SQLite schema 58 normalizes five
  alternative pools across the Dreadclaw Drop Pod, Kharybdis Assault Claw, two
  Tyrannocytes, and the Valkyrie Sky Talon; the shared “more than 1 Wound” cost
  also makes the Hierophant exact. Exact Transport coverage increases from 159
  to 165 of 178 datasheets. Army Lists and shared eligibility prevent primary
  and alternative passengers from mixing, enforce each mode's capacity, apply
  the Tyrannocyte's 12-Wound Monster ceiling, and identify modes in the UI and
  API. Exact parser, schema/catalogue snapshots, current-profile Wounds-band
  homogeneity, legal alternative assignments, mixed-mode rejection, capacity
  overflow, Monster ceiling, and API regressions cover the change.

- 2026-08-08: Added exact passenger-keyword exceptions to Transport exclusions.
  SQLite schema 57 normalizes the published Ynnari exceptions for the Falcon,
  Firestorm, Vampire Raider, and Wave Serpent, increasing exact Transport
  coverage from 155 to 159 of 178 datasheets. Yvraine and the Visarch can now
  embark while other Ynnari passengers remain excluded; the separate Jump Pack
  exclusion is never weakened by those exceptions. Parser, database, catalogue,
  allocation, and Transport API
  regressions cover allowed named Characters, a rejected Ynnari unit, and a
  rejected Asuryani Jump Pack unit.

- 2026-08-08: Added exact independent Transport capacity pools. SQLite schema
  56 normalizes nine published “primary models and N additional models” clauses
  across five Storm Eagles, two Stormravens, the Ghost Ark, and the Harridan,
  increasing exact Transport coverage from 146 to 155 of 178 datasheets. Saved
  passengers are assigned to their matching keyword pool, each pool enforces
  its own capacity, and total display usage no longer causes a Dreadnought or
  Character allowance to consume Infantry capacity. Army Lists identifies the
  matched pool, while catalogue data and the Transport API expose every pool and
  its required keywords. Exact parser, schema/catalogue snapshots, primary and
  additional passenger eligibility, full-primary-plus-additional boundaries,
  additional-pool overflow, Ghost Ark multi-keyword allocation, and API fit
  tests cover the change.

- 2026-08-08: Added exact attached-Tacticus Transport exceptions. SQLite schema
  55 normalizes the published Character/non-Tacticus attachment condition for
  nine Rhino, Razorback, and Terrax datasheets, increasing exact Transport
  coverage from 137 to 146 rows and from 60 to all 61 Firing Deck transports.
  Army Lists persists an explicit Character-to-bodyguard link, rejects missing
  and circular links, and requires both parts of an Attached unit to embark in
  the same transport and remain collectively legal. Model vs Model, Unit vs
  Unit, Play Mode, static agent URLs, and both Transport APIs accept the same
  attachment context; no-context and Tacticus-bodyguard cases remain excluded.
  Exact parser, database/catalogue snapshots, legal and illegal bodyguard
  boundaries, Firing Deck resolution, aggregate assignment, persistence, URL,
  API, and rendered workflow tests cover the change.

- 2026-08-08: Added source-backed Transport assignments and legal Firing Deck
  passengers. SQLite schema 54 retains the exact Transport paragraph for 178
  datasheets and normalizes 137 unambiguous rules, including 60 of 61 Firing
  Deck transports, into allowed keyword groups, exclusions, Wounds thresholds,
  fixed per-model space costs, and four equipped-wargear capacity changes. Army
  Lists assigns each passenger instance to a specific compatible transport,
  detects missing, self, circular, and over-capacity formations, and preserves
  assignments through device/cloud storage and backups. Model vs Model, Unit vs
  Unit, static agent URLs, and API Firing Deck resolution now reject passengers
  that the transport cannot legally carry; Play Mode additionally requires the
  saved assignment. Conditional source clauses not yet representable are
  unavailable instead of inferred. Parser negatives, database and catalogue
  snapshots, keyword/exclusion/cost boundaries, aggregate capacity, equipment
  modifiers, circular assignment, persistence, API discovery, and existing
  C/WebAssembly Firing Deck regressions cover the change.

- 2026-08-08: Added explicit Firing Deck weapon selection. SQLite schema 53
  records the published Firing Deck limit for 61 transports and exact two-slot
  passenger exceptions for four Heavy Weapons Squad datasheets. Model vs Model,
  Unit vs Unit, Play Mode recovery, the hosted API, and static agent URLs select
  a passenger datasheet or saved unit, one ranged non-One Shot weapon per model,
  and an editable model count within the aggregate slot limit. Units that have
  already shot are rejected. Passenger weapon profiles and inherent weapon
  abilities are retained while the transport is the attack's bearer, so
  passenger unit abilities do not transfer. Exact source/database/catalogue
  snapshots, capacity and two-slot boundaries, melee and One Shot negatives,
  phase-state and URL override rejection, recovery, API discovery/validation,
  and C/WebAssembly count monotonicity cover the change.

- 2026-08-08: Added exact embarked-model-scaled Attacks. SQLite schema 52
  imports Hunta Rig's On Da Hunt for butcha boyz with the published +6 cap and
  Raider's Visions of Butchery for bladevanes and chainsnares. Model vs Model,
  Unit vs Unit, Play Mode recovery, normalized API profiles, and static agent
  URLs preserve both total embarked models and the embarked Wracks subset;
  impossible subset counts are rejected. Exact source-text negatives, database
  and catalogue snapshots, named-weapon and cap boundaries, URL and recovery
  round trips, API validation, and C/WebAssembly damage monotonicity cover the
  change.

- 2026-08-07: Added normalized defensive equipment for multi-model target
  units. SQLite schema 51 classifies exact bearer- and unit-scoped Save,
  invulnerable-save, Feel No Pain, and first-failed-save Damage replacement
  equipment while preserving source descriptions and matching wargear
  guidance. Unit vs Unit exposes the options on each ordered target segment;
  bearer effects apply only to that segment, unit effects apply across all
  segments, and keyword-limited defenses reject mixed-eligibility volleys.
  Editable stats remain authoritative after selection.

- 2026-08-07: Generalized exact count-scaled Attacks. SQLite schema 50 imports
  Brotherhood Champion and Judiciar bonuses per enemy Character model
  destroyed, Venomcrawler's cumulative Soul Eater bonus per qualifying Fight
  phase, and Marshal's Pious Fervour bonus per nearby enemy unit with its exact
  +3 cap. Model vs Model, Unit vs Unit, Play Mode recovery, normalized API
  profiles, static agent URLs, and catalogue discovery preserve three new
  editable counters; zero remains conservative unknown state. Exact source-text
  negatives, database and JSON snapshots, named-weapon boundaries, capped and
  cumulative composition, URL round trips, persistence, and C/WebAssembly
  damage monotonicity cover the change.

- 2026-08-07: Corrected cross-unit selected-target abilities. SQLite schema 49
  marks 18 generated presets from 15 exact source rules as usable by either the
  source unit or a separate same-side source, while Fire Discipline and Marked
  by Fate remain source-unit-only. Normalized attacker, target, and any-of
  weapon keyword requirements now enforce Aeldari, Adepta Sororitas, Adeptus
  Astartes, Astra Militarum Aircraft, Death Guard, Heretic Astartes, VEHICLE,
  INFANTRY, Blast, Torrent, and Melta clauses across Model vs Model, Unit vs
  Unit, Play Mode, API catalogue data, and static agent calculations. Blight
  Bombardment now keeps its universal Death Guard ranged Hit re-roll of 1 and
  upgrades it to a full Hit re-roll only for Blast attacks; effect-specific
  qualifiers no longer suppress unrelated effects in the same preset. Exact
  text negatives, schema and catalogue snapshots, both source relationships,
  affected-keyword and weapon boundaries, agent resolution, API discovery,
  and exact C/WebAssembly damage monotonicity cover the change.

- 2026-08-07: Added directional selected-target visibility and source range.
  Model vs Model, Unit vs Unit, Play Mode recovery, normalized API profiles,
  and static agent URLs independently preserve attacker-source-to-target and
  target-source-to-attacker distances and line of sight. SQLite schema 48
  conservatively marks 20 existing situational combat presets whose source
  text contains exactly one visible-enemy selection; 16 also enforce their
  published source range, with zero remaining unknown and inactive. Selected
  abilities still require explicit user activation, so visibility alone never
  invents a choice. The separate `indirect` override now says only “Apply
  Indirect Fire penalties” and cannot satisfy selected-target LOS. Parser
  exclusions, database/catalogue snapshots, directional URL and recovery
  round trips, rendered workflow checks, API validation, and C/WebAssembly
  modifier and boundary regressions cover the change.

- 2026-08-07: Added exact closest-eligible-target state. Model vs Model, Unit
  vs Unit, Play Mode recovery, shared matchup profiles, normalized API inputs,
  and static agent URLs now preserve an editable `targetClosestEligible` fact;
  `closestTarget=true` is its compact agent alias. SQLite schema 47 marks 11
  exact single-clause abilities automatic only for that relationship and
  splits Windriders' Swift Demise into its unconditional Hit re-roll of 1 and
  its closest-target full re-roll. Forgefiend additionally enforces the
  published 18-inch boundary, while Flash Gitz remains scoped to its snazzgun.
  Altered wording and the Indomitor, Nekrosor, and Bondsman compound cases stay
  conservative. Exact-text negatives, database/catalogue snapshots, legacy
  recovery, URL round trips, rendered workflows, native and WebAssembly damage
  monotonicity, 330/330 proofs, zero Eva alarms, E-ACSL, and a direct
  2,000-input sanitizer campaign cover the change.

- 2026-08-07: Added independent target-side support. Model vs Model, Unit vs
  Unit, Play Mode, recovery, shared matchup links, normalized profiles, and
  static agent URLs now preserve a separate defending support unit, selected
  abilities, affected-unit keywords, and source distance without reusing the
  attacker-side relationship. SQLite schema 46 classifies Illuminor Szeras's
  exact Mechanical Augmentation aura as support for a Necrons Battleline unit
  within 3 inches and exports both clauses: +1 AP when that supported unit
  attacks and -1 incoming AP when it is targeted. Illuminor is not Battleline,
  so the rule cannot protect its source; unknown range, out-of-range targets,
  missing keywords, unrelated factions, and self-relationship selection remain
  inactive. Exact-text parser negatives, database/catalogue snapshots, legacy
  recovery, agent resolution, independent composition boundaries, native and
  WebAssembly damage monotonicity, 330/330 proofs, zero Eva alarms, E-ACSL, and
  the 2,000-input sanitizer campaign cover the change.

- 2026-08-07: Added exact targeted Vehicle support. SQLite schema 45
  classifies eight Techmarine, Warpsmith, and Mek source rows that select a
  friendly Vehicle within 3 inches for either +1 Hit or re-roll Hit rolls of 1.
  The selected attacker must have every published faction and Vehicle keyword,
  and zero distance remains conservatively unknown. Meka-dread and both Trojan
  Support Vehicle rows can satisfy their own target keywords, so they remain
  editable self abilities rather than disappearing or being forced into a
  separate-unit relationship. The existing support selector, shares, Play
  recovery, APIs, and static agent URLs consume the new data without changing
  user-entered profiles. Exact-source parser negatives, self-versus-support
  database and catalogue snapshots, agent resolution, eligibility boundaries,
  C/WebAssembly damage monotonicity, native and Wasm builds, 330/330 proofs,
  zero Eva alarms, E-ACSL, and a 2,000-input sanitizer campaign cover the change.

- 2026-08-07: Added exact range and affected-keyword eligibility for simple
  non-self friendly-unit auras. SQLite schema 44 classifies Brood Progenitor,
  Drone Commander, Taskmaster, Unholy Mechanisms, and three Wisdom of the
  Ancients source rows as supporting-unit effects, while retaining
  self-applicable and compound auras conservatively. Model vs Model, Unit vs
  Unit, Play Mode, shared profiles, normalized APIs, and static agent URLs now
  preserve an editable source-to-supported-unit distance; zero is unknown and
  therefore inactive. The affected attacker must also contain every published
  keyword. Agent results expose both requirements, and Play Mode preserves the
  support effect while changing targets. Exact-text parser negatives,
  database/catalogue snapshots, URL and recovery round trips, boundary tests,
  native and WebAssembly builds, 330/330 formal proofs, zero Eva alarms, E-ACSL,
  and the bounded sanitizer fuzz campaign cover the change.

- 2026-08-07: Added exact per-battle support-use tracking. SQLite schema 43
  records the published two-use limit only on Blacklight Marker Drones and
  exports it to every catalogue consumer; altered source wording is rejected
  rather than inferred. Play Mode spends one token when that ability is turned
  on for an Observer activation, never for each weapon roll, and keeps the
  ability active across all supported weapon profiles. Counters are isolated by
  saved support-unit instance, editable for tabletop corrections, disabled at
  zero, cleared by a full battle reset, and recovered after reload alongside
  legacy recovery data. Static agent results expose `usesPerBattle` but remain
  explicitly stateless. Parser negatives, schema/catalogue snapshots, bounded
  state validation, exhaustion, correction, per-instance isolation, recovery,
  rendered Play guidance, and full C/WebAssembly release gates cover the change.

- 2026-08-07: Added explicit cross-unit support sources. SQLite schema 42 gives
  every combat preset a source relationship and classifies Forward Observers,
  Blacklight Marker Drones, and High-intensity Markerlights as effects supplied
  by a separate Observer unit, never as that unit's own attack bonus. All three
  require the affected attacker to be Guided against the current Spotted target
  and are ranged-only; High-intensity Markerlights no longer leaks into melee.
  Model vs Model and Unit vs Unit select a same-faction supporting profile,
  while Play Mode selects a different supporting unit instance from the saved
  army list and recovers that choice after reload. Static agent URLs accept
  `support` plus `supportPreset`, reject cross-faction and self-preset misuse,
  and expose the resolved source. Exact parser negatives, generated database
  snapshots, legacy recovery, agent resolution, self-versus-support boundaries,
  and C/WebAssembly re-roll monotonicity cover the change.

- 2026-08-07: Added exact T’au Guided, Spotted, and Markerlight relationships.
  SQLite schema 41 separates Ballistic Skill characteristic improvement from
  Hit-roll modifiers and turns 42 For the Greater Good source rows into two
  independently gated automatic effects. Coordinated Strike requires the
  attacker to be Guided against its Spotted target; Precise Targeting and
  Target Uploaded require the current target to be Spotted; Markerlight Ignores
  Cover additionally requires that the Spotted target was marked by a
  Markerlight Observer. Observer-source buffs remain conservative manual rules
  until cross-unit support is represented. Editable state round-trips through
  Model vs Model, Unit vs Unit, Play recovery, normalized APIs, share links, and
  static agent URLs. Exact parser negatives, generated database snapshots,
  URL/recovery/API validation, workflow rendering, and C/WebAssembly hit and
  cover boundary tests cover the change.

- 2026-08-07: Added exact directional selected-objective relationships. SQLite
  schema 40 marks Archon’s Will, Priority Objective Identified, and Seeker of
  the Unfound automatic only when the source or target is within range of the
  objective selected by the correct side; Archon’s Will independently requires
  its source unit not to be Battle-shocked. Four editable matchup facts preserve
  both sides without conflating a selected marker with any objective marker.
  Model vs Model, Unit vs Unit, Play recovery, normalized APIs, share links, and
  static agent URLs carry the state. Exact parser negatives, generated database
  snapshots, directional offensive and defensive composition, URL/recovery
  round trips, and C/WebAssembly damage monotonicity cover the boundary.

- 2026-08-07: Added exact objective ownership. SQLite schema 39 distinguishes
  objectives controlled by the attacker, target, neither player, or an unknown
  owner and keeps unknown ownership conservatively inactive. Fifteen former
  manual rows are now source-backed automatic rules: nine Armoured Spearhead,
  two Bringers of Change, two Stand Vigil, and two Battlefield Control rows.
  Baseline re-rolls remain automatic and only the stronger control-dependent
  tier activates for the exact relationship. Editable ownership round-trips
  through Model vs Model, Unit vs Unit, Play recovery, normalized APIs, and
  static agent URLs. Parser negatives retain closest-target and selected-marker
  compounds as manual choices; database/catalogue snapshots, URL/recovery and
  API validation, rendered workflows, and C/WebAssembly damage monotonicity
  cover the new boundary.

- 2026-08-07: Added exact direct objective-marker position. SQLite schema 38
  marks 22 source/target objective-dependent effects automatic and splits 17
  baseline re-roll abilities from their stronger objective upgrade, so the
  baseline remains active away from an objective. Editable attacker and target
  state now round-trips through Model vs Model, Unit vs Unit, Play recovery,
  normalized API profiles, and static agent URLs. The same projection audit
  makes ten Black Rage Hit re-rolls unconditional and Voice of Experience
  Attached-unit-dependent because their Objective Control text does not gate
  the combat effect. Exact parser negatives exclude controlled/selected markers,
  closest-target, token, aura, and alternative conditions. Generated database
  and catalogue snapshots, URL/recovery round trips, workflow rendering, and
  C/WebAssembly damage monotonicity cover the change.

- 2026-08-07: Corrected and automated Oath of Moment across 275 Adeptus Astartes
  datasheets. SQLite schema 37 splits the rule into a Hit re-roll gated by an
  editable selected-target state and a separate +1 Wound effect that also
  requires explicit Codex-detachment/non-divergent-chapter eligibility. This
  removes the former manual preset that incorrectly bundled both benefits.
  Model vs Model, Unit vs Unit, Play recovery, normalized API profiles, and
  static agent URLs preserve both states. Exact parser negatives, generated
  database and catalogue snapshots, URL and recovery round trips, three-state
  preset composition, and C/WebAssembly damage monotonicity cover the change.

- 2026-08-07: Added exact Waaagh-benefit state. SQLite schema 36 splits the
  universal Orks Waaagh! rule into melee-only +1 Strength/Attacks and an
  unrestricted 5+ invulnerable save across 87 source datasheets, preventing
  either effect from inheriting the other's weapon scope. Six direct dependent
  abilities are automatic for Gorkanaut, Morkanaut, Meganobz, Warboss, Nob with
  Waaagh! Banner, and Warboss in Mega Armour; Ghazghkull's compound aura and
  leader clauses remain conservative manual choices. Model vs Model, Unit vs
  Unit, Play recovery, normalized API profiles, and static agent URLs preserve
  separate editable attacker and target state. Exact parser negatives,
  generated-data snapshots, URL/recovery round trips, weapon-scope checks, and
  native C/WebAssembly damage monotonicity cover the behavior.

- 2026-08-07: Added exact model-count-scaled Attacks. SQLite schema 35 imports
  Gabriel Seth's Whirlwind of Gore and Wurrboy's Unstable Oracle with the
  affected named weapon, five-model increment, and either nearby-enemy or
  source-unit count. Model vs Model, Unit vs Unit, Play Mode recovery,
  normalized API profiles, and static agent URLs preserve both editable counts;
  zero is a conservative unknown state. Wurrboy also requires the explicit
  Attached-unit state. Parser negatives, generated-data snapshots, URL and
  recovery round trips, weapon-scope checks, every rounding boundary, and
  native C/WebAssembly damage monotonicity cover the behavior.

- 2026-08-07: Added exact Attached-unit eligibility. SQLite schema 34 marks
  155 simple leader rules automatic while retaining 35 compound leader rules as
  manual choices when they also depend on casualties, distance, Waaagh!, a
  named surviving model, an objective, a mode choice, or another independent
  condition. Model vs Model, Unit vs Unit, Play Mode recovery, shared profiles,
  normalized API input, and static agent URLs preserve separately editable
  attacker and target Attached-unit state. Data snapshots, URL round trips,
  recovery, and attacking/defensive C/Wasm regressions cover inactive and
  active boundaries.

- 2026-08-07: Corrected Lance activation in every catalogue-backed workflow.
  A weapon's native Lance keyword and Lance granted by a selected source rule
  now provide +1 Wound only when the editable attacker charge state is active.
  Direct profiles retain `lanceActive` as an explicit override. Catalogue,
  granted-rule, inactive-state, and C/Wasm expected-damage regressions cover
  the boundary.

- 2026-08-07: Added exact attacker stationary eligibility and corrected Heavy
  activation in catalogue workflows. SQLite schema 33 marks eight unambiguous
  Remains Stationary rules automatic across Bastion of Firepower, Mark the
  Target, Punishing Salvoes, Signum, and Targeter Optics. Order-dependent and
  leader-dependent clauses remain manual. Model vs Model, Unit vs Unit, Play
  Mode recovery, normalized API input, and static agent URLs preserve an
  editable stationary state. Catalogue Heavy weapons now receive +1 Hit from
  that state, while granting the Heavy ability no longer incorrectly activates
  its bonus without remaining stationary. Parser exclusions, generated-data
  snapshots, URL round trips, recovery, and C/Wasm composition regressions
  cover active and inactive boundaries.

- 2026-08-07: Added exact direct target unit-strength eligibility. SQLite
  schema 32 marks 15 unambiguous rules automatic: six activate only against a
  Below Half-strength target, while nine activate while the target is not Below
  Half-strength. Model vs Model, Unit vs Unit, Play Mode recovery, shared
  profiles, normalized API input, and static agent URLs preserve an editable
  three-state target value: full strength, below Starting Strength, or Below
  Half-strength. Leader, aura, named-weapon-only, phase-preamble, and
  multi-threshold clauses remain manual. Parser exclusions, exact generated-data
  snapshots, URL round trips, recovery, and C/Wasm composition regressions cover
  all three state boundaries.

- 2026-08-07: Added exact direct Battle-shock eligibility. SQLite schema 31
  marks Furies' Prey on the Weak, Hierophant's Apex-beast, and Incubi's
  Tormentors as automatic only against a Battle-shocked target, while
  Ministorum Priest's Holy Piety is automatic only while its attacking unit is
  not Battle-shocked. Model vs Model, Unit vs Unit, Play Mode recovery, shared
  profiles, normalized API input, and static agent URLs preserve separately
  editable attacker and target state. Aura, leader, objective, observer, and
  mixed-clause Battle-shock abilities remain manual. Parser exclusions, exact
  generated-data snapshots, URL round trips, recovery, and C/Wasm composition
  regressions cover both active and inactive boundaries.

- 2026-08-07: Added exact attacker-charge eligibility. SQLite schema 30 marks
  17 unambiguous charge-triggered presets as automatic and exports their
  machine-readable requirement; mixed clauses such as charged-or-was-charged,
  closest-target alternatives, and combined choice modes remain manual. Model
  vs Model, Unit vs Unit, Play Mode, shared profiles, normalized API input, and
  static agent URLs preserve an editable charge state. An inactive state can
  no longer apply the selected rule, while `charged=true` automatically applies
  the source rule to compatible weapons. Brutal Raider now also imports its
  plural-worded Armour Penetration improvement alongside Strength. Parser exclusions, generated-data
  snapshots, URL round trips, and C/Wasm composition regressions cover the
  boundary.

- 2026-08-07: Added composition-gated bearer defenses. SQLite schema 29 uses
  the structured maximum unit composition to import 21 optional defensive
  presets with 23 exact effects only for datasheets proven to contain one
  model. This includes Shield Generator, Shield Dome, Storm Shield,
  Scattershield, Nanoscarab Amulet, Shining Aegis, and related wargear; the two
  Wraithknight Scattershield records compose both their 4+ invulnerable save
  and Damage reduction. Multi-model bearer abilities such as Lychguard
  Dispersion Shields remain excluded. Parser opt-in, exact generated-data,
  target composition, and native/Wasm damage regressions cover the boundary.

- 2026-08-07: Added conservative direct target-distance eligibility. SQLite
  schema 28 imports a maximum target distance only when one modeled effect has
  an unambiguous attacker-to-target condition, currently covering both
  Drive-by Dakka datasheets and Way of the Short Blade. Distance 0 means
  unknown and never activates a distance-gated preset. The static agent URL,
  Model vs Model, Unit vs Unit, Play Mode recovery, normalized profile,
  catalogue export, and preset composer all preserve the editable distance,
  with parser, exact data-snapshot, composition-boundary, and recovery
  regressions.

- 2026-08-07: Added conservative phase eligibility for source-backed combat
  presets. Effects with explicit Shooting- or Fight-phase timing that expire at
  the end of that phase now resolve only against ranged or melee attacks,
  respectively; rules available in both phases and rules lasting until the end
  of the turn remain unrestricted. SQLite schema 27 reclassifies 113 existing
  presets across 45 named abilities, including Distraction Grot, Payback Time,
  Dance of Death, Fire Support, and Moment Shackle's defensive mode. Parser,
  generated-data, catalogue, and Wasm composition regressions cover eligible,
  ineligible, dual-phase, and cross-phase-duration cases.

- 2026-08-07: Added source-backed phase-, target-, and battlefield-state-dependent
  fixed Attacks replacements as explicit situational presets, building on the
  existing replace-before-add native C and WebAssembly representation. SQLite
  schema 26 imports ten additional exact weapon-scoped replacements for
  Arco-flagellants, Fire Prism, Flash Gitz, Iron Priest on Thunderwolf, Sergeant
  Harker, four Enginseer/Techmarine variants, and Trajann Valoris. Payback Time
  also replaces Sustained Hits 1 with Sustained Hits 3, and Moment Shackle now
  exports its Attacks 12 and 2+ invulnerable-save modes as one exclusive choice.
  Conditions remain opt-in with their complete source text; non-CHARACTER and
  other subset-model wording remains excluded. Parser, full generated-data,
  catalogue, preset-scoping, native/Wasm, formal, fuzz, and benchmark
  regressions cover the change.

- 2026-08-07: Added exact optional allocation-time Damage replacement with an
  explicit deterministic use policy across native C, WebAssembly, complexity
  estimates, exact and simulated APIs, editable Model vs Model, Unit vs Unit,
  and Play profiles, combat presets, and static agent URLs. Users choose the
  remaining uses and how many allocated attacks to skip; the engine then spends
  one use at allocation time even if the selected attack misses, and carries
  the replacement through Sustained Hits, Devastating Wounds, weapons, and
  ordered target allocation. SQLite schema 25 conservatively imports 12
  source-backed rows for Ablative Plating, Chaos Familiar, Inviolable Transport,
  Resilient Organism, Stealth Drones, and Surgeon Acolyte while excluding
  failed-save and phase-long timing. Native, Wasm, parser, generated-data,
  preset, URL, API, seeded-simulation, formal, fuzz, and benchmark regressions
  cover the behavior.

- 2026-08-07: Added exact mandatory first-failed-save Damage replacement across
  native C, WebAssembly, ordered volleys, complexity estimates, exact and
  simulated APIs, editable target profiles, combat presets, and static agent
  URLs. Channeller Stones and Stimm-needler now expose source-backed situational
  effects that change the triggering attack's Damage characteristic to 0. The
  state is consumed only by an actual failed saving throw, survives
  Devastating Wounds that bypass a save, and persists across weapons and target
  allocation. SQLite schema 24, hand-derived native/Wasm distributions,
  catalogue/parser/API/simulation regressions, formal proofs, and sanitizer
  fuzzing cover the behavior. A sanitizer-discovered pathological volley also
  replaced repeated prefix evaluation with a single-pass cumulative evaluator,
  reduced the replacement-only path from quadratic to linear in weapon count,
  and hashes only reachable deferred packet slots.

- 2026-08-06: Added exact random Attacks, Strength, and Damage characteristic
  modifiers with one source roll shared across every affected characteristic
  and weapon profile. Native C, WebAssembly, exact ordered volleys, complexity
  estimates, CSPRNG rolls, seeded simulations, APIs, editable profiles, and
  static agent URLs now preserve the correlation instead of multiplying
  independently averaged values. SQLite schema 23 conservatively imports
  Exalted Champion's Aspire to Glory and Tzaangor Shaman's Psychic-only
  Sacrificial Blessing from the pinned catalogue. Hand-derived single-profile,
  capped-volley, cross-weapon group, malformed-group, Wasm ABI, API simulation,
  parser, generated-data, formal, and sanitizer regressions cover the change.

- 2026-08-06: Added fixed Attacks, Strength, and Damage characteristic
  multiplication across native C, WebAssembly, exact and seeded APIs, CSPRNG
  rolls, editable Model vs Model and Play profiles, combat presets, and static
  agent URLs. The engines now share the official replacement, division,
  multiplication, addition/subtraction, round-up, and minimum sequence. Rapid
  Fire and Blast remain additions after Attacks multiplication, including when
  they use different dice sizes, and the per-weapon minimum is applied only
  after all additions and penalties. SQLite schema 22 can conservatively import
  generic whole-model/unit doubling effects while rejecting Daemonhost-style
  subset-model wording until composition-aware scoping exists. Hand-derived
  native, ordered-volley, Wasm, API, preset, parser, and URL regressions cover
  both arithmetic order and cross-surface field transport.

- 2026-08-06: Repaired the hosted API's calculator-engine dependency by
  importing the C/WebAssembly binary as a precompiled Worker module instead of
  fetching raw static bytes and attempting runtime compilation, which the
  production Workers runtime rejects. The browser and static agent surfaces
  retain their existing public Wasm asset, while API calculations, volleys,
  complexity estimates, and health checks share the deployment-bundled module.
  Node API tests now load the same compiled-module shape, assert that the
  production bundle cannot regress to an asset fetch, and prove that a static
  asset outage no longer takes the server calculator offline.

- 2026-08-06: Added exact incoming-Damage division for unconditional rules such
  as Avatar of Khaine's Molten Form. Four source-backed datasheet abilities now
  load as editable target divisors across Model vs Model, Unit vs Unit, Play
  Mode, API requests, seeded and cryptographically random rolls, and static
  agent URLs. Native C and WebAssembly now apply the official sequence of
  replacement, division, addition/subtraction, round-up, and minimum, fixing
  cases where a Damage bonus was previously applied before halving. SQLite
  schema 21, catalogue snapshots, hand-derived native/Wasm fractions, API
  exact/simulation checks, generated property/fuzz inputs, and formal runtime
  checks cover the behavior. Release-mode C test targets now explicitly retain
  assertions, so the GitHub Actions native job executes these checks instead of
  compiling them out through `NDEBUG`.

- 2026-08-06: Added source-backed attacking-weapon keyword eligibility and
  imported 15 exact Psychic-only Feel No Pain effects. Culexus Assassin's
  Abomination now applies its 2+ Feel No Pain automatically only against
  Psychic weapons; fourteen leader-dependent 4+ rules remain explicit choices
  and are inert against non-Psychic attacks. Model vs Model, Play Mode, agent
  URLs, and API catalogue data share the same eligibility metadata. Unit vs
  Unit refuses mixed Psychic/non-Psychic volleys when their target defenses
  differ instead of applying one defense to every ranged weapon. Parser,
  catalogue, composition, mixed-volley, API, and native/Wasm FNP regressions
  cover the behavior. Data verification helpers now close SQLite connections
  deterministically so temporary database checks are reliable on Windows.

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
  Bearer-only, subset-model, friendly-aura, affected-model, attack-type-limited
  effects not yet representable in that cycle, and conflicting values remained
  omitted instead of being applied to the wrong
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
