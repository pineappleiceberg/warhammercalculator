import { CHAPTER_APPROVED_MISSION_PROCEDURES } from "./mission-pack.mjs";

export const SECONDARY_MODES = Object.freeze(["fixed", "tactical"]);

export const MISSION_ACTION_FLAGS = Object.freeze({
  aircraft: 1,
  battleShocked: 2,
  positiveObjectiveControl: 4,
  withinEngagementRange: 8,
  titanicCharacter: 16,
  advancedOrFellBack: 32,
  eligibleToShoot: 64,
  alreadyShot: 128,
  timingReviewed: 256,
  cardRulesReviewed: 512,
  unitLimitAvailable: 1024,
  mask: 2047,
});

export const MISSION_TRACKER_FLAGS = Object.freeze({
  planReviewed: 1,
  sourceLocked: 2,
  cardRulesPlayerSupplied: 4,
  mask: 7,
});

export function missionActionFlags(facts) {
  return (
    (facts?.aircraft ? MISSION_ACTION_FLAGS.aircraft : 0) |
    (facts?.battleShocked ? MISSION_ACTION_FLAGS.battleShocked : 0) |
    (facts?.objectiveControl > 0 ? MISSION_ACTION_FLAGS.positiveObjectiveControl : 0) |
    (facts?.withinEngagementRange ? MISSION_ACTION_FLAGS.withinEngagementRange : 0) |
    (facts?.titanicCharacter ? MISSION_ACTION_FLAGS.titanicCharacter : 0) |
    (facts?.advancedOrFellBack ? MISSION_ACTION_FLAGS.advancedOrFellBack : 0) |
    (facts?.eligibleToShoot ? MISSION_ACTION_FLAGS.eligibleToShoot : 0) |
    (facts?.alreadyShot ? MISSION_ACTION_FLAGS.alreadyShot : 0) |
    (facts?.timingReviewed ? MISSION_ACTION_FLAGS.timingReviewed : 0) |
    (facts?.cardRulesReviewed ? MISSION_ACTION_FLAGS.cardRulesReviewed : 0) |
    (facts?.unitLimitAvailable ? MISSION_ACTION_FLAGS.unitLimitAvailable : 0)
  );
}

export function missionActionIsValid(facts) {
  const flags = missionActionFlags(facts);
  const required =
    MISSION_ACTION_FLAGS.positiveObjectiveControl |
    MISSION_ACTION_FLAGS.eligibleToShoot |
    MISSION_ACTION_FLAGS.timingReviewed |
    MISSION_ACTION_FLAGS.cardRulesReviewed |
    MISSION_ACTION_FLAGS.unitLimitAvailable;
  return Boolean(
    (flags & ~MISSION_ACTION_FLAGS.mask) === 0 &&
      (flags & required) === required &&
      !(flags & MISSION_ACTION_FLAGS.aircraft) &&
      !(flags & MISSION_ACTION_FLAGS.battleShocked) &&
      !(flags & MISSION_ACTION_FLAGS.advancedOrFellBack) &&
      !(flags & MISSION_ACTION_FLAGS.alreadyShot) &&
      (!(flags & MISSION_ACTION_FLAGS.withinEngagementRange) ||
        Boolean(flags & MISSION_ACTION_FLAGS.titanicCharacter)),
  );
}

export function missionActionEligibility(facts) {
  const reasons = [];
  if (facts?.aircraft) reasons.push("Aircraft units cannot start Actions");
  if (facts?.battleShocked) reasons.push("Battle-shocked units cannot start Actions");
  if (!(facts?.objectiveControl > 0)) reasons.push("Objective Control must be greater than 0");
  if (facts?.withinEngagementRange && !facts?.titanicCharacter) {
    reasons.push("Engagement Range blocks this non-Titanic Character unit");
  }
  if (facts?.advancedOrFellBack) reasons.push("The unit Advanced or Fell Back this turn");
  if (!facts?.eligibleToShoot) reasons.push("The unit is not eligible to shoot this phase");
  if (facts?.alreadyShot) reasons.push("The unit has already been selected to shoot this phase");
  if (!facts?.timingReviewed) reasons.push("The physical card timing has not been reviewed");
  if (!facts?.cardRulesReviewed)
    reasons.push("The physical card conditions have not been reviewed");
  if (!facts?.unitLimitAvailable) reasons.push("The Action's simultaneous-unit limit is full");
  return {
    valid: missionActionIsValid(facts),
    flags: missionActionFlags(facts),
    reasons,
  };
}

