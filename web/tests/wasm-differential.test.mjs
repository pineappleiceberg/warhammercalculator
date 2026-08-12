import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  attackRollSucceeds,
  modifiedRollTarget,
  savingThrowTarget,
  woundTarget,
} from "../lib/thresholds.mjs";
import {
  allocateDamageToSequence,
  allocateDamageToUnit,
  targetSequencePosition,
} from "../lib/allocation.mjs";
import { abilityDiceValue } from "../lib/dice.mjs";
import { parseAgentProfile } from "../lib/agent-parameters.mjs";
import {
  battleFormationHealth,
  chargeResolutionIsValid,
  counterOffensiveIsValid,
  fightMoveIsValid,
  fireOverwatchIsValid,
  goToGroundIsValid,
  rapidIngressIsValid,
  smokescreenIsValid,
  TABLE_GEOMETRY_CONSTANTS,
  tableGeometryFlags,
  tableGeometryIsValid,
  terrainFootprintFlags,
  terrainFootprintSetFacts,
  terrainFootprintSetIsValid,
  hazardousResolutionIsValid,
  heroicInterventionIsValid,
  initialDeploymentIsValid,
  modelPlacementFlags,
  modelPlacementSetFacts,
  modelPlacementSetIsValid,
  modelPositionFlags,
  modelPositionSetFacts,
  modelPositionSetIsValid,
  normalizeBattleState,
  rangedDeclarationIsValid,
  rangedGeometryResolutionIsValid,
  rangedTargetEligibilityIsValid,
  replayBattleState,
  weaponBearerDeclarationIsValid,
  weaponInventoryDeclarationIsValid,
  transportDeploymentChainIsValid,
  transportLoadIsValid,
} from "../lib/battle-state.mjs";
import { BATTLE_PHASE_STEPS, nextBattleClock, startBattleClock } from "../lib/battle-clock.mjs";
import {
  applyCombatPresets,
  applyTargetCombatPresets,
  attackKeywordsForWeapon,
  combatPresetEffects,
  combatPresetMeetsEligibility,
  combatPresetRequiresActivation,
  combatPresetSubjectSummary,
  combatPresetSupportsRole,
  combatPresetSupportsWeapon,
  selectedAndAutomaticCombatPresets,
  updateCombatPresetSelection,
} from "../lib/combat-presets.mjs";
import { rulesInteractionCases } from "./rules-interaction-corpus.mjs";
import {
  applyChoiceSelectionChange,
  applyLoadoutSubjectCountChange,
  applyModelCountChange,
  armyListWeaponsFromGroups,
  choicePoolMaximum,
  choiceSelectionItemCounts,
  choiceSelectionLimitWarnings,
  choiceSelectionWeaponCounts,
  defaultWeaponCounts,
  defaultLoadoutSubjectCounts,
  equippedWeaponLines,
  groupWeaponProfiles,
  loadoutSubjectWeaponCounts,
  normalizeEquippedCount,
  sourceEquippedWeaponCounts,
  startingSizeRangeLabel,
  unitLoadoutWarnings,
  unitStartingSizeStatus,
  unitStartingSizeWarning,
  weaponAllocationErrors,
  weaponLimitMaximum,
} from "../lib/loadout.mjs";
import { resolveFiringDeckSelections } from "../lib/firing-deck.mjs";
import { ruleCoverageIsPermitted } from "../lib/rule-coverage.mjs";
import {
  endpointClearanceFactValuesAreValid,
  spatialFactValuesAreValid,
} from "../lib/spatial-facts.mjs";
import { terrainClearanceFactValuesAreValid } from "../lib/terrain-clearance-facts.mjs";
import { missionTrackerFactsAreValid } from "../lib/mission-tracker.mjs";
import { objectiveControlFactValuesAreValid } from "../lib/objective-control-facts.mjs";
import {
  convexSilhouetteIsValid,
  simpleTerrainSurfaceIsValid,
  visibilityFactValuesAreValid,
} from "../lib/visibility-facts.mjs";

globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = dirname(fileURLToPath(import.meta.url));
const { default: createCalculator } = await import("../public/wasm/calculator.js");
const wasmDirectory = new URL("../public/wasm/", import.meta.url);
const wasmBinary = await readFile(new URL("calculator.wasm", wasmDirectory));
const calculator = await createCalculator({
  locateFile: (file) => fileURLToPath(new URL(file, wasmDirectory)),
  wasmBinary,
});

function calculateSummary(...values) {
  const output = values.pop();
  return calculator._whc_calculate_summary(...values, 1, 1, 1, output);
}

test("WebAssembly exports the formally verified validators", () => {
  assert.equal(typeof calculator._dice_value_is_valid, "function");
  assert.equal(typeof calculator._probability_distribution_is_normalized, "function");
  assert.equal(typeof calculator._attack_plan_is_valid, "function");
  assert.equal(typeof calculator._whc_estimate_ordered_volley_complexity, "function");
  assert.equal(typeof calculator._whc_replay_battle_health_events, "function");
  assert.equal(typeof calculator._whc_ranged_target_eligibility_is_valid, "function");
  assert.equal(typeof calculator._whc_ranged_geometry_resolution_is_valid, "function");
  assert.equal(typeof calculator._whc_weapon_inventory_declaration_is_valid, "function");
  assert.equal(typeof calculator._whc_weapon_bearer_declaration_is_valid, "function");
  assert.equal(typeof calculator._whc_charge_resolution_is_valid, "function");
  assert.equal(typeof calculator._whc_fight_move_is_valid, "function");
  assert.equal(typeof calculator._whc_heroic_intervention_is_valid, "function");
  assert.equal(typeof calculator._whc_fire_overwatch_is_valid, "function");
  assert.equal(typeof calculator._whc_hazardous_resolution_is_valid, "function");
  assert.equal(typeof calculator._whc_go_to_ground_is_valid, "function");
  assert.equal(typeof calculator._whc_smokescreen_is_valid, "function");
  assert.equal(typeof calculator._whc_rapid_ingress_is_valid, "function");
  assert.equal(typeof calculator._whc_rule_coverage_is_permitted, "function");
  assert.equal(typeof calculator._whc_counter_offensive_is_valid, "function");
  assert.equal(typeof calculator._whc_ranged_declaration_is_valid, "function");
  assert.equal(typeof calculator._whc_transport_load_is_valid, "function");
  assert.equal(typeof calculator._whc_transport_deployment_chain_is_valid, "function");
  assert.equal(typeof calculator._whc_initial_deployment_is_valid, "function");
  assert.equal(typeof calculator._whc_table_geometry_is_valid, "function");
  assert.equal(typeof calculator._whc_terrain_footprint_set_is_valid, "function");
  assert.equal(typeof calculator._whc_model_placement_set_is_valid, "function");
  assert.equal(typeof calculator._whc_model_position_set_is_valid, "function");
  assert.equal(typeof calculator._whc_spatial_facts_are_valid, "function");
  assert.equal(typeof calculator._whc_endpoint_clearance_facts_are_valid, "function");
  assert.equal(typeof calculator._whc_terrain_clearance_facts_are_valid, "function");
  assert.equal(typeof calculator._whc_mission_tracker_facts_are_valid, "function");
  assert.equal(typeof calculator._whc_waaagh_state_is_valid, "function");
  assert.equal(typeof calculator._whc_grim_resolve_model_objective_control_is_valid, "function");
  assert.equal(typeof calculator._whc_oath_of_moment_attack_state_is_valid, "function");
  assert.equal(typeof calculator._whc_reanimation_protocols_transition_is_valid, "function");
  assert.equal(typeof calculator._whc_objective_control_facts_are_valid, "function");
  assert.equal(typeof calculator._whc_visibility_facts_are_valid, "function");
  assert.equal(typeof calculator._whc_convex_silhouette_is_valid, "function");
  assert.equal(typeof calculator._whc_simple_terrain_surface_is_valid, "function");
  assert.equal(typeof calculator._whc_start_battle_clock, "function");
  assert.equal(typeof calculator._whc_next_battle_clock, "function");
});

test("Waaagh! state predicate matches source-locked active and inactive facts", () => {
  assert.equal(calculator._whc_waaagh_state_is_valid(0, 0, 0, 0, 0, 0, 0, 0, 0), 1);
  assert.equal(calculator._whc_waaagh_state_is_valid(1, 1, 1, 1, 1, 1, 1, 1, 5), 1);
  assert.equal(calculator._whc_waaagh_state_is_valid(1, 1, 1, 1, 0, 0, 0, 0, 0), 1);
  assert.equal(calculator._whc_waaagh_state_is_valid(1, 0, 1, 1, 1, 1, 1, 1, 5), 0);
  assert.equal(calculator._whc_waaagh_state_is_valid(2, 1, 1, 1, 1, 1, 1, 1, 5), 0);
});

test("Grim Resolve predicate matches replacement-then-addition Objective Control", () => {
  const validate = calculator._whc_grim_resolve_model_objective_control_is_valid;
  assert.equal(validate(0, 0, 0, 0, 2, 2), 1);
  assert.equal(validate(1, 1, 1, 0, 2, 3), 1);
  assert.equal(validate(1, 1, 0, 1, 2, 1), 1);
  assert.equal(validate(1, 1, 1, 1, 2, 2), 1);
  assert.equal(validate(0, 1, 1, 0, 2, 3), 0);
  assert.equal(validate(1, 1, 1, 1, 2, 1), 0);
});

test("Oath of Moment predicate matches source, target, ability, and Hit re-roll state", () => {
  const validate = calculator._whc_oath_of_moment_attack_state_is_valid;
  assert.equal(validate(0, 0, 0, 0, 0, 0), 1);
  assert.equal(validate(1, 1, 1, 1, 1, 1), 1);
  assert.equal(validate(1, 1, 1, 1, 0, 0), 1);
  assert.equal(validate(0, 1, 1, 1, 1, 1), 0);
  assert.equal(validate(1, 1, 0, 1, 1, 1), 0);
  assert.equal(validate(1, 1, 1, 0, 1, 1), 0);
  assert.equal(validate(1, 1, 1, 1, 0, 1), 0);
});

test("Reanimation Protocols predicate matches healing and returning one wound", () => {
  const validate = calculator._whc_reanimation_protocols_transition_is_valid;
  assert.equal(validate(1, 1, 1, 1, 3, 3, 1, 3, 3, 2, 1, 2, 0), 1);
  assert.equal(validate(1, 1, 1, 1, 3, 2, 2, 3, 3, 2, 0, 3, 2), 1);
  assert.equal(validate(1, 1, 0, 1, 3, 2, 2, 3, 3, 2, 0, 3, 2), 0);
});

test("WebAssembly and JavaScript agree on reviewed simple terrain surfaces", () => {
  const cases = [
    [
      [4000, 9000],
      [6000, 9000],
      [6000, 10000],
      [5000, 10000],
      [5000, 11000],
      [4000, 11000],
    ],
    [
      [4000, 11000],
      [5000, 11000],
      [5000, 10000],
      [6000, 10000],
      [6000, 9000],
      [4000, 9000],
    ],
    [
      [4000, 9000],
      [6000, 11000],
      [4000, 11000],
      [6000, 9000],
    ],
  ].map((coordinates) =>
    coordinates.map(([xThousandths, yThousandths]) => ({ xThousandths, yThousandths })),
  );
  for (const vertices of cases) {
    const words = Int32Array.from(
      vertices.flatMap((vertex) => [vertex.xThousandths, vertex.yThousandths]),
    );
    const pointer = calculator._malloc(words.byteLength);
    try {
      new Int32Array(calculator.HEAPU8.buffer, pointer, words.length).set(words);
      assert.equal(
        Boolean(calculator._whc_simple_terrain_surface_is_valid(pointer, vertices.length, 1)),
        simpleTerrainSurfaceIsValid(vertices),
      );
    } finally {
      calculator._free(pointer);
    }
  }
});

test("WebAssembly and JavaScript agree on reviewed convex silhouettes", () => {
  const cases = [
    {
      vertices: [
        { xOffsetThousandths: -500, yOffsetThousandths: -500 },
        { xOffsetThousandths: 500, yOffsetThousandths: -500 },
        { xOffsetThousandths: 500, yOffsetThousandths: 500 },
        { xOffsetThousandths: -500, yOffsetThousandths: 500 },
      ],
      flags: 1,
    },
    {
      vertices: [
        { xOffsetThousandths: -500, yOffsetThousandths: 500 },
        { xOffsetThousandths: 500, yOffsetThousandths: 500 },
        { xOffsetThousandths: 500, yOffsetThousandths: -500 },
        { xOffsetThousandths: -500, yOffsetThousandths: -500 },
      ],
      flags: 1,
    },
    {
      vertices: [
        { xOffsetThousandths: -500, yOffsetThousandths: -500 },
        { xOffsetThousandths: 500, yOffsetThousandths: -500 },
        { xOffsetThousandths: 0, yOffsetThousandths: 0 },
        { xOffsetThousandths: 500, yOffsetThousandths: 500 },
        { xOffsetThousandths: -500, yOffsetThousandths: 500 },
      ],
      flags: 1,
    },
    {
      vertices: [
        { xOffsetThousandths: -500, yOffsetThousandths: -500 },
        { xOffsetThousandths: 500, yOffsetThousandths: -500 },
        { xOffsetThousandths: 500, yOffsetThousandths: 500 },
      ],
      flags: 0,
    },
  ];
  for (const { vertices, flags } of cases) {
    const words = Int32Array.from(
      vertices.flatMap((vertex) => [vertex.xOffsetThousandths, vertex.yOffsetThousandths]),
    );
    const pointer = calculator._malloc(words.byteLength);
    try {
      new Int32Array(calculator.HEAPU8.buffer, pointer, words.length).set(words);
      assert.equal(
        Boolean(calculator._whc_convex_silhouette_is_valid(pointer, vertices.length, flags)),
        convexSilhouetteIsValid(vertices, flags),
      );
    } finally {
      calculator._free(pointer);
    }
  }
});

test("WebAssembly and JavaScript agree on executable spatial-fact summaries", () => {
  const cases = [
    [1, 1, 0, 1, 0, 5, 1, 7],
    [6, 6, 1, 5, 3, 5, 2, 7],
    [7, 7, 2, 7, 0, 12, 0, 7],
    [7, 6, 2, 7, 0, 12, 0, 7],
    [7, 7, 1, 7, 0, 12, 0, 7],
    [7, 7, 2, 8, 0, 12, 0, 7],
    [7, 7, 2, 7, 0, 13, 0, 7],
    [7, 7, 2, 7, 0, 12, 0, 3],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_spatial_facts_are_valid(...values)),
      spatialFactValuesAreValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on endpoint-clearance summaries", () => {
  const cases = [
    [0, 0, 5, 5, 0, 0, 3],
    [5, 5, 5, 5, 0, 0, 3],
    [5, 5, 5, 5, 10, 25, 3],
    [5, 4, 5, 5, 6, 20, 2],
    [5, 4, 5, 4, 6, 16, 0],
    [5, 4, 5, 5, 7, 0, 2],
    [5, 5, 5, 5, 0, 0, 2],
    [1001, 1001, 5, 5, 0, 0, 3],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_endpoint_clearance_facts_are_valid(...values)),
      endpointClearanceFactValuesAreValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on terrain-clearance summaries", () => {
  const cases = [
    [5, 5, 12, 12, 12, 15, 15, 0, 7],
    [5, 5, 12, 12, 12, 15, 15, 4, 7],
    [5, 4, 12, 10, 11, 15, 8, 2, 0],
    [5, 5, 12, 12, 12, 15, 14, 0, 7],
    [5, 5, 12, 12, 12, 4, 4, 0, 7],
    [0, 0, 12, 12, 12, 0, 0, 0, 7],
    [5, 5, 25, 25, 25, 15, 15, 0, 7],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_terrain_clearance_facts_are_valid(...values)),
      terrainClearanceFactValuesAreValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on mission-tracker summaries", () => {
  const cases = [
    [1, 1, 2, 0, 0, 0, 2, 30, 20, 10, 10, 60, 1, 1, 7],
    [2, 1, 0, 12, 5, 3, 2, 50, 40, 0, 10, 100, 0, 0, 7],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 1, 2, 0, 0, 0, 2, 50, 41, 20, 10, 101, 0, 0, 7],
    [2, 1, 0, 12, 5, 3, 2, 20, 20, 1, 10, 50, 0, 0, 7],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_mission_tracker_facts_are_valid(...values)),
      missionTrackerFactsAreValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on objective-control classifications", () => {
  const cases = [
    [2, 2, 0, 2, 0, 1, 7],
    [2, 2, 5, 1, 1, 0, 7],
    [2, 2, 5, 2, 0, 1, 7],
    [2, 2, 5, 2, 1, 0, 7],
    [2, 2, 0, 2, 0, 1, 7],
    [3, 3, 5, 1, 1, 0, 7],
    [2, 2, 5, 1, 1, 0, 3],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_objective_control_facts_are_valid(...values)),
      objectiveControlFactValuesAreValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on visibility and cover fact partitions", () => {
  const cases = [
    [4, 4, 1, 2, 1, 1, 2, 1, 0, 1, 3],
    [4, 3, 1, 2, 1, 1, 2, 1, 0, 1, 3],
    [4, 4, 1, 2, 1, 0, 2, 1, 0, 1, 3],
    [4, 4, 1, 2, 1, 1, 2, 1, 1, 1, 3],
    [4, 4, 1, 2, 1, 1, 2, 1, 0, 1, 1],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_visibility_facts_are_valid(...values)),
      visibilityFactValuesAreValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on ranged geometry resolutions", () => {
  const cases = [
    [2, 2, 3, 3, 0, 265],
    [2, 0, 3, 2, 1, 262],
    [2, 1, 3, 2, 1, 273],
    [2, 1, 3, 3, 0, 265],
    [0, 0, 3, 3, 0, 265],
    [2, 2, 3, 2, 0, 265],
    [2, 2, 3, 3, 0, 9],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_ranged_geometry_resolution_is_valid(...values)),
      rangedGeometryResolutionIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on canonical table geometry", () => {
  const base = {
    battlefieldWidthThousandths: TABLE_GEOMETRY_CONSTANTS.widthThousandths,
    battlefieldHeightThousandths: TABLE_GEOMETRY_CONSTANTS.heightThousandths,
    objectivePositions: [
      { objectiveId: "objective-1", xThousandths: 10_000, yThousandths: 10_000 },
      { objectiveId: "objective-2", xThousandths: 50_000, yThousandths: 34_000 },
    ],
    terrainProfile: {
      sectionCount: TABLE_GEOMETRY_CONSTANTS.terrainSectionCount,
      sixByFourCount: TABLE_GEOMETRY_CONSTANTS.sixByFourCount,
      tenByFiveCount: TABLE_GEOMETRY_CONSTANTS.tenByFiveCount,
      twelveBySixCount: TABLE_GEOMETRY_CONSTANTS.twelveBySixCount,
    },
    terrainLayoutReviewed: true,
    deploymentZonesReviewed: true,
    objectivePositionsReviewed: true,
    reviewedByPlayer: true,
  };
  const cases = [
    base,
    ...["charge", "heroic_intervention", "pile_in", "consolidation"].map((context) => ({
      ...base,
      context,
    })),
    { ...base, battlefieldWidthThousandths: 44_000 },
    {
      ...base,
      objectivePositions: [base.objectivePositions[0], { ...base.objectivePositions[0] }],
    },
    { ...base, terrainLayoutReviewed: false },
    {
      ...base,
      terrainProfile: { ...base.terrainProfile, twelveBySixCount: 5, sectionCount: 11 },
    },
  ];
  for (const geometry of cases) {
    const positions = geometry.objectivePositions;
    const uniquePositions = new Set(
      positions.map((objective) => `${objective.xThousandths}:${objective.yThousandths}`),
    ).size;
    const values = [
      geometry.battlefieldWidthThousandths,
      geometry.battlefieldHeightThousandths,
      positions.length,
      uniquePositions,
      geometry.terrainProfile.sectionCount,
      geometry.terrainProfile.sixByFourCount,
      geometry.terrainProfile.tenByFiveCount,
      geometry.terrainProfile.twelveBySixCount,
      tableGeometryFlags(geometry, true),
    ];
    assert.equal(
      Boolean(calculator._whc_table_geometry_is_valid(...values)),
      tableGeometryIsValid(geometry, true),
    );
  }
});

