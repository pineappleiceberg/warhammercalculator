import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import calculatorWasm from "../public/wasm/calculator.wasm?module";
import {
  DEFAULT_PROFILE,
  normalizeProfile,
  simulateAttack,
  simulateOrderedVolley,
  simulateOrderedVolleyPhase,
  type CombatProfile,
} from "../lib/combat";
import {
  createArmyList,
  deleteArmyList,
  importArmyLists,
  listArmyLists,
  updateArmyList,
} from "../db/army-lists";
import type { ArmyListInput, ArmyListRecord } from "../lib/army-list";
import {
  createArmyListBackup,
  normalizeArmyListInput,
  normalizeArmyListRecord,
  parseArmyListBackup,
} from "../lib/army-list-codec.mjs";
import {
  choiceSelectionItemCounts,
  choiceSelectionWeaponCounts,
  loadoutSubjectWeaponCounts,
  sourceEquippedWeaponCounts,
  unitLoadoutWarnings,
  unitStartingSizeStatus,
} from "../lib/loadout.mjs";
import type { Catalogue, CatalogueCombatPreset } from "../lib/catalogue";
import {
  endpointClearanceFactValues,
  endpointClearanceFactValuesAreValid,
  spatialFactValues,
  spatialFactValuesAreValid,
} from "../lib/spatial-facts.mjs";
import {
  terrainClearanceFactValues,
  terrainClearanceFactValuesAreValid,
} from "../lib/terrain-clearance-facts.mjs";
import {
  objectiveControlFactValues,
  objectiveControlFactValuesAreValid,
} from "../lib/objective-control-facts.mjs";
import { missionTrackerFactsAreValid } from "../lib/mission-tracker.mjs";
import { visibilityFactValues, visibilityFactValuesAreValid } from "../lib/visibility-facts.mjs";
import { resolveFiringDeckSelections } from "../lib/firing-deck.mjs";
import {
  bodyguardJoinEligibility,
  leaderAttachmentEligibility,
  leaderFormationEligibility,
} from "../lib/attachments.mjs";
import { transportCapacityPools, transportPassengerEligibility } from "../lib/transport.mjs";
import { savedUnitDefensiveEquipmentWarnings } from "../lib/formations.mjs";
import {
  combatPresetSourceEquipmentCount,
  sourceEquipmentCombatPresetIds,
  unavailableSourceEquipmentCombatPresetIds,
} from "../lib/combat-presets.mjs";
import {
  battleTransportOccupancy,
  battleTransportDeploymentChains,
  battleInitialDeploymentRules,
  battleFormation,
  battleFormationHealth,
  battleGrimResolveFormationFacts,
  battleOathOfMomentAttackFacts,
  reanimationProtocolsTransitionIsValid,
  shadowInTheWarpTestIsValid,
  commandBattleShockTestIsValid,
  desperateEscapeTestIsValid,
  battleWaaaghFormationFacts,
  battleSurvivingWeaponCount,
  chargeResolutionFlags,
  chargeResolutionIsValid,
  counterOffensiveFlags,
  counterOffensiveIsValid,
  fightMoveFlags,
  fightMoveIsValid,
  fireOverwatchFlags,
  fireOverwatchIsValid,
  FIRE_OVERWATCH_TRIGGERS,
  goToGroundFlags,
  goToGroundIsValid,
  smokescreenFlags,
  smokescreenIsValid,
  HAZARDOUS_FLAGS,
  hazardousResolutionIsValid,
  heroicInterventionChargeFlags,
  heroicInterventionFlags,
  heroicInterventionIsValid,
  missionTrackerFacts,
  normalizeBattleState,
  rangedDeclarationIsValid,
  rapidIngressFlags,
  rapidIngressIsValid,
  rapidIngressPlacementIsLegal,
  BATTLE_SHOCK_COMPARATOR_BATTLE_STATE_VERSION,
  RULE_COVERAGE_BATTLE_STATE_VERSION,
  rangedTargetEligibilityIsValid,
  rangedGeometryResolutionIsValid,
  replayBattleState,
  modelPlacementFlags,
  modelPlacementSetFacts,
  modelPlacementSetIsValid,
  modelPositionFlags,
  modelPositionSetFacts,
  modelPositionSetIsValid,
  tableGeometryFlags,
  tableGeometryIsValid,
  terrainFootprintFlags,
  terrainFootprintSetFacts,
  terrainFootprintSetIsValid,
  transportLoadIsValid,
  transportDeploymentChainIsValid,
  initialDeploymentIsValid,
  weaponBearerDeclarationIsValid,
  weaponInventoryDeclarationIsValid,
} from "../lib/battle-state.mjs";
import {
  battleRuleSelectionIds,
  verifyBattleRuleCoverageBinding,
} from "../lib/battle-rule-selection.mjs";
import { BATTLE_PHASE_STEPS } from "../lib/battle-clock.mjs";
import {
  RULE_COVERAGE_STATUS,
  assessRuleCoverage,
  normalizeRuleCoverageMatrix,
} from "../lib/rule-coverage.mjs";
import { normalizeMissionPackCatalogue } from "../lib/mission-pack.mjs";

interface Env {
  ASSETS: Fetcher;
  ARMY_DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface CanonicalFightMoveEvent {
  stage: "pile_in" | "consolidation";
  destination: "none" | "enemy" | "objective";
  maximumModelMoveThousandths: number;
  movementReviewedByPlayer: boolean;
  movementReviewReason: string;
  baseContactModelsStationary: boolean;
  unitCoherencyConfirmed: boolean;
  endsWithinEngagementRange: boolean;
  allMovedModelsCloserToEnemy: boolean;
  baseContactMaximized: boolean;
  enemyDestinationImpossible: boolean;
  objectiveId: string;
  endsWithinObjectiveRange: boolean;
  allMovedModelsCloserToObjective: boolean;
  objectiveDestinationImpossible: boolean;
  outcomeReason: string;
  meleeAttacksCompleteConfirmed: boolean;
  meleeAttacksCompletionReason: string;
  clock: unknown;
}

type Catalogue = {
  sourceUpdatedAt: string;
  leaderFormationRules: {
    maximumLeaders: number;
    sourceUrl: string;
    sourceSha256: string;
    sourceVersion: string;
    sourcePage: number;
  };
  factions: Array<{ id: string; name: string }>;
  units: Array<{
    id: string;
    factionId: string;
    name: string;
    models: unknown[];
    weapons: Array<{
      id: number;
      name: string;
      type: "Ranged" | "Melee";
      groupId: string;
      abilities: Array<{ name: string; value: string | null }>;
    }>;
    composition: Array<{ text: string; min: number | null; max: number | null }>;
    compositionModels: Array<{
      modelId?: number;
      name: string;
      min: number;
      max: number;
      source: string;
      loadoutSubjectId?: string;
      controlsComposition?: boolean;
      countFormula?: {
        fixed: number;
        perModel: number;
        perIncrement: number;
        modelsPerIncrement: number;
      };
    }>;
    loadout: string;
    defaultWeapons: Array<{
      groupId: string;
      groupName: string;
      terms: Array<{
        fixed: number;
        perModel: number;
        perIncrement: number;
        modelsPerIncrement: number;
        quantity: number;
        source: string;
      }>;
    }>;
    unresolvedLoadoutSubjects: Array<{
      id: string;
      subject: string;
      equipment: string;
      weapons: Array<{
        groupId: string;
        groupName: string;
        quantity: number;
      }>;
    }>;
    wargearOptions: string[];
    weaponLimits: Array<{
      groupId: string;
      groupName: string;
      terms: Array<{
        fixed: number;
        perIncrement: number;
        modelsPerIncrement: number;
        quantity: number;
        source: string;
      }>;
    }>;
    wargearChoicePools: Array<{
      id: string;
      fixed: number;
      perIncrement: number;
      modelsPerIncrement: number;
      minimumModels: number;
      selectionsPerReplacement: number;
      source: string;
      replaces: Array<{ groupId: string; groupName: string; quantity: number }>;
      alternatives: Array<{
        id: string;
        label: string;
        weapons: Array<{ groupId: string; groupName: string; quantity: number }>;
        selectionKey?: string;
        selectionName?: string;
        selectionQuantity?: number;
        selectionSlots: number;
        maximumSelections?: number;
        prerequisites?: Array<{
          alternativeId: string;
          minimum: number;
          maximum: number;
          source: string;
        }>;
      }>;
    }>;
    wargearChoiceItemLimits: Array<{
      itemKey: string;
      itemName: string;
      fixed: number;
      perIncrement: number;
      modelsPerIncrement: number;
      source: string;
    }>;
    wargearChoicePairingRules: Array<{
      poolId: string;
      weaponType: "Ranged" | "Melee";
      evaluationScope: "pool" | "unit";
      triggerCount: number;
      maximumTypedSelections: number;
      requirements: Array<{
        label: string;
        minimum: number;
        maximum: number;
        matches: Array<{ kind: "ability" | "weapon_group"; value: string }>;
      }>;
      requiredAbility?: string;
      requiredMinimum?: number;
      requiredMaximum?: number;
      source: string;
    }>;
    weaponTypeLimits: Array<{
      weaponType: "Ranged" | "Melee";
      fixed: number;
      perIncrement: number;
      modelsPerIncrement: number;
      source: string;
    }>;
    startingSizeRanges: Array<{
      minimum: number;
      maximum: number;
      source: string;
    }>;
    suggestedModelCount: number | null;
    maximumModelCount: number | null;
    combatPresets: CatalogueCombatPreset[];
    firingDeck: { capacity: number; abilityId: string | null } | null;
    firingDeckModelCost: number;
    transport: {
      capacity: number;
      exactRules: boolean;
      source: string;
      allowedKeywords: string[][];
      excluded: Array<{
        keywords: string[];
        minimumWounds: number | null;
        nonCharacter: boolean;
      }>;
      modelCosts: Array<{ keywords: string[]; minimumWounds: number | null; cost: number }>;
      capacityModifiers: Array<{ equipment: string; capacity: number }>;
    } | null;
    transportKeywords: string[];
    leaderBodyguardIds: string[];
    leaderAttachmentConditions: Array<{
      bodyguardId: string;
      requiredEquipment: string;
      requiredWeaponGroupId: string | null;
      requiredChoiceAlternativeId: string | null;
      source: string;
    }>;
    leaderFooter: string;
    leaderAttachmentException: {
      maximumLeaders: number;
      mandatoryAttachment: boolean;
      anyExistingLeader: boolean;
      existingLeaderKeywords: string[];
      forbidSameDatasheet: boolean;
      forbiddenCompanionKeyword: string | null;
      source: string;
    } | null;
    bodyguardLeaderRule: {
      minimumLeaders: number;
      minimumLeaderKeywords: string[];
      maximumLeaders: number | null;
      maximumRequiredStartingStrength: number | null;
      maximumRequiredLeaderKeyword: string | null;
      leadersMustBeDistinct: boolean;
      source: string;
    } | null;
    bodyguardJoinOptions: Array<{
      bodyguardId: string;
      maximumSameJoiner: number;
      requiresUnattached: boolean;
      increasesStartingStrength: boolean;
      source: string;
    }>;
  }>;
};

type CalculatorExports = {
  memory: WebAssembly.Memory;
  __wasm_call_ctors(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  whc_calculate_summary_with_characteristic_roll(...values: number[]): number;
  whc_calculate_ordered_volley_summary(...values: number[]): number;
  whc_estimate_ordered_volley_complexity(...values: number[]): number;
  whc_replay_battle_health_events(...values: number[]): number;
  whc_ranged_target_eligibility_is_valid(...values: number[]): number;
  whc_ranged_geometry_resolution_is_valid(...values: number[]): number;
  whc_weapon_inventory_declaration_is_valid(...values: number[]): number;
  whc_weapon_bearer_declaration_is_valid(...values: number[]): number;
  whc_charge_resolution_is_valid(...values: number[]): number;
  whc_fight_move_is_valid(...values: number[]): number;
  whc_heroic_intervention_is_valid(...values: number[]): number;
  whc_fire_overwatch_is_valid(...values: number[]): number;
  whc_hazardous_resolution_is_valid(...values: number[]): number;
  whc_desperate_escape_test_is_valid(...values: number[]): number;
  whc_go_to_ground_is_valid(...values: number[]): number;
  whc_smokescreen_is_valid(...values: number[]): number;
  whc_rapid_ingress_is_valid(...values: number[]): number;
  whc_rule_coverage_is_permitted(...values: number[]): number;
  whc_counter_offensive_is_valid(...values: number[]): number;
  whc_ranged_declaration_is_valid(...values: number[]): number;
  whc_transport_load_is_valid(...values: number[]): number;
  whc_transport_deployment_chain_is_valid(...values: number[]): number;
  whc_initial_deployment_is_valid(...values: number[]): number;
  whc_table_geometry_is_valid(...values: number[]): number;
  whc_terrain_footprint_set_is_valid(...values: number[]): number;
  whc_model_placement_set_is_valid(...values: number[]): number;
  whc_model_position_set_is_valid(...values: number[]): number;
  whc_spatial_facts_are_valid(...values: number[]): number;
  whc_endpoint_clearance_facts_are_valid(...values: number[]): number;
  whc_terrain_clearance_facts_are_valid(...values: number[]): number;
  whc_mission_tracker_facts_are_valid(...values: number[]): number;
  whc_objective_control_facts_are_valid(...values: number[]): number;
  whc_visibility_facts_are_valid(...values: number[]): number;
  whc_waaagh_state_is_valid(...values: number[]): number;
  whc_grim_resolve_model_objective_control_is_valid(...values: number[]): number;
  whc_oath_of_moment_attack_state_is_valid(...values: number[]): number;
  whc_reanimation_protocols_transition_is_valid(...values: number[]): number;
  whc_shadow_in_the_warp_test_is_valid(...values: number[]): number;
  whc_command_battle_shock_test_is_valid(...values: number[]): number;
  whc_start_battle_clock(firstPlayerIndex: number, clockPointer: number): number;
  whc_next_battle_clock(currentPointer: number, nextPointer: number): number;
};

type OrderedTargetSegment = {
  toughness: number;
  save: number;
  invulnerable: number;
  feelNoPain: number;
  wounds: number;
  reduction: number;
  damageDivisor: number;
  firstFailedSaveDamageReplacement: number | null;
  allocatedAttackDamageReplacement: number;
  allocatedAttackDamageReplacementUses: number;
  allocatedAttackDamageReplacementSkip: number;
  modelCount: number;
  benefitOfCover?: boolean;
};

const API_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Request-ID",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

let cataloguePromise: Promise<Catalogue> | null = null;
let calculatorPromise: Promise<CalculatorExports> | null = null;
let ruleCoveragePromise: Promise<ReturnType<typeof normalizeRuleCoverageMatrix>> | null = null;
let missionPackPromise: Promise<ReturnType<typeof normalizeMissionPackCatalogue>> | null = null;

class ServiceUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

class ExactStateLimitError extends Error {
  constructor() {
    super("Exact state budget exceeded; use POST /api/v1/volley/simulate");
    this.name = "ExactStateLimitError";
  }
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...API_HEADERS, ...headers },
  });
}

function apiError(
  message: string,
  status = 400,
  code = status === 404 ? "NOT_FOUND" : "INVALID_REQUEST",
) {
  return json(
    {
      error: { message, status, code, retryable: status >= 500 },
      apiVersion: "v1",
    },
    status,
  );
}

async function loadCatalogue(request: Request, env: Env) {
  cataloguePromise ??= env.ASSETS.fetch(new Request(new URL("/profile-data.json", request.url)))
    .then(async (response) => {
      if (!response.ok) {
        throw new ServiceUnavailableError(
          "Profile catalogue is unavailable",
          "PROFILE_CATALOGUE_UNAVAILABLE",
        );
      }
      const catalogue = (await response.json()) as Catalogue;
      if (
        !catalogue ||
        typeof catalogue.sourceUpdatedAt !== "string" ||
        !Array.isArray(catalogue.factions) ||
        !Array.isArray(catalogue.detachments) ||
        !Array.isArray(catalogue.enhancements) ||
        !Array.isArray(catalogue.units)
      ) {
        throw new ServiceUnavailableError(
          "Profile catalogue is invalid",
          "PROFILE_CATALOGUE_INVALID",
        );
      }
      return catalogue;
    })
    .catch((error: unknown) => {
      cataloguePromise = null;
      if (error instanceof ServiceUnavailableError) throw error;
      throw new ServiceUnavailableError(
        "Profile catalogue could not be loaded",
        "PROFILE_CATALOGUE_UNAVAILABLE",
      );
    });
  return cataloguePromise;
}

async function loadRuleCoverage(request: Request, env: Env) {
  ruleCoveragePromise ??= Promise.all([
    env.ASSETS.fetch(new Request(new URL("/battle-rule-coverage.json", request.url))),
    env.ASSETS.fetch(new Request(new URL("/battle-rule-sources.json", request.url))),
  ])
    .then(async ([coverageResponse, sourceResponse]) => {
      if (!coverageResponse.ok || !sourceResponse.ok) {
        throw new ServiceUnavailableError(
          "Rule coverage catalogue is unavailable",
          "RULE_COVERAGE_UNAVAILABLE",
        );
      }
      return normalizeRuleCoverageMatrix(
        await coverageResponse.json(),
        await sourceResponse.json(),
      );
    })
    .catch((error: unknown) => {
      ruleCoveragePromise = null;
      if (error instanceof ServiceUnavailableError) throw error;
      throw new ServiceUnavailableError(
        "Rule coverage catalogue is invalid",
        "RULE_COVERAGE_INVALID",
      );
    });
  return ruleCoveragePromise;
}

async function loadMissionPack(request: Request, env: Env) {
  missionPackPromise ??= env.ASSETS.fetch(
    new Request(new URL("/chapter-approved-2025-26-v1.4.json", request.url)),
  )
    .then(async (response) => {
      if (!response.ok) {
        throw new ServiceUnavailableError(
          "Mission pack catalogue is unavailable",
          "MISSION_PACK_UNAVAILABLE",
        );
      }
      return normalizeMissionPackCatalogue(await response.json());
    })
    .catch((error: unknown) => {
      missionPackPromise = null;
      if (error instanceof ServiceUnavailableError) throw error;
      throw new ServiceUnavailableError(
        "Mission pack catalogue is invalid",
        "MISSION_PACK_INVALID",
      );
    });
  return missionPackPromise;
}

