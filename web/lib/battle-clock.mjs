export const MAX_BATTLE_ROUNDS = 5;

export const BATTLE_PHASE_STEPS = Object.freeze({
  command: Object.freeze(["start", "battle_shock", "end"]),
  movement: Object.freeze(["start", "move_units", "reinforcements", "end"]),
  shooting: Object.freeze(["start", "resolve_attacks", "end"]),
  charge: Object.freeze(["start", "charge_moves", "end"]),
  fight: Object.freeze(["start", "fights_first", "remaining_combats", "end"]),
});

export const BATTLE_PHASES = Object.freeze(Object.keys(BATTLE_PHASE_STEPS));
export const BATTLE_EFFECT_DURATIONS = Object.freeze([
  "end_of_step",
  "end_of_phase",
  "end_of_turn",
  "end_of_round",
  "end_of_battle",
]);

export function setupBattleClock() {
  return {
    status: "setup",
    battleRound: 0,
    turn: 0,
    phase: "setup",
    step: "setup",
    firstPlayerId: "",
    activePlayerId: "",
    priorityPlayerId: "",
  };
}

export function startBattleClock(players, firstPlayerId) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw new Error("Battle clock requires exactly two players");
  }
  if (!players.some((player) => player.id === firstPlayerId)) {
    throw new Error("First player is not part of this battle");
  }
  return {
    status: "active",
    battleRound: 1,
    turn: 1,
    phase: BATTLE_PHASES[0],
    step: BATTLE_PHASE_STEPS[BATTLE_PHASES[0]][0],
    firstPlayerId,
    activePlayerId: firstPlayerId,
    priorityPlayerId: firstPlayerId,
  };
}

function otherPlayerId(players, playerId) {
  const other = players.find((player) => player.id !== playerId);
  if (!other) throw new Error("Battle clock cannot determine the other player");
  return other.id;
}

export function nextBattleClock(clock, players) {
  if (clock.status !== "active") throw new Error("Only an active battle clock can advance");
  const steps = BATTLE_PHASE_STEPS[clock.phase];
  const stepIndex = steps?.indexOf(clock.step) ?? -1;
  if (stepIndex < 0) throw new Error("Battle clock phase and step are inconsistent");
  if (stepIndex + 1 < steps.length) {
    return { ...clock, step: steps[stepIndex + 1] };
  }
  const phaseIndex = BATTLE_PHASES.indexOf(clock.phase);
  if (phaseIndex + 1 < BATTLE_PHASES.length) {
    const phase = BATTLE_PHASES[phaseIndex + 1];
    return { ...clock, phase, step: BATTLE_PHASE_STEPS[phase][0] };
  }
  if (clock.turn === 1) {
    const activePlayerId = otherPlayerId(players, clock.firstPlayerId);
    return {
      ...clock,
      turn: 2,
      phase: BATTLE_PHASES[0],
      step: BATTLE_PHASE_STEPS[BATTLE_PHASES[0]][0],
      activePlayerId,
      priorityPlayerId: activePlayerId,
    };
  }
  if (clock.battleRound < MAX_BATTLE_ROUNDS) {
    return {
      ...clock,
      battleRound: clock.battleRound + 1,
      turn: 1,
      phase: BATTLE_PHASES[0],
      step: BATTLE_PHASE_STEPS[BATTLE_PHASES[0]][0],
      activePlayerId: clock.firstPlayerId,
      priorityPlayerId: clock.firstPlayerId,
    };
  }
  return {
    ...clock,
    status: "complete",
    phase: "complete",
    step: "complete",
    activePlayerId: "",
    priorityPlayerId: "",
  };
}

export function sameBattleClock(left, right) {
  return [
    "status",
    "battleRound",
    "turn",
    "phase",
    "step",
    "firstPlayerId",
    "activePlayerId",
    "priorityPlayerId",
  ].every((key) => left?.[key] === right?.[key]);
}

export function battleAttackWindow(clock) {
  return (
    clock?.status === "active" &&
    ((clock.phase === "shooting" && clock.step === "resolve_attacks") ||
      (clock.phase === "fight" &&
        (clock.step === "fights_first" || clock.step === "remaining_combats")))
  );
}

export function effectExpiresOnAdvance(effect, from, to) {
  const applied = effect.appliedAt;
  if (effect.duration === "end_of_battle") return to.status === "complete";
  if (effect.duration === "end_of_round") {
    return to.status === "complete" || to.battleRound !== applied.battleRound;
  }
  if (effect.duration === "end_of_turn") {
    return (
      to.status === "complete" || to.battleRound !== applied.battleRound || to.turn !== applied.turn
    );
  }
  if (effect.duration === "end_of_phase") {
    return (
      to.status === "complete" ||
      to.battleRound !== applied.battleRound ||
      to.turn !== applied.turn ||
      to.phase !== applied.phase
    );
  }
  return !sameBattleClock(from, to);
}

export function battleClockLabel(clock, players = []) {
  if (clock?.status === "setup") return "Battle setup";
  if (clock?.status === "complete") return "Battle complete";
  const player = players.find((candidate) => candidate.id === clock?.activePlayerId);
  const phase = clock?.phase ? `${clock.phase[0].toUpperCase()}${clock.phase.slice(1)}` : "";
  const step = (clock?.step ?? "").replaceAll("_", " ");
  return `Round ${clock.battleRound} · ${player?.name ?? "Active player"} · ${phase} · ${step}`;
}