test("WebAssembly and JavaScript agree on canonical terrain footprints", () => {
  const dimensions = [
    ...Array.from({ length: 4 }, () => [6_000, 4_000]),
    ...Array.from({ length: 2 }, () => [10_000, 5_000]),
    ...Array.from({ length: 6 }, () => [12_000, 6_000]),
  ];
  const centres = [
    [4_000, 3_000],
    [12_000, 3_000],
    [20_000, 3_000],
    [28_000, 3_000],
    [5_000, 10_000],
    [17_000, 10_000],
    [6_000, 18_000],
    [20_000, 18_000],
    [34_000, 18_000],
    [48_000, 18_000],
    [6_000, 30_000],
    [20_000, 30_000],
  ];
  const base = {
    footprints: dimensions.map(([widthThousandths, heightThousandths], index) => ({
      id: `outline-${index + 1}`,
      widthThousandths,
      heightThousandths,
      centerXThousandths: centres[index][0],
      centerYThousandths: centres[index][1],
      rotationMilliDegrees: 0,
      areaTerrainSectionId: `section-${index + 1}`,
    })),
    placementReviewed: true,
    sectionGroupingReviewed: true,
    reviewedByPlayer: true,
  };
  const rotated = {
    ...base,
    footprints: base.footprints.map((footprint, index) =>
      index === 8 ? { ...footprint, rotationMilliDegrees: 45_000 } : footprint,
    ),
  };
  const rotatedOutOfBounds = {
    ...base,
    footprints: base.footprints.map((footprint, index) =>
      index === 0 ? { ...footprint, rotationMilliDegrees: 45_000 } : footprint,
    ),
  };
  const rotatedOverlap = {
    ...base,
    footprints: base.footprints.map((footprint, index) =>
      index === 8
        ? {
            ...footprint,
            centerXThousandths: 32_000,
            rotationMilliDegrees: 45_000,
          }
        : footprint,
    ),
  };
  const cases = [
    base,
    rotated,
    rotatedOutOfBounds,
    rotatedOverlap,
    {
      ...base,
      footprints: base.footprints.map((footprint, index) =>
        index === 1
          ? {
              ...footprint,
              centerXThousandths: base.footprints[0].centerXThousandths,
              centerYThousandths: base.footprints[0].centerYThousandths,
            }
          : footprint,
      ),
    },
    {
      ...base,
      footprints: base.footprints.map((footprint, index) =>
        index === 0 ? { ...footprint, centerXThousandths: 0 } : footprint,
      ),
    },
    { ...base, sectionGroupingReviewed: false },
  ];
  assert.equal(terrainFootprintSetIsValid(rotated, true), true);
  assert.equal(terrainFootprintSetFacts(rotatedOutOfBounds).inBoundsFootprintCount, 11);
  assert.equal(terrainFootprintSetIsValid(rotatedOutOfBounds, true), false);
  assert.ok(terrainFootprintSetFacts(rotatedOverlap).overlapPairCount > 0);
  assert.equal(terrainFootprintSetIsValid(rotatedOverlap, true), false);
  for (const terrain of cases) {
    const facts = terrainFootprintSetFacts(terrain);
    const values = [
      facts.footprintCount,
      facts.positionedFootprintCount,
      facts.uniqueFootprintCount,
      facts.inBoundsFootprintCount,
      facts.groupedFootprintCount,
      facts.overlapPairCount,
      facts.sixByFourCount,
      facts.tenByFiveCount,
      facts.twelveBySixCount,
      terrainFootprintFlags(terrain, true),
    ];
    assert.equal(
      Boolean(calculator._whc_terrain_footprint_set_is_valid(...values)),
      terrainFootprintSetIsValid(terrain, true),
    );
  }
});

test("WebAssembly and JavaScript agree on exact-model placement sets", () => {
  const expectedModelIds = ["circle", "ellipse", "hull"];
  const base = {
    reviewedByPlayer: true,
    measurementBoundariesReviewed: true,
    positionsReviewed: true,
    noModelOverlapReviewed: true,
    objectiveClearanceReviewed: true,
    models: [
      {
        modelId: "circle",
        measurementBasis: "base",
        shape: "circle",
        widthThousandths: 2_000,
        depthThousandths: 2_000,
        centerXThousandths: 1_000,
        centerYThousandths: 1_000,
        elevationThousandths: 0,
        rotationMilliDegrees: 0,
      },
      {
        modelId: "ellipse",
        measurementBasis: "base",
        shape: "ellipse",
        widthThousandths: 4_000,
        depthThousandths: 2_000,
        centerXThousandths: 58_000,
        centerYThousandths: 22_000,
        elevationThousandths: 2_000,
        rotationMilliDegrees: 0,
      },
      {
        modelId: "hull",
        measurementBasis: "model",
        shape: "rectangle",
        widthThousandths: 2_000,
        depthThousandths: 2_000,
        centerXThousandths: 30_000,
        centerYThousandths: 42_585,
        elevationThousandths: 0,
        rotationMilliDegrees: 45_000,
      },
    ],
  };
  const cases = [
    base,
    {
      ...base,
      models: base.models.map((model) =>
        model.modelId === "hull" ? { ...model, centerYThousandths: 42_586 } : model,
      ),
    },
    {
      ...base,
      models: base.models.map((model) =>
        model.modelId === "circle" ? { ...model, depthThousandths: 1_999 } : model,
      ),
    },
    { ...base, models: [...base.models.slice(0, 2), { ...base.models[1] }] },
    {
      ...base,
      models: base.models.map((model, index) => (index ? model : { ...model, modelId: "unknown" })),
    },
    { ...base, positionsReviewed: false },
  ];
  for (const placement of cases) {
    const facts = modelPlacementSetFacts(placement, expectedModelIds);
    const values = [
      facts.expectedModelCount,
      facts.placementCount,
      facts.uniqueModelCount,
      facts.recognizedModelCount,
      facts.positionedModelCount,
      facts.inBoundsModelCount,
      facts.dimensionedModelCount,
      facts.supportedShapeCount,
      facts.basedModelCount,
      facts.baselessModelCount,
      modelPlacementFlags(placement, true),
    ];
    assert.equal(
      Boolean(calculator._whc_model_placement_set_is_valid(...values)),
      modelPlacementSetIsValid(placement, expectedModelIds, true),
    );
  }
});

test("WebAssembly and JavaScript agree on live per-model movement invariants", () => {
  const formation = {
    segments: [
      { id: "body", modelIds: ["model-1", "model-2"] },
      { id: "leader", modelIds: ["model-3"] },
    ],
    health: {
      body: { modelsRemaining: 1, woundsLost: 0 },
      leader: { modelsRemaining: 1, woundsLost: 0 },
    },
  };
  const footprint = (modelId, centerXThousandths) => ({
    modelId,
    measurementBasis: "base",
    shape: "circle",
    widthThousandths: 1_000,
    depthThousandths: 1_000,
    centerXThousandths,
    centerYThousandths: 10_000,
    elevationThousandths: 0,
    rotationMilliDegrees: 0,
  });
  const previous = {
    models: [
      footprint("model-1", 10_000),
      footprint("model-2", 12_000),
      footprint("model-3", 14_000),
    ],
  };
  const base = {
    context: "movement",
    models: [footprint("model-2", 13_000), footprint("model-3", 15_000)].map((model) => {
      const start = previous.models.find((candidate) => candidate.modelId === model.modelId);
      const point = (candidate) => ({
        centerXThousandths: candidate.centerXThousandths,
        centerYThousandths: candidate.centerYThousandths,
        elevationThousandths: candidate.elevationThousandths,
        rotationMilliDegrees: candidate.rotationMilliDegrees,
      });
      return {
        ...model,
        path: [point(start), point(model)],
        distanceMovedThousandths: 1_000,
        maximumDistanceThousandths: 6_000,
      };
    }),
    reviewedByPlayer: true,
    measurementBoundariesReviewed: true,
    positionsReviewed: true,
    noModelOverlapReviewed: true,
    objectiveClearanceReviewed: true,
    pathsReviewed: true,
    terrainClearanceReviewed: true,
    coherencyReviewed: true,
    engagementRangeReviewed: true,
    reconcilesStaleStart: false,
  };
  const cases = [
    base,
    ...["destroyed_transport_disembarkation", "emergency_disembarkation"].map((context) => ({
      ...base,
      context,
      models: base.models.map((model) => ({
        ...model,
        path: [model.path.at(-1)],
        distanceMovedThousandths: 0,
        maximumDistanceThousandths: 0,
      })),
    })),
    { ...base, pathsReviewed: false },
    {
      ...base,
      models: base.models.map((model, index) =>
        index === 0 ? { ...model, maximumDistanceThousandths: 999 } : model,
      ),
    },
    {
      ...base,
      reconcilesStaleStart: true,
      models: base.models.map((model) => ({
        ...model,
        path: [
          { ...model.path[0], centerYThousandths: model.path[0].centerYThousandths + 1_000 },
          { ...model.path[1], centerYThousandths: model.path[1].centerYThousandths + 1_000 },
        ],
        centerYThousandths: model.centerYThousandths + 1_000,
        distanceMovedThousandths: 1_000,
      })),
    },
    {
      ...base,
      models: base.models.map((model, index) =>
        index === 0 ? { ...model, distanceMovedThousandths: 0 } : model,
      ),
    },
    {
      ...base,
      models: base.models.map((model, index) =>
        index === 0 ? { ...model, widthThousandths: 2_000 } : model,
      ),
    },
    {
      ...base,
      models: base.models.map((model, index) =>
        index === 0
          ? {
              ...model,
              path: [
                { ...model.path[0], centerXThousandths: model.path[0].centerXThousandths + 1 },
                model.path[1],
              ],
            }
          : model,
      ),
    },
    {
      ...base,
      models: base.models.map((model, index) =>
        index === 0
          ? { ...model, path: [model.path[0], { ...model.path[1], centerYThousandths: 10_001 }] }
          : model,
      ),
    },
    {
      ...base,
      models: base.models.map((model, index) =>
        index === 0
          ? { ...model, path: [{ ...model.path[0], centerXThousandths: 0 }, model.path[1]] }
          : model,
      ),
    },
    { ...base, models: [base.models[0]] },
  ];
  for (const position of cases) {
    const facts = modelPositionSetFacts(position, formation, previous);
    const values = [
      facts.liveModelCount,
      facts.placementCount,
      facts.uniqueModelCount,
      facts.recognizedModelCount,
      facts.positionedModelCount,
      facts.inBoundsModelCount,
      facts.dimensionedModelCount,
      facts.supportedShapeCount,
      facts.basedModelCount,
      facts.baselessModelCount,
      formation.segments.length,
      facts.matchedLiveSegmentCount,
      facts.pathModelCount,
      facts.pathStartCount,
      facts.pathEndpointCount,
      facts.pathInBoundsCount,
      facts.footprintMatchCount,
      facts.distanceWithinLimitCount,
      facts.distanceCoversPathCount,
      modelPositionFlags(position, true),
    ];
    assert.equal(
      Boolean(calculator._whc_model_position_set_is_valid(...values)),
      modelPositionSetIsValid(position, formation, previous, true),
    );
  }
});

test("WebAssembly and JavaScript agree on initial deployment exceptions", () => {
  const cases = [
    [0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 1],
    [1, 1, 0, 0, 0, 1],
    [0, 0, 1, 0, 1, 2],
    [0, 0, 1, 0, 1, 1],
    [0, 0, 1, 1, 2, 1],
    [0, 0, 1, 1, 2, 3],
    [0, 0, 1, 1, 2, 2],
    [0, 0, 1, 0, 2, 1],
    [0, 0, 0, 0, 1, 1],
    [2, 0, 0, 0, 0, 1],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_initial_deployment_is_valid(...values)),
      initialDeploymentIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on Transport capacity boundaries", () => {
  const cases = [
    [0, 12, 0, 0, 0],
    [12, 12, 0, 0, 1],
    [13, 12, 0, 0, 1],
    [4, 6, 1, 1, 1],
    [4, 6, 2, 1, 1],
    [4, 6, 0, 1, 1],
    [4, 6, 1, 0, 1],
    [4, 6, 0, 0, 2],
    [0, 0, 0, 0, 0],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_transport_load_is_valid(...values)),
      transportLoadIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on nested Transport deployment chains", () => {
  const cases = [
    [1, 1, 0, 0],
    [1, 1, 1, 0],
    [3, 3, 1, 0],
    [3, 3, 2, 3],
    [3, 3, 3, 3],
    [3, 2, 1, 0],
    [3, 3, 2, 2],
    [0, 0, 0, 0],
    [258, 258, 1, 0],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_transport_deployment_chain_is_valid(...values)),
      transportDeploymentChainIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on exact weapon-bearer declarations", () => {
  const cases = [
    [3, 2, 0, 2, 3, 2],
    [3, 1, 0, 1, 1, 1],
    [3, 4, 0, 1, 0, 0],
    [3, 1, 1, 1, 0, 0],
    [3, 2, 1, 2, 0, 0],
    [3, 2, 0, 1, 1, 2],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_weapon_bearer_declaration_is_valid(...values)),
      weaponBearerDeclarationIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on structured charge resolutions", () => {
  const common = 1 | 2 | 4;
  const successful = common | 8 | 16 | 32 | 64 | 128;
  const cases = [
    [3, 4, 0, 7000, 8500, 6500, 1, 1, successful],
    [1, 2, 0, 3000, 11000, 0, 2, 0, common | 512],
    [3, 4, 0, 7000, 8500, 7500, 1, 1, successful],
    [3, 4, 0, 7000, 12500, 6500, 1, 1, successful],
    [3, 4, 1, 7000, 8500, 6500, 1, 1, successful],
    [3, 4, 1, 7000, 8500, 6500, 1, 1, successful | 256],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_charge_resolution_is_valid(...values)),
      chargeResolutionIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on reviewed Fight movements", () => {
  const cases = [
    [1, 1, 3000, 63],
    [1, 1, 0, 63],
    [1, 0, 0, 1121],
    [2, 1, 3000, 63],
    [2, 2, 2500, 1507],
    [2, 0, 0, 1633],
    [1, 0, 0, 3105],
    [2, 0, 0, 3105],
    [1, 1, 0, 3105],
    [1, 2, 1000, 1507],
    [1, 0, 1, 1121],
    [2, 1, 3001, 63],
    [2, 1, 1000, 31],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_fight_move_is_valid(...values)),
      fightMoveIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on Heroic Intervention resolutions", () => {
  const successfulChargeFlags = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128;
  const failedChargeFlags = 1 | 2 | 4 | 512;
  const cases = [
    [3, 4, 0, 7000, 6000, 5000, 1, successfulChargeFlags, 15],
    [1, 2, 0, 3000, 6000, 0, 0, failedChargeFlags, 15],
    [3, 4, 0, 7000, 6001, 5000, 1, successfulChargeFlags, 15],
    [3, 4, 0, 7000, 6000, 5000, 1, successfulChargeFlags, 13],
    [3, 4, 0, 7000, 6000, 8000, 1, successfulChargeFlags, 15],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_heroic_intervention_is_valid(...values)),
      heroicInterventionIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on Fire Overwatch eligibility", () => {
  const cases = [
    ["set_up", "movement", 24000, 63],
    ["set_up", "charge", 1, 63],
    ["normal_move_start", "movement", 12000, 63],
    ["advance_end", "movement", 6000, 63],
    ["charge_declared", "charge", 9000, 63],
    ["charge_declared", "movement", 9000, 63],
    ["normal_move_end", "charge", 9000, 63],
    ["fall_back_start", "movement", 24001, 63],
    ["set_up", "movement", 12000, 62],
  ];
  const triggers = [
    "set_up",
    "normal_move_start",
    "normal_move_end",
    "advance_start",
    "advance_end",
    "fall_back_start",
    "fall_back_end",
    "charge_declared",
  ];
  for (const [trigger, phase, distance, flags] of cases) {
    const values = [triggers.indexOf(trigger) + 1, phase === "movement" ? 2 : 4, distance, flags];
    assert.equal(
      Boolean(calculator._whc_fire_overwatch_is_valid(...values)),
      fireOverwatchIsValid(trigger, phase, distance, flags),
    );
  }
});

test("WebAssembly and JavaScript agree on Hazardous damage resolution", () => {
  const cases = [
    [1, 0, false, 3, 0, 0, 0, 3, true, 3],
    [1, 0, false, 5, 5, 3, 2, 1, false, 3],
    [2, 1, true, 2, 5, 2, 0, 2, true, 3],
    [1, 0, false, 1, 5, 3, 3, 0, false, 3],
    [2, 0, false, 3, 0, 0, 0, 3, true, 3],
    [1, 2, true, 3, 0, 0, 0, 3, true, 3],
    [1, 0, false, 2, 5, 3, 0, 3, false, 3],
    [1, 0, false, 3, 0, 0, 0, 3, true, 2],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_hazardous_resolution_is_valid(...values)),
      hazardousResolutionIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on Go to Ground resolution", () => {
  const cases = [
    [3, 2, 1, 1, false, false, 31],
    [3, 1, 1, 0, false, false, 31],
    [2, 2, 1, 1, false, false, 31],
    [3, 0, 1, 0, false, false, 31],
    [3, 2, 2, 0, false, false, 31],
    [3, 2, 1, 0, false, false, 31],
    [3, 2, 1, 1, true, false, 31],
    [3, 2, 1, 1, false, true, 31],
    [3, 2, 1, 1, false, false, 15],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_go_to_ground_is_valid(...values)),
      goToGroundIsValid(
        values[0] === 3 ? "shooting" : "movement",
        values[1],
        values[2],
        values[3],
        values[4],
        values[5],
        values[6],
      ),
    );
  }
});

test("WebAssembly and JavaScript agree on Smokescreen resolution", () => {
  const cases = [
    [3, 2, 1, 1, false, false, 31],
    [3, 1, 1, 0, false, false, 31],
    [2, 2, 1, 1, false, false, 31],
    [3, 0, 1, 0, false, false, 31],
    [3, 2, 2, 0, false, false, 31],
    [3, 2, 1, 0, false, false, 31],
    [3, 2, 1, 1, true, false, 31],
    [3, 2, 1, 1, false, true, 31],
    [3, 2, 1, 1, false, false, 15],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_smokescreen_is_valid(...values)),
      smokescreenIsValid(
        values[0] === 3 ? "shooting" : "movement",
        values[1],
        values[2],
        values[3],
        values[4],
        values[5],
        values[6],
      ),
    );
  }
});