async function checkedRuleCoverage(request: Request, env: Env, rules: unknown) {
  const report = assessRuleCoverage(await loadRuleCoverage(request, env), rules);
  const calculator = await loadCalculator();
  for (const result of report.results) {
    const wasmPermitted = Boolean(
      calculator.whc_rule_coverage_is_permitted(
        RULE_COVERAGE_STATUS[result.status],
        Number(result.sourceLocked),
        Number(result.acknowledged),
      ),
    );
    if (wasmPermitted !== result.permitted) {
      throw new ServiceUnavailableError(
        "Rule coverage engines disagree",
        "RULE_COVERAGE_ENGINE_MISMATCH",
      );
    }
  }
  return report;
}

async function loadCalculator() {
  calculatorPromise ??= (async () => {
    let calculator: CalculatorExports | null = null;
    const imports = {
      env: {
        emscripten_resize_heap(requestedSize: number) {
          if (!calculator) return 0;
          const memory = calculator.memory;
          const missing = requestedSize - memory.buffer.byteLength;
          if (missing <= 0) return 1;
          try {
            memory.grow(Math.ceil(missing / 65_536));
            return 1;
          } catch {
            return 0;
          }
        },
        emscripten_memcpy_big(destination: number, source: number, count: number) {
          if (!calculator) return destination;
          new Uint8Array(calculator.memory.buffer).copyWithin(destination, source, source + count);
          return destination;
        },
      },
    };
    const instantiated = await WebAssembly.instantiate(calculatorWasm, imports);
    calculator = instantiated.exports as unknown as CalculatorExports;
    if (
      typeof calculator.__wasm_call_ctors !== "function" ||
      typeof calculator.whc_calculate_summary_with_characteristic_roll !== "function" ||
      typeof calculator.whc_calculate_ordered_volley_summary !== "function" ||
      typeof calculator.whc_estimate_ordered_volley_complexity !== "function" ||
      typeof calculator.whc_replay_battle_health_events !== "function" ||
      typeof calculator.whc_ranged_target_eligibility_is_valid !== "function" ||
      typeof calculator.whc_ranged_geometry_resolution_is_valid !== "function" ||
      typeof calculator.whc_weapon_inventory_declaration_is_valid !== "function" ||
      typeof calculator.whc_weapon_bearer_declaration_is_valid !== "function" ||
      typeof calculator.whc_charge_resolution_is_valid !== "function" ||
      typeof calculator.whc_fight_move_is_valid !== "function" ||
      typeof calculator.whc_heroic_intervention_is_valid !== "function" ||
      typeof calculator.whc_fire_overwatch_is_valid !== "function" ||
      typeof calculator.whc_hazardous_resolution_is_valid !== "function" ||
      typeof calculator.whc_desperate_escape_test_is_valid !== "function" ||
      typeof calculator.whc_go_to_ground_is_valid !== "function" ||
      typeof calculator.whc_smokescreen_is_valid !== "function" ||
      typeof calculator.whc_rapid_ingress_is_valid !== "function" ||
      typeof calculator.whc_counter_offensive_is_valid !== "function" ||
      typeof calculator.whc_ranged_declaration_is_valid !== "function" ||
      typeof calculator.whc_transport_load_is_valid !== "function" ||
      typeof calculator.whc_transport_deployment_chain_is_valid !== "function" ||
      typeof calculator.whc_initial_deployment_is_valid !== "function" ||
      typeof calculator.whc_table_geometry_is_valid !== "function" ||
      typeof calculator.whc_terrain_footprint_set_is_valid !== "function" ||
      typeof calculator.whc_model_placement_set_is_valid !== "function" ||
      typeof calculator.whc_model_position_set_is_valid !== "function" ||
      typeof calculator.whc_spatial_facts_are_valid !== "function" ||
      typeof calculator.whc_endpoint_clearance_facts_are_valid !== "function" ||
      typeof calculator.whc_terrain_clearance_facts_are_valid !== "function" ||
      typeof calculator.whc_mission_tracker_facts_are_valid !== "function" ||
      typeof calculator.whc_reanimation_protocols_transition_is_valid !== "function" ||
      typeof calculator.whc_shadow_in_the_warp_test_is_valid !== "function" ||
      typeof calculator.whc_command_battle_shock_test_is_valid !== "function" ||
      typeof calculator.whc_objective_control_facts_are_valid !== "function" ||
      typeof calculator.whc_visibility_facts_are_valid !== "function" ||
      typeof calculator.whc_start_battle_clock !== "function" ||
      typeof calculator.whc_next_battle_clock !== "function"
    ) {
      throw new ServiceUnavailableError(
        "Calculator engine exports are invalid",
        "CALCULATOR_ENGINE_INVALID",
      );
    }
    calculator.__wasm_call_ctors();
    return calculator;
  })().catch((error: unknown) => {
    calculatorPromise = null;
    if (error instanceof ServiceUnavailableError) throw error;
    throw new ServiceUnavailableError(
      "Calculator engine could not be loaded",
      "CALCULATOR_ENGINE_UNAVAILABLE",
    );
  });
  return calculatorPromise;
}

const BATTLE_CLOCK_FIELDS = 8;
const BATTLE_CLOCK_STATUS = { setup: 0, active: 1, complete: 2 } as const;
const BATTLE_CLOCK_PHASE = {
  setup: 0,
  command: 1,
  movement: 2,
  shooting: 3,
  charge: 4,
  fight: 5,
  complete: 6,
} as const;

function battleClockWords(
  clock: ReturnType<typeof replayBattleState>["clock"],
  players: unknown[],
) {
  const playerIds = players.map((candidate) => (candidate as { id: string }).id);
  const playerIndex = (id: string) => (id ? playerIds.indexOf(id) : 2);
  const steps = BATTLE_PHASE_STEPS[clock.phase as keyof typeof BATTLE_PHASE_STEPS];
  return [
    BATTLE_CLOCK_STATUS[clock.status as keyof typeof BATTLE_CLOCK_STATUS],
    clock.battleRound,
    clock.turn,
    BATTLE_CLOCK_PHASE[clock.phase as keyof typeof BATTLE_CLOCK_PHASE],
    steps ? steps.indexOf(clock.step) : 0,
    playerIndex(clock.firstPlayerId),
    playerIndex(clock.activePlayerId),
    playerIndex(clock.priorityPlayerId),
  ];
}

function assertBattleClockWords(
  calculator: CalculatorExports,
  pointer: number,
  expectedClock: ReturnType<typeof replayBattleState>["clock"],
  players: unknown[],
) {
  const actual = [...new Uint32Array(calculator.memory.buffer, pointer, BATTLE_CLOCK_FIELDS)];
  const expected = battleClockWords(expectedClock, players);
  if (actual.some((value, index) => value !== expected[index])) {
    throw new ServiceUnavailableError(
      "Canonical battle clock diverged from the web replay",
      "BATTLE_CLOCK_DIVERGENCE",
    );
  }
}

function verifyBattleClock(
  state: ReturnType<typeof normalizeBattleState>,
  calculator: CalculatorExports,
) {
  const start = state.events.find((event) => event.type === "battle_started");
  if (!start || start.type !== "battle_started") return;
  const firstPlayerIndex = state.players.findIndex((player) => player.id === start.firstPlayerId);
  const currentPointer = calculator.malloc(BATTLE_CLOCK_FIELDS * 4);
  const nextPointer = calculator.malloc(BATTLE_CLOCK_FIELDS * 4);
  if (!currentPointer || !nextPointer) {
    if (currentPointer) calculator.free(currentPointer);
    if (nextPointer) calculator.free(nextPointer);
    throw new ServiceUnavailableError(
      "Battle clock replay memory is unavailable",
      "BATTLE_CLOCK_MEMORY",
    );
  }
  try {
    if (!calculator.whc_start_battle_clock(firstPlayerIndex, currentPointer)) {
      throw new ServiceUnavailableError(
        "Canonical battle clock rejected the battle start",
        "BATTLE_CLOCK_DIVERGENCE",
      );
    }
    assertBattleClockWords(calculator, currentPointer, start.clock, state.players);
    for (const event of state.events) {
      if (event.type !== "clock_advanced") continue;
      new Uint32Array(calculator.memory.buffer, currentPointer, BATTLE_CLOCK_FIELDS).set(
        battleClockWords(event.from, state.players),
      );
      if (!calculator.whc_next_battle_clock(currentPointer, nextPointer)) {
        throw new ServiceUnavailableError(
          "Canonical battle clock rejected a valid transition",
          "BATTLE_CLOCK_DIVERGENCE",
        );
      }
      assertBattleClockWords(calculator, nextPointer, event.to, state.players);
    }
  } finally {
    calculator.free(currentPointer);
    calculator.free(nextPointer);
  }
}

