import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveObjectiveControlFacts,
  objectiveControlFactValues,
  objectiveControlFactValuesAreValid,
} from "../lib/objective-control-facts.mjs";

function formation(id, playerId, objectiveControl, modelIds) {
  const segmentId = `${id}:segment`;
  return {
    id,
    playerId,
    segments: [{ id: segmentId, modelIds, objectiveControl }],
    health: { [segmentId]: { modelsRemaining: modelIds.length, woundsLost: 0 } },
  };
}

function spatial(formationId, modelIds, executable = true) {
  return {
    formationId,
    executable,
    objectives: [{ objectiveId: "centre", status: "in_range", modelIds }],
  };
}

function derive(
  first,
  second,
  battleShockedFormationIds = new Set(),
  battleShockedObjectiveControlByFormation = new Map(),
  objectiveControlModifiersByFormation = new Map(),
) {
  return deriveObjectiveControlFacts({
    players: [{ id: "one" }, { id: "two" }],
    objectives: [{ objectiveId: "centre" }],
    formations: new Map([
      [first.id, first],
      [second.id, second],
    ]),
    eligibleFormationIds: new Set([first.id, second.id]),
    spatialFactsByFormation: new Map([
      [
        first.id,
        spatial(
          first.id,
          first.segments[0].modelIds.slice(0, first.health[first.segments[0].id].modelsRemaining),
        ),
      ],
      [
        second.id,
        spatial(
          second.id,
          second.segments[0].modelIds.slice(
            0,
            second.health[second.segments[0].id].modelsRemaining,
          ),
        ),
      ],
    ]),
    battleShockedFormationIds,
    battleShockedObjectiveControlByFormation,
    objectiveControlModifiersByFormation,
  }).get("centre");
}

test("surviving in-range models sum source-locked Objective Control", () => {
  const first = formation("alpha", "one", 2, ["a1", "a2", "a3"]);
  const second = formation("beta", "two", 1, ["b1", "b2"]);
  first.health["alpha:segment"].modelsRemaining = 2;
  const fact = derive(first, second);
  assert.equal(fact.status, "controlled");
  assert.equal(fact.controllerPlayerId, "one");
  assert.deepEqual(fact.scores, [
    { playerId: "one", score: 4 },
    { playerId: "two", score: 2 },
  ]);
  assert.equal(objectiveControlFactValuesAreValid(...objectiveControlFactValues(fact)), true);
});

test("equal positive scores contest an objective", () => {
  const fact = derive(formation("alpha", "one", 2, ["a1"]), formation("beta", "two", 2, ["b1"]));
  assert.equal(fact.status, "contested");
  assert.equal(fact.controllerPlayerId, "");
  assert.equal(fact.contested, true);
});

test("equal zero scores leave an objective contested", () => {
  const fact = derive(formation("alpha", "one", 0, ["a1"]), formation("beta", "two", 0, ["b1"]));
  assert.equal(fact.status, "contested");
  assert.equal(fact.controllerPlayerId, "");
  assert.equal(fact.contested, true);
  assert.deepEqual(fact.scores, [
    { playerId: "one", score: 0 },
    { playerId: "two", score: 0 },
  ]);
});

test("Battle-shocked formations contribute zero Objective Control", () => {
  const fact = derive(
    formation("alpha", "one", 5, ["a1"]),
    formation("beta", "two", 1, ["b1"]),
    new Set(["alpha"]),
  );
  assert.equal(fact.controllerPlayerId, "two");
  assert.equal(fact.contributions[0].score, 0);
  assert.equal(fact.contributions[0].battleShocked, true);
});

test("source-locked replacement applies before an additive Objective Control modifier", () => {
  const fact = derive(
    formation("alpha", "one", 5, ["a1", "a2"]),
    formation("beta", "two", 3, ["b1"]),
    new Set(["alpha"]),
    new Map([["alpha", 1]]),
    new Map([["alpha", 1]]),
  );
  assert.equal(fact.controllerPlayerId, "one");
  assert.equal(fact.contributions[0].score, 4);
});

test("missing legacy OC or spatial facts fail closed", () => {
  const first = formation("alpha", "one", null, ["a1"]);
  const second = formation("beta", "two", 1, ["b1"]);
  const fact = derive(first, second);
  assert.equal(fact.executable, false);
  assert.equal(fact.status, "unknown");
  assert.deepEqual(fact.unavailableReasons, ["objective_control_unavailable:alpha"]);
});

test("classification validator rejects inconsistent controller claims", () => {
  assert.equal(objectiveControlFactValuesAreValid(2, 2, 3, 1, 1, 0, 7), true);
  assert.equal(objectiveControlFactValuesAreValid(2, 2, 3, 2, 0, 1, 7), true);
  assert.equal(objectiveControlFactValuesAreValid(2, 2, 0, 2, 0, 1, 7), true);
  assert.equal(objectiveControlFactValuesAreValid(2, 2, 0, 0, 0, 0, 7), false);
  assert.equal(objectiveControlFactValuesAreValid(2, 2, 3, 2, 1, 0, 7), false);
});
