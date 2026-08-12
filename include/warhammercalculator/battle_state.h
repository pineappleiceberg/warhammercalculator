#ifndef WARHAMMERCALCULATOR_BATTLE_STATE_H
#define WARHAMMERCALCULATOR_BATTLE_STATE_H

#include <stdbool.h>
#include <stdint.h>

#define WHC_BATTLE_EVENT_VERSION 1u
#define WHC_BATTLE_STATE_VERSION WHC_BATTLE_EVENT_VERSION
#define WHC_MAX_BATTLE_SEGMENTS 32u
#define WHC_MAX_BATTLE_EVENTS 10000u
#define WHC_BATTLE_PROFILE_FIELDS 2u
#define WHC_BATTLE_EVENT_HEADER_FIELDS 6u
#define WHC_BATTLE_ALLOCATION_FIELDS 5u
#define WHC_BATTLE_EVENT_FIELDS                                                                    \
    (WHC_BATTLE_EVENT_HEADER_FIELDS + WHC_MAX_BATTLE_SEGMENTS * WHC_BATTLE_ALLOCATION_FIELDS)
#define WHC_BATTLE_HEALTH_FIELDS 2u
#define WHC_BATTLE_CLOCK_FIELDS 8u
#define WHC_BATTLE_PLAYER_NONE 2u
#define WHC_TARGET_VISIBLE 1u
#define WHC_TARGET_FULLY_VISIBLE 2u
#define WHC_TARGET_INDIRECT_FIRE 4u
#define WHC_TARGET_WEAPON_HAS_INDIRECT 8u
#define WHC_TARGET_REVIEWED_BY_PLAYER 16u
#define WHC_TARGET_RANGE_OVERRIDE_EXPLAINED 32u
#define WHC_WEAPON_ASSAULT 1u
#define WHC_WEAPON_INDIRECT 2u
#define WHC_CHARGE_REVIEWED_BY_PLAYER 1u
#define WHC_CHARGE_PHASE_START_ELIGIBLE 2u
#define WHC_CHARGE_STARTED_OUTSIDE_ENGAGEMENT 4u
#define WHC_CHARGE_ALL_TARGETS_ENGAGED 8u
#define WHC_CHARGE_UNIT_COHERENCY 16u
#define WHC_CHARGE_NON_TARGETS_AVOIDED 32u
#define WHC_CHARGE_ALL_MODELS_CLOSER 64u
#define WHC_CHARGE_BASE_CONTACT_MAXIMIZED 128u
#define WHC_CHARGE_ROLL_OVERRIDE_EXPLAINED 256u
#define WHC_CHARGE_FAILURE_EXPLAINED 512u
#define WHC_CHARGE_FLAGS_MASK 1023u
#define WHC_FIGHT_MOVE_PILE_IN 1u
#define WHC_FIGHT_MOVE_CONSOLIDATION 2u
#define WHC_FIGHT_DESTINATION_NONE 0u
#define WHC_FIGHT_DESTINATION_ENEMY 1u
#define WHC_FIGHT_DESTINATION_OBJECTIVE 2u
#define WHC_FIGHT_MOVE_REVIEWED_BY_PLAYER 1u
#define WHC_FIGHT_MOVE_UNIT_COHERENCY 2u
#define WHC_FIGHT_MOVE_ENGAGEMENT_RANGE 4u
#define WHC_FIGHT_MOVE_CLOSER_TO_ENEMY 8u
#define WHC_FIGHT_MOVE_BASE_CONTACT_MAXIMIZED 16u
#define WHC_FIGHT_MOVE_BASE_CONTACT_STATIONARY 32u
#define WHC_FIGHT_MOVE_ENEMY_DESTINATION_IMPOSSIBLE 64u
#define WHC_FIGHT_MOVE_OBJECTIVE_RANGE 128u
#define WHC_FIGHT_MOVE_CLOSER_TO_OBJECTIVE 256u
#define WHC_FIGHT_MOVE_OBJECTIVE_DESTINATION_IMPOSSIBLE 512u
#define WHC_FIGHT_MOVE_OUTCOME_EXPLAINED 1024u
#define WHC_FIGHT_MOVE_RULE_RESTRICTED 2048u
#define WHC_FIGHT_MOVE_FLAGS_MASK 4095u
#define WHC_HEROIC_TARGET_ELIGIBILITY_REVIEWED 1u
#define WHC_HEROIC_VEHICLE_RESTRICTION_SATISFIED 2u
#define WHC_HEROIC_SOLE_TRIGGER_TARGET 4u
#define WHC_HEROIC_CHARGE_BONUS_SUPPRESSED 8u
#define WHC_HEROIC_FLAGS_MASK 15u
#define WHC_FIRE_OVERWATCH_TARGET_VISIBLE 1u
#define WHC_FIRE_OVERWATCH_ELIGIBLE_TO_SHOOT 2u
#define WHC_FIRE_OVERWATCH_NON_TITANIC 4u
#define WHC_FIRE_OVERWATCH_OUT_OF_PHASE_RESTRICTIONS 8u
#define WHC_FIRE_OVERWATCH_HITS_ON_UNMODIFIED_SIX 16u
#define WHC_FIRE_OVERWATCH_CRITICAL_HITS_ON_SIX 32u
#define WHC_FIRE_OVERWATCH_FLAGS_MASK 63u
#define WHC_HAZARDOUS_SELECTED_BEARER 1u
#define WHC_HAZARDOUS_SELECTION_PRIORITY 2u
#define WHC_HAZARDOUS_FLAGS_MASK 3u
#define WHC_GO_TO_GROUND_TARGET_SELECTED 1u
#define WHC_GO_TO_GROUND_TARGET_INFANTRY 2u
#define WHC_GO_TO_GROUND_RESPONDING_PLAYER 4u
#define WHC_GO_TO_GROUND_SIX_PLUS_INVULNERABLE 8u
#define WHC_GO_TO_GROUND_BENEFIT_OF_COVER 16u
#define WHC_GO_TO_GROUND_FLAGS_MASK 31u
#define WHC_COUNTER_OFFENSIVE_ENEMY_JUST_FOUGHT 1u
#define WHC_COUNTER_OFFENSIVE_TARGET_IN_ENGAGEMENT_RANGE 2u
#define WHC_COUNTER_OFFENSIVE_TARGET_NOT_FOUGHT 4u
#define WHC_COUNTER_OFFENSIVE_RESPONDING_PLAYER 8u
#define WHC_COUNTER_OFFENSIVE_FIGHTS_NEXT 16u
#define WHC_COUNTER_OFFENSIVE_FLAGS_MASK 31u
#define WHC_SMOKESCREEN_TARGET_SELECTED 1u
#define WHC_SMOKESCREEN_TARGET_SMOKE 2u
#define WHC_SMOKESCREEN_RESPONDING_PLAYER 4u
#define WHC_SMOKESCREEN_BENEFIT_OF_COVER 8u
#define WHC_SMOKESCREEN_STEALTH 16u
#define WHC_SMOKESCREEN_FLAGS_MASK 31u
#define WHC_RAPID_INGRESS_TARGET_IN_RESERVES 1u
#define WHC_RAPID_INGRESS_RESPONDING_PLAYER 2u
#define WHC_RAPID_INGRESS_AS_REINFORCEMENTS 4u
#define WHC_RAPID_INGRESS_PLACEMENT_LEGAL 8u
#define WHC_RAPID_INGRESS_PASSENGERS_REMAIN_EMBARKED 16u
#define WHC_RAPID_INGRESS_FLAGS_MASK 31u

