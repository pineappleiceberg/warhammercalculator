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
               flags == 1121u;
    }
    if (destination == WHC_FIGHT_DESTINATION_OBJECTIVE)
        return flags == 1507u;
    return destination == WHC_FIGHT_DESTINATION_NONE && maximum_model_move_thousandths == 0u &&
           flags == 1633u;
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

bool whc_fire_overwatch_is_valid(uint32_t trigger, uint32_t phase,
                                 uint32_t distance_thousandths, uint32_t flags) {
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
        if (feel_no_pain_roll_count != 0u || ignored_wounds != 0u ||
            applied_damage != expected) {
            return false;
        }
    } else if (feel_no_pain_roll_count < 1u || feel_no_pain_roll_count > 3u ||
               ignored_wounds > feel_no_pain_roll_count ||
               applied_damage != feel_no_pain_roll_count - ignored_wounds ||
               (applied_damage != remaining_wounds &&
                (applied_damage >= remaining_wounds || feel_no_pain_roll_count != 3u))) {
        return false;
    }
    return model_destroyed ? applied_damage == remaining_wounds
                           : applied_damage < remaining_wounds;
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
