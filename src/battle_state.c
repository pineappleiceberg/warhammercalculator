#include "warhammercalculator/battle_state.h"

#include <stddef.h>
#include <string.h>

_Static_assert(WHC_BATTLE_EVENT_FIELDS == 166u, "Battle event ABI changed");
_Static_assert(WHC_BATTLE_CLOCK_FIELDS == 8u, "Battle clock ABI changed");

/*@ assigns \nothing;
    ensures \result <= 4;
*/
static uint32_t whc_battle_phase_step_count(uint32_t phase) {
    if (phase == WHC_BATTLE_PHASE_COMMAND || phase == WHC_BATTLE_PHASE_SHOOTING ||
        phase == WHC_BATTLE_PHASE_CHARGE) {
        return 3u;
    }
    if (phase == WHC_BATTLE_PHASE_MOVEMENT || phase == WHC_BATTLE_PHASE_FIGHT) {
        return 4u;
    }
    return 0u;
}

/*@ requires \valid_read(clock + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1));
    assigns \nothing;
    ensures \result ==> clock[0] == WHC_BATTLE_CLOCK_ACTIVE;
    ensures \result ==> 1 <= clock[1] && clock[1] <= 5;
    ensures \result ==> 1 <= clock[2] && clock[2] <= 2;
    ensures \result ==> WHC_BATTLE_PHASE_COMMAND <= clock[3] &&
                         clock[3] <= WHC_BATTLE_PHASE_FIGHT;
    ensures \result ==> clock[4] < 4;
    ensures \result ==> clock[5] <= 1;
    ensures \result ==> clock[6] <= 1 && clock[7] <= 1;
*/
static bool whc_battle_clock_is_active_valid(const uint32_t *clock) {
    uint32_t steps;
    uint32_t expected_active;

    if (clock == NULL || clock[0] != WHC_BATTLE_CLOCK_ACTIVE || clock[1] < 1u || clock[1] > 5u ||
        clock[2] < 1u || clock[2] > 2u || clock[3] < WHC_BATTLE_PHASE_COMMAND ||
        clock[3] > WHC_BATTLE_PHASE_FIGHT || clock[5] > 1u) {
        return false;
    }
    steps = whc_battle_phase_step_count(clock[3]);
    expected_active = clock[2] == 1u ? clock[5] : 1u - clock[5];
    return steps > 0u && clock[4] < steps && clock[6] == expected_active && clock[7] <= 1u;
}

bool whc_start_battle_clock(uint32_t first_player_index, uint32_t *clock) {
    if (clock == NULL || first_player_index > 1u) {
        return false;
    }
    clock[0] = WHC_BATTLE_CLOCK_ACTIVE;
    clock[1] = 1u;
    clock[2] = 1u;
    clock[3] = WHC_BATTLE_PHASE_COMMAND;
    clock[4] = 0u;
    clock[5] = first_player_index;
    clock[6] = first_player_index;
    clock[7] = first_player_index;
    return true;
}

bool whc_next_battle_clock(const uint32_t *current, uint32_t *next) {
    uint32_t candidate[WHC_BATTLE_CLOCK_FIELDS];
    uint32_t steps;

    if (current == NULL || next == NULL || !whc_battle_clock_is_active_valid(current)) {
        return false;
    }
    candidate[0] = current[0];
    candidate[1] = current[1];
    candidate[2] = current[2];
    candidate[3] = current[3];
    candidate[4] = current[4];
    candidate[5] = current[5];
    candidate[6] = current[6];
    candidate[7] = current[7];
    steps = whc_battle_phase_step_count(candidate[3]);
    if (candidate[4] + 1u < steps) {
        candidate[4]++;
        if (candidate[3] == WHC_BATTLE_PHASE_FIGHT && (candidate[4] == 1u || candidate[4] == 2u)) {
            candidate[7] = 1u - candidate[6];
        }
    } else if (candidate[3] < WHC_BATTLE_PHASE_FIGHT) {
        candidate[3]++;
        candidate[4] = 0u;
        candidate[7] = candidate[3] == WHC_BATTLE_PHASE_FIGHT ? 1u - candidate[6] : candidate[6];
    } else if (candidate[2] == 1u) {
        candidate[2] = 2u;
        candidate[3] = WHC_BATTLE_PHASE_COMMAND;
        candidate[4] = 0u;
        candidate[6] = 1u - candidate[5];
        candidate[7] = candidate[6];
    } else if (candidate[1] < 5u) {
        candidate[1]++;
        candidate[2] = 1u;
        candidate[3] = WHC_BATTLE_PHASE_COMMAND;
        candidate[4] = 0u;
        candidate[6] = candidate[5];
        candidate[7] = candidate[5];
    } else {
        candidate[0] = WHC_BATTLE_CLOCK_COMPLETE;
        candidate[3] = WHC_BATTLE_PHASE_COMPLETE;
        candidate[4] = 0u;
        candidate[6] = WHC_BATTLE_PLAYER_NONE;
        candidate[7] = WHC_BATTLE_PLAYER_NONE;
    }
    next[0] = candidate[0];
    next[1] = candidate[1];
    next[2] = candidate[2];
    next[3] = candidate[3];
    next[4] = candidate[4];
    next[5] = candidate[5];
    next[6] = candidate[6];
    next[7] = candidate[7];
    return true;
}