test("WebAssembly and JavaScript agree on Rapid Ingress resolution", () => {
  const cases = [
    [2, 3, 2, 2, 2, 1, 1, false, false, false, 31],
    [2, 3, 1, 1, 1, 1, 0, false, false, true, 31],
    [2, 2, 2, 2, 2, 1, 1, false, false, false, 31],
    [3, 3, 2, 2, 2, 1, 1, false, false, false, 31],
    [2, 3, 1, 1, 1, 1, 0, false, false, false, 31],
    [2, 3, 1, 2, 2, 1, 1, false, false, true, 31],
    [2, 3, 2, 2, 0, 1, 0, false, false, false, 31],
    [2, 3, 2, 2, 2, 1, 1, true, false, false, 31],
    [2, 3, 2, 2, 2, 1, 1, false, true, false, 31],
    [2, 3, 2, 2, 2, 1, 1, false, false, false, 15],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_rapid_ingress_is_valid(...values)),
      rapidIngressIsValid(
        values[0] === 2 ? "movement" : "shooting",
        values[1] === 3 ? "end" : "reinforcements",
        values[2],
        values[3],
        values[4],
        values[5],
        values[6],
        values[7],
        values[8],
        values[9],
        values[10],
      ),
    );
  }
});

test("WebAssembly and JavaScript agree on the fail-closed rule coverage gate", () => {
  const cases = [
    [1, true, false],
    [2, true, true],
    [2, true, false],
    [3, true, false],
    [4, true, true],
    [1, false, true],
    [0, true, true],
    [255, true, true],
  ];
  for (const [status, sourceLocked, acknowledged] of cases) {
    assert.equal(
      Boolean(calculator._whc_rule_coverage_is_permitted(status, sourceLocked, acknowledged)),
      ruleCoverageIsPermitted(status, sourceLocked, acknowledged ? "reviewed" : ""),
    );
  }
});

test("WebAssembly and JavaScript agree on Counter-offensive resolution", () => {
  const cases = [
    [5, 2, 2, 0, false, false, 31],
    [5, 3, 2, 1, false, false, 31],
    [3, 2, 2, 0, false, false, 31],
    [5, 1, 2, 0, false, false, 31],
    [5, 2, 1, 1, false, false, 31],
    [5, 2, 2, 1, false, false, 31],
    [5, 2, 2, 0, true, false, 31],
    [5, 2, 2, 0, false, true, 31],
    [5, 2, 2, 0, false, false, 15],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_counter_offensive_is_valid(...values)),
      counterOffensiveIsValid(
        values[0] === 5 ? "fight" : "shooting",
        values[1],
        values[2],
        values[3],
        values[4],
        values[5],
        values[6],
      ),
    );
  }
});

test("WebAssembly and JavaScript agree on activation-wide ranged declarations", () => {
  const cases = [
    [3, 3, 2, 2, 3, 3, 63],
    [1, 1, 1, 1, 1, 1, 63],
    [0, 0, 0, 0, 0, 0, 63],
    [3, 2, 2, 2, 3, 3, 63],
    [3, 3, 3, 2, 3, 3, 63],
    [3, 3, 2, 2, 2, 3, 63],
    [3, 3, 2, 2, 3, 3, 31],
    [257, 257, 2, 2, 3, 3, 63],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_ranged_declaration_is_valid(...values)),
      rangedDeclarationIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on locked weapon declarations", () => {
  const cases = [
    [3, 5, 0, 3, 3, 2],
    [3, 1, 2, 1, 1, 1],
    [0, 5, 0, 1, 0, 0],
    [3, 0, 0, 1, 0, 0],
    [3, 5, 2, 2, 0, 0],
    [3, 5, 0, 1, 1, 2],
  ];
  for (const values of cases) {
    assert.equal(
      Boolean(calculator._whc_weapon_inventory_declaration_is_valid(...values)),
      weaponInventoryDeclarationIsValid(...values),
    );
  }
});

test("WebAssembly and JavaScript agree on ranged target eligibility", () => {
  const cases = [
    {
      fact: {
        publishedRangeThousandths: 24000,
        effectiveRangeThousandths: 24000,
        measuredDistanceThousandths: 18000,
        eligibleWeaponCount: 3,
        visible: true,
        fullyVisible: false,
        indirectFire: false,
        weaponHasIndirect: false,
        reviewedByPlayer: true,
        rangeOverrideReason: "",
      },
      declaredWeaponCount: 3,
    },
    {
      fact: {
        publishedRangeThousandths: 48000,
        effectiveRangeThousandths: 48000,
        measuredDistanceThousandths: 32000,
        eligibleWeaponCount: 1,
        visible: false,
        fullyVisible: false,
        indirectFire: true,
        weaponHasIndirect: true,
        reviewedByPlayer: true,
        rangeOverrideReason: "",
      },
      declaredWeaponCount: 1,
    },
    {
      fact: {
        publishedRangeThousandths: 24000,
        effectiveRangeThousandths: 30000,
        measuredDistanceThousandths: 25000,
        eligibleWeaponCount: 1,
        visible: true,
        fullyVisible: true,
        indirectFire: false,
        weaponHasIndirect: false,
        reviewedByPlayer: true,
        rangeOverrideReason: "Detachment rule",
      },
      declaredWeaponCount: 1,
    },
    {
      fact: {
        publishedRangeThousandths: 24000,
        effectiveRangeThousandths: 24000,
        measuredDistanceThousandths: 24001,
        eligibleWeaponCount: 2,
        visible: true,
        fullyVisible: false,
        indirectFire: false,
        weaponHasIndirect: false,
        reviewedByPlayer: true,
        rangeOverrideReason: "",
      },
      declaredWeaponCount: 2,
    },
  ];
  for (const { fact, declaredWeaponCount } of cases) {
    const flags =
      (fact.visible ? 1 : 0) |
      (fact.fullyVisible ? 2 : 0) |
      (fact.indirectFire ? 4 : 0) |
      (fact.weaponHasIndirect ? 8 : 0) |
      (fact.reviewedByPlayer ? 16 : 0) |
      (fact.rangeOverrideReason ? 32 : 0);
    assert.equal(
      Boolean(
        calculator._whc_ranged_target_eligibility_is_valid(
          fact.publishedRangeThousandths,
          fact.effectiveRangeThousandths,
          fact.measuredDistanceThousandths,
          fact.eligibleWeaponCount,
          declaredWeaponCount,
          flags,
        ),
      ),
      rangedTargetEligibilityIsValid(fact, declaredWeaponCount),
    );
  }
});

test("WebAssembly and JavaScript battle clocks match every transition", () => {
  const statuses = { setup: 0, active: 1, complete: 2 };
  const phases = {
    setup: 0,
    command: 1,
    movement: 2,
    shooting: 3,
    charge: 4,
    fight: 5,
    complete: 6,
  };
  const players = [{ id: "alpha" }, { id: "beta" }];
  const words = (clock) => {
    const steps = BATTLE_PHASE_STEPS[clock.phase];
    const playerIndex = (id) => (id ? players.findIndex((player) => player.id === id) : 2);
    return [
      statuses[clock.status],
      clock.battleRound,
      clock.turn,
      phases[clock.phase],
      steps ? steps.indexOf(clock.step) : 0,
      playerIndex(clock.firstPlayerId),
      playerIndex(clock.activePlayerId),
      playerIndex(clock.priorityPlayerId),
    ];
  };
  const currentPointer = calculator._malloc(8 * 4);
  const nextPointer = calculator._malloc(8 * 4);
  try {
    for (const firstPlayerIndex of [0, 1]) {
      let clock = startBattleClock(players, players[firstPlayerIndex].id);
      assert.equal(calculator._whc_start_battle_clock(firstPlayerIndex, currentPointer), 1);
      assert.deepEqual(
        [...new Uint32Array(calculator.HEAPU8.buffer, currentPointer, 8)],
        words(clock),
      );
      let transitions = 0;
      while (clock.status === "active") {
        clock = nextBattleClock(clock, players);
        assert.equal(calculator._whc_next_battle_clock(currentPointer, nextPointer), 1);
        assert.deepEqual(
          [...new Uint32Array(calculator.HEAPU8.buffer, nextPointer, 8)],
          words(clock),
        );
        new Uint32Array(calculator.HEAPU8.buffer, currentPointer, 8).set(
          new Uint32Array(calculator.HEAPU8.buffer, nextPointer, 8),
        );
        transitions++;
      }
      assert.equal(transitions, 170);
    }
  } finally {
    calculator._free(currentPointer);
    calculator._free(nextPointer);
  }
});

test("WebAssembly matches JavaScript for the versioned golden battle replay", async () => {
  const state = normalizeBattleState(
    JSON.parse(
      await readFile(new URL("./fixtures/battle-replay-v1.json", import.meta.url), "utf8"),
    ),
  );
  const formation = state.events.find(
    (event) => event.type === "formation_registered" && event.formation.id === "target",
  ).formation;
  const segmentIndices = new Map(formation.segments.map((segment, index) => [segment.id, index]));
  const selectedEvents = [];
  const attackIndices = new Map();
  for (const event of state.events) {
    if (event.type === "attack_resolved" && event.targetFormationId === formation.id) {
      attackIndices.set(event.id, selectedEvents.length);
      selectedEvents.push(event);
    } else if (event.type === "attack_reverted" && attackIndices.has(event.revertsEventId)) {
      selectedEvents.push(event);
    }
  }
  const profiles = new Uint32Array(formation.segments.length * 2);
  formation.segments.forEach((segment, index) => {
    profiles[index * 2] = segment.wounds;
    profiles[index * 2 + 1] = segment.startingModels;
  });
  const eventFields = 166;
  const events = new Uint32Array(selectedEvents.length * eventFields);
  selectedEvents.forEach((event, index) => {
    const offset = index * eventFields;
    events[offset] = event.version;
    if (event.type === "attack_resolved") {
      events[offset + 1] = 1;
      events[offset + 2] = event.allocations.length;
      events[offset + 4] = event.summary.damage;
      events[offset + 5] = event.summary.modelsDestroyed;
      event.allocations.forEach((allocation, allocationIndex) => {
        const allocationOffset = offset + 6 + allocationIndex * 5;
        events[allocationOffset] = segmentIndices.get(allocation.segmentId);
        events[allocationOffset + 1] = allocation.before.modelsRemaining;
        events[allocationOffset + 2] = allocation.before.woundsLost;
        events[allocationOffset + 3] = allocation.after.modelsRemaining;
        events[allocationOffset + 4] = allocation.after.woundsLost;
      });
    } else {
      events[offset + 1] = 2;
      events[offset + 3] = attackIndices.get(event.revertsEventId);
    }
  });
  const profilesPointer = calculator._malloc(profiles.byteLength);
  const eventsPointer = calculator._malloc(events.byteLength);
  const healthPointer = calculator._malloc(formation.segments.length * 8);
  try {
    new Uint32Array(calculator.HEAPU8.buffer, profilesPointer, profiles.length).set(profiles);
    new Uint32Array(calculator.HEAPU8.buffer, eventsPointer, events.length).set(events);
    assert.equal(
      calculator._whc_replay_battle_health_events(
        profilesPointer,
        formation.segments.length,
        eventsPointer,
        selectedEvents.length,
        healthPointer,
      ),
      1,
    );
    const result = new Uint32Array(
      calculator.HEAPU8.buffer,
      healthPointer,
      formation.segments.length * 2,
    );
    const health = Object.fromEntries(
      formation.segments.map((segment, index) => [
        segment.id,
        { modelsRemaining: result[index * 2], woundsLost: result[index * 2 + 1] },
      ]),
    );
    assert.deepEqual(health, battleFormationHealth(state, formation.id));
    assert.deepEqual(replayBattleState(state).activeAttackIds, ["final-attack"]);
  } finally {
    calculator._free(profilesPointer);
    calculator._free(eventsPointer);
    calculator._free(healthPointer);
  }
});

test("WebAssembly replays destroyed Transport passenger damage", () => {
  const profiles = new Uint32Array([2, 1]);
  const events = new Uint32Array(166);
  events[0] = 1;
  events[1] = 3;
  events[2] = 1;
  events[4] = 1;
  events[5] = 0;
  events[6] = 0;
  events[7] = 1;
  events[8] = 0;
  events[9] = 1;
  events[10] = 1;
  const profilesPointer = calculator._malloc(profiles.byteLength);
  const eventsPointer = calculator._malloc(events.byteLength);
  const healthPointer = calculator._malloc(8);
  try {
    new Uint32Array(calculator.HEAPU8.buffer, profilesPointer, profiles.length).set(profiles);
    new Uint32Array(calculator.HEAPU8.buffer, eventsPointer, events.length).set(events);
    assert.equal(
      calculator._whc_replay_battle_health_events(
        profilesPointer,
        1,
        eventsPointer,
        1,
        healthPointer,
      ),
      1,
    );
    assert.deepEqual([...new Uint32Array(calculator.HEAPU8.buffer, healthPointer, 2)], [1, 1]);
  } finally {
    calculator._free(profilesPointer);
    calculator._free(eventsPointer);
    calculator._free(healthPointer);
  }
});

test("Firing Deck model selection scales the exact C/WebAssembly attack count", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const trukk = catalogue.units.find((unit) => unit.id === "000000026");
  const boyz = catalogue.units.find((unit) => unit.id === "000000016");
  const shoota = boyz.weapons.find((weapon) => weapon.name === "Shoota");
  const oneModel = resolveFiringDeckSelections(catalogue, trukk, [
    { passengerUnitId: boyz.id, weaponId: shoota.id, modelCount: 1 },
  ]);
  const twelveModels = resolveFiringDeckSelections(catalogue, trukk, [
    { passengerUnitId: boyz.id, weaponId: shoota.id, modelCount: 12 },
  ]);
  assert.equal(oneModel.selections[0].weapon.id, twelveModels.selections[0].weapon.id);
  assert.ok(
    lessThanOrEqual(
      exactMean({ attacks: 2, weaponCount: oneModel.selections[0].modelCount }),
      exactMean({ attacks: 2, weaponCount: twelveModels.selections[0].modelCount }),
    ),
  );
});

test("signed characteristic modifiers use per-weapon floors in C/Wasm", () => {
  const output = calculator._malloc(72);
  try {
    assert.equal(
      calculateSummary(
        1,
        6,
        0,
        0,
        2,
        2,
        10,
        0,
        0,
        0,
        1,
        6,
        1,
        7,
        0,
        0,
        10,
        0,
        16,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        -1,
        0,
        0,
        0,
        0,
        0,
        1,
        output,
      ),
      1,
    );
    assert.deepEqual([readUint64(output, 5, 6), readUint64(output, 7, 8)], [40n, 9n]);
    assert.equal(
      calculateSummary(
        1,
        6,
        0,
        4,
        2,
        2,
        10,
        0,
        0,
        0,
        1,
        6,
        1,
        7,
        0,
        0,
        10,
        0,
        16,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        -1,
        0,
        0,
        0,
        0,
        0,
        1,
        output,
      ),
      1,
    );
    assert.equal(calculator.getValue(output, "i32") >>> 0, 0);
    assert.equal(calculator.getValue(output + 16, "i32") >>> 0, 6);
    assert.deepEqual([readUint64(output, 5, 6), readUint64(output, 7, 8)], [5n, 1n]);
    assert.equal(
      calculateSummary(
        1,
        6,
        0,
        4,
        1,
        2,
        10,
        0,
        0,
        0,
        1,
        6,
        1,
        7,
        0,
        0,
        10,
        0,
        272,
        0,
        1,
        0,
        0,
        0,
        1,
        3,
        0,
        0,
        0,
        0,
        -1,
        0,
        0,
        0,
        0,
        0,
        1,
        output,
      ),
      1,
    );
    assert.equal(calculator.getValue(output + 16, "i32") >>> 0, 6);
    assert.deepEqual([readUint64(output, 5, 6), readUint64(output, 7, 8)], [25n, 6n]);
    assert.equal(
      calculateSummary(
        0,
        0,
        1,
        0,
        1,
        2,
        2,
        0,
        1,
        6,
        0,
        6,
        7,
        7,
        0,
        0,
        10,
        0,
        528,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        2,
        0,
        0,
        0,
        -1,
        0,
        8,
        0,
        1,
        1,
        output,
      ),
      1,
    );
    assert.deepEqual([readUint64(output, 5, 6), readUint64(output, 7, 8)], [1n, 1n]);
  } finally {
    calculator._free(output);
  }
});

