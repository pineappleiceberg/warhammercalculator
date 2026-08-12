# Complete battle engine goal

Warhammer Calculator is complete as a battle simulator only when it can guide
or automate a full supported Warhammer 40,000 10th-edition game between two
legal saved lists, from deployment through the final score, without silently
ignoring a mandatory rule. Attack resolution alone does not satisfy this goal.

## Completion requirements

### Authoritative rules coverage

- Pin the supported Core Rules, Rules Commentary, Balance Dataslate, Munitorum
  Field Manual, mission pack, faction, detachment, enhancement, datasheet, and
  Stratagem sources by title, version, URL, retrieval date, and content hash.
- Represent army rules, detachment rules, enhancements, datasheet abilities,
  weapon rules, Stratagems, missions, terrain rules, and timing restrictions as
  structured executable rules or explicit unsupported-rule failures.
- Maintain a coverage matrix proving which published rules are executable,
  guided/manual, irrelevant to the selected game, or unsupported. Unknown text
  must fail closed instead of being treated as having no effect.

### Canonical battle state

- Track battle round, turn, phase, step, active player, priority, Command
  Points, Victory Points, missions, objectives, reserves, transports, Attached
  units, and every once-per-battle, round, turn, phase, or target resource.
- Track each unit's models, mixed profiles, wounds, casualties, destroyed state,
  Battle-shock, eligibility, actions already taken, effects with expiry, and
  relevant model-level wargear and status.
- Preserve legal Bodyguard, Leader, joined-unit, Transport, and split-unit
  composition throughout casualties, disembarkation, and unit separation.
- Store every transition in an append-only, versioned event log that can be
  validated, replayed, undone in guided play, exported, imported, and recovered
  after interruption.

### Complete action and timing engine

- Validate and resolve deployment, reserves, Command phase choices,
  Battle-shock, movement, Advance, Fall Back, transports, Reinforcements,
  shooting, target selection, charges, Heroic Intervention, Fight sequencing,
  pile-in, attacks, damage allocation, consolidation, objective control, and
  scoring.
- Offer every legal reaction and Stratagem at its correct timing window, enforce
  costs and usage limits, and expire effects at the exact published boundary.
- Never advance the game while a mandatory choice, roll, allocation, or reaction
  remains unresolved.

### Table geometry

- Represent model bases or hulls, unit coherency, Engagement Range, objective
  markers, deployment zones, battlefield boundaries, terrain footprints and
  heights, visibility, cover, and movement paths in a common coordinate model.
- Support player-entered measurements and visibility decisions first, while
  retaining a path for camera or UWB-assisted measurements. Sensor input must
  remain reviewable and overrideable rather than becoming unquestioned truth.

### Guided and automated play

- Guided play must present only legal actions, explain blocked actions, request
  necessary physical-table facts, resolve dice, update battle state, and keep a
  complete score and audit trail.
- Automated play must generate legal actions for both armies and use pluggable,
  testable policies for tactical decisions. Deterministic seeded runs must be
  reproducible; player-facing real rolls must continue to use a CSPRNG.
- Batch simulation must report win rate, score distribution, uncertainty,
  scenario assumptions, policy identity, rules snapshot, and reproducible run
  metadata rather than presenting one policy's result as objective army power.

### Reliability and release proof

- The C core, native build, WebAssembly, API, static agent interface, web UI,
  persistence, and database must share versioned state and rule semantics.
- Unit, property, differential, scenario, replay, migration, fuzz, performance,
  formal-method, accessibility, deployment, and rules-regression tests must
  cover every supported transition and published rule added to the engine.
- Golden full-game scenarios must replay identically across native C,
  WebAssembly, API, and browser surfaces where those surfaces own the same
  behavior.
- A release is not complete until two arbitrary legal lists from every supported
  faction can finish each supported mission through both guided and automated
  play, or the engine identifies a precise unsupported rule before play begins.

## Delivery order

1. **Complete:** finish unified tracking for limited self-unit and supporting-unit abilities.
2. **Complete:** introduce the canonical versioned battle state and append-only event log,
   then make attack results persist wounds, casualties, and destroyed units.
3. **Complete:** add the round, turn, phase, step, pending-choice, and effect-expiry state
   machine.
4. **Complete:** add CP, VP, objectives, Battle-shock, missions, scoring, and
   limited-resource accounting.
