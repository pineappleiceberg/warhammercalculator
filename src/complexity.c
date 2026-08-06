#include "warhammercalculator/calculator.h"

#include <limits.h>
#include <string.h>

/*@ assigns \nothing;
    ensures \result <= UINT32_MAX;
    ensures (integer)left * right <= UINT32_MAX ==>
        \result == (integer)left * right;
    ensures (integer)left * right > UINT32_MAX ==> \result == UINT32_MAX;
*/
static uint32_t uint32_saturating_product(uint32_t left, uint32_t right) {
    uint64_t product = (uint64_t)left * right;
    return product > UINT32_MAX ? UINT32_MAX : (uint32_t)product;
}

/*@ assigns \nothing;
    ensures \result >= left;
    ensures \result >= right;
    ensures \result <= UINT32_MAX;
    ensures (integer)left + right <= UINT32_MAX ==>
        \result == (integer)left + right;
    ensures (integer)left + right > UINT32_MAX ==> \result == UINT32_MAX;
*/
static uint32_t uint32_saturating_add(uint32_t left, uint32_t right) {
    return right > UINT32_MAX - left ? UINT32_MAX : left + right;
}

bool estimate_ordered_volley_complexity(const struct weapon_profile *weapons,
                                        const struct target_profile *targets, uint16_t weapon_count,
                                        const struct target_unit_layout *layout,
                                        struct exact_complexity *result) {
    uint32_t capacity = target_unit_capacity(layout);
    uint32_t maximum_attack_events = 0u;
    uint32_t maximum_stage_dimension = 1u;
    uint32_t deferred_packet_dimensions = 1u;
    uint16_t weapon_index = 0u;
    bool uses_deferred_states = false;

    if (weapons == NULL || targets == NULL || layout == NULL || result == NULL ||
        weapon_count == 0u || weapon_count > MAX_VOLLEY_WEAPONS || layout->segment_count == 0u ||
        layout->segment_count > MAX_TARGET_SEGMENTS || capacity == 0u) {
        return false;
    }

    while (weapon_index < weapon_count) {
        const struct weapon_profile *weapon = &weapons[weapon_index];
        struct attack_plan representative;
        uint32_t attack_maximum = 0u;
        uint32_t sustained_maximum = 0u;
        uint32_t hit_events = 0u;
        uint32_t stage_dimension = 0u;
        uint16_t segment_index = 0u;
        bool weapon_defers = false;

        memset(&representative, 0, sizeof(representative));
        while (segment_index < layout->segment_count) {
            struct attack_plan plan;
            const struct target_profile *target =
                &targets[(uint32_t)weapon_index * layout->segment_count + segment_index];
            if (!attack_plan_build(weapon, target, &plan)) {
                return false;
            }
            if (segment_index == 0u) {
                representative = plan;
            }
            if ((plan.flags & ATTACK_PLAN_CRITICAL_WOUNDS_BYPASS_SAVE) != 0u) {
                weapon_defers = true;
            }
            segment_index++;
        }

        attack_maximum = weapon->attacks.modifier;
        attack_maximum = uint32_saturating_add(
            attack_maximum,
            uint32_saturating_product(weapon->attacks.dice_count, weapon->attacks.dice_sides));
        sustained_maximum = representative.sustained_hits.modifier;
        sustained_maximum = uint32_saturating_add(
            sustained_maximum, uint32_saturating_product(representative.sustained_hits.dice_count,
                                                         representative.sustained_hits.dice_sides));
        hit_events =
            uint32_saturating_product(attack_maximum, uint32_saturating_add(1u, sustained_maximum));
        maximum_attack_events = uint32_saturating_add(maximum_attack_events, hit_events);
        stage_dimension = uint32_saturating_product(uint32_saturating_add(1u, attack_maximum),
                                                    uint32_saturating_add(1u, hit_events));
        stage_dimension = uint32_saturating_product(stage_dimension, 2u);
        if (stage_dimension > maximum_stage_dimension) {
            maximum_stage_dimension = stage_dimension;
        }
        if (weapon_defers) {
            uses_deferred_states = true;
            deferred_packet_dimensions = uint32_saturating_product(
                deferred_packet_dimensions, uint32_saturating_add(1u, hit_events));
        }
        weapon_index++;
    }

    result->state_limit = MAX_EXACT_DEFERRED_STATES;
    result->maximum_attack_events = maximum_attack_events;
    result->target_capacity = capacity;
    result->uses_deferred_states = uses_deferred_states;
    if (uses_deferred_states) {
        result->estimated_state_upper_bound = uint32_saturating_product(
            uint32_saturating_add(1u, capacity),
            uint32_saturating_product(maximum_stage_dimension, deferred_packet_dimensions));
    } else {
        result->estimated_state_upper_bound = uint32_saturating_add(1u, capacity);
    }
    result->exact_guaranteed_by_bound = result->estimated_state_upper_bound <= result->state_limit;
    return true;
}