/*@ assigns \nothing;
    ensures \result <==> wounds > 0 && starting_models > 0 &&
                            models_remaining <= starting_models && wounds_lost < wounds &&
                            (models_remaining > 0 || wounds_lost == 0);
*/
static bool whc_battle_health_is_valid(uint32_t wounds, uint32_t starting_models,
                                       uint32_t models_remaining, uint32_t wounds_lost) {
    return wounds > 0u && starting_models > 0u && models_remaining <= starting_models &&
           wounds_lost < wounds && (models_remaining > 0u || wounds_lost == 0u);
}

bool whc_ranged_target_eligibility_is_valid(uint32_t published_range_thousandths,
                                            uint32_t effective_range_thousandths,
                                            uint32_t measured_distance_thousandths,
                                            uint32_t eligible_weapon_count,
                                            uint32_t declared_weapon_count, uint32_t flags) {
    const bool visible = (flags & WHC_TARGET_VISIBLE) != 0u;
    const bool fully_visible = (flags & WHC_TARGET_FULLY_VISIBLE) != 0u;
    const bool indirect_fire = (flags & WHC_TARGET_INDIRECT_FIRE) != 0u;
    const bool weapon_has_indirect = (flags & WHC_TARGET_WEAPON_HAS_INDIRECT) != 0u;
    const bool reviewed_by_player = (flags & WHC_TARGET_REVIEWED_BY_PLAYER) != 0u;
    const bool range_override_explained = (flags & WHC_TARGET_RANGE_OVERRIDE_EXPLAINED) != 0u;

    return published_range_thousandths > 0u && effective_range_thousandths > 0u &&
           measured_distance_thousandths > 0u &&
           measured_distance_thousandths <= effective_range_thousandths &&
           declared_weapon_count > 0u && declared_weapon_count <= eligible_weapon_count &&
           reviewed_by_player && (!fully_visible || visible) &&
           ((visible && !indirect_fire) || (!visible && indirect_fire && weapon_has_indirect)) &&
           (published_range_thousandths == effective_range_thousandths || range_override_explained);
}

bool whc_weapon_inventory_declaration_is_valid(uint32_t inventory_count,
                                               uint32_t source_models_remaining,
                                               uint32_t used_count, uint32_t declared_count,
                                               uint32_t inventory_flags, uint32_t declared_flags) {
    return inventory_count > 0u && source_models_remaining > 0u && declared_count > 0u &&
           used_count <= inventory_count && declared_count <= inventory_count - used_count &&
           inventory_flags <= (WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT) &&
           declared_flags <= (WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT) &&
           ((declared_flags & WHC_WEAPON_ASSAULT) == 0u ||
            (inventory_flags & WHC_WEAPON_ASSAULT) != 0u) &&
           ((declared_flags & WHC_WEAPON_INDIRECT) == 0u ||
            (inventory_flags & WHC_WEAPON_INDIRECT) != 0u);
}

bool whc_weapon_bearer_declaration_is_valid(uint32_t inventory_count,
                                            uint32_t surviving_bearer_count, uint32_t used_count,
                                            uint32_t declared_count, uint32_t inventory_flags,
                                            uint32_t declared_flags) {
    return inventory_count > 0u && surviving_bearer_count > 0u &&
           surviving_bearer_count <= inventory_count && used_count <= surviving_bearer_count &&
           declared_count > 0u && declared_count <= surviving_bearer_count - used_count &&
           inventory_flags <= (WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT) &&
           declared_flags <= (WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT) &&
           ((declared_flags & WHC_WEAPON_ASSAULT) == 0u ||
            (inventory_flags & WHC_WEAPON_ASSAULT) != 0u) &&
           ((declared_flags & WHC_WEAPON_INDIRECT) == 0u ||
            (inventory_flags & WHC_WEAPON_INDIRECT) != 0u);
}

bool whc_charge_resolution_is_valid(uint32_t die_one, uint32_t die_two, int32_t roll_modifier,
                                    uint32_t charge_distance_thousandths,
                                    uint32_t maximum_target_distance_thousandths,
                                    uint32_t maximum_model_move_thousandths, uint32_t target_count,
                                    bool successful, uint32_t flags) {
    if (die_one < 1u || die_one > 6u || die_two < 1u || die_two > 6u || roll_modifier < -12 ||
        roll_modifier > 12) {
        return false;
    }
    const int32_t modified_roll = (int32_t)(die_one + die_two) + roll_modifier;
    const uint32_t canonical_distance = modified_roll > 0 ? (uint32_t)modified_roll * 1000u : 0u;
    const bool common =
        charge_distance_thousandths <= 24000u && maximum_target_distance_thousandths > 0u &&
        maximum_target_distance_thousandths <= 12000u && maximum_model_move_thousandths <= 24000u &&
        target_count > 0u && target_count <= 12u && flags <= WHC_CHARGE_FLAGS_MASK &&
        (flags & WHC_CHARGE_REVIEWED_BY_PLAYER) != 0u &&
        (flags & WHC_CHARGE_PHASE_START_ELIGIBLE) != 0u &&
        (flags & WHC_CHARGE_STARTED_OUTSIDE_ENGAGEMENT) != 0u &&
        (charge_distance_thousandths == canonical_distance ||
         (flags & WHC_CHARGE_ROLL_OVERRIDE_EXPLAINED) != 0u);
    if (!common)
        return false;
    if (!successful) {
        return maximum_model_move_thousandths == 0u && (flags & WHC_CHARGE_FAILURE_EXPLAINED) != 0u;
    }
    return maximum_model_move_thousandths > 0u &&
           maximum_model_move_thousandths <= charge_distance_thousandths &&
           (flags & WHC_CHARGE_ALL_TARGETS_ENGAGED) != 0u &&
           (flags & WHC_CHARGE_UNIT_COHERENCY) != 0u &&
           (flags & WHC_CHARGE_NON_TARGETS_AVOIDED) != 0u &&
           (flags & WHC_CHARGE_ALL_MODELS_CLOSER) != 0u &&
           (flags & WHC_CHARGE_BASE_CONTACT_MAXIMIZED) != 0u;
}