async function replayFormationHealth(
  candidate: unknown,
  requestedFormationId: unknown,
  request: Request,
  env: Env,
) {
  if (typeof requestedFormationId !== "string" || !requestedFormationId) {
    throw new Error("formationId must be a non-empty string");
  }
  const state = normalizeBattleState(candidate);
  const replayedState = replayBattleState(state);
  if (state.version >= RULE_COVERAGE_BATTLE_STATE_VERSION) {
    if (!replayedState.ruleCoverage) {
      throw new Error("Battle state is missing source-locked rule selections");
    }
    const coverage = verifyBattleRuleCoverageBinding(
      await loadRuleCoverage(request, env),
      replayedState.ruleCoverage,
    );
    const checked = await checkedRuleCoverage(
      request,
      env,
      battleRuleSelectionIds(coverage.plan).map((id) => ({
        id,
        acknowledgement: coverage.plan.acknowledgements[id] ?? "",
      })),
    );
    if (JSON.stringify(checked) !== JSON.stringify(coverage.report)) {
      throw new ServiceUnavailableError(
        "Battle rule coverage diverged from the canonical engines",
        "BATTLE_RULE_COVERAGE_DIVERGENCE",
      );
    }
  }
  const registration = state.events.find(
    (event) => event.type === "formation_registered" && event.formation.id === requestedFormationId,
  );
  if (!registration || registration.type !== "formation_registered") {
    throw new Error("formationId is not registered in the battle state");
  }
  const formation = battleFormation(state, requestedFormationId);
  if (!formation) throw new Error("formationId is not registered in the battle state");
  const segmentIndices = new Map(formation.segments.map((segment, index) => [segment.id, index]));
  const selectedEvents: Array<{
    event: (typeof state.events)[number];
    transportPassenger?: {
      summary: { damage: number; modelsDestroyed: number };
      allocations: Array<{
        segmentId: string;
        before: { modelsRemaining: number; woundsLost: number };
        after: { modelsRemaining: number; woundsLost: number };
      }>;
    };
    hazardousAllocation?: {
      summary: { damage: number; modelsDestroyed: number };
      allocation: {
        segmentId: string;
        before: { modelsRemaining: number; woundsLost: number };
        after: { modelsRemaining: number; woundsLost: number };
      };
    };
    desperateEscapeAllocation?: {
      summary: { damage: number; modelsDestroyed: number };
      allocations: Array<{
        segmentId: string;
        before: { modelsRemaining: number; woundsLost: number };
        after: { modelsRemaining: number; woundsLost: number };
      }>;
    };
  }> = [];
  const attackIndices = new Map<string, number>();
  for (const event of state.events) {
    if (event.type === "attack_resolved" && event.targetFormationId === requestedFormationId) {
      attackIndices.set(event.id, selectedEvents.length);
      selectedEvents.push({ event });
    } else if (event.type === "attack_reverted" && attackIndices.has(event.revertsEventId)) {
      selectedEvents.push({ event });
    } else if (event.type === "transport_destroyed_resolved") {
      const transportPassenger = event.passengers.find(
        (passenger) => passenger.formationId === requestedFormationId,
      );
      if (transportPassenger) selectedEvents.push({ event, transportPassenger });
    } else if (
      event.type === "hazardous_damage_resolved" &&
      event.formationId === requestedFormationId &&
      event.allocation
    ) {
      selectedEvents.push({
        event,
        hazardousAllocation: { summary: event.summary, allocation: event.allocation },
      });
    } else if (
      event.type === "reanimation_wound_resolved" &&
      event.formationId === requestedFormationId
    ) {
      selectedEvents.push({ event });
    } else if (
      event.type === "desperate_escape_casualties_resolved" &&
      event.formationId === requestedFormationId
    ) {
      selectedEvents.push({
        event,
        desperateEscapeAllocation: {
          summary: event.summary,
          allocations: event.allocations,
        },
      });
    }
  }

  const profileFields = 2;
  const eventFields = 166;
  const eventHeaderFields = 6;
  const allocationFields = 5;
  const profiles = new Uint32Array(formation.segments.length * profileFields);
  formation.segments.forEach((segment, index) => {
    profiles[index * profileFields] = segment.wounds;
    profiles[index * profileFields + 1] = segment.startingModels;
  });
  const events = new Uint32Array(selectedEvents.length * eventFields);
  selectedEvents.forEach(
    ({ event, transportPassenger, hazardousAllocation, desperateEscapeAllocation }, index) => {
      const offset = index * eventFields;
      events[offset] = event.version;
      if (event.type === "attack_resolved") {
        events[offset + 1] = 1;
        events[offset + 2] = event.allocations.length;
        events[offset + 4] = event.summary.damage;
        events[offset + 5] = event.summary.modelsDestroyed;
        event.allocations.forEach((allocation, allocationIndex) => {
          const segmentIndex = segmentIndices.get(allocation.segmentId);
          if (segmentIndex === undefined) throw new Error("Attack allocation segment is unknown");
          const allocationOffset = offset + eventHeaderFields + allocationIndex * allocationFields;
          events[allocationOffset] = segmentIndex;
          events[allocationOffset + 1] = allocation.before.modelsRemaining;
          events[allocationOffset + 2] = allocation.before.woundsLost;
          events[allocationOffset + 3] = allocation.after.modelsRemaining;
          events[allocationOffset + 4] = allocation.after.woundsLost;
        });
      } else if (event.type === "attack_reverted") {
        events[offset + 1] = 2;
        events[offset + 3] = attackIndices.get(event.revertsEventId) ?? 0xffffffff;
      } else if (event.type === "transport_destroyed_resolved" && transportPassenger) {
        events[offset + 1] = 3;
        events[offset + 2] = transportPassenger.allocations.length;
        events[offset + 4] = transportPassenger.summary.damage;
        events[offset + 5] = transportPassenger.summary.modelsDestroyed;
        transportPassenger.allocations.forEach((allocation, allocationIndex) => {
          const segmentIndex = segmentIndices.get(allocation.segmentId);
          if (segmentIndex === undefined) {
            throw new Error("Transport allocation segment is unknown");
          }
          const allocationOffset = offset + eventHeaderFields + allocationIndex * allocationFields;
          events[allocationOffset] = segmentIndex;
          events[allocationOffset + 1] = allocation.before.modelsRemaining;
          events[allocationOffset + 2] = allocation.before.woundsLost;
          events[allocationOffset + 3] = allocation.after.modelsRemaining;
          events[allocationOffset + 4] = allocation.after.woundsLost;
        });
      } else if (event.type === "hazardous_damage_resolved" && hazardousAllocation) {
        const allocation = hazardousAllocation.allocation;
        const segmentIndex = segmentIndices.get(allocation.segmentId);
        if (segmentIndex === undefined) throw new Error("Hazardous allocation segment is unknown");
        events[offset + 1] = 4;
        events[offset + 2] = 1;
        events[offset + 4] = hazardousAllocation.summary.damage;
        events[offset + 5] = hazardousAllocation.summary.modelsDestroyed;
        const allocationOffset = offset + eventHeaderFields;
        events[allocationOffset] = segmentIndex;
        events[allocationOffset + 1] = allocation.before.modelsRemaining;
        events[allocationOffset + 2] = allocation.before.woundsLost;
        events[allocationOffset + 3] = allocation.after.modelsRemaining;
        events[allocationOffset + 4] = allocation.after.woundsLost;
      } else if (event.type === "reanimation_wound_resolved") {
        const segmentIndex = segmentIndices.get(event.segmentId);
        if (segmentIndex === undefined) {
          throw new Error("Reanimation Protocols allocation segment is unknown");
        }
        events[offset + 1] = event.action === "heal" ? 5 : 6;
        events[offset + 2] = 1;
        const allocationOffset = offset + eventHeaderFields;
        events[allocationOffset] = segmentIndex;
        events[allocationOffset + 1] = event.before.modelsRemaining;
        events[allocationOffset + 2] = event.before.woundsLost;
        events[allocationOffset + 3] = event.after.modelsRemaining;
        events[allocationOffset + 4] = event.after.woundsLost;
      } else if (
        event.type === "desperate_escape_casualties_resolved" &&
        desperateEscapeAllocation
      ) {
        events[offset + 1] = 7;
        events[offset + 2] = desperateEscapeAllocation.allocations.length;
        events[offset + 4] = desperateEscapeAllocation.summary.damage;
        events[offset + 5] = desperateEscapeAllocation.summary.modelsDestroyed;
        desperateEscapeAllocation.allocations.forEach((allocation, allocationIndex) => {
          const segmentIndex = segmentIndices.get(allocation.segmentId);
          if (segmentIndex === undefined) {
            throw new Error("Desperate Escape allocation segment is unknown");
          }
          const allocationOffset = offset + eventHeaderFields + allocationIndex * allocationFields;
          events[allocationOffset] = segmentIndex;
          events[allocationOffset + 1] = allocation.before.modelsRemaining;
          events[allocationOffset + 2] = allocation.before.woundsLost;
          events[allocationOffset + 3] = allocation.after.modelsRemaining;
          events[allocationOffset + 4] = allocation.after.woundsLost;
        });
      }
    },
  );

  const calculator = await loadCalculator();
  const profilesPointer = calculator.malloc(profiles.byteLength);
  const eventsPointer = events.byteLength > 0 ? calculator.malloc(events.byteLength) : 0;
  const healthPointer = calculator.malloc(formation.segments.length * 2 * 4);
  if (!profilesPointer || !healthPointer || (events.byteLength > 0 && !eventsPointer)) {
    if (profilesPointer) calculator.free(profilesPointer);
    if (eventsPointer) calculator.free(eventsPointer);
    if (healthPointer) calculator.free(healthPointer);
    throw new ServiceUnavailableError(
      "Battle replay memory is unavailable",
      "BATTLE_REPLAY_MEMORY",
    );
  }
  try {
    verifyBattleClock(state, calculator);
    if (replayedState.tableGeometry) {
      const geometry = replayedState.tableGeometry;
      const values = [
        geometry.battlefieldWidthThousandths,
        geometry.battlefieldHeightThousandths,
        geometry.objectivePositions.length,
        new Set(
          geometry.objectivePositions.map(
            (objective) => `${objective.xThousandths}:${objective.yThousandths}`,
          ),
        ).size,
        geometry.terrainProfile.sectionCount,
        geometry.terrainProfile.sixByFourCount,
        geometry.terrainProfile.tenByFiveCount,
        geometry.terrainProfile.twelveBySixCount,
        tableGeometryFlags(geometry, true),
      ];
      const javascriptValid = tableGeometryIsValid(geometry, true);
      const nativeValid = Boolean(calculator.whc_table_geometry_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Table geometry diverged from the C/WebAssembly predicate",
          "TABLE_GEOMETRY_DIVERGENCE",
        );
      }
    }
    if (replayedState.terrainFootprints) {
      const terrain = replayedState.terrainFootprints;
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
      const javascriptValid = terrainFootprintSetIsValid(terrain, true);
      const nativeValid = Boolean(calculator.whc_terrain_footprint_set_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Terrain footprints diverged from the C/WebAssembly predicate",
          "TERRAIN_FOOTPRINT_DIVERGENCE",
        );
      }
    }
    for (const [formationId, placement] of replayedState.modelPlacementsByFormation) {
      const formation = replayedState.formations.get(formationId);
      if (!formation) {
        throw new ServiceUnavailableError(
          "Model placement references an absent formation",
          "MODEL_PLACEMENT_DIVERGENCE",
        );
      }
      const expectedModelIds = formation.modelInstances.map((model: { id: string }) => model.id);
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
      const javascriptValid = modelPlacementSetIsValid(placement, expectedModelIds, true);
      const nativeValid = Boolean(calculator.whc_model_placement_set_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Model placement diverged from the C/WebAssembly predicate",
          "MODEL_PLACEMENT_DIVERGENCE",
        );
      }
    }
    for (const [formationId, position] of replayedState.currentModelPositionsByFormation) {
      if (
        position.context === "deployment" ||
        replayedState.geometryStaleFormationIds.has(formationId)
      ) {
        continue;
      }
      const formation = replayedState.formations.get(formationId);
      const history = replayedState.modelPositionHistoryByFormation.get(formationId) ?? [];
      const previous = history.length > 1 ? history.at(-2) : null;
      if (!formation) {
        throw new ServiceUnavailableError(
          "Model position references an absent formation",
          "MODEL_POSITION_DIVERGENCE",
        );
      }
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
      const javascriptValid = modelPositionSetIsValid(position, formation, previous, true);
      const nativeValid = Boolean(calculator.whc_model_position_set_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Model position diverged from the C/WebAssembly predicate",
          "MODEL_POSITION_DIVERGENCE",
        );
      }
    }
    for (const fact of replayedState.spatialFactsByFormation.values()) {
      if (!fact.executable) continue;
      const values = spatialFactValues(fact);
      const javascriptValid = spatialFactValuesAreValid(...values);
      const nativeValid = Boolean(calculator.whc_spatial_facts_are_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Executable spatial facts diverged from the C/WebAssembly predicate",
          "SPATIAL_FACTS_DIVERGENCE",
        );
      }
    }
    {
      const fact = replayedState.endpointClearanceFacts;
      const values = endpointClearanceFactValues(fact);
      const javascriptValid = endpointClearanceFactValuesAreValid(...values);
      const nativeValid = Boolean(calculator.whc_endpoint_clearance_facts_are_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Endpoint clearance diverged from the C/WebAssembly predicate",
          "ENDPOINT_CLEARANCE_DIVERGENCE",
        );
      }
    }
    for (const fact of replayedState.terrainClearanceFactsByFormation.values()) {
      const values = terrainClearanceFactValues(fact);
      const javascriptValid = terrainClearanceFactValuesAreValid(...values);
      const nativeValid = Boolean(calculator.whc_terrain_clearance_facts_are_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Terrain clearance diverged from the C/WebAssembly predicate",
          "TERRAIN_CLEARANCE_DIVERGENCE",
        );
      }
    }
    for (const player of state.players) {
      const fact = missionTrackerFacts(state, player.id);
      const javascriptValid = missionTrackerFactsAreValid(...fact.values);
      const nativeValid = Boolean(calculator.whc_mission_tracker_facts_are_valid(...fact.values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Mission tracker diverged from the C/WebAssembly predicate",
          "MISSION_TRACKER_DIVERGENCE",
        );
      }
    }
    for (const fact of replayedState.objectiveControlFacts.values()) {
      if (!fact.executable) continue;
      const values = objectiveControlFactValues(fact);
      const javascriptValid = objectiveControlFactValuesAreValid(...values);
      const nativeValid = Boolean(calculator.whc_objective_control_facts_are_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Executable objective control diverged from the C/WebAssembly predicate",
          "OBJECTIVE_CONTROL_DIVERGENCE",
        );
      }
    }
    for (const targetFacts of replayedState.visibilityFactsByFormation.values()) {
      for (const fact of targetFacts.values()) {
        if (!fact.executable) continue;
        const values = visibilityFactValues(fact);
        const javascriptValid = visibilityFactValuesAreValid(...values);
        const nativeValid = Boolean(calculator.whc_visibility_facts_are_valid(...values));
        if (!javascriptValid || javascriptValid !== nativeValid) {
          throw new ServiceUnavailableError(
            "Executable visibility facts diverged from the C/WebAssembly predicate",
            "VISIBILITY_FACTS_DIVERGENCE",
          );
        }
      }
    }
    new Uint32Array(calculator.memory.buffer, profilesPointer, profiles.length).set(profiles);
    if (eventsPointer) {
      new Uint32Array(calculator.memory.buffer, eventsPointer, events.length).set(events);
    }
    const ok = calculator.whc_replay_battle_health_events(
      profilesPointer,
      formation.segments.length,
      eventsPointer,
      selectedEvents.length,
      healthPointer,
    );
    if (!ok) {
      throw new ServiceUnavailableError(
        "Canonical battle replay diverged from the calculator engine",
        "BATTLE_REPLAY_DIVERGENCE",
      );
    }
    const result = new Uint32Array(
      calculator.memory.buffer,
      healthPointer,
      formation.segments.length * 2,
    );
    const health = Object.fromEntries(
      formation.segments.map((segment, index) => [
        segment.id,
        { modelsRemaining: result[index * 2], woundsLost: result[index * 2 + 1] },
      ]),
    );
    const expected = battleFormationHealth(state, requestedFormationId);
    if (JSON.stringify(health) !== JSON.stringify(expected)) {
      throw new ServiceUnavailableError(
        "Canonical battle replay diverged from the web replay",
        "BATTLE_REPLAY_DIVERGENCE",
      );
    }
    const replayed = replayedState;
    const targetEligibilityFacts = [...replayed.targetEligibilityFacts.values()]
      .map((fact) => {
        const flags =
          (fact.visible ? 1 : 0) |
          (fact.fullyVisible ? 2 : 0) |
          (fact.indirectFire ? 4 : 0) |
          (fact.weaponHasIndirect ? 8 : 0) |
          (fact.reviewedByPlayer ? 16 : 0) |
          (fact.rangeOverrideReason ? 32 : 0);
        const declaredWeaponCount = fact.declaredWeaponCount || fact.eligibleWeaponCount;
        const javascriptEligible = rangedTargetEligibilityIsValid(fact, declaredWeaponCount);
        const nativeEligible = Boolean(
          calculator.whc_ranged_target_eligibility_is_valid(
            fact.publishedRangeThousandths,
            fact.effectiveRangeThousandths,
            fact.measuredDistanceThousandths,
            fact.eligibleWeaponCount,
            declaredWeaponCount,
            flags,
          ),
        );
        if (javascriptEligible !== nativeEligible) {
          throw new ServiceUnavailableError(
            "Canonical ranged target eligibility diverged from the web replay",
            "TARGET_ELIGIBILITY_DIVERGENCE",
          );
        }
        if (fact.geometryDecision) {
          const coverProvenCount = fact.geometryDecision.cover.filter(
            (entry: { resolution: string }) => entry.resolution === "geometry_proof",
          ).length;
          const geometryValues = [
            fact.geometryDecision.observerModelIds.length,
            fact.geometryDecision.provenObserverModelIds.length,
            fact.geometryDecision.targetModelIds.length,
            coverProvenCount,
            fact.geometryDecision.cover.length - coverProvenCount,
            fact.geometryDecision.flags,
          ];
          const javascriptGeometry = rangedGeometryResolutionIsValid(...geometryValues);
          const nativeGeometry = Boolean(
            calculator.whc_ranged_geometry_resolution_is_valid(...geometryValues),
          );
          if (!javascriptGeometry || javascriptGeometry !== nativeGeometry) {
            throw new ServiceUnavailableError(
              "Canonical ranged geometry diverged from the C/WebAssembly predicate",
              "RANGED_GEOMETRY_DIVERGENCE",
            );
          }
        }
        return { ...fact, eligible: javascriptEligible };
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    const rangedDeclarationSets = replayed.rangedDeclarationSets.map((event) => {
      const values = [
        event.declarationCount,
        event.uniqueDeclarationCount,
        event.targetRunCount,
        event.uniqueTargetCount,
        event.profileRunCount,
        event.uniqueTargetProfileCount,
        event.flags,
      ];
      const javascriptValid = rangedDeclarationIsValid(...values);
      const nativeValid = Boolean(calculator.whc_ranged_declaration_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Activation-wide ranged declarations diverged from the C/WebAssembly predicate",
          "RANGED_DECLARATION_DIVERGENCE",
        );
      }
      return {
        eventId: event.id,
        activationEventId: event.activationEventId,
        declarationEventIds: [...event.declarationEventIds],
        declarationCount: event.declarationCount,
        uniqueTargetCount: event.uniqueTargetCount,
        uniqueTargetProfileCount: event.uniqueTargetProfileCount,
        reactionOrder: event.reactionOrder || null,
        flags: event.flags,
      };
    });
    const activeAttackIds = new Set(replayed.activeAttackIds);
    const weaponUses = new Map<string, number>();
    const weaponDeclarations = state.events.flatMap((event, eventIndex) => {
      if (
        event.type !== "attack_resolved" ||
        event.weaponType !== "Ranged" ||
        !activeAttackIds.has(event.id) ||
        !event.weaponSourceFormationId ||
        !event.sourceSavedUnitId ||
        !event.weaponGroupId ||
        !event.clock
      ) {
        return [];
      }
      const source = replayed.formations.get(event.weaponSourceFormationId);
      const group = source?.weaponInventory.find(
        (candidate) =>
          candidate.sourceSavedUnitId === event.sourceSavedUnitId &&
          candidate.groupId === event.weaponGroupId,
      );
      const profile = group?.profiles.find((candidate) => candidate.weaponId === event.weaponId);
      if (!group || !profile) {
        throw new ServiceUnavailableError(
          "Canonical weapon declaration lost its locked inventory",
          "WEAPON_INVENTORY_DIVERGENCE",
        );
      }
      const key = `${event.clock.battleRound}:${event.clock.turn}:${event.clock.phase}:${event.weaponSourceFormationId}:${event.sourceSavedUnitId}:${event.weaponGroupId}`;
      const usedBefore = weaponUses.get(key) ?? 0;
      const inventoryFlags = (profile.hasAssault ? 1 : 0) | (profile.hasIndirect ? 2 : 0);
      const declaredFlags = (event.weaponHasAssault ? 1 : 0) | (event.indirectFire ? 2 : 0);
      const exactBearers = source.weaponBearerTracking === "exact";
      const survivingBearerCount = exactBearers
        ? battleSurvivingWeaponCount(
            { ...state, events: state.events.slice(0, eventIndex) },
            event.weaponSourceFormationId,
            event.sourceSavedUnitId,
            event.weaponGroupId,
          )
        : group.count;
      const declarationValues = [
        group.count,
        exactBearers ? survivingBearerCount : 1,
        usedBefore,
        event.declaredWeaponCount,
        inventoryFlags,
        declaredFlags,
      ];
      const javascriptEligible = exactBearers
        ? weaponBearerDeclarationIsValid(...declarationValues)
        : weaponInventoryDeclarationIsValid(...declarationValues);
      const nativeEligible = Boolean(
        exactBearers
          ? calculator.whc_weapon_bearer_declaration_is_valid(...declarationValues)
          : calculator.whc_weapon_inventory_declaration_is_valid(
              group.count,
              1,
              usedBefore,
              event.declaredWeaponCount,
              inventoryFlags,
              declaredFlags,
            ),
      );
      if (!javascriptEligible || javascriptEligible !== nativeEligible) {
        throw new ServiceUnavailableError(
          "Canonical weapon declaration diverged from the C/WebAssembly predicate",
          "WEAPON_INVENTORY_DIVERGENCE",
        );
      }
      weaponUses.set(key, usedBefore + event.declaredWeaponCount);
      return [
        {
          attackEventId: event.id,
          weaponSourceFormationId: event.weaponSourceFormationId,
          sourceSavedUnitId: event.sourceSavedUnitId,
          weaponGroupId: event.weaponGroupId,
          weaponId: event.weaponId,
          inventoryCount: group.count,
          bearerTracking: source.weaponBearerTracking,
          survivingBearerCount: exactBearers ? survivingBearerCount : null,
          usedBefore,
          declaredWeaponCount: event.declaredWeaponCount,
          eligible: true,
        },
      ];
    });
    const charges = [...replayed.chargeByFormation.values()]
      .map((event) => {
        if (!Array.isArray(event.targetFacts)) {
          return {
            formationId: event.formationId,
            targetFormationIds: event.targetFormationIds,
            successful: event.successful,
            roll: event.roll,
            targetEligibilityConfirmed: event.targetEligibilityConfirmed,
            targetEligibilityReason: event.targetEligibilityReason,
            eligibilityOverride: event.eligibilityOverride,
            overrideReason: event.overrideReason,
            clock: event.clock,
            canonicalMovement: false,
          };
        }
        const maximumTargetDistanceThousandths = Math.max(
          ...event.targetFacts.map((fact) => fact.startDistanceThousandths),
        );
        const flags = chargeResolutionFlags(event);
        const values = [
          event.rolls[0],
          event.rolls[1],
          event.rollModifier,
          event.chargeDistanceThousandths,
          maximumTargetDistanceThousandths,
          event.maximumModelMoveThousandths,
          event.targetFacts.length,
          event.successful ? 1 : 0,
          flags,
        ];
        const javascriptValid = chargeResolutionIsValid(...values);
        const nativeValid = Boolean(calculator.whc_charge_resolution_is_valid(...values));
        if (!javascriptValid || javascriptValid !== nativeValid) {
          throw new ServiceUnavailableError(
            "Canonical charge movement diverged from the C/WebAssembly predicate",
            "CHARGE_RESOLUTION_DIVERGENCE",
          );
        }
        return {
          formationId: event.formationId,
          targetFormationIds: event.targetFormationIds,
          successful: event.successful,
          rolls: event.rolls,
          rollModifier: event.rollModifier,
          chargeDistanceThousandths: event.chargeDistanceThousandths,
          rollOverrideReason: event.rollOverrideReason,
          targetFacts: event.targetFacts,
          phaseStartEligibilityConfirmed: event.phaseStartEligibilityConfirmed,
          phaseStartEligibilityReason: event.phaseStartEligibilityReason,
          startedOutsideEngagementRange: event.startedOutsideEngagementRange,
          maximumModelMoveThousandths: event.maximumModelMoveThousandths,
          unitCoherencyConfirmed: event.unitCoherencyConfirmed,
          nonTargetEngagementRangeAvoided: event.nonTargetEngagementRangeAvoided,
          allModelsCloserToTarget: event.allModelsCloserToTarget,
          baseContactMaximized: event.baseContactMaximized,
          movementReviewedByPlayer: event.movementReviewedByPlayer,
          movementReviewReason: event.movementReviewReason,
          failureReason: event.failureReason,
          eligibilityOverride: event.eligibilityOverride,
          overrideReason: event.overrideReason,
          clock: event.clock,
          canonicalMovement: true,
          ...(event.source
            ? {
                source: event.source,
                receivesChargeBonus: event.receivesChargeBonus !== false,
              }
            : {}),
        };
      })
      .sort((left, right) => left.formationId.localeCompare(right.formationId));
    const heroicInterventions = replayed.heroicInterventions.map((event) => {
      const chargeFlags = heroicInterventionChargeFlags(event);
      const heroicFlags = heroicInterventionFlags(event);
      const values = [
        event.rolls[0],
        event.rolls[1],
        event.rollModifier,
        event.chargeDistanceThousandths,
        event.targetFacts[0].startDistanceThousandths,
        event.maximumModelMoveThousandths,
        event.successful ? 1 : 0,
        chargeFlags,
        heroicFlags,
      ];
      const javascriptValid = heroicInterventionIsValid(...values);
      const nativeValid = Boolean(calculator.whc_heroic_intervention_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Heroic Intervention diverged from the C/WebAssembly predicate",
          "HEROIC_INTERVENTION_DIVERGENCE",
        );
      }
      return {
        eventId: event.id,
        triggerChargeEventId: event.triggerChargeEventId,
        formationId: event.formationId,
        targetFormationId: event.targetFormationIds[0],
        commandPointCost: event.commandPointCost,
        commandPointsBefore: event.commandPointsBefore,
        commandPointsAfter: event.commandPointsAfter,
        costOverrideReason: event.costOverrideReason,
        usageOverrideReason: event.usageOverrideReason,
        stratagemEligibilityOverrideReason: event.stratagemEligibilityOverrideReason,
        rolls: event.rolls,
        rollModifier: event.rollModifier,
        chargeDistanceThousandths: event.chargeDistanceThousandths,
        rollOverrideReason: event.rollOverrideReason,
        startDistanceThousandths: event.targetFacts[0].startDistanceThousandths,
        targetEligibilityConfirmed: event.targetEligibilityConfirmed,
        targetEligibilityReason: event.targetEligibilityReason,
        startedOutsideEngagementRange: event.startedOutsideEngagementRange,
        maximumModelMoveThousandths: event.maximumModelMoveThousandths,
        endsWithinEngagementRangeOfTarget: event.targetFacts[0].endsWithinEngagementRange,
        unitCoherencyConfirmed: event.unitCoherencyConfirmed,
        nonTargetEngagementRangeAvoided: event.nonTargetEngagementRangeAvoided,
        allModelsCloserToTarget: event.allModelsCloserToTarget,
        baseContactMaximized: event.baseContactMaximized,
        movementReviewedByPlayer: event.movementReviewedByPlayer,
        movementReviewReason: event.movementReviewReason,
        vehicleRestrictionSatisfied: event.vehicleRestrictionSatisfied,
        soleTriggerTargetConfirmed: event.soleTriggerTargetConfirmed,
        chargeBonusSuppressedConfirmed: event.chargeBonusSuppressedConfirmed,
        successful: event.successful,
        failureReason: event.failureReason,
        receivesChargeBonus: false,
        clock: event.clock,
      };
    });
    const fireOverwatches = replayed.fireOverwatches.map((event) => {
      const values = [
        FIRE_OVERWATCH_TRIGGERS.indexOf(event.trigger) + 1,
        event.clock.phase === "movement" ? 2 : 4,
        event.distanceThousandths,
        fireOverwatchFlags(event),
      ];
      const javascriptValid = fireOverwatchIsValid(
        event.trigger,
        event.clock.phase,
        event.distanceThousandths,
        values[3],
      );
      const nativeValid = Boolean(calculator.whc_fire_overwatch_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Fire Overwatch diverged from the C/WebAssembly predicate",
          "FIRE_OVERWATCH_DIVERGENCE",
        );
      }
      return {
        eventId: event.id,
        triggerEventId: event.triggerEventId,
        trigger: event.trigger,
        formationId: event.formationId,
        targetFormationId: event.targetFormationId,
        commandPointCost: event.commandPointCost,
        commandPointsBefore: event.commandPointsBefore,
        commandPointsAfter: event.commandPointsAfter,
        costOverrideReason: event.costOverrideReason,
        usageOverrideReason: event.usageOverrideReason,
        stratagemEligibilityOverrideReason: event.stratagemEligibilityOverrideReason,
        distanceThousandths: event.distanceThousandths,
        targetVisible: event.targetVisible,
        shootingEligibilityConfirmed: event.shootingEligibilityConfirmed,
        shootingEligibilityReason: event.shootingEligibilityReason,
        outOfPhaseRestrictionsConfirmed: event.outOfPhaseRestrictionsConfirmed,
        outOfPhaseRestrictionsReason: event.outOfPhaseRestrictionsReason,
        hitsOnUnmodifiedSixConfirmed: event.hitsOnUnmodifiedSixConfirmed,
        criticalHitsOnSixConfirmed: event.criticalHitsOnSixConfirmed,
        titanicRestrictionSatisfied: event.titanicRestrictionSatisfied,
        clock: event.clock,
      };
    });
    const goToGrounds = state.events
      .filter((event) => event.type === "go_to_ground_resolved")
      .map((event) => {
        const target = replayed.formations.get(event.targetFormationId);
        if (!target) {
          throw new ServiceUnavailableError(
            "Go to Ground target is unavailable",
            "GO_TO_GROUND_DIVERGENCE",
          );
        }
        const flags = goToGroundFlags(
          event,
          target.keywords.includes("infantry"),
          target.playerId === event.playerId,
        );
        const values = [
          3,
          event.commandPointsBefore,
          event.commandPointCost,
          event.commandPointsAfter,
          0,
          0,
          flags,
        ];
        const javascriptValid = goToGroundIsValid(
          "shooting",
          event.commandPointsBefore,
          event.commandPointCost,
          event.commandPointsAfter,
          false,
          false,
          flags,
        );
        const nativeValid = Boolean(calculator.whc_go_to_ground_is_valid(...values));
        if (!javascriptValid || javascriptValid !== nativeValid) {
          throw new ServiceUnavailableError(
            "Go to Ground diverged from the C/WebAssembly predicate",
            "GO_TO_GROUND_DIVERGENCE",
          );
        }
        const effect = replayed.goToGrounds.find((candidate) => candidate.id === event.id);
        if (!effect) {
          throw new ServiceUnavailableError(
            "Go to Ground lost its phase effect",
            "GO_TO_GROUND_DIVERGENCE",
          );
        }
        return {
          eventId: event.id,
          triggerEventId: event.triggerEventId,
          playerId: event.playerId,
          targetFormationId: event.targetFormationId,
          commandPointCost: event.commandPointCost,
          commandPointsBefore: event.commandPointsBefore,
          commandPointsAfter: event.commandPointsAfter,
          allModelsHaveSixPlusInvulnerable: event.allModelsHaveSixPlusInvulnerable,
          allModelsHaveBenefitOfCover: event.allModelsHaveBenefitOfCover,
          effect,
          clock: event.clock,
          canonical: true,
        };
      });
    const smokescreens = state.events
      .filter((event) => event.type === "smokescreen_resolved")
      .map((event) => {
        const target = replayed.formations.get(event.targetFormationId);
        if (!target) {
          throw new ServiceUnavailableError(
            "Smokescreen target is unavailable",
            "SMOKESCREEN_DIVERGENCE",
          );
        }
        const flags = smokescreenFlags(
          event,
          target.keywords.includes("smoke"),
          target.playerId === event.playerId,
        );
        const values = [
          3,
          event.commandPointsBefore,
          event.commandPointCost,
          event.commandPointsAfter,
          0,
          0,
          flags,
        ];
        const javascriptValid = smokescreenIsValid(
          "shooting",
          event.commandPointsBefore,
          event.commandPointCost,
          event.commandPointsAfter,
          false,
          false,
          flags,
        );
        const nativeValid = Boolean(calculator.whc_smokescreen_is_valid(...values));
        if (!javascriptValid || javascriptValid !== nativeValid) {
          throw new ServiceUnavailableError(
            "Smokescreen diverged from the C/WebAssembly predicate",
            "SMOKESCREEN_DIVERGENCE",
          );
        }
        const effect = replayed.smokescreens.find((candidate) => candidate.id === event.id);
        if (!effect) {
          throw new ServiceUnavailableError(
            "Smokescreen lost its phase effect",
            "SMOKESCREEN_DIVERGENCE",
          );
        }
        return {
          eventId: event.id,
          triggerEventId: event.triggerEventId,
          playerId: event.playerId,
          targetFormationId: event.targetFormationId,
          commandPointCost: event.commandPointCost,
          commandPointsBefore: event.commandPointsBefore,
          commandPointsAfter: event.commandPointsAfter,
          allModelsHaveBenefitOfCover: event.allModelsHaveBenefitOfCover,
          allModelsHaveStealth: event.allModelsHaveStealth,
          effect,
          clock: event.clock,
          canonical: true,
        };
      });
    const rapidIngresses = replayed.rapidIngresses.map((event) => {
      const formation = replayed.formations.get(event.formationId);
      const deployment = replayed.deploymentByFormation.get(event.formationId);
      if (!formation || !deployment) {
        throw new ServiceUnavailableError(
          "Rapid Ingress source facts are unavailable",
          "RAPID_INGRESS_DIVERGENCE",
        );
      }
      const placementLegal = rapidIngressPlacementIsLegal(event, deployment);
      const flags = rapidIngressFlags(
        event,
        ["reserves", "strategic_reserves"].includes(deployment.location),
        formation.playerId === event.playerId,
        placementLegal,
      );
      const values = [
        2,
        3,
        event.clock.battleRound,
        deployment.earliestBattleRound,
        event.commandPointsBefore,
        event.commandPointCost,
        event.commandPointsAfter,
        0,
        0,
        event.firstRoundOutOfPhaseAllowed ? 1 : 0,
        flags,
      ];
      const javascriptValid = rapidIngressIsValid(
        "movement",
        "end",
        event.clock.battleRound,
        deployment.earliestBattleRound,
        event.commandPointsBefore,
        event.commandPointCost,
        event.commandPointsAfter,
        false,
        false,
        event.firstRoundOutOfPhaseAllowed,
        flags,
      );
      const nativeValid = Boolean(calculator.whc_rapid_ingress_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Rapid Ingress diverged from the C/WebAssembly predicate",
          "RAPID_INGRESS_DIVERGENCE",
        );
      }
      return {
        eventId: event.id,
        triggerEventId: event.triggerEventId,
        playerId: event.playerId,
        formationId: event.formationId,
        commandPointCost: event.commandPointCost,
        commandPointsBefore: event.commandPointsBefore,
        commandPointsAfter: event.commandPointsAfter,
        placementMethod: event.placementMethod,
        placementReason: event.placementReason,
        firstRoundOutOfPhaseAllowed: event.firstRoundOutOfPhaseAllowed,
        firstRoundOutOfPhaseReason: event.firstRoundOutOfPhaseReason,
        deployedFormationIds: event.deployedFormationIds,
        passengersCannotDisembarkThisPhase: event.passengersCannotDisembarkThisPhase,
        largeModelRestrictedThisTurn: event.largeModelRestrictedThisTurn,
        clock: event.clock,
        canonical: true,
      };
    });
    const counterOffensives = replayed.counterOffensives.map((event) => {
      const flags = counterOffensiveFlags(event, true, true);
      const values = [
        5,
        event.commandPointsBefore,
        event.commandPointCost,
        event.commandPointsAfter,
        0,
        0,
        flags,
      ];
      const javascriptValid = counterOffensiveIsValid(
        "fight",
        event.commandPointsBefore,
        event.commandPointCost,
        event.commandPointsAfter,
        false,
        false,
        flags,
      );
      const nativeValid = Boolean(calculator.whc_counter_offensive_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Counter-offensive diverged from the C/WebAssembly predicate",
          "COUNTER_OFFENSIVE_DIVERGENCE",
        );
      }
      return {
        eventId: event.id,
        triggerActivationEventId: event.triggerActivationEventId,
        playerId: event.playerId,
        formationId: event.formationId,
        commandPointCost: event.commandPointCost,
        commandPointsBefore: event.commandPointsBefore,
        commandPointsAfter: event.commandPointsAfter,
        targetInEngagementRange: event.targetInEngagementRange,
        targetEligibilityReason: event.targetEligibilityReason,
        fightsNextConfirmed: event.fightsNextConfirmed,
        clock: event.clock,
        canonical: true,
      };
    });
    const hazardousTestsById = new Map(replayed.hazardousTests.map((event) => [event.id, event]));
    const hazardousDamageResolutions = replayed.hazardousDamageResolutions.map((event) => {
      if (!event.allocation) {
        return {
          eventId: event.id,
          testEventId: event.testEventId,
          testIndex: event.testIndex,
          formationId: event.formationId,
          selectedSegmentId: null,
          noEligibleBearer: true,
          selectionReason: event.selectionReason,
          feelNoPainRolls: [],
          summary: event.summary,
          clock: event.clock,
        };
      }
      const test = hazardousTestsById.get(event.testEventId)?.tests[event.testIndex];
      const segment = formation.segments.find(
        (candidate) => candidate.id === event.allocation?.segmentId,
      );
      if (!test || !segment) {
        throw new ServiceUnavailableError(
          "Hazardous damage references unavailable canonical facts",
          "HAZARDOUS_DIVERGENCE",
        );
      }
      const remainingWounds = segment.wounds - event.allocation.before.woundsLost;
      const ignoredWounds = event.feelNoPainRolls.filter(
        (roll) => segment.feelNoPain > 0 && roll >= segment.feelNoPain,
      ).length;
      const values = [
        test.initialRoll,
        test.reroll,
        test.rerollReason ? 1 : 0,
        remainingWounds,
        segment.feelNoPain,
        event.feelNoPainRolls.length,
        ignoredWounds,
        event.summary.damage,
        event.summary.modelsDestroyed ? 1 : 0,
        HAZARDOUS_FLAGS.mask,
      ];
      const javascriptValid = hazardousResolutionIsValid(
        test.initialRoll,
        test.reroll,
        Boolean(test.rerollReason),
        remainingWounds,
        segment.feelNoPain,
        event.feelNoPainRolls.length,
        ignoredWounds,
        event.summary.damage,
        Boolean(event.summary.modelsDestroyed),
        HAZARDOUS_FLAGS.mask,
      );
      const nativeValid = Boolean(calculator.whc_hazardous_resolution_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Hazardous resolution diverged from the C/WebAssembly predicate",
          "HAZARDOUS_DIVERGENCE",
        );
      }
      return {
        eventId: event.id,
        testEventId: event.testEventId,
        testIndex: event.testIndex,
        formationId: event.formationId,
        selectedSegmentId: event.selectedSegmentId,
        noEligibleBearer: false,
        selectionReason: event.selectionReason,
        feelNoPainRolls: event.feelNoPainRolls,
        summary: event.summary,
        clock: event.clock,
      };
    });
    const serializeFightMove = (event: CanonicalFightMoveEvent | null) => {
      if (!event) return null;
      const values = [
        event.stage === "pile_in" ? 1 : 2,
        event.destination === "none" ? 0 : event.destination === "enemy" ? 1 : 2,
        event.maximumModelMoveThousandths,
        fightMoveFlags(event),
      ];
      const javascriptValid = fightMoveIsValid(...values);
      const nativeValid = Boolean(calculator.whc_fight_move_is_valid(...values));
      if (!javascriptValid || javascriptValid !== nativeValid) {
        throw new ServiceUnavailableError(
          "Canonical Fight movement diverged from the C/WebAssembly predicate",
          "FIGHT_MOVE_DIVERGENCE",
        );
      }
      return {
        stage: event.stage,
        destination: event.destination,
        maximumModelMoveThousandths: event.maximumModelMoveThousandths,
        movementReviewedByPlayer: event.movementReviewedByPlayer,
        movementReviewReason: event.movementReviewReason,
        baseContactModelsStationary: event.baseContactModelsStationary,
        unitCoherencyConfirmed: event.unitCoherencyConfirmed,
        endsWithinEngagementRange: event.endsWithinEngagementRange,
        allMovedModelsCloserToEnemy: event.allMovedModelsCloserToEnemy,
        baseContactMaximized: event.baseContactMaximized,
        enemyDestinationImpossible: event.enemyDestinationImpossible,
        objectiveId: event.objectiveId,
        endsWithinObjectiveRange: event.endsWithinObjectiveRange,
        allMovedModelsCloserToObjective: event.allMovedModelsCloserToObjective,
        objectiveDestinationImpossible: event.objectiveDestinationImpossible,
        outcomeReason: event.outcomeReason,
        movementRuleRestricted: event.movementRuleRestricted,
        movementRuleRestrictionReason: event.movementRuleRestrictionReason,
        meleeAttacksCompleteConfirmed: event.meleeAttacksCompleteConfirmed,
        meleeAttacksCompletionReason: event.meleeAttacksCompletionReason,
        clock: event.clock,
      };
    };
    const fightActivations = [...replayed.fightMovementsByActivation]
      .map(([activationEventId, movement]) => ({
        activationEventId,
        formationId: movement.formationId,
        attackCount: movement.attackCount,
        pileIn: serializeFightMove(movement.pileIn),
        consolidation: serializeFightMove(movement.consolidation),
        canonicalMovement: Boolean(movement.pileIn || movement.consolidation),
      }))
      .sort((left, right) => left.activationEventId.localeCompare(right.activationEventId));
    const transportOccupancy = [...replayed.formations.values()]
      .filter((formation) => formation.keywords.includes("transport"))
      .map((formation) => {
        const occupancy = battleTransportOccupancy(state, formation.id);
        for (const pool of occupancy.poolLoads ?? []) {
          const values = [pool.used, pool.capacity, 0, 0, occupancy.modeCount];
          const javascriptValid = transportLoadIsValid(...values);
          const nativeValid = Boolean(calculator.whc_transport_load_is_valid(...values));
          if (javascriptValid !== nativeValid) {
            throw new ServiceUnavailableError(
              "Transport capacity diverged from the C/WebAssembly predicate",
              "TRANSPORT_CAPACITY_DIVERGENCE",
            );
          }
        }
        for (const allowance of occupancy.allowanceLoads ?? []) {
          const values = [
            0,
            1,
            allowance.models,
            allowance.maximumModels ?? 0,
            occupancy.modeCount,
          ];
          const javascriptValid = transportLoadIsValid(...values);
          const nativeValid = Boolean(calculator.whc_transport_load_is_valid(...values));
          if (javascriptValid !== nativeValid) {
            throw new ServiceUnavailableError(
              "Transport allowance diverged from the C/WebAssembly predicate",
              "TRANSPORT_CAPACITY_DIVERGENCE",
            );
          }
        }
        return { transportFormationId: formation.id, ...occupancy };
      })
      .sort((left, right) => left.transportFormationId.localeCompare(right.transportFormationId));
    const transportDeploymentChains = battleTransportDeploymentChains(state)
      .map((chain) => {
        if (chain.complete) {
          const values = [
            chain.formationIds.length,
            new Set(chain.formationIds).size,
            chain.rootLocationCode,
            chain.reserveEligibilityCount,
          ];
          const javascriptValid = transportDeploymentChainIsValid(...values);
          const nativeValid = Boolean(
            calculator.whc_transport_deployment_chain_is_valid(...values),
          );
          if (javascriptValid !== nativeValid || javascriptValid !== chain.valid) {
            throw new ServiceUnavailableError(
              "Transport deployment ancestry diverged from the C/WebAssembly predicate",
              "TRANSPORT_DEPLOYMENT_DIVERGENCE",
            );
          }
        }
        return chain;
      })
      .sort((left, right) => left.formationId.localeCompare(right.formationId));
    const initialDeploymentRules = battleInitialDeploymentRules(state)
      .map((report) => {
        if (report.complete) {
          const javascriptValid = initialDeploymentIsValid(...report.values);
          const nativeValid = Boolean(calculator.whc_initial_deployment_is_valid(...report.values));
          if (javascriptValid !== nativeValid || javascriptValid !== report.valid) {
            throw new ServiceUnavailableError(
              "Initial deployment rules diverged from the C/WebAssembly predicate",
              "INITIAL_DEPLOYMENT_DIVERGENCE",
            );
          }
        }
        const { values, ...publicReport } = report;
        void values;
        return publicReport;
      })
      .sort((left, right) => left.formationId.localeCompare(right.formationId));
    const waaagh = [...replayed.formations.keys()]
      .map((formationId) => {
        const facts = battleWaaaghFormationFacts(state, formationId);
        const nativeValid = Boolean(calculator.whc_waaagh_state_is_valid(...facts.values));
        if (nativeValid !== facts.valid || !facts.valid) {
          throw new ServiceUnavailableError(
            "Waaagh! state diverged from the C/WebAssembly predicate",
            "WAAAGH_STATE_DIVERGENCE",
          );
        }
        const { values, ...publicFacts } = facts;
        void values;
        return publicFacts;
      })
      .sort((left, right) => left.formationId.localeCompare(right.formationId));
    const grimResolvePlayerIds = new Set(
      (replayed.ruleCoverage?.plan.players ?? [])
        .filter(
          (player) =>
            player.detachment?.sourceId === "000000834" &&
            player.detachment.ruleIds.includes("detachment.catalogue-000000834"),
        )
        .map((player) => player.playerId),
    );
    const grimResolve = [...replayed.formations.values()]
      .filter((formation) => grimResolvePlayerIds.has(formation.playerId))
      .flatMap((formation) => {
        const facts = battleGrimResolveFormationFacts(state, formation.id, replayed);
        const models = facts.models.map((model) => {
          const nativeValid = Boolean(
            calculator.whc_grim_resolve_model_objective_control_is_valid(...model.values),
          );
          if (nativeValid !== model.valid || !model.valid) {
            throw new ServiceUnavailableError(
              "Grim Resolve Objective Control diverged from the C/WebAssembly predicate",
              "GRIM_RESOLVE_STATE_DIVERGENCE",
            );
          }
          const { values, ...publicModel } = model;
          void values;
          return publicModel;
        });
        return [{ ...facts, models }];
      })
      .sort((left, right) => left.formationId.localeCompare(right.formationId));
    const oathOfMoment = [...replayed.formations.values()]
      .map((formation) => {
        const facts = battleOathOfMomentAttackFacts(state, formation.id, replayed);
        const nativeValid = Boolean(
          calculator.whc_oath_of_moment_attack_state_is_valid(...facts.values),
        );
        if (nativeValid !== facts.valid || !facts.valid) {
          throw new ServiceUnavailableError(
            "Oath of Moment state diverged from the C/WebAssembly predicate",
            "OATH_OF_MOMENT_STATE_DIVERGENCE",
          );
        }
        const { values, ...publicFacts } = facts;
        void values;
        return publicFacts;
      })
      .filter((facts) => facts.sourceLocked)
      .sort((left, right) => left.formationId.localeCompare(right.formationId));
    const reanimationProtocols = replayed.reanimationProtocolActivations.map((activation) => {
      const formation = replayed.formations.get(activation.formationId)!;
      const resolutions = replayed.reanimationProtocolResolutions
        .filter((resolution) => resolution.activationEventId === activation.id)
        .map((resolution, index) => {
          const segment = formation.segments.find(
            (candidate) => candidate.id === resolution.segmentId,
          )!;
          const values = [
            1,
            formation.reanimationProtocolSavedUnitIds.includes(segment.savedUnitId) ? 1 : 0,
            1,
            1,
            activation.roll,
            activation.roll - index,
            resolution.action === "heal" ? 1 : 2,
            segment.wounds,
            segment.startingModels,
            resolution.before.modelsRemaining,
            resolution.before.woundsLost,
            resolution.after.modelsRemaining,
            resolution.after.woundsLost,
          ];
          const javascriptValid = reanimationProtocolsTransitionIsValid(...values);
          const nativeValid = Boolean(
            calculator.whc_reanimation_protocols_transition_is_valid(...values),
          );
          if (!javascriptValid || nativeValid !== javascriptValid) {
            throw new ServiceUnavailableError(
              "Reanimation Protocols diverged from the C/WebAssembly predicate",
              "REANIMATION_PROTOCOLS_DIVERGENCE",
            );
          }
          return {
            segmentId: resolution.segmentId,
            action: resolution.action,
            before: resolution.before,
            after: resolution.after,
          };
        });
      return {
        activationEventId: activation.id,
        playerId: activation.playerId,
        formationId: activation.formationId,
        unitKey: activation.unitKey,
        roll: activation.roll,
        woundsResolved: resolutions.length,
        resolutions,
      };
    });
    const shadowInTheWarp = replayed.shadowInTheWarpActivations.map((activation) => {
      const resolutions = replayed.shadowInTheWarpResolutions
        .filter((resolution) => resolution.activationEventId === activation.id)
        .map((resolution) => {
          const legacyComparator =
            state.version < BATTLE_SHOCK_COMPARATOR_BATTLE_STATE_VERSION ||
            resolution.sequence <=
              (state.migration?.legacyBattleShockComparatorThroughSequence ?? 0);
          const formation = replayed.formations.get(resolution.formationId)!;
          const targetFaction = replayed.ruleCoverage?.plan.players.find(
            (player) => player.playerId === formation.playerId,
          )?.faction;
          const values = [
            1,
            1,
            1,
            1,
            1,
            targetFaction?.sourceId === "TYR" ? 1 : 0,
            resolution.ownSynapseProximity.within ? 1 : 0,
            resolution.shadowSynapseProximity.within ? 1 : 0,
            resolution.dice.length,
            resolution.dice.reduce((total, die) => total + die, 0),
            resolution.leadership,
            resolution.battleShockedBefore ? 1 : 0,
            resolution.failed ? 1 : 0,
            resolution.battleShockedBefore || resolution.failed ? 1 : 0,
          ];
          if (!legacyComparator) {
            const javascriptValid = shadowInTheWarpTestIsValid(...values);
            const nativeValid = Boolean(calculator.whc_shadow_in_the_warp_test_is_valid(...values));
            if (!javascriptValid || nativeValid !== javascriptValid) {
              throw new ServiceUnavailableError(
                "Shadow in the Warp diverged from the C/WebAssembly predicate",
                "SHADOW_IN_THE_WARP_DIVERGENCE",
              );
            }
          }
          return {
            ...resolution,
            comparisonMode: legacyComparator
              ? "legacy-v44-reversed"
              : "core-10e-pass-greater-than-or-equal",
          };
        });
      return { ...activation, resolutions };
    });
    const commandBattleShock = replayed.commandBattleShockResolutions.map((resolution) => {
      const formation = replayed.formations.get(resolution.formationId)!;
      const faction = replayed.ruleCoverage?.plan.players.find(
        (player) => player.playerId === formation.playerId,
      )?.faction;
      const values = [
        1,
        1,
        resolution.startingStrength,
        resolution.currentStrength,
        resolution.singleModelWounds,
        resolution.singleModelWoundsRemaining,
        faction?.sourceId === "TYR" && faction.ruleIds?.includes("faction.synapse-battle-shock")
          ? 1
          : 0,
        resolution.synapseProximity.within ? 1 : 0,
        resolution.dice.length,
        resolution.dice.reduce((total, die) => total + die, 0),
        resolution.leadership,
        resolution.failed ? 1 : 0,
      ];
      const javascriptValid = commandBattleShockTestIsValid(...values);
      const nativeValid = Boolean(calculator.whc_command_battle_shock_test_is_valid(...values));
      if (!javascriptValid || nativeValid !== javascriptValid) {
        throw new ServiceUnavailableError(
          "Command Battle-shock diverged from the C/WebAssembly predicate",
          "COMMAND_BATTLE_SHOCK_DIVERGENCE",
        );
      }
      return resolution;
    });
    const desperateEscape = replayed.desperateEscapeTests.map((event) => {
      const tests = event.tests.map((test) => {
        const failed = (test.reroll || test.initialRoll) <= 2;
        const values = [test.initialRoll, test.reroll, test.rerollReason ? 1 : 0, failed ? 1 : 0];
        const javascriptValid = desperateEscapeTestIsValid(
          test.initialRoll,
          test.reroll,
          Boolean(test.rerollReason),
          failed,
        );
        const nativeValid = Boolean(calculator.whc_desperate_escape_test_is_valid(...values));
        if (!javascriptValid || nativeValid !== javascriptValid) {
          throw new ServiceUnavailableError(
            "Desperate Escape diverged from the C/WebAssembly predicate",
            "DESPERATE_ESCAPE_DIVERGENCE",
          );
        }
        return { ...test, failed };
      });
      const casualties = replayed.desperateEscapeCasualtyResolutions.find(
        (resolution) => resolution.testEventId === event.id,
      );
      return {
        eventId: event.id,
        formationId: event.formationId,
        movementStartEventId: event.movementStartEventId,
        tests,
        failedTestCount: event.failedTestCount,
        destroyedModelIds: casualties?.destroyedModelIds ?? [],
        clock: event.clock,
        canonical: true,
      };
    });
    return {
      schemaVersion: state.version,
      rulesSnapshot: state.rulesSnapshot,
      ruleCoverage: replayed.ruleCoverage,
      factionRules: { waaagh, oathOfMoment, reanimationProtocols, shadowInTheWarp },
      commandBattleShock,
      desperateEscape,
      detachmentRules: { grimResolve },
      tableGeometry: replayed.tableGeometry,
      terrainFootprints: replayed.terrainFootprints,
      terrainVisibility: replayed.terrainVisibility,
      modelPlacements: Object.fromEntries(replayed.modelPlacementsByFormation),
      currentModelPositions: Object.fromEntries(replayed.currentModelPositionsByFormation),
      modelPositionHistory: Object.fromEntries(replayed.modelPositionHistoryByFormation),
      modelLocationHistory: Object.fromEntries(replayed.modelLocationHistoryByFormation),
      geometryStaleFormationIds: [...replayed.geometryStaleFormationIds].sort(),
      spatialFacts: Object.fromEntries(replayed.spatialFactsByFormation),
      endpointClearanceFacts: replayed.endpointClearanceFacts,
      terrainClearanceFacts: Object.fromEntries(replayed.terrainClearanceFactsByFormation),
      objectiveControlFacts: Object.fromEntries(replayed.objectiveControlFacts),
      missionTracking: {
        plans: Object.fromEntries(replayed.secondaryPlans),
        drawnCards: Object.fromEntries(
          [...replayed.secondaryDrawnCards].map(([playerId, cards]) => [
            playerId,
            [...cards.values()],
          ]),
        ),
        activeCards: Object.fromEntries(
          [...replayed.secondaryActiveCards].map(([playerId, cards]) => [
            playerId,
            [...cards.values()],
          ]),
        ),
        discardedCardIds: Object.fromEntries(
          [...replayed.secondaryDiscardedCardIds].map(([playerId, cardIds]) => [
            playerId,
            [...cardIds].sort(),
          ]),
        ),
        cardPoints: Object.fromEntries(replayed.secondaryCardPoints),
        categoryPoints: Object.fromEntries(replayed.missionCategoryPoints),
        turnEndReviews: Object.fromEntries(
          [...replayed.secondaryTurnEndReviews].map(([turn, playerIds]) => [
            turn,
            [...playerIds].sort(),
          ]),
        ),
        activeActions: [...replayed.activeMissionActions.values()],
        completedActions: replayed.completedMissionActions,
        failedActions: replayed.failedMissionActions,
        facts: Object.fromEntries(
          state.players.map((player) => [player.id, missionTrackerFacts(state, player.id)]),
        ),
      },
      visibilityFacts: Object.fromEntries(
        [...replayed.visibilityFactsByFormation].map(([formationId, targets]) => [
          formationId,
          Object.fromEntries(targets),
        ]),
      ),
      pendingModelPosition: replayed.pendingModelPosition,
      pendingModelPositions: replayed.pendingModelPositions,
      formationId: requestedFormationId,
      health,
      activeAttackIds: replayed.activeAttackIds,
      clock: replayed.clock,
      pendingChoiceIds: [...replayed.pendingChoices.keys()].sort(),
      activeEffects: [...replayed.effects.values()]
        .map(({ id, name, duration, ownerPlayerId, sourceFormationId }) => ({
          id,
          name,
          duration,
          ownerPlayerId,
          sourceFormationId,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      mission: replayed.mission,
      players: state.players.map((player) => ({
        id: player.id,
        name: player.name,
        resources: [...replayed.resources.get(player.id).values()].map((resource) => ({
          ...resource,
        })),
      })),
      objectives: [...replayed.objectives.values()].map((objective) => ({ ...objective })),
      battleShockedFormationIds: [...replayed.battleShockedFormations.keys()].sort(),
      movement: [...replayed.movementByFormation.values()]
        .map(({ formationId, movement, clock, fromReserves = false, rapidIngress = false }) => ({
          formationId,
          movement,
          clock,
          fromReserves,
          rapidIngress,
        }))
        .sort((left, right) => left.formationId.localeCompare(right.formationId)),
      charges,
      pendingFireOverwatch: replayed.pendingFireOverwatch
        ? { ...replayed.pendingFireOverwatch }
        : null,
      fireOverwatches,
      fireOverwatchPasses: replayed.fireOverwatchPasses.map((event) => ({
        eventId: event.id,
        triggerEventId: event.triggerEventId,
        trigger: event.trigger,
        targetFormationId: event.targetFormationId,
        playerId: event.playerId,
        reason: event.reason,
        clock: event.clock,
      })),
      pendingGoToGround: replayed.pendingGoToGround ? { ...replayed.pendingGoToGround } : null,
      pendingSmokescreen: replayed.pendingSmokescreen ? { ...replayed.pendingSmokescreen } : null,
      pendingRapidIngress: replayed.pendingRapidIngress
        ? { ...replayed.pendingRapidIngress }
        : null,
      pendingCounterOffensive: replayed.pendingCounterOffensive
        ? { ...replayed.pendingCounterOffensive }
        : null,
      counterOffensives,
      counterOffensivePasses: replayed.counterOffensivePasses.map((event) => ({
        eventId: event.id,
        triggerActivationEventId: event.triggerActivationEventId,
        playerId: event.playerId,
        reason: event.reason,
        clock: event.clock,
      })),
      forcedFightFormationId: replayed.forcedFightFormationId || null,
      readyRangedAttack: replayed.readyRangedAttack ? { ...replayed.readyRangedAttack } : null,
      rangedDeclarations: {
        draft: replayed.rangedDeclarationDraft.map((declaration) => ({ ...declaration })),
        sets: rangedDeclarationSets,
        activeSetEventId: replayed.activeRangedDeclarationSet?.id ?? null,
        ready: replayed.readyRangedAttacks.map((declaration) => ({ ...declaration })),
        retractions: replayed.rangedDeclarationRetractions.map((event) => ({
          eventId: event.id,
          activationEventId: event.activationEventId,
          declarationEventId: event.declarationEventId,
          reason: event.reason,
        })),
        autoSkipped: replayed.autoSkippedRangedDeclarations.map((declaration) => ({
          ...declaration,
        })),
      },
      goToGrounds,
      activeGoToGroundEffects: replayed.activeGoToGroundEffects.map((effect) => ({
        ...effect,
      })),
      goToGroundPasses: replayed.goToGroundPasses.map((event) => ({
        eventId: event.id,
        triggerEventId: event.triggerEventId,
        playerId: event.playerId,
        targetFormationId: event.targetFormationId,
        reason: event.reason,
        clock: event.clock,
      })),
      smokescreens,
      activeSmokescreenEffects: replayed.activeSmokescreenEffects.map((effect) => ({
        ...effect,
      })),
      smokescreenPasses: replayed.smokescreenPasses.map((event) => ({
        eventId: event.id,
        triggerEventId: event.triggerEventId,
        playerId: event.playerId,
        targetFormationId: event.targetFormationId,
        reason: event.reason,
        clock: event.clock,
      })),
      rapidIngresses,
      rapidIngressPasses: replayed.rapidIngressPasses.map((event) => ({
        eventId: event.id,
        triggerEventId: event.triggerEventId,
        playerId: event.playerId,
        reason: event.reason,
        clock: event.clock,
      })),
      pendingHazardous: replayed.pendingHazardous ? { ...replayed.pendingHazardous } : null,
      hazardousTests: replayed.hazardousTests.map((event) => ({
        eventId: event.id,
        activationEventId: event.activationEventId,
        formationId: event.formationId,
        tests: event.tests,
        failedTestIndices: event.failedTestIndices,
        deferredUntilChargeMove: event.deferredUntilChargeMove,
        triggerChargeEventId: event.triggerChargeEventId || null,
        clock: event.clock,
      })),
      hazardousDamageResolutions,
      pendingHeroicIntervention: replayed.pendingHeroicIntervention
        ? { ...replayed.pendingHeroicIntervention }
        : null,
      heroicInterventions,
      heroicInterventionPasses: replayed.heroicInterventionPasses.map((event) => ({
        eventId: event.id,
        triggerChargeEventId: event.triggerChargeEventId,
        playerId: event.playerId,
        reason: event.reason,
        clock: event.clock,
      })),
      fightActivations,
      activeActivation: replayed.activeActivation
        ? {
            formationId: replayed.activeActivation.formationId,
            activationType: replayed.activeActivation.activationType,
            weaponRestriction: replayed.activeActivation.weaponRestriction,
            source: replayed.activeActivation.source ?? "normal",
            targetFormationId: replayed.activeActivation.targetFormationId ?? null,
            attackCount: replayed.activeActivation.attackCount,
            ...(replayed.activeActivation.activationType === "fight"
              ? {
                  activationEventId: replayed.activeActivation.id,
                  pileInRecorded: Boolean(replayed.activeActivation.pileIn),
                  consolidationRecorded: Boolean(replayed.activeActivation.consolidation),
                }
              : {}),
          }
        : null,
      completedActivationKeys: [...replayed.completedActivations].sort(),
      targetEligibilityFacts,
      weaponDeclarations,
      deployment: {
        complete: replayed.deploymentComplete,
        priorityPlayerId: replayed.deploymentPriorityPlayerId || null,
        declarations: [...replayed.deploymentByFormation.values()]
          .map(
            ({
              formationId,
              location,
              points,
              earliestBattleRound,
              eligibilityConfirmed,
              eligibilityReason,
              transportFormationId = "",
              legacyAssumed = false,
            }) => ({
              formationId,
              location,
              points,
              earliestBattleRound,
              eligibilityConfirmed,
              eligibilityReason,
              transportFormationId,
              legacyAssumed,
            }),
          )
          .sort((left, right) => left.formationId.localeCompare(right.formationId)),
        deployedFormationIds: [...replayed.deployedFormationIds].sort(),
        offBattlefieldFormationIds: [...replayed.offBattlefieldFormationIds].sort(),
        reserveArrivals: [...replayed.reserveArrivals.values()]
          .map(({ formationId, placementReason, clock }) => ({
            formationId,
            placementReason,
            clock,
          }))
          .sort((left, right) => left.formationId.localeCompare(right.formationId)),
        destroyedAtBattleEndFormationIds: [...replayed.reserveDestroyedFormationIds].sort(),
        destroyedInFirstRoundFormationIds: [...replayed.setupDestroyedFormationIds].sort(),
        initialRules: initialDeploymentRules,
        transportChains: transportDeploymentChains,
      },
      transports: {
        compatibility: [...replayed.formations.values()]
          .flatMap((formation) =>
            formation.transportOptions.map((option) => ({
              formationId: formation.id,
              assigned: formation.assignedTransportFormationId === option.transportFormationId,
              transportFormationId: option.transportFormationId,
              assignments: option.assignments.map((assignment) => ({ ...assignment })),
            })),
          )
          .sort((left, right) =>
            `${left.formationId}\u0000${left.transportFormationId}`.localeCompare(
              `${right.formationId}\u0000${right.transportFormationId}`,
            ),
          ),
        occupancy: transportOccupancy,
        embarked: [...replayed.embarkedByFormation.entries()]
          .map(([formationId, transportFormationId]) => ({
            formationId,
            transportFormationId,
          }))
          .sort((left, right) => left.formationId.localeCompare(right.formationId)),
        disembarked: [...replayed.disembarkedByFormation.entries()]
          .map(([formationId, event]) => ({
            formationId,
            transportFormationId: event.transportFormationId,
            destroyedTransport: Boolean(event.destroyedTransport),
            emergency: Boolean(event.emergency),
            clock: event.clock,
          }))
          .sort((left, right) => left.formationId.localeCompare(right.formationId)),
        pendingDestroyedTransportIds: [...replayed.pendingTransportDestructions.keys()].sort(),
        destroyedTransportResolutions: [...replayed.transportDestructionResolutions.values()]
          .map(
            ({
              transportFormationId,
              causeEventId,
              deadlyDemiseResolvedConfirmed,
              deadlyDemiseResolutionReason,
              passengers,
              clock,
            }) => ({
              transportFormationId,
              causeEventId,
              deadlyDemiseResolvedConfirmed,
              deadlyDemiseResolutionReason,
              passengers: passengers.map(
                ({
                  formationId,
                  firstSegmentId,
                  emergency,
                  unplacedModels,
                  rolls,
                  feelNoPainRolls,
                  summary,
                }) => ({
                  formationId,
                  firstSegmentId,
                  emergency,
                  unplacedModels,
                  rolls,
                  feelNoPainRolls,
                  summary,
                }),
              ),
              clock,
            }),
          )
          .sort((left, right) =>
            left.transportFormationId.localeCompare(right.transportFormationId),
          ),
      },
      scoringEvents: replayed.scoringEvents.map(
        ({ id, playerId, category, points, before, after, reason, clock }) => ({
          id,
          playerId,
          category,
          points,
          before,
          after,
          reason,
          clock,
        }),
      ),
    };
  } finally {
    calculator.free(profilesPointer);
    if (eventsPointer) calculator.free(eventsPointer);
    calculator.free(healthPointer);
  }
}

async function withStorage<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch {
    throw new ServiceUnavailableError(
      "Cloud list storage is temporarily unavailable",
      "LIST_STORAGE_UNAVAILABLE",
    );
  }
}