5. **In progress:** deployment declarations, alternating placement, Strategic
   Reserves limits, Reserve arrival timing, target and weapon-type selection,
   replayed movement outcomes, charge attempts, once-per-phase Shooting/Fight
   activations, Assault-after-Advance restrictions, alternating Fight priority,
   source-compatible Transport selection, embark/disembark/destruction timing,
   live-model and compound-pool capacity, legal nested Transport deployment and
   Reserve ancestry, destroyed-passenger
   allocation and Deadly Demise ordering, exact optional weapon-bearer identity
   through casualties, canonical charge rolls and reviewed charge movement,
   canonical Pile In and Consolidation sequencing, explicit fail-closed
   eligibility confirmations, plus the immediate Heroic Intervention window,
   audited CP cost, legal charge target/movement, Walker restriction, and
   suppressed Charge Bonus are complete. Fire Overwatch now has executable
   setup, movement-start, movement-end, and charge-declaration windows; audited
   CP and once-per-turn use; non-Titanic, range, visibility, surviving-weapon,
   target-lock, and unmodified-6 enforcement; out-of-phase review; and explicit
   decline paths. Normal Shooting now declares all weapon copies, profiles, and
   split-fire targets activation-wide before dice, gives Go to Ground the
   complete eligible target set, and enforces target- and profile-contiguous
   resolution. Hazardous weapons now lock their exact bearer and profile
   identity, roll one replayed test per used copy, enforce wounded/non-Character/
   Character priority across every surviving Hazardous bearer in the unit,
   apply three non-spilling mortal wounds with Feel No Pain, and defer Fire
   Overwatch allocation until the triggering charger
   ends its Charge move. When deferred Hazardous damage and Heroic Intervention
   become due together, the active player chooses their resolution order and
   both remain mandatory until resolved. Empty Dedicated Transports now become
   not deployed and are destroyed in round one, non-Hover Aircraft must begin
   in Reserves, and source-locked Hover Aircraft can instead deploy normally or
   enter Strategic Reserves. Counter-offensive now opens after an enemy Fight
   activation, spends 2CP atomically, and forces an eligible reviewed formation
   to fight next. Smokescreen now pauses activation-wide target declarations,
   lets the active player order simultaneous defensive Stratagems, spends 1CP
   atomically, and applies phase-long Benefit of Cover and Stealth to an
   eligible Smoke target. Rapid Ingress now opens at the end of the opposing
   Movement phase, spends 1CP atomically, enforces Reserves, round, placement,
   Battle-shock, and repeat-use restrictions, deploys complete nested Transport
   trees as Reinforcements, keeps passengers embarked, and records the
   round-one source-rule and large-model Strategic Reserves exceptions.
   Remaining work includes other reaction and Stratagem windows, full
   geometry-backed target eligibility, and
   geometry-backed engagement.
6. **In progress:** the source-locked Core Rules and universal-Stratagem matrix,
   four-state coverage model, fail-closed C/WebAssembly predicate, static
   catalogue, API checker, deployment health check, and version-24 canonical
   selection gate are complete. Setup records exact faction, detachment,
   enhancement, datasheet, terrain, and mission identities and blocks every
   absent, stale, unsupported, or unacknowledged rule before a new battle starts.
   The pinned structured snapshot now supplies exact guided mappings for all 26
   faction, 262 detachment, 927 enhancement, and 1,712 datasheet identities.
   Chapter Approved 2025-26 Tournament Companion v1.4 additionally supplies the
   exact 20 A-T mission combinations, eight terrain layouts, and their allowed
   pairings. Next replace guided mission scoring and physical terrain boundaries
   with executable handlers as their state becomes representable.
7. **In progress:** version 35 records the canonical 60-by-44-inch battlefield,
   exact mission/layout binding, objective centres, official terrain-section
   inventory, twelve rotated and non-overlapping area-terrain outlines,
   single/separate section grouping, stable coordinate origin, review method,
   and player confirmation before an exact Chapter Approved deployment. Each
   battlefield deployment now also locks every stable model identity to a base
   or baseless hull footprint, centre, elevation, and rotation before deployment
   can alternate or the battle can start. Normal movement, Reserve arrivals,
   Charge, Heroic Intervention, Pile In, Consolidation, normal disembarkation,
   destroyed-Transport and Emergency Disembarkation, starting-embarked
   declarations, later embarkation, and casualty staleness now preserve those
   identities in replayable snapshots or explicit Transport location
   transitions. Multiple forced passenger formations queue
   independently before play can continue. Reviewed terrain panels, openings,
   primitive or optional convex-prism model silhouettes, coherency, objective
   range, Engagement Range, directional visibility, and per-model Benefit of
   Cover are now executable and replayed. Published per-model Objective Control,
   surviving model identity, marker range, Battle-shock OC 0, player totals,
   contested ties including 0-0, end-of-phase or end-of-turn timing, and reviewed
   overrides now derive canonical objective state.
   Ranged target declarations bind exact weapon bearers or Transport observers
   to those facts, require an explicit review when a proof is unknown, and carry
   model-specific cover into ordered damage allocation. Next derive terrain
   movement clearance and physical overlap, then execute mission scoring while
   retaining explicit reviewed fallbacks.
8. Deliver the complete guided battle workflow and full-game replay corpus.
9. Add deterministic automated policies, batch battle simulation, and calibrated
   matchup reporting.
10. Prove the cross-surface release gate and maintain it for every rules update.