test("source choice pools share allowances and preserve compound bundles", () => {
  const unit = {
    name: "Dreadnought",
    suggestedModelCount: 1,
    maximumModelCount: 1,
    weaponLimits: [],
    weapons: [
      { groupId: "unit:flamer", groupName: "Flamer" },
      { groupId: "unit:bolter", groupName: "Bolter" },
    ],
    defaultWeapons: [
      {
        groupId: "unit:bolter",
        groupName: "Bolter",
        terms: [
          {
            fixed: 2,
            perModel: 0,
            perIncrement: 0,
            modelsPerIncrement: 1,
            quantity: 1,
            source: "This model is equipped with 2 bolters",
          },
        ],
      },
    ],
    wargearChoicePools: [
      {
        id: "unit:pool",
        fixed: 1,
        perIncrement: 0,
        modelsPerIncrement: 1,
        source: "Choose one replacement",
        replaces: [{ groupId: "unit:bolter", groupName: "Bolter", quantity: 2 }],
        alternatives: [
          {
            id: "unit:pool:1",
            label: "2 flamers",
            weapons: [{ groupId: "unit:flamer", groupName: "Flamer", quantity: 2 }],
          },
          {
            id: "unit:pool:2",
            label: "1 flamer and 1 bolter",
            weapons: [
              { groupId: "unit:flamer", groupName: "Flamer", quantity: 1 },
              { groupId: "unit:bolter", groupName: "Bolter", quantity: 1 },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(choicePoolMaximum(unit.wargearChoicePools[0], 1), 1);
  assert.deepEqual(choiceSelectionWeaponCounts(unit, { "unit:pool:2": 1 }), {
    "unit:flamer": 1,
    "unit:bolter": 1,
  });
  assert.deepEqual(defaultWeaponCounts(unit, 1), { "unit:bolter": 2 });
  assert.deepEqual(sourceEquippedWeaponCounts(unit, 1, { "unit:pool:2": 1 }), {
    "unit:bolter": 1,
    "unit:flamer": 1,
  });
  assert.deepEqual(
    applyChoiceSelectionChange(
      { "unit:bolter": 2, "unit:flamer": 0 },
      unit.wargearChoicePools[0],
      unit.wargearChoicePools[0].alternatives[1],
      0,
      1,
    ),
    { "unit:bolter": 1, "unit:flamer": 1 },
  );
  assert.deepEqual(
    unitLoadoutWarnings(unit, 1, {}, { "unit:flamer": 1, "unit:bolter": 1 }, { "unit:pool:2": 1 }),
    [],
  );
  assert.match(
    unitLoadoutWarnings(
      unit,
      1,
      {},
      { "unit:flamer": 4, "unit:bolter": 0 },
      { "unit:pool:1": 2 },
    )[0],
    /2 selections exceeds the shared limit of 1/i,
  );
});

test("duplicate-capable source pools share item and weapon-type limits", () => {
  const unit = {
    name: "Battlesuit",
    suggestedModelCount: 1,
    maximumModelCount: 1,
    startingSizeRanges: [{ minimum: 1, maximum: 1, source: "1 Battlesuit" }],
    weaponLimits: [],
    weapons: [
      { groupId: "unit:burst", groupName: "Burst cannon", type: "Ranged" },
      { groupId: "unit:fusion", groupName: "Fusion blaster", type: "Ranged" },
      { groupId: "unit:fists", groupName: "Fists", type: "Melee" },
    ],
    defaultWeapons: [],
    wargearChoiceItemLimits: [
      {
        itemKey: "equipment:shield generator",
        itemName: "Shield Generator",
        fixed: 1,
        perIncrement: 0,
        modelsPerIncrement: 1,
        source: "This model cannot have duplicates",
      },
    ],
    weaponTypeLimits: [
      {
        weaponType: "Ranged",
        fixed: 3,
        perIncrement: 0,
        modelsPerIncrement: 1,
        source: "This model cannot have more than 3 ranged weapons",
      },
    ],
    wargearChoicePools: [
      {
        id: "unit:replace",
        fixed: 1,
        perIncrement: 0,
        modelsPerIncrement: 1,
        source: "Replace one weapon",
        replaces: [],
        alternatives: [
          {
            id: "unit:replace:shield",
            label: "1 shield generator*",
            weapons: [],
            selectionKey: "equipment:shield generator",
            selectionName: "Shield Generator",
            selectionQuantity: 1,
          },
        ],
      },
      {
        id: "unit:add",
        fixed: 3,
        perIncrement: 0,
        modelsPerIncrement: 1,
        source: "Add up to three items",
        replaces: [],
        alternatives: [
          {
            id: "unit:add:shield",
            label: "1 shield generator*",
            weapons: [],
            selectionKey: "equipment:shield generator",
            selectionName: "Shield Generator",
            selectionQuantity: 1,
          },
        ],
      },
    ],
  };
  const choices = { "unit:replace:shield": 1, "unit:add:shield": 1 };
  assert.deepEqual(choiceSelectionItemCounts(unit, choices), {
    "equipment:shield generator": 2,
  });
  assert.match(choiceSelectionLimitWarnings(unit, 1, choices)[0], /shared limit of 1/i);
  const warnings = unitLoadoutWarnings(
    unit,
    1,
    {},
    { "unit:burst": 1, "unit:fusion": 3, "unit:fists": 1 },
    choices,
  );
  assert.ok(warnings.some((warning) => /4 equipped copies.*limit of 3/i.test(warning)));
});

test("unit ability presets separate attacking and defensive effects", () => {
  const mixed = {
    weaponScope: "Melee",
    hitModifier: -1,
    woundModifier: 1,
    rerollHits: true,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: true,
    hitModifierRole: "target",
    hitModifierSubject: "enemy_unit",
    woundModifierRole: "attacker",
    woundModifierSubject: "self",
    hitRerollRole: "attacker",
    hitRerollSubject: "self",
    woundRerollRole: "attacker",
    woundRerollSubject: "self",
  };
  assert.equal(combatPresetSupportsRole(mixed, "attacker"), true);
  assert.equal(combatPresetSupportsRole(mixed, "target"), true);
  const outOfScope = combatPresetEffects([mixed], "Ranged", "attacker");
  assert.equal(outOfScope.hitModifier, 0);
  assert.equal(outOfScope.woundModifier, 0);
  assert.equal(outOfScope.rerollHits, false);
  assert.equal(outOfScope.apModifier, 0);
  assert.equal(outOfScope.lethalHits, false);
  const applied = applyCombatPresets(
    { hitModifier: 0, woundModifier: 0, ap: 4 },
    [mixed],
    [mixed],
    "Melee",
  );
  assert.equal(applied.hitModifier, -1);
  assert.equal(applied.woundModifier, 1);
  assert.equal(applied.rerollHits, true);
  assert.equal(applied.rerollHitOnes, false);
  assert.equal(applied.rerollWoundOnes, true);
  assert.equal(applied.ap, 4);
  assert.equal(combatPresetSubjectSummary(mixed, "attacker"), "this unit");
  assert.equal(combatPresetSubjectSummary(mixed, "target"), "enemy attacker");
  const selfPenalty = {
    ...mixed,
    hitModifier: -1,
    hitModifierRole: "attacker",
    hitModifierSubject: "self",
    woundModifier: 0,
    rerollHits: false,
    rerollWoundOnes: false,
  };
  assert.equal(combatPresetEffects([selfPenalty], "Melee", "attacker").hitModifier, -1);
  assert.equal(combatPresetEffects([selfPenalty], "Melee", "target").hitModifier, 0);
  assert.equal(
    applyCombatPresets(
      { hitModifier: 0, woundModifier: 0 },
      [
        { ...mixed, hitModifier: 1, hitModifierRole: "attacker" },
        { ...mixed, hitModifier: 1, hitModifierRole: "attacker" },
      ],
      [mixed],
      "Melee",
    ).hitModifier,
    1,
  );
});

test("unit ability presets compose weapon rules, AP, and critical thresholds", () => {
  const preset = {
    weaponScope: "Ranged",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      {
        type: "lethal_hits",
        value: 1,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "self",
      },
      {
        type: "ap_modifier",
        value: 1,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "self",
      },
      {
        type: "critical_hits",
        value: 5,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "self",
      },
      {
        type: "sustained_hits",
        value: 0,
        diceCount: 1,
        diceSides: 3,
        role: "attacker",
        subject: "self",
      },
    ],
  };
  const applied = applyCombatPresets(
    {
      ap: 2,
      criticalHits: 6,
      criticalWounds: 0,
      lethalHits: false,
      devastatingWounds: false,
      twinLinked: false,
      ignoresCover: false,
      lanceActive: false,
      heavyActive: false,
      sustainedHits: 1,
      sustainedHitsDice: 0,
      sustainedHitsSides: 0,
      rapidFire: 0,
      rapidFireDice: 0,
      rapidFireSides: 0,
      hitModifier: 0,
      woundModifier: 0,
    },
    [preset],
    [],
    "Ranged",
  );
  assert.equal(applied.ap, 3);
  assert.equal(applied.criticalHits, 5);
  assert.equal(applied.lethalHits, true);
  assert.deepEqual(
    [applied.sustainedHits, applied.sustainedHitsDice, applied.sustainedHitsSides],
    [0, 1, 3],
  );
  assert.equal(combatPresetSubjectSummary(preset, "attacker"), "this unit");
});

test("unit ability presets compose direct weapon characteristic modifiers", () => {
  const preset = {
    weaponScope: "Melee",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      {
        type: "attacks_modifier",
        value: 1,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "led_unit",
      },
      {
        type: "strength_modifier",
        value: 2,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "led_unit",
      },
      {
        type: "damage_modifier",
        value: 1,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "led_unit",
      },
    ],
  };
  const applied = applyCombatPresets(
    {
      attacks: 0,
      attackDice: 1,
      attackSides: 6,
      strength: 8,
      damage: 1,
      damageDice: 1,
      damageSides: 3,
      ap: 2,
      criticalHits: 6,
      criticalWounds: 0,
      lethalHits: false,
      devastatingWounds: false,
      twinLinked: false,
      ignoresCover: false,
      lanceActive: false,
      heavyActive: false,
      sustainedHits: 0,
      sustainedHitsDice: 0,
      sustainedHitsSides: 0,
      rapidFire: 0,
      rapidFireDice: 0,
      rapidFireSides: 0,
      hitModifier: 0,
      woundModifier: 0,
    },
    [preset],
    [],
    "Melee",
  );
  assert.deepEqual([applied.attackDice, applied.attackSides, applied.attacks], [1, 6, 0]);
  assert.equal(applied.attacksModifier, 1);
  assert.equal(applied.strength, 8);
  assert.equal(applied.strengthModifier, 2);
  assert.deepEqual([applied.damageDice, applied.damageSides, applied.damage], [1, 3, 1]);
  assert.equal(applied.damageModifier, 1);
  assert.equal(combatPresetEffects([preset], "Ranged", "attacker").attacksModifier, 0);
});

test("one source roll remains shared across random characteristic modifiers", () => {
  const preset = {
    id: "shared-d3",
    weaponScope: "Any",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: ["attacks_modifier", "strength_modifier"].map((type) => ({
      type,
      value: 0,
      diceCount: 1,
      diceSides: 3,
      role: "attacker",
      subject: "self",
    })),
  };
  const applied = applyCombatPresets(
    {
      weaponName: "Psychic weapon",
      attacksModifier: 0,
      strengthModifier: 0,
      damageModifier: 0,
      ap: 0,
      criticalHits: 6,
      criticalWounds: 0,
      lethalHits: false,
      devastatingWounds: false,
      twinLinked: false,
      ignoresCover: false,
      lanceActive: false,
      heavyActive: false,
      sustainedHits: 0,
      sustainedHitsDice: 0,
      sustainedHitsSides: 0,
      rapidFire: 0,
      rapidFireDice: 0,
      rapidFireSides: 0,
      hitModifier: 0,
      woundModifier: 0,
      rerollHits: false,
      rerollHitOnes: false,
      rerollWounds: false,
      rerollWoundOnes: false,
      save: 7,
      invulnerable: 0,
      feelNoPain: 0,
      reduction: 0,
    },
    [preset],
    [],
    "Ranged",
  );
  assert.deepEqual(
    [
      applied.characteristicModifierDice,
      applied.characteristicModifierSides,
      applied.characteristicModifierBonus,
      applied.characteristicModifierAttacks,
      applied.characteristicModifierStrength,
      applied.characteristicModifierDamage,
      applied.characteristicModifierGroup,
    ],
    [1, 3, 0, true, true, false, "shared-d3"],
  );
  assert.equal(applied.attacksModifier, 0);
  assert.equal(applied.strengthModifier, 0);
});

test("fixed characteristic replacements and multipliers compose and respect scope", () => {
  const preset = {
    weaponScope: "Any",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      {
        type: "attacks_replacement",
        value: 12,
        diceCount: 0,
        diceSides: 0,
        weaponName: "Dead Man’s Hand",
        role: "attacker",
        subject: "self",
      },
      ...["attacks_multiplier", "strength_multiplier", "damage_multiplier"].map((type) => ({
        type,
        value: 2,
        diceCount: 0,
        diceSides: 0,
        weaponName: "Dead Man’s Hand",
        role: "attacker",
        subject: "self",
      })),
    ],
  };
  const base = {
    weaponName: "Dead Man’s Hand",
    attacksReplacement: 0,
    attacksMultiplier: 1,
    attacksModifier: -1,
    strengthMultiplier: 1,
    strengthModifier: 0,
    damageMultiplier: 1,
    damageModifier: 0,
    ap: 0,
    criticalHits: 6,
    criticalWounds: 0,
    lethalHits: false,
    devastatingWounds: false,
    twinLinked: false,
    ignoresCover: false,
    lanceActive: false,
    heavyActive: false,
    sustainedHits: 0,
    sustainedHitsDice: 0,
    sustainedHitsSides: 0,
    rapidFire: 0,
    rapidFireDice: 0,
    rapidFireSides: 0,
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    save: 7,
    invulnerable: 0,
    feelNoPain: 0,
    reduction: 0,
  };
  const applied = applyCombatPresets(base, [preset], [], "Melee");
  assert.equal(applied.attacksReplacement, 12);
  assert.deepEqual(
    [applied.attacksMultiplier, applied.strengthMultiplier, applied.damageMultiplier],
    [2, 2, 2],
  );
  assert.equal(combatPresetSupportsWeapon(preset, "Melee", "Dead Man's Hand"), true);
  assert.equal(combatPresetSupportsWeapon(preset, "Ranged", "Blood Song"), false);
  assert.equal(
    applyCombatPresets({ ...base, weaponName: "Blood Song" }, [preset], [], "Ranged")
      .attacksReplacement,
    0,
  );

  const characteristicPreset = {
    ...preset,
    effects: [
      {
        type: "strength_replacement",
        value: 9,
        diceCount: 0,
        diceSides: 0,
        role: "attacker",
        subject: "self",
      },
      {
        type: "damage_replacement",
        value: 0,
        diceCount: 0,
        diceSides: 0,
        role: "target",
        subject: "self",
      },
    ],
  };
  const replaced = applyCombatPresets(
    { ...base, strengthReplacement: 0, damageReplacement: null },
    [characteristicPreset],
    [characteristicPreset],
    "Melee",
  );
  assert.equal(replaced.strengthReplacement, 9);
  assert.equal(replaced.damageReplacement, 0);
});

test("automatic target-keyword presets apply only to eligible weapons and targets", () => {
  const psychicAssassin = {
    id: "culexus:psychic-assassin",
    activation: "automatic",
    weaponScope: "Any",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      {
        type: "attacks_replacement",
        value: 6,
        diceCount: 0,
        diceSides: 0,
        weaponName: "Animus speculum",
        requiredTargetKeyword: "psyker",
        role: "attacker",
        subject: "self",
      },
    ],
  };
  assert.equal(combatPresetRequiresActivation(psychicAssassin), false);
  assert.equal(combatPresetMeetsEligibility(psychicAssassin, ["Infantry", "PSYKER"]), true);
  assert.equal(combatPresetMeetsEligibility(psychicAssassin, ["Infantry"]), false);
  assert.deepEqual(
    selectedAndAutomaticCombatPresets([psychicAssassin], [], "Ranged", "Animus Speculum", [
      "psyker",
    ]),
    [psychicAssassin],
  );
  assert.deepEqual(
    selectedAndAutomaticCombatPresets([psychicAssassin], [], "Melee", "Life-draining touch", [
      "psyker",
    ]),
    [],
  );
  assert.deepEqual(
    selectedAndAutomaticCombatPresets([psychicAssassin], [], "Ranged", "Animus speculum", [
      "vehicle",
    ]),
    [],
  );
});

test("support auras require an eligible supported unit at a known in-range distance", () => {
  const taskmaster = {
    id: "knight-desecrator:taskmaster",
    sourceRelationship: "supporting_unit",
    maximumSupportDistance: 9,
    requiredSupportedKeywords: ["war dog"],
    weaponScope: "Ranged",
    rerollHitOnes: true,
    effects: [],
  };
  const eligible = (keywords, distance) =>
    combatPresetMeetsEligibility(
      taskmaster,
      [],
      [],
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      keywords,
      distance,
    );
  assert.equal(eligible(["Vehicle", "War Dog"], 9), true);
  assert.equal(eligible(["Vehicle", "War Dog"], 10), false);
  assert.equal(eligible(["Vehicle", "War Dog"], 0), false);
  assert.equal(eligible(["Vehicle"], 9), false);
});

test("Psychic-only defenses apply by attack keyword and reject incompatible volleys", () => {
  const abomination = {
    id: "culexus:abomination",
    activation: "automatic",
    weaponScope: "Any",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      {
        type: "feel_no_pain",
        value: 2,
        diceCount: 0,
        diceSides: 0,
        requiredAttackKeyword: "psychic",
        role: "target",
        subject: "self",
      },
    ],
  };
  const psychicKeywords = attackKeywordsForWeapon({
    type: "Ranged",
    abilities: [{ name: "psychic" }, { name: "precision" }],
  });
  assert.deepEqual(psychicKeywords, ["ranged", "psychic", "precision"]);
  assert.equal(combatPresetMeetsEligibility(abomination, [], psychicKeywords), true);
  assert.equal(combatPresetMeetsEligibility(abomination, [], ["ranged"]), false);
  assert.deepEqual(
    selectedAndAutomaticCombatPresets(
      [abomination],
      [],
      "Ranged",
      "Psychic weapon",
      [],
      psychicKeywords,
    ),
    [abomination],
  );
  const target = {
    save: 7,
    invulnerable: 0,
    feelNoPain: 0,
    reduction: 0,
    keywords: ["psyker"],
  };
  assert.equal(
    applyTargetCombatPresets(
      [target],
      [abomination],
      [{ weaponType: "Ranged", attackKeywords: psychicKeywords }],
    )[0].feelNoPain,
    2,
  );
  const selectedDefense = selectedAndAutomaticCombatPresets(
    [abomination],
    [],
    "Ranged",
    "Psychic weapon",
    [],
    psychicKeywords,
  );
  assert.equal(
    applyCombatPresets(target, [], selectedDefense, "Ranged", {
      attackKeywords: psychicKeywords,
    }).feelNoPain,
    2,
  );
  assert.equal(
    applyTargetCombatPresets(
      [target],
      [abomination],
      [{ weaponType: "Ranged", attackKeywords: ["ranged"] }],
    )[0].feelNoPain,
    0,
  );
  assert.throws(
    () =>
      applyTargetCombatPresets(
        [target],
        [abomination],
        [
          { weaponType: "Ranged", attackKeywords: psychicKeywords },
          { weaponType: "Ranged", attackKeywords: ["ranged"] },
        ],
      ),
    /different defensive eligibility/i,
  );
});

test("defensive presets compose editable profiles and every ordered target segment", () => {
  const preset = {
    weaponScope: "Any",
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    effects: [
      ...[
        ["save_target", 2],
        ["invulnerable_save", 4],
        ["feel_no_pain", 5],
        ["damage_reduction", 1],
        ["first_failed_save_damage_replacement", 0],
      ].map(([type, value]) => ({
        type,
        value,
        diceCount: 0,
        diceSides: 0,
        role: "target",
        subject: "self",
      })),
      {
        type: "allocated_attack_damage_replacement",
        value: 0,
        uses: 2,
        diceCount: 0,
        diceSides: 0,
        role: "target",
        subject: "self",
      },
    ],
  };
  const base = {
    save: 3,
    invulnerable: 0,
    feelNoPain: 0,
    reduction: 0,
    firstFailedSaveDamageReplacement: null,
    allocatedAttackDamageReplacement: 0,
    allocatedAttackDamageReplacementUses: 0,
    allocatedAttackDamageReplacementSkip: 3,
    hitModifier: 0,
    woundModifier: 0,
  };
  const applied = applyCombatPresets(base, [], [preset], "Ranged");
  assert.deepEqual(
    [
      applied.save,
      applied.invulnerable,
      applied.feelNoPain,
      applied.reduction,
      applied.firstFailedSaveDamageReplacement,
      applied.allocatedAttackDamageReplacement,
      applied.allocatedAttackDamageReplacementUses,
      applied.allocatedAttackDamageReplacementSkip,
    ],
    [2, 4, 5, 1, 0, 0, 2, 3],
  );
  const targets = applyTargetCombatPresets(
    [
      { ...base, modelCount: 2 },
      { ...base, save: 2, invulnerable: 3, feelNoPain: 6, reduction: 2, modelCount: 1 },
    ],
    [preset],
    ["Ranged", "Melee"],
  );
  assert.deepEqual(
    targets.map((target) => [
      target.save,
      target.invulnerable,
      target.feelNoPain,
      target.reduction,
      target.firstFailedSaveDamageReplacement,
      target.allocatedAttackDamageReplacement,
      target.allocatedAttackDamageReplacementUses,
      target.allocatedAttackDamageReplacementSkip,
    ]),
    [
      [2, 4, 5, 1, 0, 0, 2, 3],
      [2, 3, 5, 2, 0, 0, 2, 3],
    ],
  );
  const rangedOnly = { ...preset, weaponScope: "Ranged" };
  assert.throws(
    () => applyTargetCombatPresets([base], [rangedOnly], ["Ranged", "Melee"]),
    /different defensive eligibility/i,
  );
  const redundantRangedSave = {
    ...rangedOnly,
    effects: [rangedOnly.effects.find((effect) => effect.type === "invulnerable_save")],
  };
  assert.equal(
    applyTargetCombatPresets(
      [{ ...base, invulnerable: 3 }],
      [redundantRangedSave],
      ["Ranged", "Melee"],
    )[0].invulnerable,
    3,
  );
});

test("mutually exclusive ability modes replace the prior selection", () => {
  const presets = [
    { id: "unit:3", choiceGroup: "unit:3" },
    { id: "unit:3:2", choiceGroup: "unit:3" },
    { id: "unit:7", choiceGroup: null },
  ];
  assert.deepEqual(updateCombatPresetSelection(presets, ["unit:3", "unit:7"], "unit:3:2", true), [
    "unit:7",
    "unit:3:2",
  ]);
  assert.deepEqual(updateCombatPresetSelection(presets, ["unit:3:2"], "unit:3:2", false), []);
});

test("inherent defenses are native profile values rather than activation choices", () => {
  assert.equal(combatPresetRequiresActivation({ activation: "inherent" }), false);
  assert.equal(combatPresetRequiresActivation({ activation: "situational" }), true);
  assert.equal(combatPresetRequiresActivation({}), true);
});

test("source defaults scale with model count without discarding editable overrides", () => {
  const unit = {
    defaultWeapons: [
      {
        groupId: "unit:rifle",
        groupName: "Rifle",
        terms: [
          {
            fixed: 0,
            perModel: 1,
            perIncrement: 0,
            modelsPerIncrement: 1,
            quantity: 1,
            source: "Every model",
          },
        ],
      },
      {
        groupId: "unit:pistol",
        groupName: "Pistol",
        terms: [
          {
            fixed: 1,
            perModel: 0,
            perIncrement: 0,
            modelsPerIncrement: 1,
            quantity: 1,
            source: "This model",
          },
        ],
      },
    ],
  };
  assert.deepEqual(defaultWeaponCounts(unit, 5), { "unit:rifle": 5, "unit:pistol": 1 });
  assert.deepEqual(applyModelCountChange({ "unit:rifle": 7, "unit:pistol": 1 }, unit, 5, 10), {
    "unit:rifle": 12,
    "unit:pistol": 1,
  });
});

test("mixed-model defaults support fixed leaders and unit-size increments", () => {
  const unit = {
    defaultWeapons: [
      {
        groupId: "unit:lasgun",
        groupName: "Lasgun",
        terms: [
          {
            fixed: 0,
            perModel: 0,
            perIncrement: 9,
            modelsPerIncrement: 10,
            quantity: 1,
            source: "Every Shock Trooper",
          },
        ],
      },
      {
        groupId: "unit:choppa",
        groupName: "Choppa",
        terms: [
          {
            fixed: -1,
            perModel: 1,
            perIncrement: 0,
            modelsPerIncrement: 1,
            quantity: 1,
            source: "Every Boy",
          },
        ],
      },
    ],
  };
  assert.deepEqual(defaultWeaponCounts(unit, 10), { "unit:lasgun": 9, "unit:choppa": 9 });
  assert.deepEqual(defaultWeaponCounts(unit, 20), { "unit:lasgun": 18, "unit:choppa": 19 });
});

test("explicit model composition derives unresolved source loadouts", () => {
  const unit = {
    name: "Accursed Cultists",
    suggestedModelCount: 8,
    maximumModelCount: 16,
    defaultWeapons: [],
    weaponLimits: [],
    wargearChoicePools: [],
    weapons: [
      { groupId: "cultists:mutations", groupName: "Hideous mutations" },
      { groupId: "cultists:appendages", groupName: "Blasphemous appendages" },
    ],
    unresolvedLoadoutSubjects: [
      {
        id: "cultists:1",
        subject: "Every Torment",
        equipment: "hideous mutations",
        weapons: [{ groupId: "cultists:mutations", groupName: "Hideous mutations", quantity: 1 }],
      },
      {
        id: "cultists:2",
        subject: "Every Mutant",
        equipment: "blasphemous appendages",
        weapons: [
          {
            groupId: "cultists:appendages",
            groupName: "Blasphemous appendages",
            quantity: 1,
          },
        ],
      },
    ],
  };
  assert.deepEqual(defaultLoadoutSubjectCounts(unit), { "cultists:1": 0, "cultists:2": 0 });
  const composition = { "cultists:1": 3, "cultists:2": 5 };
  assert.deepEqual(loadoutSubjectWeaponCounts(unit, composition), {
    "cultists:mutations": 3,
    "cultists:appendages": 5,
  });
  assert.deepEqual(defaultWeaponCounts(unit, 8, composition), {
    "cultists:mutations": 3,
    "cultists:appendages": 5,
  });
  assert.deepEqual(
    applyLoadoutSubjectCountChange(
      { "cultists:mutations": 0, "cultists:appendages": 0 },
      unit.unresolvedLoadoutSubjects[0],
      0,
      3,
    ),
    { "cultists:mutations": 3, "cultists:appendages": 0 },
  );
  assert.deepEqual(
    unitLoadoutWarnings(
      unit,
      8,
      {},
      { "cultists:mutations": 3, "cultists:appendages": 5 },
      {},
      composition,
    ),
    [],
  );
  assert.match(
    unitLoadoutWarnings(
      unit,
      8,
      {},
      { "cultists:mutations": 9, "cultists:appendages": 0 },
      {},
      { "cultists:1": 9 },
    )[0],
    /exceeds the unit total/i,
  );
});

test("mixed target allocation never spills damage between models", () => {
  const targets = [
    { wounds: 1, modelCount: 1 },
    { wounds: 2, modelCount: 2 },
  ];
  const first = allocateDamageToSequence(0, 2, targets);
  assert.deepEqual(first, {
    applied: 1,
    appliedThisAttack: 1,
    wasted: 1,
    modelsDestroyed: 1,
    woundsRemaining: 2,
    segmentIndex: 1,
  });
  const partial = allocateDamageToSequence(2, 4, targets);
  assert.equal(partial.appliedThisAttack, 1);
  assert.equal(partial.wasted, 3);
  assert.equal(partial.modelsDestroyed, 2);
  assert.equal(targetSequencePosition(3, targets).woundsRemaining, 2);
});

function readUint64(pointer, lowIndex, highIndex) {
  const low = calculator.getValue(pointer + lowIndex * 4, "i32") >>> 0;
  const high = calculator.getValue(pointer + highIndex * 4, "i32") >>> 0;
  return (BigInt(high) << 32n) | BigInt(low);
}

test("parameterized agent profile reaches the C/Wasm exact engine unchanged", () => {
  const profile = parseAgentProfile(
    "attacks=1&hit=2&strength=4&ap=0&damage=1&toughness=4&save=7&wounds=10",
    {
      attackDice: 0,
      attackSides: 0,
      attacks: 1,
      attacksReplacement: 0,
      attacksModifier: 0,
      weaponCount: 1,
      hitOn: 4,
      strength: 4,
      strengthReplacement: 0,
      strengthModifier: 0,
      ap: 0,
      damageDice: 0,
      damageSides: 0,
      damage: 1,
      damageReplacement: null,
      damageModifier: 0,
      criticalHits: 6,
      toughness: 4,
      save: 3,
      invulnerable: 0,
      feelNoPain: 0,
      wounds: 1,
      targetModels: 1,
      reduction: 0,
      criticalWounds: 0,
      hitModifier: 0,
      woundModifier: 0,
      sustainedHitsDice: 0,
      sustainedHitsSides: 0,
      sustainedHits: 0,
      rapidFireDice: 0,
      rapidFireSides: 0,
      rapidFire: 0,
      melta: 0,
      withinHalfRange: false,
      torrent: false,
      blast: false,
      heavyActive: false,
      lanceActive: false,
      targetCover: false,
      ignoresCover: false,
      indirect: false,
      lethalHits: false,
      devastatingWounds: false,
      twinLinked: false,
      rerollHits: false,
      rerollHitOnes: false,
      rerollWounds: false,
      rerollWoundOnes: false,
    },
  );
  const output = calculator._malloc(72);
  try {
    const ok = calculateSummary(
      profile.attackDice,
      profile.attackSides,
      profile.attacks,
      profile.attacksReplacement,
      profile.weaponCount,
      profile.hitOn,
      profile.strength,
      profile.ap,
      profile.damageDice,
      profile.damageSides,
      profile.damage,
      profile.criticalHits,
      profile.toughness,
      profile.save,
      profile.invulnerable,
      profile.feelNoPain,
      profile.wounds,
      profile.reduction,
      0,
      profile.criticalWounds,
      profile.targetModels,
      profile.sustainedHitsDice,
      profile.sustainedHitsSides,
      profile.sustainedHits,
      profile.rapidFireDice,
      profile.rapidFireSides,
      profile.rapidFire,
      profile.melta,
      profile.hitModifier,
      profile.woundModifier,
      profile.attacksModifier,
      profile.strengthModifier,
      profile.damageModifier,
      profile.strengthReplacement,
      profile.damageReplacement ?? 0,
      profile.damageReplacement === null ? 0 : 1,
      profile.damageDivisor,
      output,
    );
    assert.equal(ok, 1);
    const expectedNumerator = readUint64(output, 5, 6);
    const expectedDenominator = readUint64(output, 7, 8);
    const appliedNumerator = readUint64(output, 14, 15);
    const appliedDenominator = readUint64(output, 16, 17);

    assert.deepEqual([expectedNumerator, expectedDenominator], [5n, 12n]);
    assert.ok(Math.abs(Number(appliedNumerator) / Number(appliedDenominator) - 5 / 12) < 1e-9);
  } finally {
    calculator._free(output);
  }
});

function interactionMeans(testCase) {
  const output = calculator._malloc(72);
  try {
    const ok = calculateSummary(
      0,
      0,
      testCase.attacks,
      0,
      1,
      testCase.hitOn,
      testCase.strength,
      testCase.ap,
      0,
      0,
      testCase.damage,
      testCase.criticalHits,
      testCase.toughness,
      testCase.save,
      testCase.invulnerable,
      testCase.feelNoPain,
      testCase.wounds,
      0,
      testCase.flags,
      testCase.criticalWounds,
      testCase.targetModels,
      0,
      0,
      testCase.sustainedHits,
      0,
      0,
      0,
      0,
      testCase.hitModifier,
      testCase.woundModifier,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      output,
    );
    assert.equal(ok, 1, testCase.name);
    return {
      expected: {
        numerator: readUint64(output, 5, 6),
        denominator: readUint64(output, 7, 8),
      },
      applied: {
        numerator: readUint64(output, 14, 15),
        denominator: readUint64(output, 16, 17),
      },
    };
  } finally {
    calculator._free(output);
  }
}

function exactMean({
  attacks = 4,
  attacksReplacement = 0,
  ap = 0,
  save = 3,
  invulnerable = 0,
  feelNoPain = 0,
  reduction = 0,
  damageDivisor = 1,
  flags = 0,
  sustainedHits = 0,
  hitModifier = 0,
  woundModifier = 0,
  hitOn = 3,
} = {}) {
  const output = calculator._malloc(72);
  try {
    const ok = calculateSummary(
      0,
      0,
      attacks,
      attacksReplacement,
      1,
      hitOn,
      10,
      ap,
      0,
      0,
      2,
      6,
      10,
      save,
      invulnerable,
      feelNoPain,
      12,
      reduction,
      flags,
      0,
      1,
      0,
      0,
      sustainedHits,
      0,
      0,
      0,
      0,
      hitModifier,
      woundModifier,
      0,
      0,
      0,
      0,
      0,
      0,
      damageDivisor,
      output,
    );
    assert.equal(ok, 1);
    return {
      numerator: readUint64(output, 5, 6),
      denominator: readUint64(output, 7, 8),
    };
  } finally {
    calculator._free(output);
  }
}

function lessThanOrEqual(left, right) {
  return left.numerator * right.denominator <= right.numerator * left.denominator;
}

function currentWeaponInput(weapon) {
  if (weapon.length === 37) return weapon;
  if (weapon.length === 36) return [...weapon, 0];
  if (weapon.length === 32) return [...weapon, 0, 0, 0, 0, 0];
  if (weapon.length === 29) return [...weapon, 1, 1, 1, 0, 0, 0, 0, 0];
  if (weapon.length === 26) return [...weapon, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0];
  const withReplacement = [...weapon.slice(0, 3), 0, ...weapon.slice(3)];
  const current = withReplacement.length === 26 ? withReplacement : [...withReplacement, 0, 0, 0];
  return [...current, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0];
}

function currentTargetInput(target) {
  if (target.length === 14) return target;
  if (target.length === 13) return [...target, 0];
  if (target.length === 10) return [...target, 0, 0, 0, 0];
  const current = target.length === 8 ? target : [...target, 1];
  return [...current, 0, 0, 0, 0, 0, 0];
}

function orderedVolley(weapons, targets, initialWoundsLost = 0) {
  const weaponFields = 37;
  const targetFields = 14;
  const weaponsPointer = calculator._malloc(weapons.length * weaponFields * 4);
  const targetsPointer = calculator._malloc(targets.length * targetFields * 4);
  const summaryPointer = calculator._malloc(10 * 4);
  const meansPointer = calculator._malloc(weapons.length * 4 * 4);
  const write = (pointer, values) =>
    values.forEach((value, index) => calculator.setValue(pointer + index * 4, value, "i32"));
  try {
    weapons.forEach((weapon, index) =>
      write(weaponsPointer + index * weaponFields * 4, currentWeaponInput(weapon)),
    );
    targets.forEach((target, index) =>
      write(targetsPointer + index * targetFields * 4, currentTargetInput(target)),
    );
    assert.equal(
      calculator._whc_calculate_ordered_volley_summary(
        weaponsPointer,
        weapons.length,
        targetsPointer,
        targets.length,
        initialWoundsLost,
        summaryPointer,
        meansPointer,
      ),
      1,
    );
    const fraction = (pointer) => ({
      numerator: readUint64(pointer, 0, 1),
      denominator: readUint64(pointer, 2, 3),
    });
    return {
      minimum: calculator.getValue(summaryPointer, "i32") >>> 0,
      maximum: calculator.getValue(summaryPointer + 16, "i32") >>> 0,
      mean: fraction(summaryPointer + 20),
      peakSparseStates: calculator.getValue(summaryPointer + 36, "i32") >>> 0,
      cumulative: weapons.map((_, index) => fraction(meansPointer + index * 16)),
    };
  } finally {
    calculator._free(weaponsPointer);
    calculator._free(targetsPointer);
    calculator._free(summaryPointer);
    calculator._free(meansPointer);
  }
}

function orderedVolleyComplexity(weapons, targets, initialWoundsLost = 0) {
  const weaponFields = 37;
  const targetFields = 14;
  const weaponsPointer = calculator._malloc(weapons.length * weaponFields * 4);
  const targetsPointer = calculator._malloc(targets.length * targetFields * 4);
  const outputPointer = calculator._malloc(24);
  const write = (pointer, values) =>
    values.forEach((value, index) => calculator.setValue(pointer + index * 4, value, "i32"));
  try {
    weapons.forEach((weapon, index) =>
      write(weaponsPointer + index * weaponFields * 4, currentWeaponInput(weapon)),
    );
    targets.forEach((target, index) =>
      write(targetsPointer + index * targetFields * 4, currentTargetInput(target)),
    );
    assert.equal(
      calculator._whc_estimate_ordered_volley_complexity(
        weaponsPointer,
        weapons.length,
        targetsPointer,
        targets.length,
        initialWoundsLost,
        outputPointer,
      ),
      1,
    );
    return Array.from(
      { length: 6 },
      (_, index) => calculator.getValue(outputPointer + index * 4, "i32") >>> 0,
    );
  } finally {
    calculator._free(weaponsPointer);
    calculator._free(targetsPointer);
    calculator._free(outputPointer);
  }
}

test("C/Wasm reports conservative deferred-state complexity before exact volleys", () => {
  const devastating = [0, 0, 1, 1, 2, 10, 6, 0, 0, 2, 6, 2 | 16, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const ordinary = [0, 0, 1, 1, 2, 10, 6, 0, 0, 3, 6, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.deepEqual(
    orderedVolleyComplexity([devastating, ordinary], [[1, 7, 0, 0, 3, 0, 2]]),
    [112, 2047, 2, 6, 1, 1],
  );
  devastating[2] = 20;
  const high = orderedVolleyComplexity([devastating, ordinary], [[1, 7, 0, 0, 3, 0, 2]]);
  assert.ok(high[0] > high[1]);
  assert.equal(high[5], 0);

  const prefixOrdinary = [...ordinary];
  prefixOrdinary[2] = 8;
  prefixOrdinary[9] = 1;
  devastating[2] = 1;
  const tightened = orderedVolleyComplexity([prefixOrdinary, devastating], [[1, 7, 0, 0, 3, 0, 2]]);
  assert.deepEqual(tightened, [1134, 2047, 9, 6, 1, 1]);
  assert.ok(tightened[0] < 2268);
  const exact = orderedVolley([prefixOrdinary, devastating], [[1, 7, 0, 0, 3, 0, 2]]);
  assert.equal(exact.peakSparseStates, 13);
  assert.ok(exact.peakSparseStates <= tightened[0]);
});

test("C/Wasm consumes first-failed-save Damage replacement exactly once", () => {
  const weapon = Array(37).fill(0);
  weapon[2] = 2;
  weapon[4] = 1;
  weapon[5] = 2;
  weapon[6] = 10;
  weapon[10] = 3;
  weapon[11] = 6;
  weapon[12] = 16;
  weapon[29] = 1;
  weapon[30] = 1;
  weapon[31] = 1;
  const protectedTarget = [1, 7, 0, 0, 20, 0, 1, 1, 0, 1];
  const unprotectedTarget = [1, 7, 0, 0, 20, 0, 1, 1, 0, 0];

  const protectedResult = orderedVolley([weapon], [protectedTarget]);
  const unprotectedResult = orderedVolley([weapon], [unprotectedTarget]);
  assert.equal(protectedResult.maximum, 3);
  assert.equal(unprotectedResult.maximum, 6);
  assert.ok(
    Math.abs(
      Number(protectedResult.mean.numerator) / Number(protectedResult.mean.denominator) - 25 / 12,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(
      Number(unprotectedResult.mean.numerator) / Number(unprotectedResult.mean.denominator) - 5,
    ) < 1e-8,
  );
  assert.equal(orderedVolleyComplexity([weapon], [protectedTarget])[4], 1);

  weapon[12] = 16 | 2;
  const devastating = orderedVolley([weapon], [protectedTarget]);
  assert.ok(
    Math.abs(Number(devastating.mean.numerator) / Number(devastating.mean.denominator) - 7 / 3) <
      1e-8,
  );
});

test("C/Wasm applies deterministic allocated-attack Damage replacement", () => {
  const weapon = Array(37).fill(0);
  weapon[2] = 2;
  weapon[4] = 1;
  weapon[5] = 6;
  weapon[6] = 2;
  weapon[10] = 3;
  weapon[11] = 6;
  weapon[29] = 1;
  weapon[30] = 1;
  weapon[31] = 1;
  const target = [1, 7, 0, 0, 20, 0, 1, 1, 0, 0, 0, 1, 0];
  const result = orderedVolley([weapon], [target]);
  assert.equal(result.maximum, 3);
  assert.ok(
    Math.abs(Number(result.mean.numerator) / Number(result.mean.denominator) - 5 / 12) < 1e-8,
  );
  assert.equal(orderedVolleyComplexity([weapon], [target])[4], 1);

  const first = [...weapon];
  first[2] = 1;
  first[5] = 2;
  first[10] = 1;
  first[12] = 16;
  const second = [...first];
  second[10] = 5;
  const skipFirst = [1, 7, 0, 0, 20, 0, 1, 1, 0, 0, 0, 1, 0];
  const skipSecond = [1, 7, 0, 0, 20, 0, 1, 1, 0, 0, 0, 1, 1];
  const firstProtected = orderedVolley([first, second], [skipFirst]).mean;
  const secondProtected = orderedVolley([first, second], [skipSecond]).mean;
  assert.ok(
    Math.abs(Number(firstProtected.numerator) / Number(firstProtected.denominator) - 25 / 6) < 1e-8,
  );
  assert.ok(
    Math.abs(Number(secondProtected.numerator) / Number(secondProtected.denominator) - 5 / 6) <
      1e-8,
  );

  const sustained = [...weapon];
  sustained[2] = 1;
  sustained[11] = 6;
  sustained[16] = 1;
  assert.equal(orderedVolley([sustained], [target]).maximum, 0);
  const devastating = [...first];
  devastating[12] = 16 | 2;
  assert.equal(orderedVolley([devastating], [target]).maximum, 0);
});

function variableRuleMean({ flags = 0, sustained = [0, 0, 0], rapid = [0, 0, 0] }) {
  const output = calculator._malloc(72);
  try {
    const ok = calculateSummary(
      0,
      0,
      1,
      0,
      1,
      6,
      2,
      0,
      0,
      0,
      1,
      6,
      1,
      7,
      0,
      0,
      10,
      0,
      flags,
      0,
      1,
      ...sustained,
      ...rapid,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      output,
    );
    assert.equal(ok, 1);
    return {
      numerator: readUint64(output, 5, 6),
      denominator: readUint64(output, 7, 8),
    };
  } finally {
    calculator._free(output);
  }
}

test("C/Wasm preserves variable Sustained Hits and Rapid Fire values", () => {
  assert.deepEqual(abilityDiceValue({ value: "d3" }), { count: 1, sides: 3, modifier: 0 });
  assert.deepEqual(abilityDiceValue({ value: "D6+3" }), { count: 1, sides: 6, modifier: 3 });
  assert.deepEqual(variableRuleMean({ sustained: [1, 3, 0] }), {
    numerator: 5n,
    denominator: 12n,
  });
  assert.deepEqual(variableRuleMean({ flags: 16 | 256, rapid: [1, 3, 0] }), {
    numerator: 5n,
    denominator: 2n,
  });
});

test("unit loadouts group mutually exclusive profiles and allocate equipped copies", () => {
  const weapons = [
    {
      id: 1,
      name: "Plasma pistol – standard",
      groupId: "unit:7",
      groupName: "Plasma pistol",
      profileIndex: 1,
    },
    {
      id: 2,
      name: "Plasma pistol – supercharge",
      groupId: "unit:7",
      groupName: "Plasma pistol",
      profileIndex: 2,
    },
    {
      id: 3,
      name: "Boltgun",
      groupId: "unit:8",
      groupName: "Boltgun",
      profileIndex: 1,
    },
  ];
  const groups = groupWeaponProfiles(weapons);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].profiles.length, 2);
  assert.deepEqual(armyListWeaponsFromGroups(groups), [
    { weaponId: 1, groupId: "unit:7", name: "Plasma pistol", count: 0, optionCount: 0 },
    { weaponId: 3, groupId: "unit:8", name: "Boltgun", count: 0, optionCount: 0 },
  ]);
  assert.deepEqual(equippedWeaponLines(groups, { "unit:7": 5, "unit:8": 7 }, { 1: 3, 2: 2 }), [
    { weapon: weapons[0], count: 3 },
    { weapon: weapons[1], count: 2 },
    { weapon: weapons[2], count: 7 },
  ]);
  assert.deepEqual(weaponAllocationErrors(groups, { "unit:7": 5 }, { 1: 4, 2: 2 }), [
    "Plasma pistol allocates 6 profiles across 5 equipped copies",
  ]);
  assert.deepEqual(weaponAllocationErrors(groups, { "unit:7": 5 }, {}), [
    "Choose firing profiles for Plasma pistol",
  ]);
  assert.equal(normalizeEquippedCount(2.9), 2);
  assert.equal(normalizeEquippedCount(-1), 0);
  assert.equal(normalizeEquippedCount(Number.NaN), 0);
});

test("source-backed loadout limits scale with unit size and remain overridable warnings", () => {
  const unit = {
    name: "Assault Squad",
    suggestedModelCount: 5,
    maximumModelCount: 10,
    weaponLimits: [
      {
        groupId: "assault:eviscerator",
        groupName: "Eviscerator",
        terms: [
          {
            fixed: 0,
            perIncrement: 1,
            modelsPerIncrement: 5,
            quantity: 1,
            source: "For every 5 models in this unit, 1 model can take an eviscerator.",
          },
        ],
      },
    ],
  };
  assert.equal(weaponLimitMaximum(unit.weaponLimits[0], 4), 0);
  assert.equal(weaponLimitMaximum(unit.weaponLimits[0], 5), 1);
  assert.equal(weaponLimitMaximum(unit.weaponLimits[0], 10), 2);
  assert.deepEqual(
    unitLoadoutWarnings(unit, 10, { "assault:eviscerator": 2 }, { "assault:eviscerator": 2 }),
    [],
  );
  assert.match(
    unitLoadoutWarnings(unit, 5, { "assault:eviscerator": 2 }, { "assault:eviscerator": 2 })[0],
    /2 option-selected copies exceeds.*limit of 1/i,
  );
  assert.match(unitLoadoutWarnings(unit, 3, {}, {})[0], /may represent battlefield casualties/i);
  assert.match(unitLoadoutWarnings(unit, 11, {}, {})[0], /at most 10 models/i);
  assert.match(
    unitLoadoutWarnings(unit, 10, { "assault:eviscerator": 2 }, { "assault:eviscerator": 1 })[0],
    /exceeds 1 total equipped/i,
  );
});

test("discrete published starting sizes remain distinct from casualty counts", () => {
  const unit = {
    name: "Cadian Shock Troops",
    startingSizeRanges: [
      { minimum: 10, maximum: 10, source: "1 Sergeant and 9 Troopers" },
      { minimum: 20, maximum: 20, source: "2 Sergeants and 18 Troopers" },
    ],
    suggestedModelCount: 10,
    maximumModelCount: 20,
    weaponLimits: [],
  };
  assert.equal(startingSizeRangeLabel(unit.startingSizeRanges), "10 or 20");
  assert.equal(unitStartingSizeWarning(unit, 10), null);
  assert.equal(unitStartingSizeWarning(unit, 20), null);
  assert.deepEqual(unitStartingSizeStatus(unit, 15), {
    legal: false,
    interpretation: "possible_casualties",
    maximum: 20,
  });
  assert.match(unitStartingSizeWarning(unit, 15), /not a legal starting size.*casualties/i);
  assert.match(unitLoadoutWarnings(unit, 15)[0], /starting sizes are 10 or 20/i);
  assert.match(unitStartingSizeWarning(unit, 21), /at most 20 models/i);
  assert.deepEqual(unitStartingSizeStatus(unit, 21), {
    legal: false,
    interpretation: "above_maximum",
    maximum: 20,
  });
  assert.equal(
    unitStartingSizeWarning(
      { ...unit, startingSizeRanges: [{ minimum: 10, maximum: 20, source: "10-20" }] },
      15,
    ),
    null,
  );
});

test("C/Wasm carries ordered damage across partial wounds and mixed target profiles", () => {
  const light = [0, 0, 1, 1, 2, 10, 0, 0, 0, 1, 6, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const heavy = [0, 0, 1, 1, 2, 10, 6, 0, 0, 2, 6, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const mixedTargets = [
    [1, 7, 0, 0, 1, 0, 1],
    [1, 2, 0, 0, 2, 0, 1],
  ];
  const forward = orderedVolley([light, heavy], mixedTargets);
  const reverse = orderedVolley([heavy, light], mixedTargets);
  assert.equal(forward.maximum, 3);
  assert.equal(reverse.maximum, 2);
  assert.ok(
    forward.mean.numerator * reverse.mean.denominator >
      reverse.mean.numerator * forward.mean.denominator,
  );
  assert.ok(
    forward.cumulative[1].numerator * forward.cumulative[0].denominator >=
      forward.cumulative[0].numerator * forward.cumulative[1].denominator,
  );

  const partial = orderedVolley([heavy], [[1, 7, 0, 0, 2, 0, 2]], 1);
  assert.equal(partial.maximum, 1);
});

test("C/Wasm applies Benefit of Cover per allocated target model", () => {
  const weapon = Array(37).fill(0);
  weapon[2] = 1;
  weapon[4] = 1;
  weapon[5] = 2;
  weapon[6] = 10;
  weapon[7] = 1;
  weapon[10] = 1;
  weapon[11] = 6;
  weapon[12] = 16;
  weapon[29] = 1;
  weapon[30] = 1;
  weapon[31] = 1;
  const withoutCover = [1, 3, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0];
  const withCover = [1, 3, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, 1];
  const plain = orderedVolley([weapon], [withoutCover]);
  const covered = orderedVolley([weapon], [withCover]);
  assert.ok(
    covered.mean.numerator * plain.mean.denominator <
      plain.mean.numerator * covered.mean.denominator,
  );
});

test("C/Wasm shares one characteristic roll across grouped ordered weapon profiles", () => {
  const weapon = [
    0, 0, 1, 0, 1, 2, 3, 0, 0, 0, 1, 6, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
    1, 3, 0, 3, 42,
  ];
  const grouped = orderedVolley([weapon, weapon], [[5, 7, 0, 0, 2, 0, 1, 1]]);
  const independentWeapon = [...weapon];
  independentWeapon[36] = 43;
  const independent = orderedVolley([weapon, independentWeapon], [[5, 7, 0, 0, 2, 0, 1, 1]]);
  assert.notEqual(
    grouped.mean.numerator * independent.mean.denominator,
    independent.mean.numerator * grouped.mean.denominator,
  );
});

test("JavaScript and C agree on wound thresholds", () => {
  for (let strength = 1; strength <= 24; strength += 1) {
    for (let toughness = 1; toughness <= 24; toughness += 1) {
      assert.equal(calculator._wounds_on(strength, toughness), woundTarget(strength, toughness));
    }
  }
});

test("JavaScript and C agree on capped Hit and Wound modifiers", () => {
  for (let succeedsOn = 2; succeedsOn <= 6; succeedsOn += 1) {
    for (let modifier = -10; modifier <= 10; modifier += 1) {
      assert.equal(
        calculator._modified_roll_threshold(succeedsOn, modifier),
        modifiedRollTarget(succeedsOn, modifier),
      );
    }
  }
});

test("C/Wasm matches the shared 10th-edition rules interaction corpus", () => {
  for (const testCase of rulesInteractionCases) {
    const actual = interactionMeans(testCase);
    assert.deepEqual(actual.expected, testCase.expected, testCase.name);
    assert.ok(
      Math.abs(
        Number(actual.applied.numerator) / Number(actual.applied.denominator) -
          Number(testCase.applied.numerator) / Number(testCase.applied.denominator),
      ) < 1e-8,
      testCase.name,
    );
  }
});

test("exact re-roll and modifier interactions match hand-derived probabilities", () => {
  assert.deepEqual(exactMean({ save: 7 }), { numerator: 8n, denominator: 3n });
  assert.deepEqual(exactMean({ save: 7, flags: 8192 }), {
    numerator: 28n,
    denominator: 9n,
  });
  assert.deepEqual(exactMean({ save: 7, flags: 32768 }), {
    numerator: 28n,
    denominator: 9n,
  });
  assert.deepEqual(exactMean({ save: 7, flags: 8192 | 32768 }), {
    numerator: 98n,
    denominator: 27n,
  });
  assert.deepEqual(exactMean({ save: 7, flags: 8 | 16384 }), {
    numerator: 16n,
    denominator: 3n,
  });
  assert.deepEqual(exactMean({ save: 7, hitModifier: 8, woundModifier: 8 }), {
    numerator: 40n,
    denominator: 9n,
  });
  assert.deepEqual(exactMean({ save: 7, hitModifier: -8, woundModifier: -8 }), {
    numerator: 4n,
    denominator: 3n,
  });
  assert.deepEqual(exactMean({ save: 7, flags: 32, hitModifier: -1 }), {
    numerator: 8n,
    denominator: 3n,
  });
});

test("JavaScript and C agree on armour, invulnerable, AP, and cover thresholds", () => {
  for (let save = 2; save <= 7; save += 1) {
    for (const invulnerable of [0, 2, 3, 4, 5, 6]) {
      for (let ap = 0; ap <= 12; ap += 1) {
        assert.equal(
          calculator._saves_on(save, invulnerable, ap),
          savingThrowTarget(save, invulnerable, ap),
        );
        assert.equal(
          calculator._saves_on_with_cover(save, invulnerable, ap),
          savingThrowTarget(save, invulnerable, ap, true),
        );
      }
    }
  }
});

test("JavaScript and C agree on model-by-model damage allocation", () => {
  for (let wounds = 1; wounds <= 10; wounds += 1) {
    for (let models = 1; models <= 10; models += 1) {
      const capacity = wounds * models;
      for (let applied = 0; applied <= capacity; applied += 1) {
        for (let incoming = 0; incoming <= 20; incoming += 1) {
          assert.equal(
            calculator._allocate_damage_to_unit(applied, incoming, wounds, models),
            allocateDamageToUnit(applied, incoming, wounds, models).applied,
          );
        }
      }
    }
  }
});

test("JavaScript and C agree on hit rolls that always fail", () => {
  for (let face = 1; face <= 6; face += 1) {
    for (let succeedsOn = 2; succeedsOn <= 7; succeedsOn += 1) {
      for (let criticalOn = 0; criticalOn <= 6; criticalOn += 1) {
        for (let autoFailsThrough = 0; autoFailsThrough <= 3; autoFailsThrough += 1) {
          assert.equal(
            calculator._attack_roll_succeeds(face, succeedsOn, criticalOn, autoFailsThrough),
            Number(attackRollSucceeds(face, succeedsOn, criticalOn, autoFailsThrough)),
          );
        }
      }
    }
  }
});

test("AP and weaker armour cannot reduce exact expected damage", () => {
  let previous = exactMean({ ap: 0, save: 2 });
  for (let ap = 1; ap <= 6; ap += 1) {
    const current = exactMean({ ap, save: 2 });
    assert.ok(lessThanOrEqual(previous, current));
    previous = current;
  }

  previous = exactMean({ ap: 2, save: 2 });
  for (let save = 3; save <= 7; save += 1) {
    const current = exactMean({ ap: 2, save });
    assert.ok(lessThanOrEqual(previous, current));
    previous = current;
  }
});

test("defensive rules cannot increase exact expected damage", () => {
  const baseline = exactMean({ ap: 3, save: 2 });
  const invulnerable = exactMean({ ap: 3, save: 2, invulnerable: 4 });
  const feelNoPain = exactMean({ ap: 3, save: 2, feelNoPain: 5 });
  const cover = exactMean({ ap: 3, save: 2, flags: 1024 });

  assert.ok(lessThanOrEqual(invulnerable, baseline));
  assert.ok(lessThanOrEqual(feelNoPain, baseline));
  assert.ok(lessThanOrEqual(cover, baseline));
});

test("source-backed Oath states improve exact C/Wasm damage only at their own boundaries", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const intercessors = catalogue.units.find((unit) => unit.name === "Intercessor Squad");
  const weapon = intercessors.weapons.find((entry) => entry.type === "Ranged");
  const selected = (targetOathOfMoment, woundBonusEligible) =>
    selectedAndAutomaticCombatPresets(
      intercessors.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      targetOathOfMoment,
      woundBonusEligible,
    );
  const inactive = applyCombatPresets({}, selected(false, false), [], weapon.type);
  const hitOnly = applyCombatPresets(
    { targetOathOfMoment: true },
    selected(true, false),
    [],
    weapon.type,
  );
  const full = applyCombatPresets(
    { targetOathOfMoment: true, attackerOathWoundBonusEligible: true },
    selected(true, true),
    [],
    weapon.type,
  );
  assert.equal(inactive.rerollHits, false);
  assert.equal(hitOnly.rerollHits, true);
  assert.equal(hitOnly.woundModifier, 0);
  assert.equal(full.rerollHits, true);
  assert.equal(full.woundModifier, 1);
  const baselineDamage = exactMean();
  const hitOnlyDamage = exactMean({ flags: hitOnly.rerollHits ? 8 : 0 });
  const fullDamage = exactMean({
    flags: full.rerollHits ? 8 : 0,
    woundModifier: full.woundModifier,
  });
  assert.ok(lessThanOrEqual(baselineDamage, hitOnlyDamage));
  assert.ok(lessThanOrEqual(hitOnlyDamage, fullDamage));
});

test("source-backed objective position upgrades the exact C/Wasm re-roll boundary", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const breachers = catalogue.units.find((unit) => unit.name === "Imperial Navy Breachers");
  const weapon = breachers.weapons.find((entry) => entry.type === "Ranged");
  const selected = (targetOnObjective) =>
    selectedAndAutomaticCombatPresets(
      breachers.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      false,
      false,
      false,
      targetOnObjective,
    );
  const baseline = applyCombatPresets({}, selected(false), [], weapon.type);
  const objective = applyCombatPresets(
    { targetOnObjective: true },
    selected(true),
    [],
    weapon.type,
    { targetOnObjective: true },
  );
  assert.equal(baseline.rerollWoundOnes, true);
  assert.equal(baseline.rerollWounds, false);
  assert.equal(objective.rerollWounds, true);
  assert.equal(objective.rerollWoundOnes, false);
  const baselineDamage = exactMean({ flags: 32768 });
  const objectiveDamage = exactMean({ flags: 16384 });
  assert.ok(lessThanOrEqual(baselineDamage, objectiveDamage));
});

test("source-backed objective ownership upgrades the exact C/Wasm re-roll boundary", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const russ = catalogue.units.find((unit) => unit.name === "Leman Russ Battle Tank");
  const weapon = russ.weapons.find((entry) => entry.type === "Ranged");
  const selected = (targetNotControlledBySource) =>
    selectedAndAutomaticCombatPresets(
      russ.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      targetNotControlledBySource,
    ).filter((preset) => preset.name.startsWith("Armoured Spearhead —"));
  const unknown = applyCombatPresets(
    { targetOnObjective: true, targetObjectiveOwner: "unknown" },
    selected(false),
    [],
    weapon.type,
  );
  const opponent = applyCombatPresets(
    { targetOnObjective: true, targetObjectiveOwner: "target" },
    selected(true),
    [],
    weapon.type,
  );
  assert.equal(unknown.rerollHitOnes, true);
  assert.equal(unknown.rerollHits, false);
  assert.equal(opponent.rerollHits, true);
  assert.equal(opponent.rerollHitOnes, false);
  assert.ok(lessThanOrEqual(exactMean({ flags: 8192 }), exactMean({ flags: 8 })));
});

test("source-backed selected objective activates the exact C/Wasm re-roll boundary", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const lieutenant = catalogue.units.find((unit) => unit.name === "Lieutenant With Combi-weapon");
  const weapon = lieutenant.weapons.find((entry) => entry.type === "Ranged");
  const selected = (targetOnSelectedObjective) =>
    selectedAndAutomaticCombatPresets(
      lieutenant.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      targetOnSelectedObjective,
    );
  const inactive = applyCombatPresets({}, selected(false), [], weapon.type);
  const active = applyCombatPresets(
    { targetOnAttackerSelectedObjective: true },
    selected(true),
    [],
    weapon.type,
  );
  assert.equal(inactive.rerollWoundOnes, false);
  assert.equal(active.rerollWoundOnes, true);
  assert.ok(lessThanOrEqual(exactMean(), exactMean({ flags: 32768 })));
});

