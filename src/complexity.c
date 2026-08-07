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
    uint32_t prefix_deferred_dimensions = 1u;
    uint32_t estimated_state_upper_bound = 1u;
    uint32_t characteristic_combinations = 1u;
    struct dice_value characteristic_rolls[MAX_VOLLEY_WEAPONS];
    uint16_t characteristic_groups[MAX_VOLLEY_WEAPONS];
    uint16_t characteristic_dimension_count = 0u;
    uint16_t weapon_index = 0u;
    bool uses_first_failed_save_state = false;
    uint16_t allocated_replacement_value = 0u;
    uint16_t allocated_replacement_uses = 0u;
    uint16_t allocated_replacement_skip = 0u;
    bool uses_deferred_states = false;

    if (weapons == NULL || targets == NULL || layout == NULL || result == NULL ||
        weapon_count == 0u || weapon_count > MAX_VOLLEY_WEAPONS || layout->segment_count == 0u ||
        layout->segment_count > MAX_TARGET_SEGMENTS || capacity == 0u) {
        return false;
    }
    uses_first_failed_save_state = targets[0].first_failed_save_damage_replacement_active;
    allocated_replacement_value = targets[0].allocated_attack_damage_replacement;
    allocated_replacement_uses = targets[0].allocated_attack_damage_replacement_uses;
    allocated_replacement_skip = targets[0].allocated_attack_damage_replacement_skip;
    if (uses_first_failed_save_state && allocated_replacement_uses != 0u &&
        targets[0].first_failed_save_damage_replacement != allocated_replacement_value) {
        return false;
    }
    uses_deferred_states = uses_first_failed_save_state || allocated_replacement_uses != 0u;

    while (weapon_index < weapon_count) {
        const struct weapon_profile *source_weapon = &weapons[weapon_index];
        const struct weapon_profile *weapon = source_weapon;
        struct weapon_profile resolved_weapon;
        struct attack_plan representative;
        uint32_t attack_maximum = 0u;
        uint32_t sustained_maximum = 0u;
        uint32_t hit_events = 0u;
        uint32_t stage_dimension = 0u;
        uint16_t segment_index = 0u;
        bool weapon_defers = false;

        memset(&representative, 0, sizeof(representative));
        if (source_weapon->characteristic_modifier_roll_flags == 0u) {
            if (source_weapon->characteristic_modifier_roll.dice_count != 0u ||
                source_weapon->characteristic_modifier_roll.dice_sides != 0u ||
                source_weapon->characteristic_modifier_roll.modifier != 0u ||
                source_weapon->characteristic_modifier_roll_group != 0u) {
                return false;
            }
        } else {
            struct distribution roll;
            uint16_t dimension = characteristic_dimension_count;
            uint32_t support = 0u;
            if (!distribution_from_dice_value(source_weapon->characteristic_modifier_roll, &roll) ||
                !weapon_profile_resolve_characteristic_roll(source_weapon, (uint16_t)roll.maximum,
                                                            &resolved_weapon)) {
                return false;
            }
            if (source_weapon->characteristic_modifier_roll_group != 0u) {
                dimension = 0u;
                while (dimension < characteristic_dimension_count &&
                       characteristic_groups[dimension] !=
                           source_weapon->characteristic_modifier_roll_group) {
                    dimension++;
                }
            }
            if (dimension < characteristic_dimension_count) {
                if (characteristic_rolls[dimension].dice_count !=
                        source_weapon->characteristic_modifier_roll.dice_count ||
                    characteristic_rolls[dimension].dice_sides !=
                        source_weapon->characteristic_modifier_roll.dice_sides ||
                    characteristic_rolls[dimension].modifier !=
                        source_weapon->characteristic_modifier_roll.modifier) {
                    return false;
                }
            } else {
                support = roll.maximum - roll.minimum + 1u;
                if (support > MAX_CHARACTERISTIC_ROLL_COMBINATIONS / characteristic_combinations) {
                    return false;
                }
                characteristic_combinations *= support;
                characteristic_rolls[dimension] = source_weapon->characteristic_modifier_roll;
                characteristic_groups[dimension] =
                    source_weapon->characteristic_modifier_roll_group;
                characteristic_dimension_count++;
            }
            weapon = &resolved_weapon;
        }
        while (segment_index < layout->segment_count) {
            struct attack_plan plan;
            const struct target_profile *target =
                &targets[(uint32_t)weapon_index * layout->segment_count + segment_index];
            if (target->first_failed_save_damage_replacement_active !=
                    uses_first_failed_save_state ||
                (uses_first_failed_save_state &&
                 target->first_failed_save_damage_replacement !=
                     targets[0].first_failed_save_damage_replacement) ||
                target->allocated_attack_damage_replacement != allocated_replacement_value ||
                target->allocated_attack_damage_replacement_uses != allocated_replacement_uses ||
                target->allocated_attack_damage_replacement_skip != allocated_replacement_skip ||
                !attack_plan_build(weapon, target, &plan)) {
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

        if (weapon->attacks_replacement != 0u) {
            attack_maximum = weapon->attacks_replacement;
        } else {
            attack_maximum = weapon->attacks.modifier;
            attack_maximum = uint32_saturating_add(
                attack_maximum,
                uint32_saturating_product(weapon->attacks.dice_count, weapon->attacks.dice_sides));
        }
        attack_maximum = uint32_saturating_product(
            attack_maximum, weapon->attacks_multiplier == 0u ? 1u : weapon->attacks_multiplier);
        attack_maximum = uint32_saturating_add(
            attack_maximum,
            uint32_saturating_add(weapon->attacks_addition.modifier,
                                  uint32_saturating_product(weapon->attacks_addition.dice_count,
                                                            weapon->attacks_addition.dice_sides)));
        if (weapon->attacks_modifier < 0) {
            uint32_t penalty = (uint32_t)(-(int32_t)weapon->attacks_modifier);
            attack_maximum = attack_maximum > penalty ? attack_maximum - penalty : 1u;
        } else {
            attack_maximum =
                uint32_saturating_add(attack_maximum, (uint32_t)weapon->attacks_modifier);
        }
        if (attack_maximum == 0u) {
            attack_maximum = 1u;
        }
        attack_maximum = uint32_saturating_product(
            attack_maximum, weapon->weapon_count == 0u ? 1u : weapon->weapon_count);
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
        if (weapon_defers) {
            uses_deferred_states = true;
            prefix_deferred_dimensions = uint32_saturating_product(
                prefix_deferred_dimensions, uint32_saturating_add(1u, hit_events));
        }
        stage_dimension = uint32_saturating_product(stage_dimension, prefix_deferred_dimensions);
        if (stage_dimension > estimated_state_upper_bound) {
            estimated_state_upper_bound = stage_dimension;
        }
        weapon_index++;
    }

    result->state_limit = MAX_EXACT_DEFERRED_STATES;
    result->maximum_attack_events = maximum_attack_events;
    result->target_capacity = capacity;
    result->uses_deferred_states = uses_deferred_states;
    if (uses_deferred_states) {
        result->estimated_state_upper_bound = uint32_saturating_product(
            uint32_saturating_add(1u, capacity), estimated_state_upper_bound);
        if (uses_first_failed_save_state) {
            result->estimated_state_upper_bound =
                uint32_saturating_product(result->estimated_state_upper_bound, 2u);
        }
        if (allocated_replacement_uses != 0u) {
            result->estimated_state_upper_bound = uint32_saturating_product(
                result->estimated_state_upper_bound,
                uint32_saturating_product(
                    uint32_saturating_add(1u, allocated_replacement_uses),
                    uint32_saturating_product(uint32_saturating_add(1u, allocated_replacement_skip),
                                              3u)));
        }
    } else {
        result->estimated_state_upper_bound = uint32_saturating_add(1u, capacity);
    }
    result->exact_guaranteed_by_bound = result->estimated_state_upper_bound <= result->state_limit;
    return true;
}
