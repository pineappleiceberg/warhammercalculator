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
#define WHC_FIGHT_MOVE_FLAGS_MASK 2047u
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
          maximum_model_move_thousandths == 0 && flags == 1633));
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
bool whc_fire_overwatch_is_valid(uint32_t trigger, uint32_t phase,
                                 uint32_t distance_thousandths, uint32_t flags);

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
        declaration_count >= 1 && declaration_count <= 256 &&
        unique_declaration_count == declaration_count &&
        target_run_count == unique_target_count &&
        unique_target_count >= 1 && unique_target_count <= declaration_count &&
        profile_run_count == unique_target_profile_count &&
        unique_target_profile_count >= unique_target_count &&
        unique_target_profile_count <= declaration_count &&
        flags == WHC_RANGED_DECLARATION_FLAGS_MASK;
*/
bool whc_ranged_declaration_is_valid(uint32_t declaration_count,
                                     uint32_t unique_declaration_count,
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
bool whc_transport_deployment_chain_is_valid(uint32_t chain_length,
                                             uint32_t unique_formation_count,
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
                                     uint32_t starting_passenger_count,
                                     uint32_t is_aircraft, uint32_t has_hover,
                                     uint32_t aircraft_mode, uint32_t root_location);

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