async function healthCheck(name: string, operation: () => Promise<Record<string, unknown> | void>) {
  const startedAt = performance.now();
  try {
    const detail = (await operation()) ?? {};
    return {
      name,
      status: "ok" as const,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...detail,
    };
  } catch (error) {
    return {
      name,
      status: "failed" as const,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      code: error instanceof ServiceUnavailableError ? error.code : "DEPENDENCY_UNAVAILABLE",
    };
  }
}

function profileFlags(profile: CombatProfile) {
  return (
    (profile.lethalHits ? 1 : 0) |
    (profile.devastatingWounds ? 2 : 0) |
    (profile.twinLinked ? 4 : 0) |
    (profile.rerollHits ? 8 : 0) |
    (profile.torrent ? 16 : 0) |
    (profile.heavyActive ? 32 : 0) |
    (profile.lanceActive ? 64 : 0) |
    (profile.blast ? 128 : 0) |
    (profile.withinHalfRange && (profile.rapidFire > 0 || profile.rapidFireDice > 0) ? 256 : 0) |
    (profile.withinHalfRange && profile.melta > 0 ? 512 : 0) |
    (profile.targetCover ? 1024 : 0) |
    (profile.ignoresCover ? 2048 : 0) |
    (profile.indirect ? 4096 : 0) |
    (profile.rerollHitOnes ? 8192 : 0) |
    (profile.rerollWounds ? 16384 : 0) |
    (profile.rerollWoundOnes ? 32768 : 0)
  );
}