test("source-backed Guided and Markerlight state composes exact C/Wasm hit and cover inputs", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const breachers = catalogue.units.find((unit) => unit.name === "Breacher Team");
  const weapon = breachers.weapons.find((entry) => entry.name === "Pulse blaster");
  const selected = (guided, spotted, markerlight) =>
    selectedAndAutomaticCombatPresets(
      breachers.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      guided,
      spotted,
      markerlight,
    );
  const base = {
    weaponName: weapon.name,
    hitOn: 4,
    ap: 1,
    targetCover: true,
    ignoresCover: false,
  };
  const inactive = applyCombatPresets(
    { ...base, targetSpotted: true, targetSpottedByMarkerlightObserver: true },
    selected(false, true, true),
    [],
    "Ranged",
  );
  const guided = applyCombatPresets(
    { ...base, attackerGuidedAgainstTarget: true, targetSpotted: true },
    selected(true, true, false),
    [],
    "Ranged",
  );
  const markerlight = applyCombatPresets(
    {
      ...base,
      attackerGuidedAgainstTarget: true,
      targetSpotted: true,
      targetSpottedByMarkerlightObserver: true,
    },
    selected(true, true, true),
    [],
    "Ranged",
  );
  assert.equal(inactive.hitOn, 4);
  assert.equal(inactive.ignoresCover, false);
  assert.equal(guided.hitOn, 3);
  assert.equal(guided.ignoresCover, false);
  assert.equal(markerlight.hitOn, 3);
  assert.equal(markerlight.ignoresCover, true);
  assert.ok(lessThanOrEqual(exactMean({ hitOn: 4 }), exactMean({ hitOn: 3 })));
  assert.deepEqual(
    exactMean({ hitOn: 3, ap: 1, save: 3, flags: 1024 | 2048 }),
    exactMean({ hitOn: 3, ap: 1, save: 3 }),
  );
  assert.ok(
    lessThanOrEqual(
      exactMean({ hitOn: 3, ap: 1, save: 3, flags: 1024 }),
      exactMean({ hitOn: 3, ap: 1, save: 3, flags: 1024 | 2048 }),
    ),
  );

  const stealth = catalogue.units.find((unit) => unit.name === "Stealth Battlesuits");
  const forwardObservers = stealth.combatPresets.find(
    (preset) => preset.name === "Forward Observers",
  );
  const supported = (isGuided, isSpotted, relationship = "supporting_unit") =>
    selectedAndAutomaticCombatPresets(
      stealth.combatPresets,
      [forwardObservers.id],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      isGuided,
      isSpotted,
      false,
      relationship,
    );
  assert.equal(
    supported(true, true, "self").some((preset) => preset.name === "Forward Observers"),
    false,
  );
  assert.deepEqual(supported(false, true), []);
  assert.deepEqual(supported(true, false), []);
  const observerEffects = supported(true, true);
  assert.deepEqual(
    observerEffects.map((preset) => preset.name),
    ["Forward Observers"],
  );
  const observerProfile = applyCombatPresets(base, observerEffects, [], "Ranged", {
    attackerGuidedAgainstTarget: true,
    targetSpotted: true,
  });
  assert.equal(observerProfile.rerollHitOnes, true);
  assert.equal(observerProfile.rerollWoundOnes, true);
  assert.ok(lessThanOrEqual(exactMean({ hitOn: 4 }), exactMean({ hitOn: 4, flags: 8192 | 32768 })));
});