bool whc_fight_move_is_valid(uint32_t stage, uint32_t destination,
                             uint32_t maximum_model_move_thousandths, uint32_t flags) {
    if (stage < WHC_FIGHT_MOVE_PILE_IN || stage > WHC_FIGHT_MOVE_CONSOLIDATION ||
        destination > WHC_FIGHT_DESTINATION_OBJECTIVE || maximum_model_move_thousandths > 3000u ||
        flags > WHC_FIGHT_MOVE_FLAGS_MASK) {
        return false;
    }
    if (destination == WHC_FIGHT_DESTINATION_ENEMY)
        return flags == 63u;
    if (stage == WHC_FIGHT_MOVE_PILE_IN) {
        return destination == WHC_FIGHT_DESTINATION_NONE && maximum_model_move_thousandths == 0u &&
               (flags == 1121u || flags == 3105u);
    }
    if (destination == WHC_FIGHT_DESTINATION_OBJECTIVE)
        return flags == 1507u;
    return destination == WHC_FIGHT_DESTINATION_NONE && maximum_model_move_thousandths == 0u &&
           (flags == 1633u || flags == 3105u);
}

bool whc_heroic_intervention_is_valid(uint32_t die_one, uint32_t die_two, int32_t roll_modifier,
                                      uint32_t charge_distance_thousandths,
                                      uint32_t start_distance_thousandths,
                                      uint32_t maximum_model_move_thousandths, bool successful,
                                      uint32_t charge_flags, uint32_t heroic_flags) {
    return start_distance_thousandths > 0u && start_distance_thousandths <= 6000u &&
           heroic_flags == WHC_HEROIC_FLAGS_MASK &&
           whc_charge_resolution_is_valid(die_one, die_two, roll_modifier,
                                          charge_distance_thousandths, start_distance_thousandths,
                                          maximum_model_move_thousandths, 1u, successful,
                                          charge_flags);
}

bool whc_fire_overwatch_is_valid(uint32_t trigger, uint32_t phase, uint32_t distance_thousandths,
                                 uint32_t flags) {
    if (trigger < WHC_FIRE_OVERWATCH_SET_UP || trigger > WHC_FIRE_OVERWATCH_CHARGE_DECLARED ||
        (phase != WHC_BATTLE_PHASE_MOVEMENT && phase != WHC_BATTLE_PHASE_CHARGE) ||
        distance_thousandths == 0u || distance_thousandths > 24000u ||
        flags != WHC_FIRE_OVERWATCH_FLAGS_MASK) {
        return false;
    }
    if (trigger == WHC_FIRE_OVERWATCH_SET_UP) {
        return true;
    }
    if (trigger == WHC_FIRE_OVERWATCH_CHARGE_DECLARED) {
        return phase == WHC_BATTLE_PHASE_CHARGE;
    }
    return phase == WHC_BATTLE_PHASE_MOVEMENT;
}

bool whc_hazardous_resolution_is_valid(uint32_t initial_roll, uint32_t reroll,
                                       bool reroll_explained, uint32_t remaining_wounds,
                                       uint32_t feel_no_pain, uint32_t feel_no_pain_roll_count,
                                       uint32_t ignored_wounds, uint32_t applied_damage,
                                       bool model_destroyed, uint32_t flags) {
    const uint32_t final_roll = reroll == 0u ? initial_roll : reroll;

    if (initial_roll < 1u || initial_roll > 6u || reroll > 6u ||
        (reroll != 0u && !reroll_explained) || final_roll != 1u || remaining_wounds == 0u ||
        remaining_wounds > 1024u ||
        (feel_no_pain != 0u && (feel_no_pain < 2u || feel_no_pain > 6u)) ||
        flags != WHC_HAZARDOUS_FLAGS_MASK) {
        return false;
    }
    if (feel_no_pain == 0u) {
        const uint32_t expected = remaining_wounds < 3u ? remaining_wounds : 3u;
        if (feel_no_pain_roll_count != 0u || ignored_wounds != 0u || applied_damage != expected) {
            return false;
        }
    } else if (feel_no_pain_roll_count < 1u || feel_no_pain_roll_count > 3u ||
               ignored_wounds > feel_no_pain_roll_count ||
               applied_damage != feel_no_pain_roll_count - ignored_wounds ||
               (applied_damage != remaining_wounds &&
                (applied_damage >= remaining_wounds || feel_no_pain_roll_count != 3u))) {
        return false;
    }
    return model_destroyed ? applied_damage == remaining_wounds : applied_damage < remaining_wounds;
}