function characteristicModifierFlags(profile: CombatProfile) {
  return (
    (profile.characteristicModifierAttacks ? 1 : 0) |
    (profile.characteristicModifierStrength ? 2 : 0) |
    (profile.characteristicModifierDamage ? 4 : 0)
  );
}

function characteristicModifierGroups(profiles: CombatProfile[]) {
  const groups = new Map<string, number>();
  return profiles.map((profile) => {
    if (!profile.characteristicModifierGroup) return 0;
    if (!groups.has(profile.characteristicModifierGroup)) {
      groups.set(profile.characteristicModifierGroup, groups.size + 1);
    }
    return groups.get(profile.characteristicModifierGroup) ?? 0;
  });
}

async function exactCalculation(profile: CombatProfile) {
  const calculator = await loadCalculator();
  const output = calculator.malloc(72);
  const flags = profileFlags(profile);

  try {
    const ok = calculator.whc_calculate_summary_with_characteristic_roll(
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
      flags,
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
      profile.attacksMultiplier,
      profile.strengthMultiplier,
      profile.damageMultiplier,
      profile.characteristicModifierDice,
      profile.characteristicModifierSides,
      profile.characteristicModifierBonus,
      characteristicModifierFlags(profile),
      profile.firstFailedSaveDamageReplacement ?? 0,
      profile.firstFailedSaveDamageReplacement === null ? 0 : 1,
      profile.allocatedAttackDamageReplacement,
      profile.allocatedAttackDamageReplacementUses,
      profile.allocatedAttackDamageReplacementSkip,
      output,
    );
    if (!ok) throw new Error("Profile exceeds the calculator's exact-distribution limits");
    const view = new DataView(calculator.memory.buffer);
    const read = (index: number) => view.getUint32(output + index * 4, true);
    const numerator = (BigInt(read(6)) << 32n) | BigInt(read(5));
    const denominator = (BigInt(read(8)) << 32n) | BigInt(read(7));
    const appliedNumerator = (BigInt(read(15)) << 32n) | BigInt(read(14));
    const appliedDenominator = (BigInt(read(17)) << 32n) | BigInt(read(16));
    return {
      minimum: read(0),
      firstQuartile: read(1),
      median: read(2),
      thirdQuartile: read(3),
      maximum: read(4),
      mean: Number(numerator) / Number(denominator),
      exact: { numerator: numerator.toString(), denominator: denominator.toString() },
      applied: {
        minimum: read(9),
        firstQuartile: read(10),
        median: read(11),
        thirdQuartile: read(12),
        maximum: read(13),
        mean: Number(appliedNumerator) / Number(appliedDenominator),
        estimated: {
          numerator: appliedNumerator.toString(),
          denominator: appliedDenominator.toString(),
        },
      },
    };
  } finally {
    calculator.free(output);
  }
}