export function missionTrackerFlags(plan, sourceLocked = true) {
  return (
    (plan?.reviewedByPlayer ? MISSION_TRACKER_FLAGS.planReviewed : 0) |
    (sourceLocked ? MISSION_TRACKER_FLAGS.sourceLocked : 0) |
    (plan?.cardRulesAvailability === "player-supplied-physical-deck"
      ? MISSION_TRACKER_FLAGS.cardRulesPlayerSupplied
      : 0)
  );
}

export function missionTrackerFactsAreValid(
  mode,
  configured,
  fixedCardCount,
  deckSize,
  drawnCount,
  discardedCount,
  activeCount,
  primaryPoints,
  secondaryPoints,
  fixedCardHighScore,
  battleReadyPoints,
  totalPoints,
  activeActionCount,
  validActionCount,
  flags,
) {
  const caps = CHAPTER_APPROVED_MISSION_PROCEDURES.victoryPointCaps;
  if (
    ![0, 1, 2].includes(mode) ||
    ![0, 1].includes(configured) ||
    fixedCardCount < 0 ||
    fixedCardCount > 2 ||
    deckSize < 0 ||
    deckSize > 64 ||
    drawnCount < 0 ||
    drawnCount > deckSize ||
    discardedCount < 0 ||
    discardedCount > drawnCount ||
    activeCount < 0 ||
    activeCount > 2 ||
    primaryPoints < 0 ||
    primaryPoints > caps.primary ||
    secondaryPoints < 0 ||
    secondaryPoints > caps.secondary ||
    fixedCardHighScore < 0 ||
    fixedCardHighScore > caps.fixedPerCard ||
    battleReadyPoints < 0 ||
    battleReadyPoints > caps.battleReady ||
    totalPoints < 0 ||
    totalPoints > caps.total ||
    primaryPoints + secondaryPoints + battleReadyPoints !== totalPoints ||
    activeActionCount < 0 ||
    activeActionCount > 1000 ||
    validActionCount !== activeActionCount ||
    (flags & ~MISSION_TRACKER_FLAGS.mask) !== 0
  ) {
    return false;
  }
  if (!configured) {
    return (
      mode === 0 &&
      fixedCardCount === 0 &&
      deckSize === 0 &&
      drawnCount === 0 &&
      discardedCount === 0 &&
      activeCount === 0 &&
      flags === 0
    );
  }
  if (flags !== MISSION_TRACKER_FLAGS.mask) return false;
  if (mode === 1) {
    return fixedCardCount === 2 && deckSize === 0 && drawnCount === 0;
  }
  return mode === 2 && fixedCardCount === 0 && deckSize > 0 && fixedCardHighScore === 0;
}

export function cappedMissionAward({ category, requestedPoints, totals, fixedCardPoints = 0 }) {
  if (!Number.isSafeInteger(requestedPoints) || requestedPoints < 1 || requestedPoints > 1000) {
    throw new Error("Mission score must request 1 to 1000 Victory Points");
  }
  const caps = CHAPTER_APPROVED_MISSION_PROCEDURES.victoryPointCaps;
  const categoryCap =
    category === "primary"
      ? caps.primary
      : category === "secondary"
        ? caps.secondary
        : category === "battle_ready"
          ? caps.battleReady
          : null;
  if (categoryCap === null) throw new Error("Source-locked mission score category is unsupported");
  const categoryRemaining = Math.max(0, categoryCap - (totals?.[category] ?? 0));
  const totalRemaining = Math.max(0, caps.total - (totals?.total ?? 0));
  const fixedRemaining =
    category === "secondary" && fixedCardPoints >= 0
      ? Math.max(0, caps.fixedPerCard - fixedCardPoints)
      : Number.MAX_SAFE_INTEGER;
  return Math.min(requestedPoints, categoryRemaining, totalRemaining, fixedRemaining);
}