#define WHC_RULE_COVERAGE_EXECUTABLE 1u
#define WHC_RULE_COVERAGE_GUIDED 2u
#define WHC_RULE_COVERAGE_IRRELEVANT 3u
#define WHC_RULE_COVERAGE_UNSUPPORTED 4u
#define WHC_RANGED_DECLARATION_SAME_ACTIVATION 1u
#define WHC_RANGED_DECLARATION_BEFORE_ATTACKS 2u
#define WHC_RANGED_DECLARATION_ALL_ELIGIBLE 4u
#define WHC_RANGED_DECLARATION_WEAPON_COUNTS_VALID 8u
#define WHC_RANGED_DECLARATION_TARGETS_CONTIGUOUS 16u
#define WHC_RANGED_DECLARATION_PROFILES_CONTIGUOUS 32u
#define WHC_RANGED_DECLARATION_FLAGS_MASK 63u
#define WHC_DEPLOYMENT_ROOT_BATTLEFIELD 1u
#define WHC_DEPLOYMENT_ROOT_RESERVES 2u
#define WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES 3u
#define WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED 0u
#define WHC_AIRCRAFT_MODE_NONE 0u
#define WHC_AIRCRAFT_MODE_AIRCRAFT 1u
#define WHC_AIRCRAFT_MODE_HOVER 2u
#define WHC_TABLE_GEOMETRY_REVIEWED_BY_PLAYER 1u
#define WHC_TABLE_GEOMETRY_SOURCE_LOCKED 2u
#define WHC_TABLE_GEOMETRY_TERRAIN_REVIEWED 4u
#define WHC_TABLE_GEOMETRY_DEPLOYMENT_ZONES_REVIEWED 8u
#define WHC_TABLE_GEOMETRY_OBJECTIVES_REVIEWED 16u
#define WHC_TABLE_GEOMETRY_FLAGS_MASK 31u
#define WHC_TABLE_WIDTH_THOUSANDTHS 60000u
#define WHC_TABLE_HEIGHT_THOUSANDTHS 44000u
#define WHC_TERRAIN_OUTLINE_COUNT 12u
#define WHC_TERRAIN_SECTION_COUNT WHC_TERRAIN_OUTLINE_COUNT
#define WHC_TERRAIN_SIX_BY_FOUR_COUNT 4u
#define WHC_TERRAIN_TEN_BY_FIVE_COUNT 2u
#define WHC_TERRAIN_TWELVE_BY_SIX_COUNT 6u
#define WHC_TERRAIN_FOOTPRINT_REVIEWED_BY_PLAYER 1u
#define WHC_TERRAIN_FOOTPRINT_SOURCE_LOCKED 2u
#define WHC_TERRAIN_FOOTPRINT_PLACEMENT_REVIEWED 4u
#define WHC_TERRAIN_FOOTPRINT_GROUPING_REVIEWED 8u
#define WHC_TERRAIN_FOOTPRINT_FLAGS_MASK 15u
#define WHC_MODEL_PLACEMENT_REVIEWED_BY_PLAYER 1u
#define WHC_MODEL_PLACEMENT_SOURCE_LOCKED 2u
#define WHC_MODEL_PLACEMENT_BOUNDARIES_REVIEWED 4u
#define WHC_MODEL_PLACEMENT_POSITIONS_REVIEWED 8u
#define WHC_MODEL_PLACEMENT_NO_OVERLAP_REVIEWED 16u
#define WHC_MODEL_PLACEMENT_OBJECTIVES_REVIEWED 32u
#define WHC_MODEL_PLACEMENT_FLAGS_MASK 63u
#define WHC_MODEL_POSITION_FLAGS_MASK 1023u
#define WHC_SPATIAL_FACTS_CURRENT 1u
#define WHC_SPATIAL_FACTS_SOURCE_LOCKED 2u
#define WHC_SPATIAL_FACTS_EXECUTABLE 4u
#define WHC_SPATIAL_FACTS_FLAGS_MASK 7u
#define WHC_ENDPOINT_CLEARANCE_FLAGS_MASK 3u
#define WHC_TERRAIN_CLEARANCE_FLAGS_MASK 7u
#define WHC_MISSION_TRACKER_PLAN_REVIEWED 1u
#define WHC_MISSION_TRACKER_SOURCE_LOCKED 2u
#define WHC_MISSION_TRACKER_CARD_RULES_PLAYER_SUPPLIED 4u
#define WHC_MISSION_TRACKER_FLAGS_MASK 7u
#define WHC_MISSION_SECONDARY_NONE 0u
#define WHC_MISSION_SECONDARY_FIXED 1u
#define WHC_MISSION_SECONDARY_TACTICAL 2u
#define WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK 7u
#define WHC_VISIBILITY_FACTS_EXECUTABLE 1u
#define WHC_VISIBILITY_FACTS_SOURCE_LOCKED 2u
#define WHC_VISIBILITY_FACTS_FLAGS_MASK 3u
#define WHC_RANGED_GEOMETRY_DIRECT_VISIBLE 1u
#define WHC_RANGED_GEOMETRY_INDIRECT_FIRE 2u
#define WHC_RANGED_GEOMETRY_WEAPON_HAS_INDIRECT 4u
#define WHC_RANGED_GEOMETRY_VISIBILITY_PROOF 8u
#define WHC_RANGED_GEOMETRY_VISIBILITY_OVERRIDE 16u
#define WHC_RANGED_GEOMETRY_FULLY_VISIBLE 32u
#define WHC_RANGED_GEOMETRY_FULL_VISIBILITY_PROOF 64u
#define WHC_RANGED_GEOMETRY_FULL_VISIBILITY_OVERRIDE 128u
#define WHC_RANGED_GEOMETRY_REVIEWED_BY_PLAYER 256u
#define WHC_RANGED_GEOMETRY_FLAGS_MASK 511u
#define WHC_RANGED_GEOMETRY_VISIBILITY_MASK 27u
#define WHC_RANGED_GEOMETRY_INDIRECT_MASK 31u
#define WHC_RANGED_GEOMETRY_FULL_VISIBILITY_MASK 224u
#define WHC_CONVEX_SILHOUETTE_REVIEWED 1u
#define WHC_CONVEX_SILHOUETTE_FLAGS_MASK 1u
#define WHC_CONVEX_SILHOUETTE_MIN_VERTICES 3u
#define WHC_CONVEX_SILHOUETTE_MAX_VERTICES 16u
#define WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT 30000
#define WHC_SIMPLE_TERRAIN_SURFACE_REVIEWED 1u
#define WHC_SIMPLE_TERRAIN_SURFACE_MIN_VERTICES 3u
#define WHC_SIMPLE_TERRAIN_SURFACE_MAX_VERTICES 32u
#define WHC_SIMPLE_TERRAIN_SURFACE_MAX_X 60000
#define WHC_SIMPLE_TERRAIN_SURFACE_MAX_Y 44000