bool whc_go_to_ground_is_valid(uint32_t phase, uint32_t command_points_before,
                               uint32_t command_point_cost, uint32_t command_points_after,
                               bool already_used, bool target_battle_shocked, uint32_t flags) {
    return phase == WHC_BATTLE_PHASE_SHOOTING && command_points_before >= 1u &&
           command_points_before <= 100000u && command_point_cost == 1u &&
           command_points_after == command_points_before - command_point_cost && !already_used &&
           !target_battle_shocked && flags == WHC_GO_TO_GROUND_FLAGS_MASK;
}

bool whc_counter_offensive_is_valid(uint32_t phase, uint32_t command_points_before,
                                    uint32_t command_point_cost, uint32_t command_points_after,
                                    bool already_used, bool target_battle_shocked, uint32_t flags) {
    return phase == WHC_BATTLE_PHASE_FIGHT && command_points_before >= 2u &&
           command_points_before <= 100000u && command_point_cost == 2u &&
           command_points_after == command_points_before - command_point_cost && !already_used &&
           !target_battle_shocked && flags == WHC_COUNTER_OFFENSIVE_FLAGS_MASK;
}

bool whc_smokescreen_is_valid(uint32_t phase, uint32_t command_points_before,
                              uint32_t command_point_cost, uint32_t command_points_after,
                              bool already_used, bool target_battle_shocked, uint32_t flags) {
    return phase == WHC_BATTLE_PHASE_SHOOTING && command_points_before >= 1u &&
           command_points_before <= 100000u && command_point_cost == 1u &&
           command_points_after == command_points_before - command_point_cost && !already_used &&
           !target_battle_shocked && flags == WHC_SMOKESCREEN_FLAGS_MASK;
}

bool whc_rapid_ingress_is_valid(uint32_t phase, uint32_t step, uint32_t battle_round,
                                uint32_t earliest_battle_round, uint32_t command_points_before,
                                uint32_t command_point_cost, uint32_t command_points_after,
                                bool already_used, bool target_battle_shocked,
                                bool first_round_out_of_phase_allowed, uint32_t flags) {
    return phase == WHC_BATTLE_PHASE_MOVEMENT && step == WHC_MOVEMENT_STEP_END &&
           battle_round >= 1u && battle_round <= 5u && earliest_battle_round >= 1u &&
           earliest_battle_round <= 5u && battle_round >= earliest_battle_round &&
           (battle_round != 1u || first_round_out_of_phase_allowed) &&
           command_points_before >= 1u && command_points_before <= 100000u &&
           command_point_cost == 1u &&
           command_points_after == command_points_before - command_point_cost && !already_used &&
           !target_battle_shocked && flags == WHC_RAPID_INGRESS_FLAGS_MASK;
}

bool whc_rule_coverage_is_permitted(uint32_t status, bool source_locked, bool acknowledged) {
    return source_locked &&
           (status == WHC_RULE_COVERAGE_EXECUTABLE || status == WHC_RULE_COVERAGE_IRRELEVANT ||
            (status == WHC_RULE_COVERAGE_GUIDED && acknowledged));
}

bool whc_ranged_declaration_is_valid(uint32_t declaration_count, uint32_t unique_declaration_count,
                                     uint32_t target_run_count, uint32_t unique_target_count,
                                     uint32_t profile_run_count,
                                     uint32_t unique_target_profile_count, uint32_t flags) {
    return declaration_count >= 1u && declaration_count <= 256u &&
           unique_declaration_count == declaration_count &&
           target_run_count == unique_target_count && unique_target_count >= 1u &&
           unique_target_count <= declaration_count &&
           profile_run_count == unique_target_profile_count &&
           unique_target_profile_count >= unique_target_count &&
           unique_target_profile_count <= declaration_count &&
           flags == WHC_RANGED_DECLARATION_FLAGS_MASK;
}

bool whc_transport_load_is_valid(uint32_t used_capacity, uint32_t capacity,
                                 uint32_t allowance_models, uint32_t allowance_maximum,
                                 uint32_t mode_count) {
    return capacity > 0u && used_capacity <= capacity && mode_count <= 1u &&
           ((allowance_maximum == 0u && allowance_models == 0u) ||
            (allowance_maximum > 0u && allowance_models <= allowance_maximum));
}

bool whc_transport_deployment_chain_is_valid(uint32_t chain_length, uint32_t unique_formation_count,
                                             uint32_t root_location,
                                             uint32_t reserve_eligibility_count) {
    return chain_length >= 1u && chain_length <= 257u && unique_formation_count == chain_length &&
           root_location <= WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES &&
           reserve_eligibility_count <= chain_length &&
           ((root_location == WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED &&
             reserve_eligibility_count == 0u) ||
            root_location == WHC_DEPLOYMENT_ROOT_BATTLEFIELD ||
            reserve_eligibility_count == chain_length);
}

