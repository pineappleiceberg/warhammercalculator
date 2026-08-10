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
4. Add CP, VP, objectives, Battle-shock, missions, scoring, and limited-resource
   accounting.
5. Add the remaining legal actions and timing windows, beginning with target
   selection and attack sequencing, then movement, charges, and Fight movement.
6. Normalize complete faction, detachment, enhancement, Stratagem, and mission
   coverage with source-locked executable rules and a fail-closed coverage gate.
7. Add table geometry and player-supplied measurement and visibility facts.
8. Deliver the complete guided battle workflow and full-game replay corpus.
9. Add deterministic automated policies, batch battle simulation, and calibrated
   matchup reporting.
10. Prove the cross-surface release gate and maintain it for every rules update.