test("source-backed target distance changes preset composition at its exact boundary", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const warbikers = catalogue.units.find((unit) => unit.name === "Warbikers");
  const driveBy = warbikers.combatPresets.find((preset) => preset.name === "Drive-by Dakka");
  const base = { weaponName: "Twin dakkagun", ap: 0, targetDistance: 0 };
  assert.equal(applyCombatPresets(base, [driveBy], [], "Ranged").ap, 0);
  assert.equal(applyCombatPresets({ ...base, targetDistance: 9 }, [driveBy], [], "Ranged").ap, 1);
  assert.equal(applyCombatPresets({ ...base, targetDistance: 10 }, [driveBy], [], "Ranged").ap, 0);
});

test("targeted vehicle support reaches C/Wasm only for the selected eligible nearby unit", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const techmarine = catalogue.units.find((unit) => unit.name === "Techmarine");
  const repulsor = catalogue.units.find((unit) => unit.name === "Repulsor");
  const blessing = techmarine.combatPresets.find(
    (preset) => preset.name === "Blessing of the Omnissiah",
  );
  const weapon = repulsor.weapons.find((entry) => entry.type === "Ranged");
  const selected = (keywords, distance, relationship = "supporting_unit") =>
    selectedAndAutomaticCombatPresets(
      techmarine.combatPresets,
      [blessing.id],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      relationship,
      keywords,
      distance,
    );
  assert.deepEqual(selected(repulsor.models[0].keywords, 0), []);
  assert.deepEqual(selected(repulsor.models[0].keywords, 4), []);
  assert.deepEqual(selected(["adeptus astartes", "infantry"], 3), []);
  assert.deepEqual(selected(repulsor.models[0].keywords, 3, "self"), []);
  const active = selected(repulsor.models[0].keywords, 3);
  assert.deepEqual(
    active.map((preset) => preset.name),
    ["Blessing of the Omnissiah"],
  );
  const profile = applyCombatPresets(
    { weaponName: weapon.name, hitOn: 4, hitModifier: 0, supportDistance: 3 },
    active,
    [],
    "Ranged",
    {
      supportDistance: 3,
      supportedUnitKeywords: repulsor.models[0].keywords,
    },
  );
  assert.equal(profile.hitModifier, 1);
  assert.ok(lessThanOrEqual(exactMean({ hitOn: 4 }), exactMean({ hitOn: 4, hitModifier: 1 })));
});