bool whc_initial_deployment_is_valid(uint32_t is_dedicated_transport,
                                     uint32_t starting_passenger_count, uint32_t is_aircraft,
                                     uint32_t has_hover, uint32_t aircraft_mode,
                                     uint32_t root_location) {
    bool mode_is_valid;

    if (is_dedicated_transport > 1u || is_aircraft > 1u || has_hover > 1u ||
        aircraft_mode > WHC_AIRCRAFT_MODE_HOVER ||
        root_location > WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES) {
        return false;
    }
    mode_is_valid = (!is_aircraft && aircraft_mode == WHC_AIRCRAFT_MODE_NONE) ||
                    (is_aircraft && (aircraft_mode == WHC_AIRCRAFT_MODE_AIRCRAFT ||
                                     (aircraft_mode == WHC_AIRCRAFT_MODE_HOVER && has_hover)));
    if (!mode_is_valid) {
        return false;
    }
    if (is_dedicated_transport && starting_passenger_count == 0u) {
        return root_location == WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED;
    }
    if (root_location == WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED) {
        return false;
    }
    if (!is_aircraft) {
        return true;
    }
    if (aircraft_mode == WHC_AIRCRAFT_MODE_AIRCRAFT) {
        return root_location == WHC_DEPLOYMENT_ROOT_RESERVES;
    }
    return root_location == WHC_DEPLOYMENT_ROOT_BATTLEFIELD ||
           root_location == WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES;
}

bool whc_table_geometry_is_valid(uint32_t battlefield_width_thousandths,
                                 uint32_t battlefield_height_thousandths, uint32_t objective_count,
                                 uint32_t positioned_objective_count,
                                 uint32_t terrain_section_count, uint32_t six_by_four_count,
                                 uint32_t ten_by_five_count, uint32_t twelve_by_six_count,
                                 uint32_t flags) {
    return battlefield_width_thousandths == WHC_TABLE_WIDTH_THOUSANDTHS &&
           battlefield_height_thousandths == WHC_TABLE_HEIGHT_THOUSANDTHS &&
           objective_count >= 1u && objective_count <= 12u &&
           positioned_objective_count == objective_count &&
           terrain_section_count == WHC_TERRAIN_SECTION_COUNT &&
           six_by_four_count == WHC_TERRAIN_SIX_BY_FOUR_COUNT &&
           ten_by_five_count == WHC_TERRAIN_TEN_BY_FIVE_COUNT &&
           twelve_by_six_count == WHC_TERRAIN_TWELVE_BY_SIX_COUNT &&
           six_by_four_count + ten_by_five_count + twelve_by_six_count == terrain_section_count &&
           flags == WHC_TABLE_GEOMETRY_FLAGS_MASK;
}

bool whc_terrain_footprint_set_is_valid(uint32_t footprint_count,
                                        uint32_t positioned_footprint_count,
                                        uint32_t unique_footprint_count,
                                        uint32_t in_bounds_footprint_count,
                                        uint32_t grouped_footprint_count,
                                        uint32_t overlap_pair_count,
                                        uint32_t six_by_four_count,
                                        uint32_t ten_by_five_count,
                                        uint32_t twelve_by_six_count, uint32_t flags) {
    return footprint_count == WHC_TERRAIN_OUTLINE_COUNT &&
           positioned_footprint_count == footprint_count &&
           unique_footprint_count == footprint_count &&
           in_bounds_footprint_count == footprint_count &&
           grouped_footprint_count == footprint_count && overlap_pair_count == 0u &&
           six_by_four_count == WHC_TERRAIN_SIX_BY_FOUR_COUNT &&
           ten_by_five_count == WHC_TERRAIN_TEN_BY_FIVE_COUNT &&
           twelve_by_six_count == WHC_TERRAIN_TWELVE_BY_SIX_COUNT &&
           six_by_four_count + ten_by_five_count + twelve_by_six_count == footprint_count &&
           flags == WHC_TERRAIN_FOOTPRINT_FLAGS_MASK;
}

bool whc_model_placement_set_is_valid(uint32_t expected_model_count,
                                      uint32_t placement_count,
                                      uint32_t unique_model_count,
                                      uint32_t recognized_model_count,
                                      uint32_t positioned_model_count,
                                      uint32_t in_bounds_model_count,
                                      uint32_t dimensioned_model_count,
                                      uint32_t supported_shape_count,
                                      uint32_t based_model_count,
                                      uint32_t baseless_model_count, uint32_t flags) {
    return expected_model_count > 0u && expected_model_count <= 1000u &&
           placement_count == expected_model_count && unique_model_count == placement_count &&
           recognized_model_count == placement_count &&
           positioned_model_count == placement_count &&
           in_bounds_model_count == placement_count &&
           dimensioned_model_count == placement_count &&
           supported_shape_count == placement_count && based_model_count <= placement_count &&
           baseless_model_count == placement_count - based_model_count &&
           flags == WHC_MODEL_PLACEMENT_FLAGS_MASK;
}

