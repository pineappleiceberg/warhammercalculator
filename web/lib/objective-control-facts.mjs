export const OBJECTIVE_CONTROL_FACT_FLAGS_MASK = 7;

function unavailableObjective(objectiveId, reasons) {
  return {
    objectiveId,
    executable: false,
    status: "unknown",
    controllerPlayerId: "",
    contested: false,
    scores: [],
    contributions: [],
    unavailableReasons: [...new Set(reasons)].sort(),
  };
}

function liveObjectiveControlByModel(formation) {
  const values = new Map();
  for (const segment of formation.segments ?? []) {
    const health = formation.health?.[segment.id];
    if (!health || !Array.isArray(segment.modelIds)) return null;
    if (!Number.isSafeInteger(segment.objectiveControl) || segment.objectiveControl < 0)
      return null;
    for (const modelId of segment.modelIds.slice(0, health.modelsRemaining)) {
      values.set(modelId, segment.objectiveControl);
    }
  }
  return values;
}

export function deriveObjectiveControlFacts({
  players,
  objectives,
  formations,
  eligibleFormationIds,
  spatialFactsByFormation,
  battleShockedFormationIds,
}) {
  const playerIds = players.map((player) => player.id);
  const facts = new Map();
  for (const objective of objectives ?? []) {
    const contributions = [];
    const reasons = [];
    for (const formationId of eligibleFormationIds) {
      const formation = formations.get(formationId);
      const spatial = spatialFactsByFormation.get(formationId);
      if (!formation || !spatial?.executable) {
        reasons.push(`spatial_facts_unavailable:${formationId}`);
        continue;
      }
      const proximity = spatial.objectives.find(
        (candidate) => candidate.objectiveId === objective.objectiveId,
      );
      if (!proximity) {
        reasons.push(`objective_proximity_missing:${formationId}`);
        continue;
      }
      if (proximity.status !== "in_range") continue;
      const objectiveControlByModel = liveObjectiveControlByModel(formation);
      if (!objectiveControlByModel) {
        reasons.push(`objective_control_unavailable:${formationId}`);
        continue;
      }
      const battleShocked = battleShockedFormationIds.has(formationId);
      const modelValues = proximity.modelIds.map((modelId) => ({
        modelId,
        value: battleShocked ? 0 : objectiveControlByModel.get(modelId),
      }));
      if (modelValues.some((model) => !Number.isSafeInteger(model.value))) {
        reasons.push(`objective_control_model_mismatch:${formationId}`);
        continue;
      }
      contributions.push({
        formationId,
        playerId: formation.playerId,
        battleShocked,
        score: modelValues.reduce((total, model) => total + model.value, 0),
        models: modelValues,
      });
    }
    if (reasons.length > 0) {
      facts.set(objective.objectiveId, unavailableObjective(objective.objectiveId, reasons));
      continue;
    }
    const scores = playerIds.map((playerId) => ({
      playerId,
      score: contributions
        .filter((contribution) => contribution.playerId === playerId)
        .reduce((total, contribution) => total + contribution.score, 0),
    }));
    const topScore = Math.max(0, ...scores.map((score) => score.score));
    const leaders = scores.filter((score) => score.score === topScore);
    const contested = leaders.length > 1;
    const controllerPlayerId = leaders.length === 1 ? leaders[0].playerId : "";
    facts.set(objective.objectiveId, {
      objectiveId: objective.objectiveId,
      executable: true,
      status: controllerPlayerId ? "controlled" : "contested",
      controllerPlayerId,
      contested,
      scores,
      contributions,
      unavailableReasons: [],
    });
  }
  return facts;
}

export function objectiveControlFactValues(fact) {
  const topScore = Math.max(0, ...fact.scores.map((score) => score.score));
  const topScorePlayerCount = fact.scores.filter((score) => score.score === topScore).length;
  return [
    fact.scores.length,
    fact.scores.length,
    topScore,
    topScorePlayerCount,
    fact.controllerPlayerId ? 1 : 0,
    fact.contested ? 1 : 0,
    fact.executable ? OBJECTIVE_CONTROL_FACT_FLAGS_MASK : 0,
  ];
}

export function objectiveControlFactValuesAreValid(
  playerCount,
  scoreEntryCount,
  topScore,
  topScorePlayerCount,
  controllerCount,
  contested,
  flags,
) {
  return Boolean(
    playerCount === 2 &&
      scoreEntryCount === playerCount &&
      Number.isSafeInteger(topScore) &&
      topScore >= 0 &&
      topScore <= 1_000_000 &&
      Number.isSafeInteger(topScorePlayerCount) &&
      topScorePlayerCount >= 0 &&
      topScorePlayerCount <= playerCount &&
      (controllerCount === 0 || controllerCount === 1) &&
      (contested === 0 || contested === 1) &&
      flags === OBJECTIVE_CONTROL_FACT_FLAGS_MASK &&
      (topScorePlayerCount === 1
        ? controllerCount === 1 && contested === 0
        : topScorePlayerCount >= 2 && controllerCount === 0 && contested === 1),
  );
}