async function exactVolley(
  profiles: CombatProfile[],
  targets: OrderedTargetSegment[],
  initialWoundsLost: number,
) {
  if (profiles.length < 1 || profiles.length > 32) {
    throw new Error("profiles must contain 1 to 32 weapon profiles");
  }
  if (targets.length < 1 || targets.length > 64) {
    throw new Error("targets must contain 1 to 64 ordered profile segments");
  }
  const capacity = targets.reduce((sum, target) => sum + target.wounds * target.modelCount, 0);
  if (
    !Number.isInteger(initialWoundsLost) ||
    initialWoundsLost < 0 ||
    initialWoundsLost >= targets[0].wounds ||
    capacity > 1024
  ) {
    throw new Error("initialWoundsLost or target capacity exceeds the exact calculator limits");
  }

  const calculator = await loadCalculator();
  const weaponFields = 37;
  const targetFields = 14;
  const weaponsPointer = calculator.malloc(profiles.length * weaponFields * 4);
  const targetsPointer = calculator.malloc(targets.length * targetFields * 4);
  const summaryPointer = calculator.malloc(10 * 4);
  const meansPointer = calculator.malloc(profiles.length * 4 * 4);
  const characteristicGroups = characteristicModifierGroups(profiles);
  try {
    let view = new DataView(calculator.memory.buffer);
    const write = (pointer: number, values: number[]) =>
      values.forEach((value, index) => view.setUint32(pointer + index * 4, value, true));
    const read = (pointer: number, index: number) => view.getUint32(pointer + index * 4, true);
    const fraction = (pointer: number) => {
      const numerator = (BigInt(read(pointer, 1)) << 32n) | BigInt(read(pointer, 0));
      const denominator = (BigInt(read(pointer, 3)) << 32n) | BigInt(read(pointer, 2));
      return {
        mean: Number(numerator) / Number(denominator),
        exact: { numerator: numerator.toString(), denominator: denominator.toString() },
      };
    };
    profiles.forEach((profile, index) =>
      write(weaponsPointer + index * weaponFields * 4, [
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
        profileFlags(profile),
        profile.criticalWounds,
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
        profile.attacksMultiplier,
        profile.strengthMultiplier,
        profile.damageMultiplier,
        profile.characteristicModifierDice,
        profile.characteristicModifierSides,
        profile.characteristicModifierBonus,
        characteristicModifierFlags(profile),
        characteristicGroups[index],
      ]),
    );
    targets.forEach((target, index) =>
      write(targetsPointer + index * targetFields * 4, [
        target.toughness,
        target.save,
        target.invulnerable,
        target.feelNoPain,
        target.wounds,
        target.reduction,
        target.modelCount,
        target.damageDivisor,
        target.firstFailedSaveDamageReplacement ?? 0,
        target.firstFailedSaveDamageReplacement === null ? 0 : 1,
        target.allocatedAttackDamageReplacement,
        target.allocatedAttackDamageReplacementUses,
        target.allocatedAttackDamageReplacementSkip,
        target.benefitOfCover ? 1 : 0,
      ]),
    );
    const ok = calculator.whc_calculate_ordered_volley_summary(
      weaponsPointer,
      profiles.length,
      targetsPointer,
      targets.length,
      initialWoundsLost,
      summaryPointer,
      meansPointer,
    );
    if (!ok) throw new ExactStateLimitError();
    view = new DataView(calculator.memory.buffer);
    const cumulative = profiles.map((_, index) => fraction(meansPointer + index * 16));
    const total = fraction(summaryPointer + 5 * 4);
    return {
      minimum: read(summaryPointer, 0),
      firstQuartile: read(summaryPointer, 1),
      median: read(summaryPointer, 2),
      thirdQuartile: read(summaryPointer, 3),
      maximum: read(summaryPointer, 4),
      mean: total.mean,
      exact: total.exact,
      peakSparseStates: read(summaryPointer, 9),
      cumulative,
      incrementalMeans: cumulative.map(
        (entry, index) => entry.mean - (index === 0 ? 0 : cumulative[index - 1].mean),
      ),
    };
  } finally {
    calculator.free(weaponsPointer);
    calculator.free(targetsPointer);
    calculator.free(summaryPointer);
    calculator.free(meansPointer);
  }
}

async function volleyComplexity(
  profiles: CombatProfile[],
  targets: OrderedTargetSegment[],
  initialWoundsLost: number,
) {
  if (profiles.length < 1 || profiles.length > 32) {
    throw new Error("profiles must contain 1 to 32 weapon profiles");
  }
  if (targets.length < 1 || targets.length > 64) {
    throw new Error("targets must contain 1 to 64 ordered profile segments");
  }
  const calculator = await loadCalculator();
  const weaponFields = 37;
  const targetFields = 14;
  const weaponsPointer = calculator.malloc(profiles.length * weaponFields * 4);
  const targetsPointer = calculator.malloc(targets.length * targetFields * 4);
  const outputPointer = calculator.malloc(6 * 4);
  const characteristicGroups = characteristicModifierGroups(profiles);
  try {
    let view = new DataView(calculator.memory.buffer);
    const write = (pointer: number, values: number[]) =>
      values.forEach((value, index) => view.setUint32(pointer + index * 4, value, true));
    profiles.forEach((profile, index) =>
      write(weaponsPointer + index * weaponFields * 4, [
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
        profileFlags(profile),
        profile.criticalWounds,
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
        profile.attacksMultiplier,
        profile.strengthMultiplier,
        profile.damageMultiplier,
        profile.characteristicModifierDice,
        profile.characteristicModifierSides,
        profile.characteristicModifierBonus,
        characteristicModifierFlags(profile),
        characteristicGroups[index],
      ]),
    );
    targets.forEach((target, index) =>
      write(targetsPointer + index * targetFields * 4, [
        target.toughness,
        target.save,
        target.invulnerable,
        target.feelNoPain,
        target.wounds,
        target.reduction,
        target.modelCount,
        target.damageDivisor,
        target.firstFailedSaveDamageReplacement ?? 0,
        target.firstFailedSaveDamageReplacement === null ? 0 : 1,
        target.allocatedAttackDamageReplacement,
        target.allocatedAttackDamageReplacementUses,
        target.allocatedAttackDamageReplacementSkip,
        target.benefitOfCover ? 1 : 0,
      ]),
    );
    const ok = calculator.whc_estimate_ordered_volley_complexity(
      weaponsPointer,
      profiles.length,
      targetsPointer,
      targets.length,
      initialWoundsLost,
      outputPointer,
    );
    if (!ok) throw new Error("Volley complexity could not be estimated");
    view = new DataView(calculator.memory.buffer);
    const read = (index: number) => view.getUint32(outputPointer + index * 4, true);
    return {
      estimatedStateUpperBound: read(0),
      stateLimit: read(1),
      maximumAttackEvents: read(2),
      targetCapacity: read(3),
      usesDeferredStates: read(4) !== 0,
      exactGuaranteedByBound: read(5) !== 0,
      estimateKind: "prefix-aware-conservative-upper-bound",
      fallbackEndpoint: "/api/v1/volley/simulate",
    };
  } finally {
    calculator.free(weaponsPointer);
    calculator.free(targetsPointer);
    calculator.free(outputPointer);
  }
}

async function requestProfile(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("Request body must be valid JSON");
  }
  const candidate =
    body && typeof body === "object" && "profile" in body
      ? (body as { profile: unknown }).profile
      : body;
  return normalizeProfile(candidate);
}

function orderedTargets(value: unknown): OrderedTargetSegment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    throw new Error("targets must contain 1 to 16 ordered profile segments");
  }
  const targets = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Each target segment must be an object");
    }
    const target = candidate as Record<string, unknown>;
    const integer = (key: string, minimum: number, maximum: number) => {
      const result = target[key];
      if (
        !Number.isInteger(result) ||
        (result as number) < minimum ||
        (result as number) > maximum
      ) {
        throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
      }
      return result as number;
    };
    const optionalSave = (key: string) => {
      const result = integer(key, 0, 6);
      if (result === 1) throw new Error(`${key} must be 0 or an integer from 2 to 6`);
      return result;
    };
    return {
      toughness: integer("toughness", 1, 65535),
      save: integer("save", 2, 7),
      invulnerable: optionalSave("invulnerable"),
      feelNoPain: optionalSave("feelNoPain"),
      wounds: integer("wounds", 1, 1024),
      reduction: integer("reduction", 0, 1024),
      damageDivisor: target.damageDivisor === undefined ? 1 : integer("damageDivisor", 1, 1024),
      firstFailedSaveDamageReplacement:
        target.firstFailedSaveDamageReplacement === undefined ||
        target.firstFailedSaveDamageReplacement === null
          ? null
          : integer("firstFailedSaveDamageReplacement", 0, 1024),
      allocatedAttackDamageReplacement:
        target.allocatedAttackDamageReplacement === undefined
          ? 0
          : integer("allocatedAttackDamageReplacement", 0, 1024),
      allocatedAttackDamageReplacementUses:
        target.allocatedAttackDamageReplacementUses === undefined
          ? 0
          : integer("allocatedAttackDamageReplacementUses", 0, 1024),
      allocatedAttackDamageReplacementSkip:
        target.allocatedAttackDamageReplacementSkip === undefined
          ? 0
          : integer("allocatedAttackDamageReplacementSkip", 0, 1024),
      modelCount: integer("modelCount", 1, 1000),
      benefitOfCover: target.benefitOfCover === undefined ? false : Boolean(target.benefitOfCover),
    };
  });
  if (new Set(targets.map((target) => String(target.firstFailedSaveDamageReplacement))).size > 1) {
    throw new Error("Target segments must share the same first-failed-save Damage replacement");
  }
  if (
    new Set(
      targets.map((target) =>
        JSON.stringify([
          target.allocatedAttackDamageReplacement,
          target.allocatedAttackDamageReplacementUses,
          target.allocatedAttackDamageReplacementSkip,
        ]),
      ),
    ).size > 1
  ) {
    throw new Error("Target segments must share the allocated-attack Damage replacement policy");
  }
  return targets;
}