enum whc_fire_overwatch_trigger {
    WHC_FIRE_OVERWATCH_SET_UP = 1u,
    WHC_FIRE_OVERWATCH_NORMAL_MOVE_START = 2u,
    WHC_FIRE_OVERWATCH_NORMAL_MOVE_END = 3u,
    WHC_FIRE_OVERWATCH_ADVANCE_START = 4u,
    WHC_FIRE_OVERWATCH_ADVANCE_END = 5u,
    WHC_FIRE_OVERWATCH_FALL_BACK_START = 6u,
    WHC_FIRE_OVERWATCH_FALL_BACK_END = 7u,
    WHC_FIRE_OVERWATCH_CHARGE_DECLARED = 8u
};

enum whc_battle_clock_status {
    WHC_BATTLE_CLOCK_SETUP = 0u,
    WHC_BATTLE_CLOCK_ACTIVE = 1u,
    WHC_BATTLE_CLOCK_COMPLETE = 2u
};

enum whc_battle_phase {
    WHC_BATTLE_PHASE_SETUP = 0u,
    WHC_BATTLE_PHASE_COMMAND = 1u,
    WHC_BATTLE_PHASE_MOVEMENT = 2u,
    WHC_BATTLE_PHASE_SHOOTING = 3u,
    WHC_BATTLE_PHASE_CHARGE = 4u,
    WHC_BATTLE_PHASE_FIGHT = 5u,
    WHC_BATTLE_PHASE_COMPLETE = 6u
};

enum whc_movement_step {
    WHC_MOVEMENT_STEP_START = 0u,
    WHC_MOVEMENT_STEP_MOVE_UNITS = 1u,
    WHC_MOVEMENT_STEP_REINFORCEMENTS = 2u,
    WHC_MOVEMENT_STEP_END = 3u
};

enum whc_battle_event_kind {
    WHC_BATTLE_EVENT_ATTACK = 1u,
    WHC_BATTLE_EVENT_REVERT = 2u,
    WHC_BATTLE_EVENT_TRANSPORT_DAMAGE = 3u,
    WHC_BATTLE_EVENT_HAZARDOUS_DAMAGE = 4u
};

/*@ requires 1 <= segment_count && segment_count <= WHC_MAX_BATTLE_SEGMENTS;
    requires event_count <= WHC_MAX_BATTLE_EVENTS;
    requires \valid_read(profiles + (0 .. segment_count * WHC_BATTLE_PROFILE_FIELDS - 1));
    requires \forall integer index; 0 <= index < segment_count ==>
                profiles[index * WHC_BATTLE_PROFILE_FIELDS] > 0 &&
                profiles[index * WHC_BATTLE_PROFILE_FIELDS + 1] > 0;
    requires event_count == 0 ||
             \valid_read(events + (0 .. event_count * WHC_BATTLE_EVENT_FIELDS - 1));
    requires \valid(health + (0 .. segment_count * WHC_BATTLE_HEALTH_FIELDS - 1));
    requires \separated(profiles + (0 .. segment_count * WHC_BATTLE_PROFILE_FIELDS - 1),
                        health + (0 .. segment_count * WHC_BATTLE_HEALTH_FIELDS - 1));
    requires event_count == 0 ||
             \separated(events + (0 .. event_count * WHC_BATTLE_EVENT_FIELDS - 1),
                        health + (0 .. segment_count * WHC_BATTLE_HEALTH_FIELDS - 1));
    assigns health[0 .. segment_count * WHC_BATTLE_HEALTH_FIELDS - 1];
    ensures !\result ==> \forall integer index;
                0 <= index < segment_count * WHC_BATTLE_HEALTH_FIELDS ==>
                    health[index] == \old(health[index]);
    ensures \result ==> \forall integer index; 0 <= index < segment_count ==>
                health[index * WHC_BATTLE_HEALTH_FIELDS] <=
                    profiles[index * WHC_BATTLE_PROFILE_FIELDS + 1] &&
                health[index * WHC_BATTLE_HEALTH_FIELDS + 1] <
                    profiles[index * WHC_BATTLE_PROFILE_FIELDS] &&
                (health[index * WHC_BATTLE_HEALTH_FIELDS] > 0 ||
                 health[index * WHC_BATTLE_HEALTH_FIELDS + 1] == 0);
    ensures \result && event_count == 0 ==> \forall integer index;
                0 <= index < segment_count ==>
                    health[index * WHC_BATTLE_HEALTH_FIELDS] ==
                        profiles[index * WHC_BATTLE_PROFILE_FIELDS + 1] &&
                    health[index * WHC_BATTLE_HEALTH_FIELDS + 1] == 0;
    ensures event_count == 0 ==> \result;
*/
bool whc_replay_battle_health_events(const uint32_t *profiles, uint32_t segment_count,
                                     const uint32_t *events, uint32_t event_count,
                                     uint32_t *health);