bool whc_model_position_set_is_valid(
    uint32_t live_model_count, uint32_t position_count, uint32_t unique_model_count,
    uint32_t recognized_model_count, uint32_t positioned_model_count,
    uint32_t in_bounds_model_count, uint32_t dimensioned_model_count,
    uint32_t supported_shape_count, uint32_t based_model_count,
    uint32_t baseless_model_count, uint32_t segment_count, uint32_t matched_segment_count,
    uint32_t path_model_count, uint32_t path_start_count, uint32_t path_endpoint_count,
    uint32_t path_in_bounds_count, uint32_t footprint_match_count,
    uint32_t distance_within_limit_count, uint32_t distance_covers_path_count,
    uint32_t flags) {
    return live_model_count > 0u && live_model_count <= 1000u &&
           position_count == live_model_count && unique_model_count == position_count &&
           recognized_model_count == position_count &&
           positioned_model_count == position_count &&
           in_bounds_model_count == position_count &&
           dimensioned_model_count == position_count &&
           supported_shape_count == position_count && based_model_count <= position_count &&
           baseless_model_count == position_count - based_model_count &&
           matched_segment_count == segment_count && path_model_count == position_count &&
           path_start_count == position_count && path_endpoint_count == position_count &&
           path_in_bounds_count == position_count && footprint_match_count == position_count &&
           distance_within_limit_count == position_count &&
           distance_covers_path_count == position_count &&
           flags == WHC_MODEL_POSITION_FLAGS_MASK;
}

bool whc_spatial_facts_are_valid(uint32_t model_count, uint32_t ready_model_count,
                                 uint32_t required_neighbour_count,
                                 uint32_t coherent_model_count,
                                 uint32_t enemy_model_pair_count, uint32_t objective_count,
                                 uint32_t objective_in_range_count, uint32_t flags) {
    const uint32_t expected_neighbours = model_count <= 1u ? 0u : (model_count <= 6u ? 1u : 2u);

    return model_count > 0u && model_count <= 1000u && ready_model_count == model_count &&
           required_neighbour_count == expected_neighbours && coherent_model_count <= model_count &&
           enemy_model_pair_count <= 1000000u && objective_count <= 12u &&
           objective_in_range_count <= objective_count && flags == WHC_SPATIAL_FACTS_FLAGS_MASK;
}

bool whc_visibility_facts_are_valid(
    uint32_t model_pair_count, uint32_t ready_model_pair_count,
    uint32_t visible_model_pair_count, uint32_t fully_visible_model_pair_count,
    uint32_t not_fully_visible_model_pair_count, uint32_t unknown_model_pair_count,
    uint32_t target_model_count, uint32_t cover_yes_count, uint32_t cover_no_count,
    uint32_t cover_unknown_count, uint32_t flags) {
    return model_pair_count > 0u && model_pair_count <= 1000000u &&
           ready_model_pair_count == model_pair_count &&
           visible_model_pair_count <= model_pair_count &&
           fully_visible_model_pair_count <= model_pair_count &&
           not_fully_visible_model_pair_count <= model_pair_count &&
           unknown_model_pair_count <= model_pair_count &&
           fully_visible_model_pair_count + not_fully_visible_model_pair_count +
                   unknown_model_pair_count ==
               model_pair_count &&
           target_model_count > 0u && target_model_count <= 1000u &&
           cover_yes_count <= target_model_count && cover_no_count <= target_model_count &&
           cover_unknown_count <= target_model_count &&
           cover_yes_count + cover_no_count + cover_unknown_count == target_model_count &&
           flags == WHC_VISIBILITY_FACTS_FLAGS_MASK;
}