test("Mechanical Augmentation independently protects a supported Necrons Battleline target", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const illuminor = catalogue.units.find((unit) => unit.name === "Illuminor Szeras");
  const warriors = catalogue.units.find((unit) => unit.name === "Necron Warriors");
  const augmentation = illuminor.combatPresets.find(
    (preset) => preset.name === "Mechanical Augmentation (Aura)",
  );
  const weapon = catalogue.units
    .find((unit) => unit.name === "Doom Scythe")
    .weapons.find((entry) => entry.name === "Heavy death ray");
  const select = (keywords, distance) =>
    selectedAndAutomaticCombatPresets(
      illuminor.combatPresets,
      [augmentation.id],
      weapon.type,
      weapon.name,
      keywords,
      attackKeywordsForWeapon(weapon),
      0,
      false,
      false,
      false,
      "full",
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      "supporting_unit",
      keywords,
      distance,
    );
  assert.equal(augmentation.sourceRelationship, "supporting_unit");
  assert.deepEqual(augmentation.requiredSupportedKeywords, ["necrons", "battleline"]);
  assert.deepEqual(select(warriors.models[0].keywords, 0), []);
  assert.deepEqual(select(warriors.models[0].keywords, 4), []);
  assert.deepEqual(select(["necrons", "infantry"], 3), []);
  const selected = select(warriors.models[0].keywords, 3);
  assert.deepEqual(
    selected.map((preset) => preset.name),
    ["Mechanical Augmentation (Aura)"],
  );
  const baseline = {
    weaponName: weapon.name,
    attacks: 3,
    hitOn: 3,
    strength: 12,
    ap: 4,
    damage: 4,
    toughness: 4,
    save: 4,
    invulnerable: 0,
  };
  const defended = applyCombatPresets(baseline, [], selected, weapon.type, {
    targetSupportedUnitKeywords: warriors.models[0].keywords,
    targetSupportDistance: 3,
  });
  assert.equal(defended.ap, 3);
  assert.ok(lessThanOrEqual(exactMean(defended), exactMean(baseline)));
  assert.equal(
    applyCombatPresets(baseline, [], selected, weapon.type, {
      targetSupportedUnitKeywords: warriors.models[0].keywords,
      targetSupportDistance: 4,
    }).ap,
    4,
  );
});

test("source-backed charge rules require the explicit attacker charge state", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const beastboss = catalogue.units.find((unit) => unit.name === "Beastboss");
  const beastlyRage = beastboss.combatPresets.find((preset) => preset.name === "Beastly Rage");
  const weapon = beastboss.weapons.find((entry) => entry.type === "Melee");
  const selected = (charged) =>
    selectedAndAutomaticCombatPresets(
      beastboss.combatPresets,
      [],
      weapon.type,
      weapon.name,
      [],
      attackKeywordsForWeapon(weapon),
      0,
      charged,
    );
  assert.equal(beastlyRage.requiresAttackerCharge, true);
  assert.equal(beastlyRage.activation, "automatic");
  assert.equal(selected(false).length, 0);
  assert.deepEqual(
    selected(true).map((preset) => preset.name),
    ["Beastly Rage"],
  );

  const base = { weaponName: weapon.name, attackerCharged: false, devastatingWounds: false };
  assert.equal(applyCombatPresets(base, [beastlyRage], [], "Melee").devastatingWounds, false);
  assert.equal(
    applyCombatPresets({ ...base, attackerCharged: true }, [beastlyRage], [], "Melee")
      .devastatingWounds,
    true,
  );

  const catachan = catalogue.units.find((unit) => unit.name === "Catachan Jungle Fighters");
  const jungleFighters = catachan.combatPresets.find((preset) => preset.name === "Jungle Fighters");
  assert.equal(jungleFighters.requiresAttackerCharge, undefined);

  const reaveCaptain = catalogue.units.find((unit) => unit.name === "Red Corsairs Reave-Captain");
  const brutalRaider = reaveCaptain.combatPresets.find((preset) => preset.name === "Brutal Raider");
  const raiderProfile = applyCombatPresets(
    { ...base, attackerCharged: true, strengthModifier: 0, ap: 0 },
    [brutalRaider],
    [],
    "Melee",
  );
  assert.equal(raiderProfile.strengthModifier, 1);
  assert.equal(raiderProfile.ap, 1);
});

test("stationary state activates exact source rules and Heavy weapons", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const porphyrion = catalogue.units.find((unit) => unit.name === "Acastus Knight Porphyrion");
  const bastion = porphyrion.combatPresets.find((preset) => preset.name === "Bastion of Firepower");
  const autocannon = porphyrion.weapons.find((weapon) => weapon.name === "Acastus autocannon");
  const base = {
    weaponName: autocannon.name,
    attackerRemainedStationary: false,
    lethalHits: false,
    heavyActive: false,
  };
  assert.equal(bastion.requiresAttackerStationary, true);
  assert.equal(applyCombatPresets(base, [bastion], [], "Ranged").lethalHits, false);
  assert.equal(
    applyCombatPresets({ ...base, attackerRemainedStationary: true }, [bastion], [], "Ranged")
      .lethalHits,
    true,
  );

  const heavyContext = { attackKeywords: ["ranged", "heavy"] };
  assert.equal(applyCombatPresets(base, [], [], "Ranged", heavyContext).heavyActive, false);
  assert.equal(
    applyCombatPresets(
      { ...base, attackerRemainedStationary: true },
      [],
      [],
      "Ranged",
      heavyContext,
    ).heavyActive,
    true,
  );

  const tycho = catalogue.units.find((unit) => unit.name === "Captain Tycho");
  const grantedHeavy = tycho.combatPresets.find((preset) =>
    preset.effects.some((effect) => effect.type === "heavy"),
  );
  assert.equal(applyCombatPresets(base, [grantedHeavy], [], "Ranged").heavyActive, false);
  assert.equal(
    applyCombatPresets({ ...base, attackerRemainedStationary: true }, [grantedHeavy], [], "Ranged")
      .heavyActive,
    true,
  );
  assert.ok(lessThanOrEqual(exactMean(), exactMean({ flags: 32 })));
});

test("charge state activates Lance weapons and granted Lance rules", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const lanceUnit = catalogue.units.find((unit) =>
    unit.weapons.some((weapon) =>
      weapon.abilities.some((ability) => ability.name.toLowerCase() === "lance"),
    ),
  );
  const lanceWeapon = lanceUnit.weapons.find((weapon) =>
    weapon.abilities.some((ability) => ability.name.toLowerCase() === "lance"),
  );
  const base = {
    weaponName: lanceWeapon.name,
    attackerCharged: false,
    lanceActive: false,
  };
  const lanceContext = { attackKeywords: attackKeywordsForWeapon(lanceWeapon) };
  assert.equal(applyCombatPresets(base, [], [], lanceWeapon.type, lanceContext).lanceActive, false);
  assert.equal(
    applyCombatPresets({ ...base, attackerCharged: true }, [], [], lanceWeapon.type, lanceContext)
      .lanceActive,
    true,
  );

  const grantingUnit = catalogue.units.find((unit) =>
    unit.combatPresets.some((preset) => preset.effects.some((effect) => effect.type === "lance")),
  );
  const grantedLance = grantingUnit.combatPresets.find((preset) =>
    preset.effects.some((effect) => effect.type === "lance"),
  );
  assert.equal(
    applyCombatPresets({ ...base, attackerAttached: true }, [grantedLance], [], "Melee")
      .lanceActive,
    false,
  );
  assert.equal(
    applyCombatPresets(
      { ...base, attackerCharged: true, attackerAttached: true },
      [grantedLance],
      [],
      "Melee",
    ).lanceActive,
    true,
  );
  assert.ok(lessThanOrEqual(exactMean(), exactMean({ flags: 64 })));
});

test("Attached-unit state activates exact attacking and defensive leader rules", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const chaplain = catalogue.units.find((unit) => unit.name === "Chaplain");
  const litany = chaplain.combatPresets.find((preset) => preset.name === "Litany of Hate");
  const attackBase = {
    weaponName: chaplain.weapons.find((weapon) => weapon.type === "Melee").name,
    attackerAttached: false,
    woundModifier: 0,
  };
  assert.equal(applyCombatPresets(attackBase, [litany], [], "Melee").woundModifier, 0);
  assert.equal(
    applyCombatPresets({ ...attackBase, attackerAttached: true }, [litany], [], "Melee")
      .woundModifier,
    1,
  );

  const chronomancer = catalogue.units.find((unit) => unit.name === "Chronomancer");
  const mantle = chronomancer.combatPresets.find((preset) => preset.name === "Timesplinter Mantle");
  const targetBase = { weaponName: "Test weapon", targetAttached: false, hitModifier: 0 };
  assert.equal(applyCombatPresets(targetBase, [], [mantle], "Ranged").hitModifier, 0);
  assert.equal(
    applyCombatPresets({ ...targetBase, targetAttached: true }, [], [mantle], "Ranged").hitModifier,
    -1,
  );
  assert.ok(lessThanOrEqual(exactMean({ hitModifier: -1 }), exactMean()));
  assert.ok(lessThanOrEqual(exactMean(), exactMean({ woundModifier: 1 })));
});

test("count-scaled Attacks use exact model, unit, casualty, and phase state", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const gabriel = catalogue.units.find((unit) => unit.name === "Gabriel Seth");
  const whirlwind = gabriel.combatPresets.find((preset) => preset.name === "Whirlwind of Gore");
  const nearbyBase = { weaponName: "Blood Reaver", attacksModifier: 0, nearbyEnemyModels: 0 };
  assert.equal(applyCombatPresets(nearbyBase, [whirlwind], [], "Melee").attacksModifier, 0);
  assert.equal(
    applyCombatPresets({ ...nearbyBase, nearbyEnemyModels: 4 }, [whirlwind], [], "Melee")
      .attacksModifier,
    0,
  );
  assert.equal(
    applyCombatPresets({ ...nearbyBase, nearbyEnemyModels: 5 }, [whirlwind], [], "Melee")
      .attacksModifier,
    1,
  );
  assert.equal(
    applyCombatPresets({ ...nearbyBase, nearbyEnemyModels: 12 }, [whirlwind], [], "Melee")
      .attacksModifier,
    2,
  );
  assert.equal(
    applyCombatPresets(
      { ...nearbyBase, weaponName: "Bolt pistol", nearbyEnemyModels: 12 },
      [whirlwind],
      [],
      "Melee",
    ).attacksModifier,
    0,
  );

  const wurrboy = catalogue.units.find((unit) => unit.name === "Wurrboy");
  const unstable = wurrboy.combatPresets.find((preset) => preset.name === "Unstable Oracle");
  const unitBase = {
    weaponName: "Eyez of Mork",
    attacksModifier: 0,
    attackerAttached: false,
    attackerUnitModels: 10,
  };
  assert.equal(applyCombatPresets(unitBase, [unstable], [], "Ranged").attacksModifier, 0);
  assert.equal(
    applyCombatPresets(
      { ...unitBase, attackerAttached: true, attackerUnitModels: 4 },
      [unstable],
      [],
      "Ranged",
    ).attacksModifier,
    0,
  );
  assert.equal(
    applyCombatPresets(
      { ...unitBase, attackerAttached: true, attackerUnitModels: 5 },
      [unstable],
      [],
      "Ranged",
    ).attacksModifier,
    2,
  );
  assert.equal(
    applyCombatPresets(
      { ...unitBase, attackerAttached: true, attackerUnitModels: 12 },
      [unstable],
      [],
      "Ranged",
    ).attacksModifier,
    4,
  );
  assert.ok(lessThanOrEqual(exactMean({ attacks: 4 }), exactMean({ attacks: 5 })));
  assert.ok(lessThanOrEqual(exactMean({ attacks: 4 }), exactMean({ attacks: 8 })));

  const marshal = catalogue.units.find((unit) => unit.name === "Marshal");
  const pious = marshal.combatPresets.find((preset) => preset.name === "Pious Fervour");
  const marshalBase = { weaponName: "master-crafted power weapon", attacksModifier: 0 };
  assert.equal(applyCombatPresets(marshalBase, [pious], [], "Melee").attacksModifier, 0);
  assert.equal(
    applyCombatPresets({ ...marshalBase, nearbyEnemyUnits: 2 }, [pious], [], "Melee")
      .attacksModifier,
    2,
  );
  assert.equal(
    applyCombatPresets({ ...marshalBase, nearbyEnemyUnits: 5 }, [pious], [], "Melee")
      .attacksModifier,
    3,
  );

  const judiciar = catalogue.units.find((unit) => unit.name === "Judiciar");
  const silentFury = judiciar.combatPresets.find((preset) => preset.name === "Silent Fury");
  const judiciarBase = { weaponName: "executioner relic blade", attacksModifier: 0 };
  assert.equal(
    applyCombatPresets(
      { ...judiciarBase, enemyCharacterModelsDestroyed: 2 },
      [silentFury],
      [],
      "Melee",
    ).attacksModifier,
    2,
  );
  assert.equal(
    applyCombatPresets(
      { ...judiciarBase, weaponName: "absolvor bolt pistol", enemyCharacterModelsDestroyed: 2 },
      [silentFury],
      [],
      "Ranged",
    ).attacksModifier,
    0,
  );

  const venomcrawler = catalogue.units.find((unit) => unit.name === "Venomcrawler");
  const soulEater = venomcrawler.combatPresets.find((preset) => preset.name === "Soul Eater");
  assert.equal(
    applyCombatPresets({ attacksModifier: 0, destructiveFightPhases: 3 }, [soulEater], [], "Ranged")
      .attacksModifier,
    3,
  );
  const huntaRig = catalogue.units.find((unit) => unit.name === "Hunta Rig");
  const onDaHunt = huntaRig.combatPresets.find((preset) => preset.name === "On Da Hunt");
  const huntaBase = { weaponName: "Butcha boyz", attacksModifier: 0 };
  assert.equal(
    applyCombatPresets({ ...huntaBase, embarkedModels: 5 }, [onDaHunt], [], "Melee")
      .attacksModifier,
    5,
  );
  const fullHuntaRig = applyCombatPresets(
    { ...huntaBase, embarkedModels: 10 },
    [onDaHunt],
    [],
    "Melee",
  );
  assert.equal(fullHuntaRig.attacksModifier, 6);
  assert.equal(
    applyCombatPresets(
      { ...huntaBase, weaponName: "Saw blades", embarkedModels: 10 },
      [onDaHunt],
      [],
      "Melee",
    ).attacksModifier,
    0,
  );
  const raider = catalogue.units.find((unit) => unit.name === "Raider");
  const visions = raider.combatPresets.find((preset) => preset.name === "Visions of Butchery");
  const raiderBase = { weaponName: "Bladevanes and chainsnares", attacksModifier: 0 };
  const fourWracks = applyCombatPresets(
    { ...raiderBase, embarkedModels: 10, embarkedWracksModels: 4 },
    [visions],
    [],
    "Melee",
  );
  assert.equal(fourWracks.attacksModifier, 4);
  assert.equal(
    applyCombatPresets(
      { ...raiderBase, embarkedModels: 10, embarkedWracksModels: 0 },
      [visions],
      [],
      "Melee",
    ).attacksModifier,
    0,
  );
  assert.ok(lessThanOrEqual(exactMean({ attacks: 4 }), exactMean({ attacks: 7 })));
  assert.ok(
    lessThanOrEqual(
      exactMean({ attacks: 4, attacksModifier: 0 }),
      exactMean({ attacks: 4, attacksModifier: fullHuntaRig.attacksModifier }),
    ),
  );
  assert.ok(
    lessThanOrEqual(
      exactMean({ attacks: 4, attacksModifier: 0 }),
      exactMean({ attacks: 4, attacksModifier: fourWracks.attacksModifier }),
    ),
  );
});