/*@ assigns \nothing;
    ensures \result <==>
        published_range_thousandths > 0 && effective_range_thousandths > 0 &&
        measured_distance_thousandths > 0 &&
        measured_distance_thousandths <= effective_range_thousandths &&
        declared_weapon_count > 0 && declared_weapon_count <= eligible_weapon_count &&
        (flags & WHC_TARGET_REVIEWED_BY_PLAYER) != 0 &&
        (((flags & WHC_TARGET_FULLY_VISIBLE) == 0) ||
         ((flags & WHC_TARGET_VISIBLE) != 0)) &&
        (((flags & WHC_TARGET_VISIBLE) != 0 &&
          (flags & WHC_TARGET_INDIRECT_FIRE) == 0) ||
         ((flags & WHC_TARGET_VISIBLE) == 0 &&
          (flags & WHC_TARGET_INDIRECT_FIRE) != 0 &&
          (flags & WHC_TARGET_WEAPON_HAS_INDIRECT) != 0)) &&
        (published_range_thousandths == effective_range_thousandths ||
         (flags & WHC_TARGET_RANGE_OVERRIDE_EXPLAINED) != 0);
*/
bool whc_ranged_target_eligibility_is_valid(uint32_t published_range_thousandths,
                                            uint32_t effective_range_thousandths,
                                            uint32_t measured_distance_thousandths,
                                            uint32_t eligible_weapon_count,
                                            uint32_t declared_weapon_count, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        inventory_count > 0 && source_models_remaining > 0 &&
        declared_count > 0 && used_count <= inventory_count &&
        declared_count <= inventory_count - used_count &&
        inventory_flags <= (WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT) &&
        declared_flags <= (WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT) &&
        ((declared_flags & WHC_WEAPON_ASSAULT) == 0 ||
         (inventory_flags & WHC_WEAPON_ASSAULT) != 0) &&
        ((declared_flags & WHC_WEAPON_INDIRECT) == 0 ||
         (inventory_flags & WHC_WEAPON_INDIRECT) != 0);
*/
bool whc_weapon_inventory_declaration_is_valid(uint32_t inventory_count,
                                               uint32_t source_models_remaining,
                                               uint32_t used_count, uint32_t declared_count,
                                               uint32_t inventory_flags, uint32_t declared_flags);

/*@ assigns \nothing;
    ensures \result <==>
        inventory_count > 0 && surviving_bearer_count > 0 &&
        surviving_bearer_count <= inventory_count && used_count <= surviving_bearer_count &&
        declared_count > 0 && declared_count <= surviving_bearer_count - used_count &&
        inventory_flags <= (WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT) &&
        declared_flags <= (WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT) &&
        ((declared_flags & WHC_WEAPON_ASSAULT) == 0 ||
         (inventory_flags & WHC_WEAPON_ASSAULT) != 0) &&
        ((declared_flags & WHC_WEAPON_INDIRECT) == 0 ||
         (inventory_flags & WHC_WEAPON_INDIRECT) != 0);
*/
bool whc_weapon_bearer_declaration_is_valid(uint32_t inventory_count,
                                            uint32_t surviving_bearer_count, uint32_t used_count,
                                            uint32_t declared_count, uint32_t inventory_flags,
                                            uint32_t declared_flags);

/*@ assigns \nothing;
    ensures \result <==>
        die_one >= 1 && die_one <= 6 && die_two >= 1 && die_two <= 6 &&
        roll_modifier >= -12 && roll_modifier <= 12 &&
        charge_distance_thousandths <= 24000 &&
        maximum_target_distance_thousandths > 0 &&
        maximum_target_distance_thousandths <= 12000 &&
        maximum_model_move_thousandths <= 24000 && target_count > 0 && target_count <= 12 &&
        flags <= WHC_CHARGE_FLAGS_MASK &&
        (flags & WHC_CHARGE_REVIEWED_BY_PLAYER) != 0 &&
        (flags & WHC_CHARGE_PHASE_START_ELIGIBLE) != 0 &&
        (flags & WHC_CHARGE_STARTED_OUTSIDE_ENGAGEMENT) != 0 &&
        (charge_distance_thousandths ==
             (die_one + die_two + roll_modifier > 0
                  ? (die_one + die_two + roll_modifier) * 1000
                  : 0) ||
         (flags & WHC_CHARGE_ROLL_OVERRIDE_EXPLAINED) != 0) &&
        (successful
             ? maximum_model_move_thousandths > 0 &&
                   maximum_model_move_thousandths <= charge_distance_thousandths &&
                   (flags & WHC_CHARGE_ALL_TARGETS_ENGAGED) != 0 &&
                   (flags & WHC_CHARGE_UNIT_COHERENCY) != 0 &&
                   (flags & WHC_CHARGE_NON_TARGETS_AVOIDED) != 0 &&
                   (flags & WHC_CHARGE_ALL_MODELS_CLOSER) != 0 &&
                   (flags & WHC_CHARGE_BASE_CONTACT_MAXIMIZED) != 0
             : maximum_model_move_thousandths == 0 &&
                   (flags & WHC_CHARGE_FAILURE_EXPLAINED) != 0);
*/
bool whc_charge_resolution_is_valid(uint32_t die_one, uint32_t die_two, int32_t roll_modifier,
                                    uint32_t charge_distance_thousandths,
                                    uint32_t maximum_target_distance_thousandths,
                                    uint32_t maximum_model_move_thousandths, uint32_t target_count,
                                    bool successful, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        stage >= WHC_FIGHT_MOVE_PILE_IN && stage <= WHC_FIGHT_MOVE_CONSOLIDATION &&
        destination <= WHC_FIGHT_DESTINATION_OBJECTIVE &&
        maximum_model_move_thousandths <= 3000 && flags <= WHC_FIGHT_MOVE_FLAGS_MASK &&
        ((destination == WHC_FIGHT_DESTINATION_ENEMY && flags == 63) ||
         (stage == WHC_FIGHT_MOVE_PILE_IN && destination == WHC_FIGHT_DESTINATION_NONE &&
          maximum_model_move_thousandths == 0 && flags == 1121) ||
         (stage == WHC_FIGHT_MOVE_CONSOLIDATION &&
          destination == WHC_FIGHT_DESTINATION_OBJECTIVE && flags == 1507) ||
         (stage == WHC_FIGHT_MOVE_CONSOLIDATION &&
          destination == WHC_FIGHT_DESTINATION_NONE &&
          maximum_model_move_thousandths == 0 && flags == 1633) ||
         (destination == WHC_FIGHT_DESTINATION_NONE &&
          maximum_model_move_thousandths == 0 && flags == 3105));
*/
bool whc_fight_move_is_valid(uint32_t stage, uint32_t destination,
                             uint32_t maximum_model_move_thousandths, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        start_distance_thousandths > 0 && start_distance_thousandths <= 6000 &&
        heroic_flags == WHC_HEROIC_FLAGS_MASK &&
        die_one >= 1 && die_one <= 6 && die_two >= 1 && die_two <= 6 &&
        roll_modifier >= -12 && roll_modifier <= 12 &&
        charge_distance_thousandths <= 24000 &&
        maximum_model_move_thousandths <= 24000 &&
        charge_flags <= WHC_CHARGE_FLAGS_MASK &&
        (charge_flags & WHC_CHARGE_REVIEWED_BY_PLAYER) != 0 &&
        (charge_flags & WHC_CHARGE_PHASE_START_ELIGIBLE) != 0 &&
        (charge_flags & WHC_CHARGE_STARTED_OUTSIDE_ENGAGEMENT) != 0 &&
        (charge_distance_thousandths ==
             (die_one + die_two + roll_modifier > 0
                  ? (die_one + die_two + roll_modifier) * 1000
                  : 0) ||
         (charge_flags & WHC_CHARGE_ROLL_OVERRIDE_EXPLAINED) != 0) &&
        (successful
             ? maximum_model_move_thousandths > 0 &&
                   maximum_model_move_thousandths <= charge_distance_thousandths &&
                   (charge_flags & WHC_CHARGE_ALL_TARGETS_ENGAGED) != 0 &&
                   (charge_flags & WHC_CHARGE_UNIT_COHERENCY) != 0 &&
                   (charge_flags & WHC_CHARGE_NON_TARGETS_AVOIDED) != 0 &&
                   (charge_flags & WHC_CHARGE_ALL_MODELS_CLOSER) != 0 &&
                   (charge_flags & WHC_CHARGE_BASE_CONTACT_MAXIMIZED) != 0
             : maximum_model_move_thousandths == 0 &&
                   (charge_flags & WHC_CHARGE_FAILURE_EXPLAINED) != 0);
*/
bool whc_heroic_intervention_is_valid(uint32_t die_one, uint32_t die_two, int32_t roll_modifier,
                                      uint32_t charge_distance_thousandths,
                                      uint32_t start_distance_thousandths,
                                      uint32_t maximum_model_move_thousandths, bool successful,
                                      uint32_t charge_flags, uint32_t heroic_flags);

/*@ assigns \nothing;
    ensures \result <==>
        trigger >= WHC_FIRE_OVERWATCH_SET_UP &&
        trigger <= WHC_FIRE_OVERWATCH_CHARGE_DECLARED &&
        (phase == WHC_BATTLE_PHASE_MOVEMENT || phase == WHC_BATTLE_PHASE_CHARGE) &&
        distance_thousandths > 0 && distance_thousandths <= 24000 &&
        flags == WHC_FIRE_OVERWATCH_FLAGS_MASK &&
        ((trigger == WHC_FIRE_OVERWATCH_SET_UP) ||
         (trigger == WHC_FIRE_OVERWATCH_CHARGE_DECLARED
              ? phase == WHC_BATTLE_PHASE_CHARGE
              : phase == WHC_BATTLE_PHASE_MOVEMENT));
*/
bool whc_fire_overwatch_is_valid(uint32_t trigger, uint32_t phase, uint32_t distance_thousandths,
                                 uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        initial_roll >= 1 && initial_roll <= 6 &&
        reroll <= 6 && (reroll == 0 || reroll_explained) &&
        (reroll == 0 ? initial_roll == 1 : reroll == 1) &&
        remaining_wounds > 0 && remaining_wounds <= 1024 &&
        (feel_no_pain == 0 || (feel_no_pain >= 2 && feel_no_pain <= 6)) &&
        flags == WHC_HAZARDOUS_FLAGS_MASK &&
        (feel_no_pain == 0
             ? feel_no_pain_roll_count == 0 && ignored_wounds == 0 &&
                   applied_damage == (remaining_wounds < 3 ? remaining_wounds : 3)
             : feel_no_pain_roll_count >= 1 && feel_no_pain_roll_count <= 3 &&
                   ignored_wounds <= feel_no_pain_roll_count &&
                   applied_damage == feel_no_pain_roll_count - ignored_wounds &&
                   (applied_damage == remaining_wounds ||
                    (applied_damage < remaining_wounds && feel_no_pain_roll_count == 3))) &&
        (model_destroyed ? applied_damage == remaining_wounds
                         : applied_damage < remaining_wounds);
*/
bool whc_hazardous_resolution_is_valid(uint32_t initial_roll, uint32_t reroll,
                                       bool reroll_explained, uint32_t remaining_wounds,
                                       uint32_t feel_no_pain, uint32_t feel_no_pain_roll_count,
                                       uint32_t ignored_wounds, uint32_t applied_damage,
                                       bool model_destroyed, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        phase == WHC_BATTLE_PHASE_SHOOTING &&
        command_points_before >= 1 && command_points_before <= 100000 &&
        command_point_cost == 1 &&
        command_points_after == command_points_before - command_point_cost &&
        !already_used && !target_battle_shocked &&
        flags == WHC_GO_TO_GROUND_FLAGS_MASK;
*/
bool whc_go_to_ground_is_valid(uint32_t phase, uint32_t command_points_before,
                               uint32_t command_point_cost, uint32_t command_points_after,
                               bool already_used, bool target_battle_shocked, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        phase == WHC_BATTLE_PHASE_FIGHT && command_points_before >= 2 &&
        command_points_before <= 100000 && command_point_cost == 2 &&
        command_points_after == command_points_before - command_point_cost &&
        !already_used && !target_battle_shocked &&
        flags == WHC_COUNTER_OFFENSIVE_FLAGS_MASK;
*/
bool whc_counter_offensive_is_valid(uint32_t phase, uint32_t command_points_before,
                                    uint32_t command_point_cost, uint32_t command_points_after,
                                    bool already_used, bool target_battle_shocked, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        phase == WHC_BATTLE_PHASE_SHOOTING && command_points_before >= 1 &&
        command_points_before <= 100000 && command_point_cost == 1 &&
        command_points_after == command_points_before - command_point_cost &&
        !already_used && !target_battle_shocked &&
        flags == WHC_SMOKESCREEN_FLAGS_MASK;
*/
bool whc_smokescreen_is_valid(uint32_t phase, uint32_t command_points_before,
                              uint32_t command_point_cost, uint32_t command_points_after,
                              bool already_used, bool target_battle_shocked, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        phase == WHC_BATTLE_PHASE_MOVEMENT && step == WHC_MOVEMENT_STEP_END &&
        battle_round >= 1 && battle_round <= 5 &&
        earliest_battle_round >= 1 && earliest_battle_round <= 5 &&
        battle_round >= earliest_battle_round &&
        (battle_round != 1 || first_round_out_of_phase_allowed) &&
        command_points_before >= 1 && command_points_before <= 100000 &&
        command_point_cost == 1 &&
        command_points_after == command_points_before - command_point_cost &&
        !already_used && !target_battle_shocked &&
        flags == WHC_RAPID_INGRESS_FLAGS_MASK;
*/
bool whc_rapid_ingress_is_valid(uint32_t phase, uint32_t step, uint32_t battle_round,
                                uint32_t earliest_battle_round, uint32_t command_points_before,
                                uint32_t command_point_cost, uint32_t command_points_after,
                                bool already_used, bool target_battle_shocked,
                                bool first_round_out_of_phase_allowed, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        source_locked &&
        (status == WHC_RULE_COVERAGE_EXECUTABLE ||
         status == WHC_RULE_COVERAGE_IRRELEVANT ||
         (status == WHC_RULE_COVERAGE_GUIDED && acknowledged));
*/
bool whc_rule_coverage_is_permitted(uint32_t status, bool source_locked, bool acknowledged);

/*@ assigns \nothing;
    ensures \result <==>
        declaration_count >= 1 && declaration_count <= 256 &&
        unique_declaration_count == declaration_count &&
        target_run_count == unique_target_count &&
        unique_target_count >= 1 && unique_target_count <= declaration_count &&
        profile_run_count == unique_target_profile_count &&
        unique_target_profile_count >= unique_target_count &&
        unique_target_profile_count <= declaration_count &&
        flags == WHC_RANGED_DECLARATION_FLAGS_MASK;
*/
bool whc_ranged_declaration_is_valid(uint32_t declaration_count, uint32_t unique_declaration_count,
                                     uint32_t target_run_count, uint32_t unique_target_count,
                                     uint32_t profile_run_count,
                                     uint32_t unique_target_profile_count, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        capacity > 0 && used_capacity <= capacity &&
        mode_count <= 1 &&
        ((allowance_maximum == 0 && allowance_models == 0) ||
         (allowance_maximum > 0 && allowance_models <= allowance_maximum));
*/
bool whc_transport_load_is_valid(uint32_t used_capacity, uint32_t capacity,
                                 uint32_t allowance_models, uint32_t allowance_maximum,
                                 uint32_t mode_count);

/*@ assigns \nothing;
    ensures \result <==>
        chain_length >= 1 && chain_length <= 257 &&
        unique_formation_count == chain_length &&
        root_location <= WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES &&
        reserve_eligibility_count <= chain_length &&
        ((root_location == WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED &&
          reserve_eligibility_count == 0) ||
         root_location == WHC_DEPLOYMENT_ROOT_BATTLEFIELD ||
         reserve_eligibility_count == chain_length);
*/
bool whc_transport_deployment_chain_is_valid(uint32_t chain_length, uint32_t unique_formation_count,
                                             uint32_t root_location,
                                             uint32_t reserve_eligibility_count);

/*@ assigns \nothing;
    ensures \result <==>
        is_dedicated_transport <= 1 && is_aircraft <= 1 && has_hover <= 1 &&
        aircraft_mode <= WHC_AIRCRAFT_MODE_HOVER &&
        root_location <= WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES &&
        ((!is_aircraft && aircraft_mode == WHC_AIRCRAFT_MODE_NONE) ||
         (is_aircraft &&
          (aircraft_mode == WHC_AIRCRAFT_MODE_AIRCRAFT ||
           (aircraft_mode == WHC_AIRCRAFT_MODE_HOVER && has_hover)))) &&
        ((is_dedicated_transport && starting_passenger_count == 0 &&
          root_location == WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED) ||
         ((!is_dedicated_transport || starting_passenger_count > 0) &&
          root_location != WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED &&
          (!is_aircraft ||
           (aircraft_mode == WHC_AIRCRAFT_MODE_AIRCRAFT &&
            root_location == WHC_DEPLOYMENT_ROOT_RESERVES) ||
           (aircraft_mode == WHC_AIRCRAFT_MODE_HOVER &&
            (root_location == WHC_DEPLOYMENT_ROOT_BATTLEFIELD ||
             root_location == WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES)))));
*/
bool whc_initial_deployment_is_valid(uint32_t is_dedicated_transport,
                                     uint32_t starting_passenger_count, uint32_t is_aircraft,
                                     uint32_t has_hover, uint32_t aircraft_mode,
                                     uint32_t root_location);

/*@ assigns \nothing;
    ensures \result <==>
        battlefield_width_thousandths == WHC_TABLE_WIDTH_THOUSANDTHS &&
        battlefield_height_thousandths == WHC_TABLE_HEIGHT_THOUSANDTHS &&
        objective_count >= 1 && objective_count <= 12 &&
        positioned_objective_count == objective_count &&
        terrain_section_count == WHC_TERRAIN_SECTION_COUNT &&
        six_by_four_count == WHC_TERRAIN_SIX_BY_FOUR_COUNT &&
        ten_by_five_count == WHC_TERRAIN_TEN_BY_FIVE_COUNT &&
        twelve_by_six_count == WHC_TERRAIN_TWELVE_BY_SIX_COUNT &&
        six_by_four_count + ten_by_five_count + twelve_by_six_count == terrain_section_count &&
        flags == WHC_TABLE_GEOMETRY_FLAGS_MASK;
*/
bool whc_table_geometry_is_valid(uint32_t battlefield_width_thousandths,
                                 uint32_t battlefield_height_thousandths, uint32_t objective_count,
                                 uint32_t positioned_objective_count,
                                 uint32_t terrain_section_count, uint32_t six_by_four_count,
                                 uint32_t ten_by_five_count, uint32_t twelve_by_six_count,
                                 uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        footprint_count == WHC_TERRAIN_OUTLINE_COUNT &&
        positioned_footprint_count == footprint_count &&
        unique_footprint_count == footprint_count &&
        in_bounds_footprint_count == footprint_count &&
        grouped_footprint_count == footprint_count &&
        overlap_pair_count == 0 &&
        six_by_four_count == WHC_TERRAIN_SIX_BY_FOUR_COUNT &&
        ten_by_five_count == WHC_TERRAIN_TEN_BY_FIVE_COUNT &&
        twelve_by_six_count == WHC_TERRAIN_TWELVE_BY_SIX_COUNT &&
        six_by_four_count + ten_by_five_count + twelve_by_six_count == footprint_count &&
        flags == WHC_TERRAIN_FOOTPRINT_FLAGS_MASK;
*/
bool whc_terrain_footprint_set_is_valid(
    uint32_t footprint_count, uint32_t positioned_footprint_count, uint32_t unique_footprint_count,
    uint32_t in_bounds_footprint_count, uint32_t grouped_footprint_count,
    uint32_t overlap_pair_count, uint32_t six_by_four_count, uint32_t ten_by_five_count,
    uint32_t twelve_by_six_count, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        expected_model_count > 0 && expected_model_count <= 1000 &&
        placement_count == expected_model_count &&
        unique_model_count == placement_count &&
        recognized_model_count == placement_count &&
        positioned_model_count == placement_count &&
        in_bounds_model_count == placement_count &&
        dimensioned_model_count == placement_count &&
        supported_shape_count == placement_count &&
        based_model_count <= placement_count &&
        baseless_model_count == placement_count - based_model_count &&
        flags == WHC_MODEL_PLACEMENT_FLAGS_MASK;
*/
bool whc_model_placement_set_is_valid(uint32_t expected_model_count, uint32_t placement_count,
                                      uint32_t unique_model_count, uint32_t recognized_model_count,
                                      uint32_t positioned_model_count,
                                      uint32_t in_bounds_model_count,
                                      uint32_t dimensioned_model_count,
                                      uint32_t supported_shape_count, uint32_t based_model_count,
                                      uint32_t baseless_model_count, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        live_model_count > 0 && live_model_count <= 1000 &&
        position_count == live_model_count &&
        unique_model_count == position_count &&
        recognized_model_count == position_count &&
        positioned_model_count == position_count &&
        in_bounds_model_count == position_count &&
        dimensioned_model_count == position_count &&
        supported_shape_count == position_count &&
        based_model_count <= position_count &&
        baseless_model_count == position_count - based_model_count &&
        matched_segment_count == segment_count &&
        path_model_count == position_count &&
        path_start_count == position_count &&
        path_endpoint_count == position_count &&
        path_in_bounds_count == position_count &&
        footprint_match_count == position_count &&
        distance_within_limit_count == position_count &&
        distance_covers_path_count == position_count &&
        flags == WHC_MODEL_POSITION_FLAGS_MASK;
*/
bool whc_model_position_set_is_valid(
    uint32_t live_model_count, uint32_t position_count, uint32_t unique_model_count,
    uint32_t recognized_model_count, uint32_t positioned_model_count,
    uint32_t in_bounds_model_count, uint32_t dimensioned_model_count,
    uint32_t supported_shape_count, uint32_t based_model_count, uint32_t baseless_model_count,
    uint32_t segment_count, uint32_t matched_segment_count, uint32_t path_model_count,
    uint32_t path_start_count, uint32_t path_endpoint_count, uint32_t path_in_bounds_count,
    uint32_t footprint_match_count, uint32_t distance_within_limit_count,
    uint32_t distance_covers_path_count, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        model_count > 0 && model_count <= 1000 &&
        ready_model_count == model_count &&
        required_neighbour_count ==
            (model_count <= 1 ? 0 : (model_count <= 6 ? 1 : 2)) &&
        coherent_model_count <= model_count &&
        enemy_model_pair_count <= 1000000 &&
        objective_count <= 12 && objective_in_range_count <= objective_count &&
        flags == WHC_SPATIAL_FACTS_FLAGS_MASK;
*/
bool whc_spatial_facts_are_valid(uint32_t model_count, uint32_t ready_model_count,
                                 uint32_t required_neighbour_count, uint32_t coherent_model_count,
                                 uint32_t enemy_model_pair_count, uint32_t objective_count,
                                 uint32_t objective_in_range_count, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        model_count <= 1000 && ready_model_count <= model_count &&
        objective_count <= 12 && ready_objective_count <= objective_count &&
        model_overlap_pair_count <=
            (ready_model_count == 0 ? 0 : ready_model_count * (ready_model_count - 1) / 2) &&
        objective_overlap_pair_count <= ready_model_count * ready_objective_count &&
        flags == (ready_model_count == model_count ? 1 : 0) +
                 (ready_objective_count == objective_count ? 2 : 0);
*/
bool whc_endpoint_clearance_facts_are_valid(uint32_t model_count, uint32_t ready_model_count,
                                            uint32_t objective_count,
                                            uint32_t ready_objective_count,
                                            uint32_t model_overlap_pair_count,
                                            uint32_t objective_overlap_pair_count, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        model_count > 0 && model_count <= 1000 && ready_model_count <= model_count &&
        section_count > 0 && section_count <= 24 &&
        ready_section_count <= section_count && supported_section_count <= section_count &&
        path_segment_count >= model_count && path_segment_count <= 64000 &&
        checked_path_segment_count <= path_segment_count && collision_count <= 1000000 &&
        flags == (ready_model_count == model_count ? 1 : 0) +
                 (ready_section_count == section_count ? 2 : 0) +
                 (supported_section_count == section_count ? 4 : 0) &&
        (flags != WHC_TERRAIN_CLEARANCE_FLAGS_MASK ||
         checked_path_segment_count == path_segment_count);
*/
bool whc_terrain_clearance_facts_are_valid(uint32_t model_count, uint32_t ready_model_count,
                                           uint32_t section_count, uint32_t ready_section_count,
                                           uint32_t supported_section_count,
                                           uint32_t path_segment_count,
                                           uint32_t checked_path_segment_count,
                                           uint32_t collision_count, uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        mode <= WHC_MISSION_SECONDARY_TACTICAL && configured <= 1 &&
        fixed_card_count <= 2 && deck_size <= 64 && drawn_count <= deck_size &&
        discarded_count <= drawn_count && active_count <= 2 &&
        primary_points <= 50 && secondary_points <= 40 &&
        fixed_card_high_score <= 20 && battle_ready_points <= 10 &&
        total_points <= 100 &&
        primary_points + secondary_points + battle_ready_points == total_points &&
        active_action_count <= 1000 && valid_action_count == active_action_count &&
        (flags & ~WHC_MISSION_TRACKER_FLAGS_MASK) == 0 &&
        ((configured == 0 && mode == WHC_MISSION_SECONDARY_NONE &&
          fixed_card_count == 0 && deck_size == 0 && drawn_count == 0 &&
          discarded_count == 0 && active_count == 0 && flags == 0) ||
         (configured == 1 && flags == WHC_MISSION_TRACKER_FLAGS_MASK &&
          ((mode == WHC_MISSION_SECONDARY_FIXED && fixed_card_count == 2 &&
            deck_size == 0 && drawn_count == 0) ||
           (mode == WHC_MISSION_SECONDARY_TACTICAL && fixed_card_count == 0 &&
            deck_size > 0 && fixed_card_high_score == 0))));
*/
bool whc_mission_tracker_facts_are_valid(uint32_t mode, uint32_t configured,
                                         uint32_t fixed_card_count, uint32_t deck_size,
                                         uint32_t drawn_count, uint32_t discarded_count,
                                         uint32_t active_count, uint32_t primary_points,
                                         uint32_t secondary_points, uint32_t fixed_card_high_score,
                                         uint32_t battle_ready_points, uint32_t total_points,
                                         uint32_t active_action_count, uint32_t valid_action_count,
                                         uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        call_count <= 1 && active <= 1 && source_faction_orks <= 1 &&
        called_at_command_start <= 1 && formation_has_ability <= 1 &&
        advanced_charge_allowed <= 1 &&
        (call_count == 0 || (source_faction_orks == 1 && called_at_command_start == 1)) &&
        (active == 0 || call_count == 1) &&
        advanced_charge_allowed ==
            (active == 1 && formation_has_ability == 1 ? 1 : 0) &&
        melee_attacks_modifier ==
            (active == 1 && formation_has_ability == 1 ? 1 : 0) &&
        melee_strength_modifier ==
            (active == 1 && formation_has_ability == 1 ? 1 : 0) &&
        granted_invulnerable_save ==
            (active == 1 && formation_has_ability == 1 ? 5 : 0);
*/
bool whc_waaagh_state_is_valid(uint32_t call_count, uint32_t active,
                               uint32_t source_faction_orks,
                               uint32_t called_at_command_start,
                               uint32_t formation_has_ability,
                               uint32_t advanced_charge_allowed,
                               uint32_t melee_attacks_modifier,
                               uint32_t melee_strength_modifier,
                               uint32_t granted_invulnerable_save);

/*@ assigns \nothing;
    ensures \result <==>
        source_detachment <= 1 && eligible_adeptus_astartes <= 1 && selected <= 1 &&
        battle_shocked <= 1 && base_objective_control <= 1000000 &&
        resolved_objective_control <= 1000001 &&
        (selected == 0 ||
            (source_detachment == 1 && eligible_adeptus_astartes == 1)) &&
        resolved_objective_control ==
            (battle_shocked == 1
                ? (source_detachment == 1 && eligible_adeptus_astartes == 1 ? 1 : 0)
                : base_objective_control) +
            (source_detachment == 1 && eligible_adeptus_astartes == 1 && selected == 1
                ? 1 : 0);
*/
bool whc_grim_resolve_model_objective_control_is_valid(
    uint32_t source_detachment, uint32_t eligible_adeptus_astartes, uint32_t selected,
    uint32_t battle_shocked, uint32_t base_objective_control,
    uint32_t resolved_objective_control);

/*@ assigns \nothing;
    ensures \result <==>
        source_faction_adeptus_astartes <= 1 && active_target <= 1 &&
        selected_at_command_start <= 1 && target_is_opponent <= 1 &&
        attacker_has_ability <= 1 && hit_reroll <= 1 &&
        (active_target == 0 || source_faction_adeptus_astartes == 1) &&
        selected_at_command_start == active_target &&
        target_is_opponent == active_target &&
        hit_reroll == (active_target == 1 && attacker_has_ability == 1 ? 1 : 0);
*/
bool whc_oath_of_moment_attack_state_is_valid(
    uint32_t source_faction_adeptus_astartes, uint32_t active_target,
    uint32_t selected_at_command_start, uint32_t target_is_opponent,
    uint32_t attacker_has_ability, uint32_t hit_reroll);

/*@ assigns \nothing;
    ensures \result <==>
        player_count == 2 && score_entry_count == player_count &&
        top_score <= 1000000 && top_score_player_count <= player_count &&
        controller_count <= 1 && contested <= 1 &&
        flags == WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK &&
        ((top_score_player_count == 1 &&
          controller_count == 1 && contested == 0) ||
         (top_score_player_count >= 2 &&
          controller_count == 0 && contested == 1));
*/
bool whc_objective_control_facts_are_valid(uint32_t player_count, uint32_t score_entry_count,
                                           uint32_t top_score, uint32_t top_score_player_count,
                                           uint32_t controller_count, uint32_t contested,
                                           uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        model_pair_count > 0 && model_pair_count <= 1000000 &&
        ready_model_pair_count == model_pair_count &&
        visible_model_pair_count <= model_pair_count &&
        fully_visible_model_pair_count <= model_pair_count &&
        not_fully_visible_model_pair_count <= model_pair_count &&
        unknown_model_pair_count <= model_pair_count &&
        fully_visible_model_pair_count + not_fully_visible_model_pair_count +
            unknown_model_pair_count == model_pair_count &&
        target_model_count > 0 && target_model_count <= 1000 &&
        cover_yes_count <= target_model_count && cover_no_count <= target_model_count &&
        cover_unknown_count <= target_model_count &&
        cover_yes_count + cover_no_count + cover_unknown_count == target_model_count &&
        flags == WHC_VISIBILITY_FACTS_FLAGS_MASK;
*/
bool whc_visibility_facts_are_valid(uint32_t model_pair_count, uint32_t ready_model_pair_count,
                                    uint32_t visible_model_pair_count,
                                    uint32_t fully_visible_model_pair_count,
                                    uint32_t not_fully_visible_model_pair_count,
                                    uint32_t unknown_model_pair_count, uint32_t target_model_count,
                                    uint32_t cover_yes_count, uint32_t cover_no_count,
                                    uint32_t cover_unknown_count, uint32_t flags);

/*@ requires vertices == \null || vertex_count < WHC_CONVEX_SILHOUETTE_MIN_VERTICES ||
             vertex_count > WHC_CONVEX_SILHOUETTE_MAX_VERTICES ||
             \valid_read(vertices + (0 .. vertex_count * 2 - 1));
    assigns \nothing;
    ensures \result ==> vertices != \null;
    ensures \result ==> WHC_CONVEX_SILHOUETTE_MIN_VERTICES <= vertex_count <=
                         WHC_CONVEX_SILHOUETTE_MAX_VERTICES;
    ensures \result ==> flags == WHC_CONVEX_SILHOUETTE_REVIEWED;
    ensures \result ==> \forall integer index; 0 <= index < vertex_count * 2 ==>
                -WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT <= vertices[index] <=
                 WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT;
    ensures \result ==> \forall integer edge, point;
                0 <= edge < vertex_count && 0 <= point < vertex_count &&
                point != edge && point != (edge + 1 == vertex_count ? 0 : edge + 1) ==>
                (vertices[(edge + 1 == vertex_count ? 0 : edge + 1) * 2] -
                 vertices[edge * 2]) *
                    (vertices[point * 2 + 1] - vertices[edge * 2 + 1]) -
                (vertices[(edge + 1 == vertex_count ? 0 : edge + 1) * 2 + 1] -
                 vertices[edge * 2 + 1]) *
                    (vertices[point * 2] - vertices[edge * 2]) > 0;
*/
bool whc_convex_silhouette_is_valid(const int32_t *vertices, uint32_t vertex_count, uint32_t flags);

/*@ requires vertices == \null || vertex_count < WHC_SIMPLE_TERRAIN_SURFACE_MIN_VERTICES ||
             vertex_count > WHC_SIMPLE_TERRAIN_SURFACE_MAX_VERTICES ||
             \valid_read(vertices + (0 .. vertex_count * 2 - 1));
    assigns \nothing;
    ensures \result ==> vertices != \null;
    ensures \result ==> WHC_SIMPLE_TERRAIN_SURFACE_MIN_VERTICES <= vertex_count <=
                         WHC_SIMPLE_TERRAIN_SURFACE_MAX_VERTICES;
    ensures \result ==> flags == WHC_SIMPLE_TERRAIN_SURFACE_REVIEWED;
    ensures \result ==> \forall integer index; 0 <= index < vertex_count ==>
                0 <= vertices[index * 2] <= WHC_SIMPLE_TERRAIN_SURFACE_MAX_X &&
                0 <= vertices[index * 2 + 1] <= WHC_SIMPLE_TERRAIN_SURFACE_MAX_Y;
*/
bool whc_simple_terrain_surface_is_valid(const int32_t *vertices, uint32_t vertex_count,
                                         uint32_t flags);

/*@ assigns \nothing;
    ensures \result <==>
        observer_count > 0 && observer_count <= 1000 &&
        proven_observer_count <= observer_count &&
        target_model_count > 0 && target_model_count <= 1000 &&
        cover_proven_count <= target_model_count &&
        cover_override_count == target_model_count - cover_proven_count &&
        (flags & ~WHC_RANGED_GEOMETRY_FLAGS_MASK) == 0 &&
        (flags & WHC_RANGED_GEOMETRY_REVIEWED_BY_PLAYER) != 0 &&
        (((flags & WHC_RANGED_GEOMETRY_VISIBILITY_MASK) == 9 &&
          proven_observer_count == observer_count) ||
         ((flags & WHC_RANGED_GEOMETRY_VISIBILITY_MASK) == 17 &&
          proven_observer_count < observer_count) ||
         ((flags & WHC_RANGED_GEOMETRY_INDIRECT_MASK) == 6 &&
          proven_observer_count < observer_count)) &&
        ((flags & WHC_RANGED_GEOMETRY_FULL_VISIBILITY_MASK) == 0 ||
         ((flags & WHC_RANGED_GEOMETRY_DIRECT_VISIBLE) != 0 &&
          ((flags & WHC_RANGED_GEOMETRY_FULL_VISIBILITY_MASK) == 96 ||
           (flags & WHC_RANGED_GEOMETRY_FULL_VISIBILITY_MASK) == 160)));
*/
bool whc_ranged_geometry_resolution_is_valid(uint32_t observer_count,
                                             uint32_t proven_observer_count,
                                             uint32_t target_model_count,
                                             uint32_t cover_proven_count,
                                             uint32_t cover_override_count, uint32_t flags);

/*@ requires first_player_index <= 1;
    requires \valid(clock + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1));
    assigns clock[0 .. WHC_BATTLE_CLOCK_FIELDS - 1];
    ensures \result;
    ensures clock[0] == WHC_BATTLE_CLOCK_ACTIVE;
    ensures clock[1] == 1 && clock[2] == 1;
    ensures clock[3] == WHC_BATTLE_PHASE_COMMAND && clock[4] == 0;
    ensures clock[5] == first_player_index && clock[6] == first_player_index &&
            clock[7] == first_player_index;
*/
bool whc_start_battle_clock(uint32_t first_player_index, uint32_t *clock);

/*@ requires \valid_read(current + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1));
    requires \valid(next + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1));
    requires \separated(current + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1),
                        next + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1));
    assigns next[0 .. WHC_BATTLE_CLOCK_FIELDS - 1];
    ensures !\result ==> \forall integer index; 0 <= index < WHC_BATTLE_CLOCK_FIELDS ==>
                next[index] == \old(next[index]);
    ensures \result ==> next[0] == WHC_BATTLE_CLOCK_ACTIVE ||
                         next[0] == WHC_BATTLE_CLOCK_COMPLETE;
    ensures \result ==> 1 <= next[1] && next[1] <= 5;
    ensures \result ==> 1 <= next[2] && next[2] <= 2;
    ensures \result ==> next[5] <= 1;
    ensures \result ==> next[0] == WHC_BATTLE_CLOCK_COMPLETE || next[7] <= 1;
*/
bool whc_next_battle_clock(const uint32_t *current, uint32_t *next);

#endif