function assertDefensiveEquipmentOverrides(input: ArmyListInput, catalogue: Catalogue) {
  for (const unit of input.units) {
    const sourceUnit = catalogue.units.find((entry) => entry.id === unit.unitId);
    if (!sourceUnit) continue;
    const warning = savedUnitDefensiveEquipmentWarnings(unit, sourceUnit).find(
      (entry) => entry.reason === null,
    );
    if (warning) {
      throw new Error(
        `${unit.name}: ${warning.message}; add a casualty or narrative defensive-equipment override reason`,
      );
    }
  }
}

async function requestArmyList(request: Request, env: Env): Promise<ArmyListInput> {
  const input = normalizeArmyListInput(await request.json()) as ArmyListInput;
  if (input.units.some((unit) => unit.defensiveEquipmentCounts !== undefined)) {
    assertDefensiveEquipmentOverrides(input, await loadCatalogue(request, env));
  }
  return input;
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: API_HEADERS });

  try {
    if (url.pathname === "/api/v1" && request.method === "GET") {
      return json({
        name: "Warhammer Damage Calculator API",
        apiVersion: "v1",
        endpoints: {
          health: "GET /api/v1/health",
          ruleCoverage: "GET /api/v1/rules/coverage",
          checkRuleCoverage: "POST /api/v1/rules/coverage/check",
          factions: "GET /api/v1/factions",
          detachments: "GET /api/v1/detachments?faction={factionId}",
          enhancements:
            "GET /api/v1/enhancements?detachment={detachmentId}&unit={optionalDatasheetId}",
          missions: "GET /api/v1/missions",
          terrain: "GET /api/v1/terrain?mission={missionId}",
          units: "GET /api/v1/units?faction={factionId}&kind={attacker|target|all}",
          weapons: "GET /api/v1/weapons?unit={datasheetId}",
          loadout: "GET /api/v1/loadout?unit={datasheetId}",
          leader:
            "GET /api/v1/leader?unit={leaderDatasheetId}&bodyguard={bodyguardDatasheetId}&leaderWeapon={weaponGroupId}&leaderChoice={choiceAlternativeId}",
          leaderFormation:
            "GET /api/v1/leader-formation?bodyguard={bodyguardDatasheetId}&leader={leaderDatasheetId}&leaderWeapon={weaponGroupId}&leaderChoice={choiceAlternativeId}&models={startingStrength}",
          bodyguardJoin:
            "GET /api/v1/bodyguard-join?unit={joiningDatasheetId}&bodyguard={bodyguardDatasheetId}&models={joiningModelCount}&bodyguardModels={bodyguardModelCount}&attached={true|false}&existingSameJoiners={count}",
          validateLoadout: "POST /api/v1/validate-loadout",
          firingDeck:
            "GET /api/v1/firing-deck?unit={transportDatasheetId}&passenger={passengerDatasheetId}&attached={attachedDatasheetId}",
          transport:
            "GET /api/v1/transport?unit={transportDatasheetId}&passenger={passengerDatasheetId}&attached={attachedDatasheetId}&models={modelCount}",
          validateFiringDeck: "POST /api/v1/validate-firing-deck",
          targets: "GET /api/v1/targets?unit={datasheetId}",
          profiles: "GET /api/v1/profiles",
          calculate: "POST /api/v1/calculate",
          volley: "POST /api/v1/volley",
          volleyComplexity: "POST /api/v1/volley/complexity",
          roll: "POST /api/v1/roll?details={true|false}",
          volleyRoll: "POST /api/v1/volley/roll?details={true|false}",
          volleySimulate: "POST /api/v1/volley/simulate",
          battleReplay: "POST /api/v1/battle/replay",
          lists:
            "GET|POST /api/v1/lists; PUT|DELETE /api/v1/lists/{id}; GET /api/v1/lists/export; POST /api/v1/lists/import",
        },
        request: { profile: DEFAULT_PROFILE },
      });
    }

    if (url.pathname === "/api/v1/health" && request.method === "GET") {
      const checks = await Promise.all([
        healthCheck("profile-catalogue", async () => {
          const catalogue = await loadCatalogue(request, env);
          return {
            sourceUpdatedAt: catalogue.sourceUpdatedAt,
            factions: catalogue.factions.length,
            detachments: catalogue.detachments.length,
            enhancements: catalogue.enhancements.length,
            units: catalogue.units.length,
          };
        }),
        healthCheck("calculator-engine", async () => {
          await loadCalculator();
        }),
        healthCheck("rule-coverage", async () => {
          const coverage = await loadRuleCoverage(request, env);
          await checkedRuleCoverage(request, env, [
            "core.attack-sequence",
            "core.charge-resolution",
          ]);
          return {
            snapshotId: coverage.snapshotId,
            rules: coverage.rules.length,
            sourceLocked: coverage.sourceLocked,
          };
        }),
        healthCheck("list-storage", async () => {
          await withStorage(() => env.ARMY_DB.prepare("SELECT 1 AS healthy").first());
        }),
      ]);
      const healthy = checks.every((check) => check.status === "ok");
      return json(
        {
          status: healthy ? "ok" : "degraded",
          apiVersion: "v1",
          checkedAt: new Date().toISOString(),
          checks,
        },
        healthy ? 200 : 503,
        { "Cache-Control": "no-store" },
      );
    }

    if (url.pathname === "/api/v1/profiles" && request.method === "GET") {
      return json(await loadCatalogue(request, env), 200, {
        "Cache-Control": "public, max-age=3600",
      });
    }

    if (url.pathname === "/api/v1/rules/coverage" && request.method === "GET") {
      return json({ data: await loadRuleCoverage(request, env), apiVersion: "v1" }, 200, {
        "Cache-Control": "public, max-age=3600",
      });
    }

    if (url.pathname === "/api/v1/rules/coverage/check" && request.method === "POST") {
      const body = (await request.json()) as { rules?: unknown };
      return json({
        data: await checkedRuleCoverage(request, env, body?.rules),
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/factions" && request.method === "GET") {
      const catalogue = await loadCatalogue(request, env);
      return json({ data: catalogue.factions, sourceUpdatedAt: catalogue.sourceUpdatedAt });
    }

    if (url.pathname === "/api/v1/detachments" && request.method === "GET") {
      const faction = url.searchParams.get("faction");
      if (!faction) return apiError("Missing required faction query parameter");
      const catalogue = await loadCatalogue(request, env);
      return json({
        data: catalogue.detachments.filter((entry) => entry.factionId === faction),
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/enhancements" && request.method === "GET") {
      const detachment = url.searchParams.get("detachment");
      if (!detachment) return apiError("Missing required detachment query parameter");
      const unit = url.searchParams.get("unit");
      const catalogue = await loadCatalogue(request, env);
      return json({
        data: catalogue.enhancements.filter(
          (entry) =>
            entry.detachmentId === detachment &&
            (!unit || entry.eligibleDatasheetIds.includes(unit)),
        ),
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/missions" && request.method === "GET") {
      const pack = await loadMissionPack(request, env);
      return json({
        data: pack.missions,
        pack: { id: pack.id, name: pack.name, edition: pack.edition, version: pack.version },
      });
    }

    if (url.pathname === "/api/v1/terrain" && request.method === "GET") {
      const missionId = url.searchParams.get("mission");
      if (!missionId) return apiError("Missing required mission query parameter");
      const pack = await loadMissionPack(request, env);
      const mission = pack.missions.find((entry) => entry.id === missionId);
      if (!mission) return apiError("Mission is outside the source-locked mission pack", 404);
      return json({
        data: pack.terrainLayouts.filter((entry) => mission.terrainLayoutIds.includes(entry.id)),
        mission,
        pack: { id: pack.id, version: pack.version },
      });
    }

    if (url.pathname === "/api/v1/units" && request.method === "GET") {
      const faction = url.searchParams.get("faction");
      if (!faction) return apiError("Missing required faction query parameter");
      const kind = url.searchParams.get("kind") ?? "all";
      if (!["attacker", "target", "all"].includes(kind)) {
        return apiError("kind must be attacker, target, or all");
      }
      const catalogue = await loadCatalogue(request, env);
      const data = catalogue.units
        .filter((unit) => unit.factionId === faction)
        .filter(
          (unit) =>
            kind === "all" ||
            (kind === "attacker" ? unit.weapons.length > 0 : unit.models.length > 0),
        )
        .map((unit) => ({
          id: unit.id,
          factionId: unit.factionId,
          name: unit.name,
          modelProfileCount: unit.models.length,
          weaponProfileCount: unit.weapons.length,
          weaponGroupCount: new Set(unit.weapons.map((weapon) => weapon.groupId)).size,
          firingDeck: unit.firingDeck,
          transport: unit.transport,
          leaderBodyguardIds: unit.leaderBodyguardIds,
          leaderAttachmentConditions: unit.leaderAttachmentConditions,
          leaderAttachmentException: unit.leaderAttachmentException,
          bodyguardLeaderRule: unit.bodyguardLeaderRule,
          bodyguardJoinOptions: unit.bodyguardJoinOptions,
          startingSizeRanges: unit.startingSizeRanges,
          suggestedModelCount: unit.suggestedModelCount,
          maximumModelCount: unit.maximumModelCount,
        }));
      return json({ data, faction });
    }

    if (url.pathname === "/api/v1/loadout" && request.method === "GET") {
      const unitId = url.searchParams.get("unit");
      if (!unitId) return apiError("Missing required unit query parameter");
      const catalogue = await loadCatalogue(request, env);
      const unit = catalogue.units.find((entry) => entry.id === unitId);
      if (!unit) return apiError("Unit not found", 404);
      return json({
        data: {
          id: unit.id,
          factionId: unit.factionId,
          name: unit.name,
          composition: unit.composition,
          compositionModels: unit.compositionModels,
          loadout: unit.loadout,
          defaultWeapons: unit.defaultWeapons,
          unresolvedLoadoutSubjects: unit.unresolvedLoadoutSubjects,
          wargearOptions: unit.wargearOptions,
          weaponLimits: unit.weaponLimits,
          wargearChoicePools: unit.wargearChoicePools,
          wargearChoiceItemLimits: unit.wargearChoiceItemLimits,
          wargearChoicePairingRules: unit.wargearChoicePairingRules,
          weaponTypeLimits: unit.weaponTypeLimits,
          firingDeck: unit.firingDeck,
          firingDeckModelCost: unit.firingDeckModelCost,
          transport: unit.transport,
          transportKeywords: unit.transportKeywords,
          leaderBodyguardIds: unit.leaderBodyguardIds,
          leaderAttachmentConditions: unit.leaderAttachmentConditions,
          leaderFooter: unit.leaderFooter,
          leaderAttachmentException: unit.leaderAttachmentException,
          bodyguardLeaderRule: unit.bodyguardLeaderRule,
          bodyguardJoinOptions: unit.bodyguardJoinOptions,
          startingSizeRanges: unit.startingSizeRanges,
          suggestedModelCount: unit.suggestedModelCount,
          maximumModelCount: unit.maximumModelCount,
          weapons: unit.weapons,
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/leader" && request.method === "GET") {
      const unitId = url.searchParams.get("unit");
      if (!unitId) return apiError("Missing required unit query parameter");
      const catalogue = await loadCatalogue(request, env);
      const leader = catalogue.units.find((entry) => entry.id === unitId);
      if (!leader) return apiError("Leader unit not found", 404);
      const bodyguardId = url.searchParams.get("bodyguard");
      const bodyguard = bodyguardId
        ? catalogue.units.find((entry) => entry.id === bodyguardId)
        : null;
      if (bodyguardId && !bodyguard) return apiError("Bodyguard unit not found", 404);
      const leaderWeaponIds = url.searchParams.getAll("leaderWeapon");
      const leaderChoiceIds = url.searchParams.getAll("leaderChoice");
      if (leaderWeaponIds.length > 100 || leaderChoiceIds.length > 100) {
        return apiError("At most 100 leaderWeapon and leaderChoice parameters are allowed");
      }
      const eligibility = bodyguard
        ? leaderAttachmentEligibility(leader, bodyguard, {
            equippedWeaponGroupIds: leaderWeaponIds,
            choiceSelectionIds: leaderChoiceIds,
          })
        : { eligible: null, reason: "" };
      return json({
        data: {
          leader: { id: leader.id, name: leader.name },
          bodyguard: bodyguard ? { id: bodyguard.id, name: bodyguard.name } : null,
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          options: leader.leaderBodyguardIds.map((id) => {
            const option = catalogue.units.find((entry) => entry.id === id);
            return { id, name: option?.name ?? id };
          }),
          leaderAttachmentException: leader.leaderAttachmentException,
          leaderAttachmentConditions: leader.leaderAttachmentConditions,
          bodyguardLeaderRule: bodyguard?.bodyguardLeaderRule ?? null,
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/leader-formation" && request.method === "GET") {
      const bodyguardId = url.searchParams.get("bodyguard");
      if (!bodyguardId) return apiError("Missing required bodyguard query parameter");
      const catalogue = await loadCatalogue(request, env);
      const bodyguard = catalogue.units.find((entry) => entry.id === bodyguardId);
      if (!bodyguard) return apiError("Bodyguard unit not found", 404);
      const leaderIds = url.searchParams.getAll("leader");
      if (leaderIds.length > 10) return apiError("At most 10 leader parameters are allowed");
      const leaders = leaderIds.map((id) => catalogue.units.find((entry) => entry.id === id));
      if (leaders.some((leader) => !leader)) return apiError("Leader unit not found", 404);
      const models = Number(url.searchParams.get("models") ?? bodyguard.suggestedModelCount ?? "1");
      if (!Number.isSafeInteger(models) || models < 1 || models > 1000) {
        return apiError("models must be an integer from 1 to 1000");
      }
      const leaderWeaponIds = url.searchParams.getAll("leaderWeapon");
      const leaderChoiceIds = url.searchParams.getAll("leaderChoice");
      if (leaderWeaponIds.length > 100 || leaderChoiceIds.length > 100) {
        return apiError("At most 100 leaderWeapon and leaderChoice parameters are allowed");
      }
      const eligibility = leaderFormationEligibility(bodyguard, leaders, models, {
        leaderLoadouts: leaders.map((leader) => ({
          equippedWeaponGroupIds: leaderWeaponIds.filter((id) => id.startsWith(`${leader.id}:`)),
          choiceSelectionIds: leaderChoiceIds.filter((id) => id.startsWith(`${leader.id}:`)),
        })),
      });
      return json({
        data: {
          bodyguard: { id: bodyguard.id, name: bodyguard.name, models },
          leaders: leaders.map((leader) => ({ id: leader.id, name: leader.name })),
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          maximumLeaders: eligibility.maximumLeaders,
          bodyguardLeaderRule: bodyguard.bodyguardLeaderRule,
          leaderAttachmentExceptions: leaders
            .filter((leader) => leader.leaderAttachmentException)
            .map((leader) => ({
              leader: { id: leader.id, name: leader.name },
              rule: leader.leaderAttachmentException,
            })),
          globalRule: catalogue.leaderFormationRules,
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/bodyguard-join" && request.method === "GET") {
      const unitId = url.searchParams.get("unit");
      if (!unitId) return apiError("Missing required unit query parameter");
      const catalogue = await loadCatalogue(request, env);
      const joiner = catalogue.units.find((entry) => entry.id === unitId);
      if (!joiner) return apiError("Joining unit not found", 404);
      const bodyguardId = url.searchParams.get("bodyguard");
      const bodyguard = bodyguardId
        ? catalogue.units.find((entry) => entry.id === bodyguardId)
        : null;
      if (bodyguardId && !bodyguard) return apiError("Bodyguard unit not found", 404);
      const attachedValue = url.searchParams.get("attached") ?? "false";
      if (!["true", "false"].includes(attachedValue)) {
        return apiError("attached must be true or false");
      }
      const existingSameJoiners = Number(url.searchParams.get("existingSameJoiners") ?? 0);
      if (
        !Number.isSafeInteger(existingSameJoiners) ||
        existingSameJoiners < 0 ||
        existingSameJoiners > 100
      ) {
        return apiError("existingSameJoiners must be an integer from 0 to 100");
      }
      const eligibility = bodyguard
        ? bodyguardJoinEligibility(joiner, bodyguard, {
            isAttached: attachedValue === "true",
            existingSameJoiners,
          })
        : { eligible: null, reason: "", rule: null };
      const joinerModels = Number(
        url.searchParams.get("models") ?? joiner.suggestedModelCount ?? 1,
      );
      const bodyguardModels = Number(
        url.searchParams.get("bodyguardModels") ?? bodyguard?.suggestedModelCount ?? 1,
      );
      if (
        !Number.isSafeInteger(joinerModels) ||
        joinerModels < 1 ||
        joinerModels > 1000 ||
        !Number.isSafeInteger(bodyguardModels) ||
        bodyguardModels < 1 ||
        bodyguardModels > 1000
      ) {
        return apiError("models and bodyguardModels must be integers from 1 to 1000");
      }
      return json({
        data: {
          unit: { id: joiner.id, name: joiner.name, models: joinerModels },
          bodyguard: bodyguard
            ? { id: bodyguard.id, name: bodyguard.name, models: bodyguardModels }
            : null,
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          rule: eligibility.rule,
          startingStrength:
            eligibility.eligible && eligibility.rule.increasesStartingStrength
              ? joinerModels + bodyguardModels
              : bodyguardModels,
          options: joiner.bodyguardJoinOptions.map((option) => {
            const profile = catalogue.units.find((entry) => entry.id === option.bodyguardId);
            return {
              id: option.bodyguardId,
              name: profile?.name ?? option.bodyguardId,
              rule: option,
            };
          }),
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/firing-deck" && request.method === "GET") {
      const unitId = url.searchParams.get("unit");
      const passengerId = url.searchParams.get("passenger");
      if (!unitId || !passengerId) {
        return apiError("Missing required unit or passenger query parameter");
      }
      const catalogue = await loadCatalogue(request, env);
      const transport = catalogue.units.find((entry) => entry.id === unitId);
      if (!transport) return apiError("Transport not found", 404);
      if (!transport.firingDeck) return apiError("Unit has no Firing Deck", 409);
      const passenger = catalogue.units.find((entry) => entry.id === passengerId);
      if (!passenger) return apiError("Passenger unit not found", 404);
      const attachedId = url.searchParams.get("attached");
      const attached = attachedId ? catalogue.units.find((entry) => entry.id === attachedId) : null;
      if (attachedId && !attached) return apiError("Attached unit not found", 404);
      if (passenger.id === transport.id) return apiError("A transport cannot be its own passenger");
      const transportEligibility = transportPassengerEligibility(transport, passenger, {
        attachedUnit: attached,
      });
      if (!transportEligibility.eligible) return apiError(transportEligibility.reason, 409);
      return json({
        data: {
          transport: { id: transport.id, name: transport.name },
          capacity: transport.firingDeck.capacity,
          passenger: {
            id: passenger.id,
            name: passenger.name,
            modelCost: passenger.firingDeckModelCost,
            weapons: passenger.weapons.filter(
              (weapon) =>
                weapon.type === "Ranged" &&
                !weapon.abilities.some((ability) => ability.name.toLowerCase() === "one shot"),
            ),
          },
          attached: attached ? { id: attached.id, name: attached.name } : null,
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/transport" && request.method === "GET") {
      const unitId = url.searchParams.get("unit");
      const passengerId = url.searchParams.get("passenger");
      if (!unitId || !passengerId) {
        return apiError("Missing required unit or passenger query parameter");
      }
      const models = Number(url.searchParams.get("models") ?? "1");
      if (!Number.isSafeInteger(models) || models < 1 || models > 1000) {
        return apiError("models must be an integer from 1 to 1000");
      }
      const catalogue = await loadCatalogue(request, env);
      const transport = catalogue.units.find((entry) => entry.id === unitId);
      const passenger = catalogue.units.find((entry) => entry.id === passengerId);
      if (!transport || !passenger) return apiError("Transport or passenger unit not found", 404);
      const attachedId = url.searchParams.get("attached");
      const attached = attachedId ? catalogue.units.find((entry) => entry.id === attachedId) : null;
      if (attachedId && !attached) return apiError("Attached unit not found", 404);
      const eligibility = transportPassengerEligibility(transport, passenger, {
        attachedUnit: attached,
      });
      return json({
        data: {
          transport: { id: transport.id, name: transport.name },
          passenger: { id: passenger.id, name: passenger.name },
          attached: attached ? { id: attached.id, name: attached.name } : null,
          capacity: eligibility.poolCapacity ?? transport.transport?.capacity ?? 0,
          pool: eligibility.eligible
            ? {
                position: eligibility.poolPosition,
                kind: eligibility.poolKind,
                label: eligibility.poolLabel,
                capacity: eligibility.poolCapacity,
                maximumWounds: eligibility.poolMaximumWounds,
              }
            : null,
          sharedAllowance: eligibility.eligible
            ? (transport.transport?.sharedAllowances.find(
                (allowance) => allowance.position === eligibility.sharedAllowancePosition,
              ) ?? null)
            : null,
          sharedAllowances: transport.transport?.sharedAllowances ?? [],
          pools: transportCapacityPools(transport).map((pool) => ({
            position: pool.position,
            kind: pool.kind,
            label: pool.label,
            capacity: pool.capacity,
            maximumWounds: pool.maximumWounds,
            allowedKeywords: pool.allowedKeywords,
          })),
          eligible: eligibility.eligible,
          reason: eligibility.reason,
          modelCost: eligibility.modelCost ?? null,
          models,
          slots: eligibility.eligible ? models * eligibility.modelCost : null,
          fits:
            eligibility.eligible &&
            models * eligibility.modelCost <= eligibility.poolCapacity &&
            (eligibility.sharedAllowanceMaximumModels === null ||
              models <= eligibility.sharedAllowanceMaximumModels),
          source: transport.transport?.source ?? null,
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/validate-firing-deck" && request.method === "POST") {
      const body = (await request.json()) as { transportId?: unknown; selections?: unknown };
      if (typeof body?.transportId !== "string" || !Array.isArray(body.selections)) {
        return apiError("transportId and selections are required");
      }
      const catalogue = await loadCatalogue(request, env);
      const transport = catalogue.units.find((entry) => entry.id === body.transportId);
      if (!transport) return apiError("Transport not found", 404);
      const result = resolveFiringDeckSelections(catalogue, transport, body.selections);
      return json({
        data: {
          capacity: result.capacity,
          slotsUsed: result.slots,
          selections: result.selections.map((selection) => ({
            passengerUnitId: selection.passengerUnitId,
            passengerUnitName: selection.passengerUnitName,
            attachedUnitId: selection.attachedUnitId,
            attachedUnitName: selection.attachedUnitName,
            weaponId: selection.weaponId,
            weaponName: selection.weaponName,
            modelCount: selection.modelCount,
            modelCost: selection.modelCost,
            slots: selection.slots,
            bearerUnitId: transport.id,
          })),
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (url.pathname === "/api/v1/validate-loadout" && request.method === "POST") {
      const body = (await request.json()) as {
        unitId?: unknown;
        modelCount?: unknown;
        weaponCounts?: unknown;
        optionCounts?: unknown;
        choiceSelections?: unknown;
        loadoutSubjectCounts?: unknown;
      };
      if (
        !body ||
        typeof body.unitId !== "string" ||
        !Number.isInteger(body.modelCount) ||
        (body.modelCount as number) < 1 ||
        (body.modelCount as number) > 1000 ||
        !body.weaponCounts ||
        typeof body.weaponCounts !== "object" ||
        Array.isArray(body.weaponCounts)
      ) {
        return apiError("unitId, modelCount, and weaponCounts are required");
      }
      const counts = body.weaponCounts as Record<string, unknown>;
      const optionCounts = (body.optionCounts ?? {}) as Record<string, unknown>;
      const choiceSelections = (body.choiceSelections ?? {}) as Record<string, unknown>;
      const loadoutSubjectCounts = (body.loadoutSubjectCounts ?? {}) as Record<string, unknown>;
      if (
        Object.keys(counts).length > 200 ||
        !optionCounts ||
        typeof optionCounts !== "object" ||
        Array.isArray(optionCounts) ||
        Object.keys(optionCounts).length > 200 ||
        !choiceSelections ||
        typeof choiceSelections !== "object" ||
        Array.isArray(choiceSelections) ||
        Object.keys(choiceSelections).length > 500 ||
        !loadoutSubjectCounts ||
        typeof loadoutSubjectCounts !== "object" ||
        Array.isArray(loadoutSubjectCounts) ||
        Object.keys(loadoutSubjectCounts).length > 100 ||
        Object.values(counts).some(
          (count) => !Number.isInteger(count) || (count as number) < 0 || (count as number) > 100,
        ) ||
        Object.values(optionCounts).some(
          (count) => !Number.isInteger(count) || (count as number) < 0 || (count as number) > 100,
        ) ||
        Object.values(choiceSelections).some(
          (count) => !Number.isInteger(count) || (count as number) < 0 || (count as number) > 100,
        ) ||
        Object.values(loadoutSubjectCounts).some(
          (count) => !Number.isInteger(count) || (count as number) < 0 || (count as number) > 1000,
        )
      ) {
        return apiError("Loadout count values must be integers within their supported ranges");
      }
      const catalogue = await loadCatalogue(request, env);
      const unit = catalogue.units.find((entry) => entry.id === body.unitId);
      if (!unit) return apiError("Unit not found", 404);
      const groupIds = new Set(unit.weapons.map((weapon) => weapon.groupId));
      const alternativeIds = new Set(
        unit.wargearChoicePools.flatMap((pool) =>
          pool.alternatives.map((alternative) => alternative.id),
        ),
      );
      const loadoutSubjectIds = new Set(
        unit.unresolvedLoadoutSubjects.map((subject) => subject.id),
      );
      if (
        [...Object.keys(counts), ...Object.keys(optionCounts)].some(
          (groupId) => !groupIds.has(groupId),
        )
      ) {
        return apiError("weaponCounts and optionCounts must use weapon group IDs from this unit");
      }
      if (
        Object.keys(choiceSelections).some((alternativeId) => !alternativeIds.has(alternativeId))
      ) {
        return apiError("choiceSelections must use alternative IDs from this unit");
      }
      if (
        Object.keys(loadoutSubjectCounts).some((subjectId) => !loadoutSubjectIds.has(subjectId))
      ) {
        return apiError("loadoutSubjectCounts must use unresolved subject IDs from this unit");
      }
      const warnings = unitLoadoutWarnings(
        unit,
        body.modelCount as number,
        optionCounts,
        counts,
        choiceSelections,
        loadoutSubjectCounts,
      );
      return json({
        data: {
          valid: warnings.length === 0,
          warnings,
          weaponLimits: unit.weaponLimits,
          wargearChoicePools: unit.wargearChoicePools,
          wargearChoiceItemLimits: unit.wargearChoiceItemLimits,
          wargearChoicePairingRules: unit.wargearChoicePairingRules,
          weaponTypeLimits: unit.weaponTypeLimits,
          selectedChoiceItemCounts: choiceSelectionItemCounts(unit, choiceSelections),
          selectedWeaponCounts: choiceSelectionWeaponCounts(unit, choiceSelections),
          compositionWeaponCounts: loadoutSubjectWeaponCounts(unit, loadoutSubjectCounts),
          suggestedEquippedCounts: sourceEquippedWeaponCounts(
            unit,
            body.modelCount as number,
            choiceSelections,
            loadoutSubjectCounts,
          ),
          sourceCombatPresetIds: sourceEquipmentCombatPresetIds(unit, {
            choiceSelections,
            modelCount: body.modelCount as number,
            loadoutSubjectCounts,
          }),
          unavailableSourceCombatPresetIds: unavailableSourceEquipmentCombatPresetIds(unit, {
            choiceSelections,
            modelCount: body.modelCount as number,
            loadoutSubjectCounts,
          }),
          sourceCombatPresetEquipmentCounts: Object.fromEntries(
            unit.combatPresets
              .filter((preset) => preset.sourceEquipmentChoiceExact)
              .map((preset) => [
                preset.id,
                combatPresetSourceEquipmentCount(preset, {
                  unit,
                  choiceSelections,
                  modelCount: body.modelCount as number,
                  loadoutSubjectCounts,
                }),
              ]),
          ),
          startingSizeRanges: unit.startingSizeRanges,
          modelCountStatus: unitStartingSizeStatus(unit, body.modelCount as number),
        },
        sourceUpdatedAt: catalogue.sourceUpdatedAt,
      });
    }

    if (
      (url.pathname === "/api/v1/weapons" || url.pathname === "/api/v1/targets") &&
      request.method === "GET"
    ) {
      const unitId = url.searchParams.get("unit");
      if (!unitId) return apiError("Missing required unit query parameter");
      const catalogue = await loadCatalogue(request, env);
      const unit = catalogue.units.find((entry) => entry.id === unitId);
      if (!unit) return apiError("Unit not found", 404);
      const data = url.pathname.endsWith("weapons") ? unit.weapons : unit.models;
      return json({ data, unit: { id: unit.id, name: unit.name, factionId: unit.factionId } });
    }

    if (url.pathname === "/api/v1/calculate" && request.method === "POST") {
      const profile = await requestProfile(request);
      return json({
        data: await exactCalculation(profile),
        profile,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/volley" && request.method === "POST") {
      const body = (await request.json()) as {
        profiles?: unknown;
        targets?: unknown;
        initialWoundsLost?: unknown;
      };
      if (!body || !Array.isArray(body.profiles)) {
        return apiError("profiles must be an array");
      }
      const profiles = body.profiles.map((profile) => normalizeProfile(profile));
      const targets = orderedTargets(body.targets);
      const initialWoundsLost = body.initialWoundsLost ?? 0;
      if (!Number.isInteger(initialWoundsLost)) {
        return apiError("initialWoundsLost must be an integer");
      }
      return json({
        data: await exactVolley(profiles, targets, initialWoundsLost as number),
        profiles,
        targets,
        initialWoundsLost,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/volley/complexity" && request.method === "POST") {
      const body = (await request.json()) as {
        profiles?: unknown;
        targets?: unknown;
        initialWoundsLost?: unknown;
      };
      if (!body || !Array.isArray(body.profiles)) {
        return apiError("profiles must be an array");
      }
      const profiles = body.profiles.map((profile) => normalizeProfile(profile));
      const targets = orderedTargets(body.targets);
      const initialWoundsLost = body.initialWoundsLost ?? 0;
      if (!Number.isInteger(initialWoundsLost)) {
        return apiError("initialWoundsLost must be an integer");
      }
      return json({
        data: await volleyComplexity(profiles, targets, initialWoundsLost as number),
        profiles,
        targets,
        initialWoundsLost,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/battle/replay" && request.method === "POST") {
      const body = (await request.json()) as {
        battleState?: unknown;
        formationId?: unknown;
      };
      if (!body || body.battleState === undefined) {
        return apiError("battleState is required");
      }
      return json({
        data: await replayFormationHealth(body.battleState, body.formationId, request, env),
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/roll" && request.method === "POST") {
      const profile = await requestProfile(request);
      const rolled = simulateAttack(profile);
      if (url.searchParams.get("details") === "false") rolled.details = [];
      return json({ data: rolled, profile, apiVersion: "v1" });
    }

    if (url.pathname === "/api/v1/volley/roll" && request.method === "POST") {
      const body = (await request.json()) as {
        profiles?: unknown;
        targets?: unknown;
        initialWoundsLost?: unknown;
      };
      if (!body || !Array.isArray(body.profiles)) {
        return apiError("profiles must be an array");
      }
      const profiles = body.profiles.map((profile) => normalizeProfile(profile));
      const targets = orderedTargets(body.targets);
      const initialWoundsLost = body.initialWoundsLost ?? 0;
      if (!Number.isInteger(initialWoundsLost)) {
        return apiError("initialWoundsLost must be an integer");
      }
      const rolled = simulateOrderedVolley(profiles, targets, initialWoundsLost as number);
      if (url.searchParams.get("details") === "false") {
        for (const line of rolled.lines) line.details = [];
      }
      return json({
        data: rolled,
        profiles,
        targets,
        initialWoundsLost,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/volley/simulate" && request.method === "POST") {
      const body = (await request.json()) as {
        profiles?: unknown;
        targets?: unknown;
        initialWoundsLost?: unknown;
        seed?: unknown;
        trials?: unknown;
      };
      if (!body || !Array.isArray(body.profiles)) {
        return apiError("profiles must be an array");
      }
      const profiles = body.profiles.map((profile) => normalizeProfile(profile));
      const targets = orderedTargets(body.targets);
      const initialWoundsLost = body.initialWoundsLost ?? 0;
      if (!Number.isInteger(initialWoundsLost)) {
        return apiError("initialWoundsLost must be an integer");
      }
      const seed = body.seed;
      const trials = body.trials ?? 10_000;
      if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffff_ffff) {
        return apiError("seed must be an unsigned 32-bit integer");
      }
      return json({
        data: simulateOrderedVolleyPhase(
          profiles,
          targets,
          seed as number,
          trials as number,
          initialWoundsLost as number,
        ),
        profiles,
        targets,
        initialWoundsLost,
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/lists" && request.method === "GET") {
      return json({
        data: await withStorage(() => listArmyLists(env.ARMY_DB)),
        apiVersion: "v1",
      });
    }

    if (url.pathname === "/api/v1/lists" && request.method === "POST") {
      if ((await withStorage(() => listArmyLists(env.ARMY_DB))).length >= 100) {
        throw new Error("Cloud storage supports at most 100 army lists");
      }
      const input = await requestArmyList(request, env);
      return json({ data: await withStorage(() => createArmyList(env.ARMY_DB, input)) }, 201);
    }

    if (url.pathname === "/api/v1/lists/export" && request.method === "GET") {
      const catalogue = await loadCatalogue(request, env);
      return json(
        createArmyListBackup(
          await withStorage(() => listArmyLists(env.ARMY_DB)),
          new Date().toISOString(),
          catalogue.sourceUpdatedAt,
        ),
      );
    }

    if (url.pathname === "/api/v1/lists/import" && request.method === "POST") {
      const backup = parseArmyListBackup(await request.json()) as { lists: unknown[] };
      const records = backup.lists.map(
        (record) => normalizeArmyListRecord(record) as ArmyListRecord,
      );
      const mergedIds = new Set(
        (await withStorage(() => listArmyLists(env.ARMY_DB))).map((record) => record.id),
      );
      for (const record of records) mergedIds.add(record.id);
      if (mergedIds.size > 100) throw new Error("Cloud storage supports at most 100 army lists");
      return json({
        data: await withStorage(() => importArmyLists(env.ARMY_DB, records)),
        imported: records.length,
      });
    }

    const listMatch = /^\/api\/v1\/lists\/([0-9a-f-]+)$/i.exec(url.pathname);
    if (listMatch && request.method === "PUT") {
      const input = await requestArmyList(request, env);
      const updated = await withStorage(() => updateArmyList(env.ARMY_DB, listMatch[1], input));
      return updated ? json({ data: updated }) : apiError("Army list not found", 404);
    }
    if (listMatch && request.method === "DELETE") {
      return (await withStorage(() => deleteArmyList(env.ARMY_DB, listMatch[1])))
        ? json({ deleted: true })
        : apiError("Army list not found", 404);
    }

    return apiError("API endpoint not found", 404);
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      return apiError(error.message, 503, error.code);
    }
    if (error instanceof SyntaxError) {
      return apiError("Request body must contain valid JSON", 400, "INVALID_JSON");
    }
    if (error instanceof ExactStateLimitError) {
      return apiError(error.message, 422, "EXACT_STATE_LIMIT");
    }
    return apiError(error instanceof Error ? error.message : "Request failed");
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname === "/api/") {
      return Response.redirect(new URL("/api/v1", request.url), 308);
    }
    if (url.pathname.startsWith("/api/v1")) {
      const response = await handleApi(request, env);
      response.headers.set("X-Request-ID", crypto.randomUUID());
      return response;
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