bool whc_convex_silhouette_is_valid(const int32_t *vertices, uint32_t vertex_count,
                                    uint32_t flags) {
    uint32_t edge_index;

    if (vertices == NULL || vertex_count < WHC_CONVEX_SILHOUETTE_MIN_VERTICES ||
        vertex_count > WHC_CONVEX_SILHOUETTE_MAX_VERTICES ||
        flags != WHC_CONVEX_SILHOUETTE_REVIEWED) {
        return false;
    }
    /*@ loop invariant 0 <= edge_index <= vertex_count;
        loop invariant \forall integer index; 0 <= index < edge_index * 2 ==>
            -WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT <= vertices[index] <=
             WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT;
        loop assigns edge_index;
        loop variant vertex_count - edge_index;
    */
    for (edge_index = 0u; edge_index < vertex_count; edge_index++) {
        uint32_t coordinate_index = edge_index * 2u;
        if (vertices[coordinate_index] < -WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT ||
            vertices[coordinate_index] > WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT ||
            vertices[coordinate_index + 1u] < -WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT ||
            vertices[coordinate_index + 1u] > WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT) {
            return false;
        }
    }
    /*@ assert \forall integer index; 0 <= index < vertex_count * 2 ==>
            -WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT <= vertices[index] <=
             WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT;
    */
    /*@ loop invariant 0 <= edge_index <= vertex_count;
        loop invariant \forall integer index; 0 <= index < vertex_count * 2 ==>
            -WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT <= vertices[index] <=
             WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT;
        loop invariant \forall integer edge, point;
            0 <= edge < edge_index && 0 <= point < vertex_count &&
            point != edge && point != (edge + 1 == vertex_count ? 0 : edge + 1) ==>
            (vertices[(edge + 1 == vertex_count ? 0 : edge + 1) * 2] -
             vertices[edge * 2]) *
                (vertices[point * 2 + 1] - vertices[edge * 2 + 1]) -
            (vertices[(edge + 1 == vertex_count ? 0 : edge + 1) * 2 + 1] -
             vertices[edge * 2 + 1]) *
                (vertices[point * 2] - vertices[edge * 2]) > 0;
        loop assigns edge_index;
        loop variant vertex_count - edge_index;
    */
    for (edge_index = 0u; edge_index < vertex_count; edge_index++) {
        uint32_t next_index = edge_index + 1u == vertex_count ? 0u : edge_index + 1u;
        uint32_t point_index;
        int64_t edge_x = (int64_t)vertices[next_index * 2u] - vertices[edge_index * 2u];
        int64_t edge_y =
            (int64_t)vertices[next_index * 2u + 1u] - vertices[edge_index * 2u + 1u];

        /*@ loop invariant 0 <= point_index <= vertex_count;
            loop invariant \forall integer index; 0 <= index < vertex_count * 2 ==>
                -WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT <= vertices[index] <=
                 WHC_CONVEX_SILHOUETTE_COORDINATE_LIMIT;
            loop invariant \forall integer point; 0 <= point < point_index &&
                point != edge_index && point != next_index ==>
                (vertices[next_index * 2] - vertices[edge_index * 2]) *
                    (vertices[point * 2 + 1] - vertices[edge_index * 2 + 1]) -
                (vertices[next_index * 2 + 1] - vertices[edge_index * 2 + 1]) *
                    (vertices[point * 2] - vertices[edge_index * 2]) > 0;
            loop assigns point_index;
            loop variant vertex_count - point_index;
        */
        for (point_index = 0u; point_index < vertex_count; point_index++) {
            int64_t point_x;
            int64_t point_y;
            int64_t cross;
            if (point_index == edge_index || point_index == next_index) {
                continue;
            }
            point_x =
                (int64_t)vertices[point_index * 2u] - vertices[edge_index * 2u];
            point_y =
                (int64_t)vertices[point_index * 2u + 1u] - vertices[edge_index * 2u + 1u];
            cross = edge_x * point_y - edge_y * point_x;
            if (cross <= 0) {
                return false;
            }
        }
    }
    return true;
}

bool whc_ranged_geometry_resolution_is_valid(
    uint32_t observer_count, uint32_t proven_observer_count, uint32_t target_model_count,
    uint32_t cover_proven_count, uint32_t cover_override_count, uint32_t flags) {
    const uint32_t visibility = flags & WHC_RANGED_GEOMETRY_VISIBILITY_MASK;
    const uint32_t indirect = flags & WHC_RANGED_GEOMETRY_INDIRECT_MASK;
    const uint32_t full_visibility = flags & WHC_RANGED_GEOMETRY_FULL_VISIBILITY_MASK;
    const bool visibility_valid =
        (visibility == 9u && proven_observer_count == observer_count) ||
        (visibility == 17u && proven_observer_count < observer_count) ||
        (indirect == 6u && proven_observer_count < observer_count);
    const bool full_visibility_valid =
        full_visibility == 0u ||
        ((flags & WHC_RANGED_GEOMETRY_DIRECT_VISIBLE) != 0u &&
         (full_visibility == 96u || full_visibility == 160u));

    return observer_count > 0u && observer_count <= 1000u &&
           proven_observer_count <= observer_count && target_model_count > 0u &&
           target_model_count <= 1000u && cover_proven_count <= target_model_count &&
           cover_override_count == target_model_count - cover_proven_count &&
           (flags & ~WHC_RANGED_GEOMETRY_FLAGS_MASK) == 0u &&
           (flags & WHC_RANGED_GEOMETRY_REVIEWED_BY_PLAYER) != 0u && visibility_valid &&
           full_visibility_valid;
}