test("Waaagh benefit state composes universal and direct Orks rules into C/Wasm", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const boyz = catalogue.units.find((unit) => unit.name === "Boyz");
  const choppa = boyz.weapons.find((weapon) => weapon.type === "Melee");
  const waaagh = boyz.combatPresets.filter((preset) => preset.name.startsWith("Waaagh! —"));
  const attackBase = {
    weaponName: choppa.name,
    attacksModifier: 0,
    strengthModifier: 0,
    attackerWaaaghActive: false,
  };
  const inactive = applyCombatPresets(attackBase, waaagh, [], "Melee");
  const active = applyCombatPresets(
    { ...attackBase, attackerWaaaghActive: true },
    waaagh,
    [],
    "Melee",
  );
  assert.equal(inactive.attacksModifier, 0);
  assert.equal(inactive.strengthModifier, 0);
  assert.equal(active.attacksModifier, 1);
  assert.equal(active.strengthModifier, 1);
  assert.ok(
    lessThanOrEqual(
      exactMean({ attacks: 3, strength: 4 }),
      exactMean({ attacks: 3, attacksModifier: 1, strength: 4, strengthModifier: 1 }),
    ),
  );

  const targetBase = { weaponName: "Test weapon", invulnerable: 0, targetWaaaghActive: false };
  assert.equal(applyCombatPresets(targetBase, [], waaagh, "Ranged").invulnerable, 0);
  assert.equal(
    applyCombatPresets({ ...targetBase, targetWaaaghActive: true }, [], waaagh, "Ranged")
      .invulnerable,
    5,
  );
  assert.ok(lessThanOrEqual(exactMean({ invulnerable: 5 }), exactMean({ invulnerable: 0 })));

  const warboss = catalogue.units.find((unit) => unit.name === "Warboss In Mega Armour");
  const deadBrutal = warboss.combatPresets.find((preset) => preset.name === "Dead Brutal");
  assert.equal(
    applyCombatPresets(
      { weaponName: "’uge choppa", damageReplacement: null, attackerWaaaghActive: true },
      [deadBrutal],
      [],
      "Melee",
    ).damageReplacement,
    3,
  );
  assert.equal(
    applyCombatPresets(
      { weaponName: "Kustom shoota", damageReplacement: null, attackerWaaaghActive: true },
      [deadBrutal],
      [],
      "Ranged",
    ).damageReplacement,
    null,
  );
});

test("source-backed Battle-shock rules require their exact attacker or target state", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const furies = catalogue.units.find((unit) => unit.name === "Furies");
  const prey = furies.combatPresets.find((preset) => preset.name === "Prey on the Weak");
  const furiesBase = {
    weaponName: furies.weapons[0].name,
    woundModifier: 0,
    targetBattleShocked: false,
  };
  assert.equal(applyCombatPresets(furiesBase, [prey], [], "Melee").woundModifier, 0);
  assert.equal(
    applyCombatPresets({ ...furiesBase, targetBattleShocked: true }, [prey], [], "Melee")
      .woundModifier,
    1,
  );

  const priest = catalogue.units.find((unit) => unit.name === "Ministorum Priest");
  const holyPiety = priest.combatPresets.find((preset) => preset.name === "Holy Piety");
  const priestBase = {
    weaponName: priest.weapons.find((weapon) => weapon.type === "Melee").name,
    rerollHits: false,
    rerollHitOnes: false,
    attackerBattleShocked: false,
  };
  assert.equal(applyCombatPresets(priestBase, [holyPiety], [], "Melee").rerollHits, true);
  assert.equal(
    applyCombatPresets({ ...priestBase, attackerBattleShocked: true }, [holyPiety], [], "Melee")
      .rerollHits,
    false,
  );
});

test("source-backed target strength rules preserve the three exact unit states", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const ballistus = catalogue.units.find((unit) => unit.name === "Ballistus Dreadnought");
  const strike = ballistus.combatPresets.find((preset) => preset.name === "Ballistus Strike");
  const ballistusBase = {
    weaponName: ballistus.weapons.find((weapon) => weapon.type === "Ranged").name,
    rerollHits: false,
    rerollHitOnes: false,
    targetStrengthState: "full",
  };
  assert.equal(applyCombatPresets(ballistusBase, [strike], [], "Ranged").rerollHits, true);
  assert.equal(
    applyCombatPresets(
      { ...ballistusBase, targetStrengthState: "below_starting" },
      [strike],
      [],
      "Ranged",
    ).rerollHits,
    true,
  );
  assert.equal(
    applyCombatPresets(
      { ...ballistusBase, targetStrengthState: "below_half" },
      [strike],
      [],
      "Ranged",
    ).rerollHits,
    false,
  );
  assert.ok(lessThanOrEqual(exactMean(), exactMean({ flags: 8 })));

  const cyberwolf = catalogue.units.find((unit) => unit.name === "Cyberwolf");
  const closeIn = cyberwolf.combatPresets.find((preset) => preset.name === "Close In for the Kill");
  const cyberwolfBase = {
    weaponName: cyberwolf.weapons.find((weapon) => weapon.type === "Melee").name,
    hitModifier: 0,
    woundModifier: 0,
    targetStrengthState: "full",
  };
  assert.deepEqual(
    ["full", "below_starting"].map((state) => {
      const profile = applyCombatPresets(
        { ...cyberwolfBase, targetStrengthState: state },
        [closeIn],
        [],
        "Melee",
      );
      return [profile.hitModifier, profile.woundModifier];
    }),
    [
      [0, 0],
      [0, 0],
    ],
  );
  const belowHalf = applyCombatPresets(
    { ...cyberwolfBase, targetStrengthState: "below_half" },
    [closeIn],
    [],
    "Melee",
  );
  assert.deepEqual([belowHalf.hitModifier, belowHalf.woundModifier], [1, 1]);
  assert.ok(lessThanOrEqual(exactMean(), exactMean({ hitModifier: 1, woundModifier: 1 })));
});

test("source-backed situational Attacks replacements reach C/Wasm exactly", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const harker = catalogue.units.find((unit) => unit.name === "Sergeant Harker");
  const payback = harker.combatPresets.find((preset) => preset.name === "Payback Time");
  const base = {
    weaponName: "Payback",
    attacksReplacement: 0,
    attacksMultiplier: 1,
    attacksModifier: 0,
    strengthReplacement: 0,
    strengthMultiplier: 1,
    strengthModifier: 0,
    damageReplacement: null,
    damageMultiplier: 1,
    damageModifier: 0,
    ap: 0,
    criticalHits: 6,
    criticalWounds: 0,
    lethalHits: false,
    devastatingWounds: false,
    twinLinked: false,
    ignoresCover: false,
    lanceActive: false,
    heavyActive: false,
    sustainedHits: 1,
    sustainedHitsDice: 0,
    sustainedHitsSides: 0,
    rapidFire: 0,
    rapidFireDice: 0,
    rapidFireSides: 0,
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    save: 7,
    invulnerable: 0,
    feelNoPain: 0,
    reduction: 0,
  };
  const active = applyCombatPresets(base, [payback], [], "Ranged");
  assert.equal(active.attacksReplacement, 6);
  assert.equal(active.sustainedHits, 3);
  const wrongPhase = applyCombatPresets(base, [payback], [], "Melee");
  assert.equal(wrongPhase.attacksReplacement, 0);
  assert.equal(wrongPhase.sustainedHits, 1);
  const inactiveMean = exactMean({ attacks: 3, sustainedHits: 1, save: 7 });
  const activeMean = exactMean({
    attacks: 3,
    attacksReplacement: active.attacksReplacement,
    sustainedHits: active.sustainedHits,
    save: 7,
  });
  assert.deepEqual(inactiveMean, { numerator: 5n, denominator: 2n });
  assert.deepEqual(activeMean, { numerator: 7n, denominator: 1n });

  const flashGitz = catalogue.units.find((unit) => unit.name === "Flash Gitz");
  const showOffs = flashGitz.combatPresets.find((preset) => preset.name === "Gun-crazy Show-offs");
  assert.equal(
    applyCombatPresets({ ...base, weaponName: "Snazzgun" }, [showOffs], [], "Ranged")
      .attacksReplacement,
    0,
  );
  const closestShowOffs = applyCombatPresets(
    { ...base, weaponName: "Snazzgun", targetClosestEligible: true },
    [showOffs],
    [],
    "Ranged",
  );
  assert.equal(closestShowOffs.attacksReplacement, 4);
  assert.equal(
    applyCombatPresets(
      { ...base, weaponName: "Choppa", targetClosestEligible: true },
      [showOffs],
      [],
      "Melee",
    ).attacksReplacement,
    0,
  );
  assert.ok(
    lessThanOrEqual(
      exactMean({ attacks: 3, save: 7 }),
      exactMean({ attacks: 3, attacksReplacement: closestShowOffs.attacksReplacement, save: 7 }),
    ),
  );

  const kommandos = catalogue.units.find((unit) => unit.name === "Kommandos");
  const distractionGrot = kommandos.combatPresets.find(
    (preset) => preset.name === "Distraction Grot",
  );
  assert.equal(distractionGrot.weaponScope, "Ranged");
  assert.equal(combatPresetSupportsWeapon(distractionGrot, "Ranged"), true);
  assert.equal(combatPresetSupportsWeapon(distractionGrot, "Melee"), false);

  const ridgerunners = catalogue.units.find((unit) => unit.name === "Achilles Ridgerunners");
  const crossfire = ridgerunners.combatPresets.find((preset) => preset.name === "Crossfire");
  assert.equal(crossfire.weaponScope, "Any");
  assert.equal(combatPresetSupportsWeapon(crossfire, "Ranged"), true);
  assert.equal(combatPresetSupportsWeapon(crossfire, "Melee"), true);
});

test("selected-target LOS and source range gate C/Wasm modifiers independently", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const sorcerer = catalogue.units.find((unit) =>
    unit.combatPresets.some((preset) => preset.name === "Marked by Fate (Psychic)"),
  );
  const marked = sorcerer.combatPresets.find(
    (preset) => preset.name === "Marked by Fate (Psychic)",
  );
  const base = {
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    attacksMultiplier: 1,
    strengthMultiplier: 1,
    damageMultiplier: 1,
    damageReplacement: null,
  };
  const hidden = applyCombatPresets(base, [marked], [], "Ranged", {
    attackerSourceCanSeeTarget: false,
  });
  const visible = applyCombatPresets(base, [marked], [], "Ranged", {
    attackerSourceCanSeeTarget: true,
  });
  assert.equal(hidden.hitModifier, 0);
  assert.equal(visible.hitModifier, 1);
  assert.ok(
    lessThanOrEqual(
      exactMean({ attacks: 6, hitModifier: hidden.hitModifier, save: 7 }),
      exactMean({ attacks: 6, hitModifier: visible.hitModifier, save: 7 }),
    ),
  );

  const eldrad = catalogue.units.find((unit) => unit.name === "Eldrad Ulthran");
  const doom = eldrad.combatPresets.find((preset) => preset.name === "Doom (Psychic)");
  const atBoundary = applyCombatPresets(base, [doom], [], "Ranged", {
    attackerSourceTargetDistance: 18,
    attackerSourceCanSeeTarget: true,
    attackerKeywords: ["Aeldari"],
  });
  const beyondBoundary = applyCombatPresets(base, [doom], [], "Ranged", {
    attackerSourceTargetDistance: 19,
    attackerSourceCanSeeTarget: true,
    attackerKeywords: ["Aeldari"],
  });
  assert.equal(atBoundary.woundModifier, 1);
  assert.equal(beyondBoundary.woundModifier, 0);
  assert.ok(
    lessThanOrEqual(
      exactMean({ attacks: 6, woundModifier: beyondBoundary.woundModifier, save: 7 }),
      exactMean({ attacks: 6, woundModifier: atBoundary.woundModifier, save: 7 }),
    ),
  );
});

test("cross-unit selected-target qualifiers reach exact C/Wasm volleys", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const preset = (unitName, presetName) =>
    catalogue.units
      .find((unit) => unit.name === unitName)
      .combatPresets.find((candidate) => candidate.name === presetName);
  const base = {
    hitModifier: 0,
    woundModifier: 0,
    rerollHits: false,
    rerollHitOnes: false,
    rerollWounds: false,
    rerollWoundOnes: false,
    attacksMultiplier: 1,
    strengthMultiplier: 1,
    damageMultiplier: 1,
    damageReplacement: null,
  };
  const blight = preset("Lord of Virulence", "Blight Bombardment");
  const composeBlight = (attackerKeywords, attackKeywords) =>
    applyCombatPresets(base, [blight], [], "Ranged", {
      attackerSourceTargetDistance: 30,
      attackerSourceCanSeeTarget: true,
      attackerKeywords,
      attackKeywords,
    });
  const baseline = composeBlight(["Death Guard"], []);
  const blast = composeBlight(["Death Guard"], ["Blast"]);
  const wrongFaction = composeBlight(["Necrons"], ["Blast"]);
  assert.deepEqual([baseline.rerollHits, baseline.rerollHitOnes], [false, true]);
  assert.deepEqual([blast.rerollHits, blast.rerollHitOnes], [true, false]);
  assert.deepEqual([wrongFaction.rerollHits, wrongFaction.rerollHitOnes], [false, false]);
  const volley = { attacks: 12, hitOn: 4, strength: 8, toughness: 8, save: 7 };
  const wrongMean = exactMean({ ...volley, ...wrongFaction });
  const baselineMean = exactMean({ ...volley, ...baseline });
  const blastMean = exactMean({ ...volley, ...blast });
  assert.ok(lessThanOrEqual(wrongMean, baselineMean));
  assert.ok(lessThanOrEqual(baselineMean, blastMean));

  const targetSighted = preset("Land Speeder", "Target Sighted");
  const qualified = applyCombatPresets(base, [targetSighted], [], "Ranged", {
    attackerSourceCanSeeTarget: true,
    attackerKeywords: ["Adeptus Astartes"],
    attackKeywords: ["Blast"],
  });
  const wrongWeapon = applyCombatPresets(base, [targetSighted], [], "Ranged", {
    attackerSourceCanSeeTarget: true,
    attackerKeywords: ["Adeptus Astartes"],
    attackKeywords: ["Melta"],
  });
  assert.equal(qualified.hitModifier, 1);
  assert.equal(qualified.ignoresCover, true);
  assert.equal(wrongWeapon.hitModifier, 0);
  assert.equal(wrongWeapon.ignoresCover, false);
  assert.ok(
    lessThanOrEqual(
      exactMean({ ...volley, ...wrongWeapon }),
      exactMean({ ...volley, ...qualified }),
    ),
  );
});

test("source-backed defensive profile values reduce C/Wasm exact damage", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const redemptor = catalogue.units.find((unit) => unit.name === "Redemptor Dreadnought");
  const model = redemptor.models[0];
  assert.equal(model.reduction, 1);
  const baseline = exactMean({
    ap: 2,
    save: model.save,
    invulnerable: model.invuln ?? 0,
    reduction: 0,
  });
  const defended = exactMean({
    ap: 2,
    save: model.save,
    invulnerable: model.invuln ?? 0,
    feelNoPain: model.feelNoPain,
    reduction: model.reduction,
  });
  assert.ok(lessThanOrEqual(defended, baseline));
  assert.notDeepEqual(defended, baseline);

  const avatar = catalogue.units.find((unit) => unit.name === "Avatar of Khaine");
  const avatarModel = avatar.models[0];
  assert.equal(avatarModel.damageDivisor, 2);
  const undivided = exactMean({
    ap: 2,
    save: avatarModel.save,
    invulnerable: avatarModel.invuln ?? 0,
  });
  const divided = exactMean({
    ap: 2,
    save: avatarModel.save,
    invulnerable: avatarModel.invuln ?? 0,
    damageDivisor: avatarModel.damageDivisor,
  });
  assert.ok(lessThanOrEqual(divided, undivided));
  assert.notDeepEqual(divided, undivided);
});

test("single-model bearer wargear composes exact optional defenses", async () => {
  const catalogue = JSON.parse(
    await readFile(new URL("../public/profile-data.json", import.meta.url), "utf8"),
  );
  const commander = catalogue.units.find(
    (unit) => unit.name === "Commander In Coldstar Battlesuit",
  );
  const shield = commander.combatPresets.find((preset) => preset.name === "Shield Generator");
  const base = { weaponName: "", ap: 4, save: 3, invulnerable: 0, reduction: 0 };
  const defended = applyCombatPresets(base, [], [shield], "Ranged");
  assert.equal(defended.invulnerable, 4);
  const shieldedMean = exactMean({ ap: 4, save: 3, invulnerable: defended.invulnerable });
  const unshieldedMean = exactMean({ ap: 4, save: 3, invulnerable: 0 });
  assert.ok(lessThanOrEqual(shieldedMean, unshieldedMean));
  assert.notDeepEqual(shieldedMean, unshieldedMean);

  const wraithknight = catalogue.units.find((unit) => unit.name === "Wraithknight");
  const scattershield = wraithknight.combatPresets.find(
    (preset) => preset.name === "Scattershield",
  );
  const compound = applyCombatPresets(base, [], [scattershield], "Ranged");
  assert.equal(compound.invulnerable, 4);
  assert.equal(compound.reduction, 1);

  const lychguard = catalogue.units.find((unit) => unit.name === "Lychguard");
  assert.equal(
    lychguard.combatPresets.some((preset) => preset.name === "Dispersion Shield"),
    false,
  );
});
