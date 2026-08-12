import assert from "node:assert/strict";
import test from "node:test";

import {
  cappedMissionAward,
  missionActionEligibility,
  missionTrackerFactsAreValid,
  missionTrackerFlags,
} from "../lib/mission-tracker.mjs";

test("applies the published Chapter Approved Victory Point caps without rounding up", () => {
  assert.equal(
    cappedMissionAward({
      category: "primary",
      requestedPoints: 5,
      totals: { primary: 48, secondary: 30, battle_ready: 10, total: 88 },
    }),
    2,
  );
  assert.equal(
    cappedMissionAward({
      category: "secondary",
      requestedPoints: 4,
      totals: { primary: 30, secondary: 39, battle_ready: 10, total: 79 },
      fixedCardPoints: 18,
    }),
    1,
  );
  assert.equal(
    cappedMissionAward({
      category: "secondary",
      requestedPoints: 5,
      totals: { primary: 45, secondary: 35, battle_ready: 10, total: 90 },
      fixedCardPoints: 18,
    }),
    2,
  );
});

test("enforces universal Action eligibility and preserves Titanic Character exception", () => {
  const eligible = {
    aircraft: false,
    battleShocked: false,
    objectiveControl: 2,
    withinEngagementRange: false,
    titanicCharacter: false,
    advancedOrFellBack: false,
    eligibleToShoot: true,
    alreadyShot: false,
    timingReviewed: true,
    cardRulesReviewed: true,
    unitLimitAvailable: true,
  };
  assert.equal(missionActionEligibility(eligible).valid, true);
  assert.equal(missionActionEligibility({ ...eligible, withinEngagementRange: true }).valid, false);
  assert.equal(
    missionActionEligibility({
      ...eligible,
      withinEngagementRange: true,
      titanicCharacter: true,
    }).valid,
    true,
  );
  for (const override of [
    { aircraft: true },
    { battleShocked: true },
    { objectiveControl: 0 },
    { advancedOrFellBack: true },
    { eligibleToShoot: false },
    { alreadyShot: true },
    { timingReviewed: false },
    { cardRulesReviewed: false },
    { unitLimitAvailable: false },
  ]) {
    assert.equal(missionActionEligibility({ ...eligible, ...override }).valid, false);
  }
});

test("validates complete Fixed and Tactical tracker summaries", () => {
  const plan = {
    reviewedByPlayer: true,
    cardRulesAvailability: "player-supplied-physical-deck",
  };
  const flags = missionTrackerFlags(plan, true);
  assert.equal(
    missionTrackerFactsAreValid(1, 1, 2, 0, 0, 0, 2, 30, 20, 10, 10, 60, 1, 1, flags),
    true,
  );
  assert.equal(
    missionTrackerFactsAreValid(2, 1, 0, 12, 5, 3, 2, 50, 40, 0, 10, 100, 0, 0, flags),
    true,
  );
  assert.equal(
    missionTrackerFactsAreValid(2, 1, 0, 12, 5, 3, 2, 50, 41, 0, 10, 101, 0, 0, flags),
    false,
  );
});