bool whc_replay_battle_health_events(const uint32_t *profiles, uint32_t segment_count,
                                     const uint32_t *events, uint32_t event_count,
                                     uint32_t *health) {
    uint32_t current[WHC_MAX_BATTLE_SEGMENTS * WHC_BATTLE_HEALTH_FIELDS];
    uint32_t next[WHC_MAX_BATTLE_SEGMENTS * WHC_BATTLE_HEALTH_FIELDS];
    uint16_t active_events[WHC_MAX_BATTLE_EVENTS];
    uint32_t active_count = 0u;

    if (profiles == NULL || health == NULL || segment_count == 0u ||
        segment_count > WHC_MAX_BATTLE_SEGMENTS || event_count > WHC_MAX_BATTLE_EVENTS ||
        (event_count > 0u && events == NULL)) {
        return false;
    }

    for (uint32_t segment = 0u; segment < segment_count; ++segment) {
        const uint32_t profile_offset = segment * WHC_BATTLE_PROFILE_FIELDS;
        const uint32_t health_offset = segment * WHC_BATTLE_HEALTH_FIELDS;
        const uint32_t wounds = profiles[profile_offset];
        const uint32_t starting_models = profiles[profile_offset + 1u];
        if (!whc_battle_health_is_valid(wounds, starting_models, starting_models, 0u)) {
            return false;
        }
        current[health_offset] = starting_models;
        current[health_offset + 1u] = 0u;
    }

    for (uint32_t event_index = 0u; event_index < event_count; ++event_index) {
        const uint32_t event_offset = event_index * WHC_BATTLE_EVENT_FIELDS;
        const uint32_t version = events[event_offset];
        const uint32_t kind = events[event_offset + 1u];
        const uint32_t allocation_count = events[event_offset + 2u];
        const uint32_t reverts_event_index = events[event_offset + 3u];
        const uint32_t expected_damage = events[event_offset + 4u];
        const uint32_t expected_destroyed = events[event_offset + 5u];

        if (version != WHC_BATTLE_EVENT_VERSION) {
            return false;
        }

        memcpy(next, current, segment_count * WHC_BATTLE_HEALTH_FIELDS * sizeof(uint32_t));
        if (kind == WHC_BATTLE_EVENT_ATTACK || kind == WHC_BATTLE_EVENT_TRANSPORT_DAMAGE ||
            kind == WHC_BATTLE_EVENT_HAZARDOUS_DAMAGE) {
            bool seen[WHC_MAX_BATTLE_SEGMENTS] = {false};
            uint64_t damage = 0u;
            uint64_t destroyed = 0u;

            if (allocation_count == 0u || allocation_count > segment_count) {
                return false;
            }
            for (uint32_t allocation = 0u; allocation < allocation_count; ++allocation) {
                const uint32_t allocation_offset = event_offset + WHC_BATTLE_EVENT_HEADER_FIELDS +
                                                   allocation * WHC_BATTLE_ALLOCATION_FIELDS;
                const uint32_t segment = events[allocation_offset];
                const uint32_t before_models = events[allocation_offset + 1u];
                const uint32_t before_wounds = events[allocation_offset + 2u];
                const uint32_t after_models = events[allocation_offset + 3u];
                const uint32_t after_wounds = events[allocation_offset + 4u];
                uint32_t profile_offset;
                uint32_t health_offset;
                uint32_t wounds;

                if (segment >= segment_count || seen[segment]) {
                    return false;
                }
                seen[segment] = true;
                profile_offset = segment * WHC_BATTLE_PROFILE_FIELDS;
                health_offset = segment * WHC_BATTLE_HEALTH_FIELDS;
                wounds = profiles[profile_offset];
                if (current[health_offset] != before_models ||
                    current[health_offset + 1u] != before_wounds ||
                    !whc_battle_health_is_valid(wounds, profiles[profile_offset + 1u], after_models,
                                                after_wounds) ||
                    after_models > before_models ||
                    (after_models == before_models && after_wounds < before_wounds)) {
                    return false;
                }
                damage += (uint64_t)(before_models - after_models) * wounds + after_wounds -
                          before_wounds;
                destroyed += before_models - after_models;
                next[health_offset] = after_models;
                next[health_offset + 1u] = after_wounds;
            }
            if (damage != expected_damage || destroyed != expected_destroyed) {
                return false;
            }
            uint32_t wounded_segments = 0u;
            for (uint32_t segment = 0u; segment < segment_count; ++segment) {
                if (next[segment * WHC_BATTLE_HEALTH_FIELDS + 1u] > 0u) {
                    ++wounded_segments;
                }
            }
            if (wounded_segments > 1u) {
                return false;
            }
            if (kind == WHC_BATTLE_EVENT_ATTACK) {
                active_events[active_count++] = (uint16_t)event_index;
            }
        } else if (kind == WHC_BATTLE_EVENT_REVERT) {
            if (allocation_count != 0u || expected_damage != 0u || expected_destroyed != 0u ||
                active_count == 0u || reverts_event_index != active_events[active_count - 1u]) {
                return false;
            }
            const uint32_t reverted_offset = reverts_event_index * WHC_BATTLE_EVENT_FIELDS;
            const uint32_t reverted_allocations = events[reverted_offset + 2u];
            if (events[reverted_offset + 1u] != WHC_BATTLE_EVENT_ATTACK) {
                return false;
            }
            for (uint32_t allocation = 0u; allocation < reverted_allocations; ++allocation) {
                const uint32_t allocation_offset = reverted_offset +
                                                   WHC_BATTLE_EVENT_HEADER_FIELDS +
                                                   allocation * WHC_BATTLE_ALLOCATION_FIELDS;
                const uint32_t segment = events[allocation_offset];
                const uint32_t health_offset = segment * WHC_BATTLE_HEALTH_FIELDS;
                if (current[health_offset] != events[allocation_offset + 3u] ||
                    current[health_offset + 1u] != events[allocation_offset + 4u]) {
                    return false;
                }
                next[health_offset] = events[allocation_offset + 1u];
                next[health_offset + 1u] = events[allocation_offset + 2u];
            }
            --active_count;
        } else {
            return false;
        }
        memcpy(current, next, segment_count * WHC_BATTLE_HEALTH_FIELDS * sizeof(uint32_t));
    }

    memcpy(health, current, segment_count * WHC_BATTLE_HEALTH_FIELDS * sizeof(uint32_t));
    return true;
}
