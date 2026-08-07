#include "warhammercalculator/calculator.h"

#include <limits.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#define VALID_D6_FACE_MASK UINT8_C(0x7E)
#define DEFERRED_STATE_TABLE_CAPACITY UINT32_C(4093)
#define DEFERRED_STATE_LIMIT MAX_EXACT_DEFERRED_STATES

struct roll_table {
    uint16_t ways[7];
    uint16_t total_ways;
};

struct roll_categories {
    uint64_t failed;
    uint64_t normal;
    uint64_t critical;
    uint64_t total;
};

struct save_categories {
    uint64_t failed;
    uint64_t succeeded;
    uint64_t total;
};

struct deferred_volley_state {
    uint16_t applied;
    uint16_t attacks_remaining;
    uint16_t wounds_remaining;
    uint8_t automatic_wound_pending;
    uint8_t first_failed_save_replacement_remaining;
    uint16_t devastating_wounds[MAX_VOLLEY_WEAPONS];
};

struct deferred_state_entry {
    struct deferred_volley_state state;
    uint64_t weight;
    uint32_t mass;
    uint32_t generation;
};

struct deferred_state_table {
    struct deferred_state_entry *entries;
    uint32_t *slots;
    uint32_t generation;
    uint32_t count;
    uint32_t peak_count;
    size_t state_size;
};

static bool distribution_from_weapon_attacks(const struct weapon_profile *weapon,
                                             struct distribution *result);
static bool distribution_from_weapon_damage(const struct weapon_profile *weapon,
                                            struct distribution *result);
static uint16_t weapon_modified_strength(const struct weapon_profile *weapon);

/*@ behavior null_result:
        assumes result == \null;
        assigns \nothing;
        ensures !\result;
    behavior overflow:
        assumes \valid(result) && right > UINT64_MAX - left;
        assigns \nothing;
        ensures !\result;
    behavior success:
        assumes \valid(result) && right <= UINT64_MAX - left;
        assigns *result;
        ensures \result && *result == left + right;
    complete behaviors;
    disjoint behaviors;
*/
static bool uint64_add_checked(uint64_t left, uint64_t right, uint64_t *result) {
    if (result == NULL || UINT64_MAX - left < right) {
        return false;
    }

    *result = left + right;
    return true;
}

/*@ behavior null_result:
        assumes result == \null;
        assigns \nothing;
        ensures !\result;
    behavior overflow:
        assumes \valid(result) && left != 0 && right > UINT64_MAX / left;
        assigns \nothing;
        ensures !\result;
    behavior success:
        assumes \valid(result) && (left == 0 || right <= UINT64_MAX / left);
        assigns *result;
        ensures \result && *result == left * right;
    complete behaviors;
    disjoint behaviors;
*/
static bool uint64_multiply_checked(uint64_t left, uint64_t right, uint64_t *result) {
    if (result == NULL) {
        return false;
    }

    if (left != 0 && right > UINT64_MAX / left) {
        return false;
    }

    *result = left * right;
    return true;
}

/*@ requires \valid(result);
    assigns *result;
    ensures \result ==> *result == first * second * third;
*/
static bool uint64_product3_checked(uint64_t first, uint64_t second, uint64_t third,
                                    uint64_t *result) {
    uint64_t temporary = 0;

    return uint64_multiply_checked(first, second, &temporary) &&
           uint64_multiply_checked(temporary, third, result);
}

/*@ requires \valid(required);
    assigns *required;
    ensures \result ==> (1 <= *required && *required <= total);
*/
static bool quantile_required_mass(uint64_t total, uint64_t quantile_numerator,
                                   uint64_t quantile_denominator, uint64_t *required) {
    if (required == NULL || total == 0 || quantile_denominator == 0 || quantile_numerator == 0 ||
        quantile_numerator > quantile_denominator) {
        return false;
    }

#if defined(__SIZEOF_INT128__)
    {
        __uint128_t product = (__uint128_t)total * (__uint128_t)quantile_numerator;
        __uint128_t rounded = product + (__uint128_t)quantile_denominator - 1u;
        __uint128_t answer = rounded / quantile_denominator;

        if (answer > UINT64_MAX) {
            return false;
        }

        *required = (uint64_t)answer;
        return true;
    }
#else
    {
        uint64_t product = 0;

        if (!uint64_multiply_checked(total, quantile_numerator, &product)) {
            return false;
        }

        *required = product / quantile_denominator;

        if (product % quantile_denominator != 0) {
            if (*required == UINT64_MAX) {
                return false;
            }
            (*required)++;
        }

        return true;
    }
#endif
}

/*@ assigns \nothing;
    ensures \result <= PROBABILITY_SCALE;
*/
static uint32_t ratio_to_probability_mass(uint64_t numerator, uint64_t denominator) {
#if defined(__SIZEOF_INT128__)
    if (denominator == 0 || numerator == 0) {
        return 0;
    }
    if (numerator >= denominator) {
        return PROBABILITY_SCALE;
    }
    return (uint32_t)(((__uint128_t)numerator * (__uint128_t)PROBABILITY_SCALE) /
                      (__uint128_t)denominator);
#else
    uint32_t result = 0;
    uint32_t bit = 0;
    uint64_t remainder = numerator;

    if (denominator == 0 || numerator == 0) {
        return 0;
    }

    if (numerator >= denominator) {
        return PROBABILITY_SCALE;
    }

    /*@ loop invariant 0 <= bit && bit <= 31;
        loop invariant remainder < denominator;
        loop assigns bit, result, remainder;
        loop variant 31 - bit;
    */
    while (bit < 31u) {
        result <<= 1u;

        if (remainder >= denominator - remainder) {
            remainder = remainder - (denominator - remainder);
            result |= UINT32_C(1);
        } else {
            remainder += remainder;
        }

        bit++;
    }

    return result;
#endif
}

/*@ requires minimum <= maximum && maximum <= MAX_DISTRIBUTION_RESULT;
    requires \valid_read(weights + (minimum .. maximum));
    requires \valid(result);
    assigns *result;
    ensures \result ==> whc_normalized_probability_distribution(result);
*/
static bool probability_distribution_from_weights(const uint64_t *weights, uint32_t minimum,
                                                  uint32_t maximum, uint64_t total_weight,
                                                  struct probability_distribution *result) {
    uint64_t cumulative = 0;
    uint32_t previous_scaled = 0;
    uint32_t outcome = 0;

    if (weights == NULL || result == NULL || total_weight == 0 || minimum > maximum ||
        maximum > MAX_DISTRIBUTION_RESULT) {
        return false;
    }

    probability_distribution_clear(result);

    outcome = minimum;
    /*@ loop invariant minimum <= outcome && outcome <= maximum + 1;
        loop invariant cumulative <= total_weight;
        loop invariant previous_scaled <= PROBABILITY_SCALE;
        loop assigns outcome, cumulative, previous_scaled,
                     result->mass[minimum .. maximum];
        loop variant maximum + 1 - outcome;
    */
    while (outcome <= maximum) {
        uint32_t scaled_cumulative = 0;

        if (!uint64_add_checked(cumulative, weights[outcome], &cumulative) ||
            cumulative > total_weight) {
            probability_distribution_clear(result);
            return false;
        }

        scaled_cumulative = ratio_to_probability_mass(cumulative, total_weight);

        result->mass[outcome] = scaled_cumulative - previous_scaled;
        previous_scaled = scaled_cumulative;
        outcome++;
    }

    if (cumulative != total_weight || previous_scaled != PROBABILITY_SCALE) {
        probability_distribution_clear(result);
        return false;
    }

    result->minimum = minimum;
    result->maximum = maximum;
    result->total_mass = PROBABILITY_SCALE;
    return true;
}

/*@ requires \valid(result);
    assigns *result;
    ensures \result ==> whc_normalized_probability_distribution(result);
    ensures \result ==> result->minimum == value && result->maximum == value;
*/
static bool probability_distribution_from_constant(uint32_t value,
                                                   struct probability_distribution *result) {
    if (result == NULL || value > MAX_DISTRIBUTION_RESULT) {
        return false;
    }

    probability_distribution_clear(result);
    result->mass[value] = PROBABILITY_SCALE;
    result->minimum = value;
    result->maximum = value;
    result->total_mass = PROBABILITY_SCALE;
    return true;
}

/*@ requires \valid_read(left) && \valid_read(right);
    requires \valid(accumulator + (0 .. MAX_DISTRIBUTION_RESULT));
    requires \valid(result);
    requires \separated(accumulator + (0 .. MAX_DISTRIBUTION_RESULT), left, right, result);
    assigns accumulator[0 .. MAX_DISTRIBUTION_RESULT], *result;
*/
static bool probability_distribution_convolve_internal(const struct probability_distribution *left,
                                                       const struct probability_distribution *right,
                                                       uint64_t *accumulator,
                                                       struct probability_distribution *result) {
    uint32_t left_outcome = 0;
    uint32_t result_minimum = 0;
    uint32_t result_maximum = 0;
    const uint64_t total_weight = (uint64_t)PROBABILITY_SCALE * (uint64_t)PROBABILITY_SCALE;

    if (left == NULL || right == NULL || accumulator == NULL || result == NULL ||
        left->total_mass != PROBABILITY_SCALE || right->total_mass != PROBABILITY_SCALE ||
        left->minimum > left->maximum || right->minimum > right->maximum ||
        left->maximum + right->maximum > MAX_DISTRIBUTION_RESULT) {
        return false;
    }

    memset(accumulator, 0, sizeof(uint64_t) * (MAX_DISTRIBUTION_RESULT + 1u));

    left_outcome = left->minimum;
    /*@ loop invariant left->minimum <= left_outcome &&
                       left_outcome <= left->maximum + 1;
        loop assigns left_outcome, accumulator[0 .. MAX_DISTRIBUTION_RESULT];
        loop variant left->maximum + 1 - left_outcome;
    */
    while (left_outcome <= left->maximum) {
        uint32_t right_outcome = right->minimum;

        if (left->mass[left_outcome] != 0) {
            /*@ loop invariant right->minimum <= right_outcome &&
                               right_outcome <= right->maximum + 1;
                loop assigns right_outcome, accumulator[0 .. MAX_DISTRIBUTION_RESULT];
                loop variant right->maximum + 1 - right_outcome;
            */
            while (right_outcome <= right->maximum) {
                if (right->mass[right_outcome] != 0) {
                    uint32_t combined = left_outcome + right_outcome;
                    uint64_t product =
                        (uint64_t)left->mass[left_outcome] * (uint64_t)right->mass[right_outcome];

                    if (!uint64_add_checked(accumulator[combined], product,
                                            &accumulator[combined])) {
                        return false;
                    }
                }

                right_outcome++;
            }
        }

        left_outcome++;
    }

    result_minimum = left->minimum + right->minimum;
    result_maximum = left->maximum + right->maximum;

    return probability_distribution_from_weights(accumulator, result_minimum, result_maximum,
                                                 total_weight, result);
}

/*@ requires \valid_read(current) && \valid_read(incoming);
    requires wounds_per_model > 0 && model_count > 0;
    requires \valid(accumulator + (0 .. MAX_DISTRIBUTION_RESULT));
    requires \valid(result);
    requires \separated(accumulator + (0 .. MAX_DISTRIBUTION_RESULT), current, incoming, result);
    assigns accumulator[0 .. MAX_DISTRIBUTION_RESULT], *result;
*/
static bool probability_distribution_allocate_attack_internal(
    const struct probability_distribution *current, const struct probability_distribution *incoming,
    uint16_t wounds_per_model, uint16_t model_count, uint64_t *accumulator,
    struct probability_distribution *result) {
    uint32_t applied = 0;
    uint32_t maximum = 0;
    uint64_t capacity = (uint64_t)wounds_per_model * model_count;
    const uint64_t total_weight = (uint64_t)PROBABILITY_SCALE * PROBABILITY_SCALE;

    if (current == NULL || incoming == NULL || accumulator == NULL || result == NULL ||
        wounds_per_model == 0u || model_count == 0u || current->total_mass != PROBABILITY_SCALE ||
        incoming->total_mass != PROBABILITY_SCALE || current->minimum > current->maximum ||
        incoming->minimum > incoming->maximum) {
        return false;
    }

    memset(accumulator, 0, sizeof(uint64_t) * (MAX_DISTRIBUTION_RESULT + 1u));
    applied = current->minimum;
    while (applied <= current->maximum) {
        uint32_t damage = incoming->minimum;

        while (damage <= incoming->maximum) {
            if (current->mass[applied] != 0u && incoming->mass[damage] != 0u) {
                uint32_t next =
                    allocate_damage_to_unit(applied, damage, wounds_per_model, model_count);
                uint64_t product = (uint64_t)current->mass[applied] * incoming->mass[damage];

                if (next > MAX_DISTRIBUTION_RESULT ||
                    !uint64_add_checked(accumulator[next], product, &accumulator[next])) {
                    return false;
                }
                if (next > maximum) {
                    maximum = next;
                }
            }
            damage++;
        }
        applied++;
    }

    if (capacity < maximum) {
        return false;
    }

    return probability_distribution_from_weights(accumulator, 0u, maximum, total_weight, result);
}

/*@ requires \valid_read(source) && \valid(result);
    requires \separated(source, result);
    assigns *result;
    ensures \result ==> result->minimum <= result->maximum;
    ensures \result ==> result->maximum <= MAX_DISTRIBUTION_RESULT;
*/
static bool distribution_add_uniform_die(const struct distribution *source, uint16_t sides,
                                         struct distribution *result) {
    uint32_t outcome = 0;
    uint64_t window = 0;
    uint64_t new_total = 0;
    uint32_t new_minimum = 0;
    uint32_t new_maximum = 0;

    if (source == NULL || result == NULL || source == result || source->total_ways == 0 ||
        sides == 0 || source->maximum + sides > MAX_DISTRIBUTION_RESULT ||
        !uint64_multiply_checked(source->total_ways, sides, &new_total)) {
        return false;
    }

    distribution_clear(result);

    new_minimum = source->minimum + 1u;
    new_maximum = source->maximum + sides;
    outcome = new_minimum;

    /*@ loop invariant new_minimum <= outcome && outcome <= new_maximum + 1;
        loop invariant outcome <= MAX_DISTRIBUTION_RESULT + 1;
        loop assigns outcome, window, result->ways[new_minimum .. new_maximum];
        loop variant new_maximum + 1 - outcome;
    */
    while (outcome <= new_maximum) {
        uint32_t entering = outcome - 1u;

        if (entering >= source->minimum && entering <= source->maximum) {
            if (!uint64_add_checked(window, source->ways[entering], &window)) {
                distribution_clear(result);
                return false;
            }
        }

        if (outcome > sides) {
            uint32_t leaving = outcome - sides - 1u;

            if (leaving >= source->minimum && leaving <= source->maximum) {
                if (window < source->ways[leaving]) {
                    distribution_clear(result);
                    return false;
                }
                window -= source->ways[leaving];
            }
        }

        result->ways[outcome] = window;
        outcome++;
    }

    result->minimum = new_minimum;
    result->maximum = new_maximum;
    result->total_ways = new_total;
    return true;
}

bool attack_roll_succeeds(uint8_t face, uint8_t succeeds_on, uint8_t critical_on,
                          uint8_t auto_fails_through) {
    bool critical = critical_on >= 2u && critical_on <= 6u && face >= critical_on;

    return face > auto_fails_through && (critical || (succeeds_on <= 6u && face >= succeeds_on));
}

/*@ assigns \nothing;
    ensures (\result & ~VALID_D6_FACE_MASK) == 0;
*/
static uint8_t failed_roll_mask(uint8_t succeeds_on, uint8_t critical_on,
                                uint8_t auto_fails_through) {
    uint8_t mask = 0;
    uint8_t face = 1;

    while (face <= 6u) {
        if (!attack_roll_succeeds(face, succeeds_on, critical_on, auto_fails_through)) {
            mask |= (uint8_t)(UINT8_C(1) << face);
        }
        face++;
    }

    return mask;
}

/*@ requires \valid(table);
    assigns *table;
    ensures \result ==> table->total_ways > 0;
*/
static bool roll_table_build(uint8_t reroll_mask, struct roll_table *table) {
    uint8_t face = 0;

    if (table == NULL) {
        return false;
    }

    memset(table, 0, sizeof(*table));
    reroll_mask &= VALID_D6_FACE_MASK;

    if (reroll_mask == 0) {
        face = 1;
        while (face <= 6u) {
            table->ways[face] = 1;
            face++;
        }
        table->total_ways = 6;
        return true;
    }

    face = 1;
    while (face <= 6u) {
        if ((reroll_mask & (uint8_t)(UINT8_C(1) << face)) != 0) {
            uint8_t second_face = 1;

            while (second_face <= 6u) {
                table->ways[second_face]++;
                second_face++;
            }
        } else {
            table->ways[face] += 6u;
        }

        face++;
    }

    table->total_ways = 36;
    return true;
}

/*@ requires \valid_read(table) && \valid(categories);
    assigns *categories;
    ensures categories->failed + categories->normal + categories->critical == categories->total;
*/
static void classify_attack_rolls(const struct roll_table *table, uint8_t succeeds_on,
                                  uint8_t critical_on, uint8_t auto_fails_through,
                                  struct roll_categories *categories) {
    uint8_t face = 1;

    memset(categories, 0, sizeof(*categories));

    while (face <= 6u) {
        uint64_t ways = table->ways[face];
        bool succeeds = attack_roll_succeeds(face, succeeds_on, critical_on, auto_fails_through);
        bool critical = succeeds && critical_on >= 2u && critical_on <= 6u && face >= critical_on;

        if (critical) {
            categories->critical += ways;
        } else if (succeeds) {
            categories->normal += ways;
        } else {
            categories->failed += ways;
        }

        face++;
    }

    categories->total = table->total_ways;
}

/*@ requires \valid_read(table) && \valid(categories);
    assigns *categories;
    ensures categories->failed + categories->succeeded == categories->total;
*/
static void classify_saves(const struct roll_table *table, uint8_t saves_on_value,
                           struct save_categories *categories) {
    uint8_t face = 1;

    memset(categories, 0, sizeof(*categories));

    while (face <= 6u) {
        if (saves_on_value <= 6u && face >= saves_on_value) {
            categories->succeeded += table->ways[face];
        } else {
            categories->failed += table->ways[face];
        }
        face++;
    }

    categories->total = table->total_ways;
}

/*@ requires \valid_read(plan) && \valid(result);
    assigns *result;
*/
static bool apply_damage_plan(const struct attack_plan *plan, uint32_t raw_damage,
                              uint32_t *result) {
    int64_t modified_damage = 0;
    int64_t modifier_numerator = 0;
    uint32_t damage = 0;
    uint8_t transform_index = 0;

    if (plan == NULL || result == NULL || plan->damage_divisor == 0u ||
        plan->damage_multiplier == 0u) {
        return false;
    }

    modifier_numerator = (int64_t)raw_damage * plan->damage_multiplier +
                         (int64_t)plan->damage_modifier * plan->damage_divisor;
    modified_damage = modifier_numerator > 0
                          ? (modifier_numerator + plan->damage_divisor - 1u) / plan->damage_divisor
                          : modifier_numerator / plan->damage_divisor;
    if (modified_damage < plan->damage_floor) {
        damage = plan->damage_floor;
    } else if (modified_damage > MAX_DISTRIBUTION_RESULT) {
        return false;
    } else {
        damage = (uint32_t)modified_damage;
    }

    while (transform_index < plan->damage_transform_count) {
        const struct damage_transform_entry *entry = &plan->damage_transforms[transform_index];

        if (entry->apply == NULL || !entry->apply(&damage, &entry->payload)) {
            return false;
        }

        transform_index++;
    }

    if (damage > MAX_DISTRIBUTION_RESULT) {
        return false;
    }

    *result = damage;
    return true;
}

/*@ requires \valid_read(weapon) && \valid_read(plan);
    requires \valid(result) && \valid(damage_distribution);
    requires \separated(result, damage_distribution, weapon, plan);
    assigns *result, *damage_distribution;
*/
static bool build_single_attack_exact_distribution(const struct weapon_profile *weapon,
                                                   const struct attack_plan *plan,
                                                   struct distribution *damage_distribution,
                                                   struct distribution *result) {
    struct roll_table hit_table;
    struct roll_table wound_table;
    struct roll_table save_table;
    struct roll_categories hit_categories;
    struct roll_categories wound_categories;
    struct save_categories save_categories;
    uint64_t rolling_hits = 0;
    uint64_t lethal_hits = 0;
    uint64_t saveable_wounds = 0;
    uint64_t bypassing_wounds = 0;
    uint64_t zero_branch_weight = 0;
    uint64_t damage_branch_weight = 0;
    uint64_t temporary = 0;
    uint64_t expected_total = 0;
    uint32_t raw_damage = 0;
    bool lethal = false;
    bool bypass_critical_wounds = false;

    if (weapon == NULL || plan == NULL || damage_distribution == NULL || result == NULL ||
        damage_distribution == result ||
        !distribution_from_weapon_damage(weapon, damage_distribution) ||
        !roll_table_build(plan->hit_reroll_mask, &hit_table) ||
        !roll_table_build(plan->wound_reroll_mask, &wound_table) ||
        !roll_table_build(plan->save_reroll_mask, &save_table)) {
        return false;
    }

    classify_attack_rolls(&hit_table, plan->hits_on, plan->critical_hits_on,
                          plan->hit_auto_fails_through, &hit_categories);
    classify_attack_rolls(&wound_table, plan->wounds_on, plan->critical_wounds_on, 0u,
                          &wound_categories);
    classify_saves(&save_table, plan->saves_on, &save_categories);

    lethal = (plan->flags & ATTACK_PLAN_LETHAL_HITS) != 0;
    bypass_critical_wounds = (plan->flags & ATTACK_PLAN_CRITICAL_WOUNDS_BYPASS_SAVE) != 0;

    rolling_hits = hit_categories.normal;
    lethal_hits = 0;

    if (lethal) {
        lethal_hits = hit_categories.critical;
    } else if (!uint64_add_checked(rolling_hits, hit_categories.critical, &rolling_hits)) {
        return false;
    }

    saveable_wounds = wound_categories.normal;
    bypassing_wounds = 0;

    if (bypass_critical_wounds) {
        bypassing_wounds = wound_categories.critical;
    } else if (!uint64_add_checked(saveable_wounds, wound_categories.critical, &saveable_wounds)) {
        return false;
    }

    if (!uint64_product3_checked(hit_categories.failed, wound_categories.total,
                                 save_categories.total, &zero_branch_weight)) {
        return false;
    }

    if (!uint64_product3_checked(rolling_hits, wound_categories.failed, save_categories.total,
                                 &temporary) ||
        !uint64_add_checked(zero_branch_weight, temporary, &zero_branch_weight)) {
        return false;
    }

    if (!uint64_product3_checked(rolling_hits, saveable_wounds, save_categories.succeeded,
                                 &temporary) ||
        !uint64_add_checked(zero_branch_weight, temporary, &zero_branch_weight)) {
        return false;
    }

    if (!uint64_product3_checked(lethal_hits, wound_categories.total, save_categories.succeeded,
                                 &temporary) ||
        !uint64_add_checked(zero_branch_weight, temporary, &zero_branch_weight)) {
        return false;
    }

    if (!uint64_product3_checked(rolling_hits, saveable_wounds, save_categories.failed,
                                 &damage_branch_weight)) {
        return false;
    }

    if (!uint64_product3_checked(lethal_hits, wound_categories.total, save_categories.failed,
                                 &temporary) ||
        !uint64_add_checked(damage_branch_weight, temporary, &damage_branch_weight)) {
        return false;
    }

    if (!uint64_product3_checked(rolling_hits, bypassing_wounds, save_categories.total,
                                 &temporary) ||
        !uint64_add_checked(damage_branch_weight, temporary, &damage_branch_weight)) {
        return false;
    }

    if (!uint64_product3_checked(hit_categories.total, wound_categories.total,
                                 save_categories.total, &expected_total) ||
        !uint64_multiply_checked(expected_total, damage_distribution->total_ways,
                                 &expected_total)) {
        return false;
    }

    distribution_clear(result);

    if (zero_branch_weight != 0) {
        uint64_t zero_ways = 0;

        if (!uint64_multiply_checked(zero_branch_weight, damage_distribution->total_ways,
                                     &zero_ways) ||
            !distribution_add_outcome(result, 0, zero_ways)) {
            distribution_clear(result);
            return false;
        }
    }

    raw_damage = damage_distribution->minimum;
    while (raw_damage <= damage_distribution->maximum) {
        uint64_t damage_ways = damage_distribution->ways[raw_damage];

        if (damage_ways != 0 && damage_branch_weight != 0) {
            uint64_t branch_ways = 0;
            uint32_t mapped_damage = 0;

            if (!apply_damage_plan(plan, raw_damage, &mapped_damage) ||
                !uint64_multiply_checked(damage_ways, damage_branch_weight, &branch_ways) ||
                !distribution_add_outcome(result, mapped_damage, branch_ways)) {
                distribution_clear(result);
                return false;
            }
        }

        raw_damage++;
    }

    if (result->total_ways != expected_total) {
        distribution_clear(result);
        return false;
    }

    return distribution_reduce_weights(result);
}

/*@ requires \valid_read(weapon) && \valid_read(plan);
    requires \valid(result) && \valid(damage_distribution);
    requires \separated(result, damage_distribution, weapon, plan);
    assigns *result, *damage_distribution;
*/
static bool build_conditional_hit_exact_distribution(const struct weapon_profile *weapon,
                                                     const struct attack_plan *plan,
                                                     bool automatic_wound,
                                                     struct distribution *damage_distribution,
                                                     struct distribution *result) {
    struct attack_plan conditional;

    if (weapon == NULL || plan == NULL) {
        return false;
    }

    conditional = *plan;
    conditional.hits_on = 1u;
    conditional.critical_hits_on = 0u;
    conditional.hit_reroll_mask = 0u;
    conditional.hit_auto_fails_through = 0u;
    conditional.sustained_hits = (struct dice_value){0u, 0u, 0u};
    conditional.flags &=
        (uint32_t)~((uint32_t)ATTACK_PLAN_LETHAL_HITS | (uint32_t)ATTACK_PLAN_AUTO_HITS);

    if (automatic_wound) {
        conditional.wounds_on = 1u;
        conditional.critical_wounds_on = 0u;
        conditional.wound_reroll_mask = 0u;
    }

    return build_single_attack_exact_distribution(weapon, &conditional, damage_distribution,
                                                  result);
}

/*@ requires \valid_read(weapon) && \valid_read(plan);
    requires \valid(workspace) && \valid(result);
    assigns *workspace, *result;
*/
static bool build_single_attack_probability_distribution(const struct weapon_profile *weapon,
                                                         const struct attack_plan *plan,
                                                         struct calculator_workspace *workspace,
                                                         struct probability_distribution *result) {
    struct roll_table hit_table;
    struct roll_categories hit_categories;
    struct probability_distribution *normal_hit = NULL;
    struct probability_distribution *automatic_wound = NULL;
    struct probability_distribution *critical_hit = NULL;
    struct probability_distribution *next = NULL;
    uint32_t outcome = 0;
    uint32_t maximum = 0;
    uint64_t total_weight = 0;
    bool lethal = false;
    bool auto_hits = false;

    if (weapon == NULL || plan == NULL || workspace == NULL || result == NULL) {
        return false;
    }

    auto_hits = (plan->flags & ATTACK_PLAN_AUTO_HITS) != 0;
    if (plan->sustained_hits.dice_count == 0u && plan->sustained_hits.modifier == 0u &&
        !auto_hits) {
        return build_single_attack_exact_distribution(weapon, plan, &workspace->exact_a,
                                                      &workspace->exact_b) &&
               probability_distribution_from_exact(&workspace->exact_b, result);
    }

    if (!build_conditional_hit_exact_distribution(weapon, plan, false, &workspace->exact_a,
                                                  &workspace->exact_b) ||
        !probability_distribution_from_exact(&workspace->exact_b, &workspace->probability_b)) {
        return false;
    }

    normal_hit = &workspace->probability_b;
    if (auto_hits) {
        if (result != normal_hit) {
            memcpy(result, normal_hit, sizeof(*result));
        }
        return true;
    }

    if (!build_conditional_hit_exact_distribution(weapon, plan, true, &workspace->exact_a,
                                                  &workspace->exact_b) ||
        !probability_distribution_from_exact(&workspace->exact_b, &workspace->probability_c) ||
        !roll_table_build(plan->hit_reroll_mask, &hit_table)) {
        return false;
    }

    automatic_wound = &workspace->probability_c;
    lethal = (plan->flags & ATTACK_PLAN_LETHAL_HITS) != 0;
    critical_hit = automatic_wound;
    if (!lethal) {
        memcpy(critical_hit, normal_hit, sizeof(*critical_hit));
    }
    next = &workspace->probability_d;

    if (plan->sustained_hits.dice_count != 0u || plan->sustained_hits.modifier != 0u) {
        struct distribution *hit_count = &workspace->exact_a;
        struct probability_distribution *current = critical_hit;
        uint32_t extra_hit = 0u;
        uint32_t base_maximum = critical_hit->maximum;
        uint64_t sustained_total_weight = 0u;

        if (!distribution_from_dice_value(plan->sustained_hits, hit_count) ||
            !uint64_multiply_checked((uint64_t)PROBABILITY_SCALE, hit_count->total_ways,
                                     &sustained_total_weight)) {
            return false;
        }
        memset(workspace->mixture_accumulator, 0, sizeof(workspace->mixture_accumulator));
        while (extra_hit <= hit_count->maximum) {
            uint64_t hit_count_weight = hit_count->ways[extra_hit];
            if (hit_count_weight != 0u) {
                outcome = current->minimum;
                while (outcome <= current->maximum) {
                    uint64_t weighted_mass = (uint64_t)current->mass[outcome] * hit_count_weight;
                    if (!uint64_add_checked(workspace->mixture_accumulator[outcome], weighted_mass,
                                            &workspace->mixture_accumulator[outcome])) {
                        return false;
                    }
                    outcome++;
                }
            }
            if (extra_hit < hit_count->maximum) {
                struct probability_distribution *swap = NULL;
                if (!probability_distribution_convolve_internal(
                        current, normal_hit, workspace->convolution_accumulator, next)) {
                    return false;
                }
                swap = current;
                current = next;
                next = swap;
            }
            extra_hit++;
        }
        maximum = base_maximum + hit_count->maximum * normal_hit->maximum;
        critical_hit = next;
        if (!probability_distribution_from_weights(workspace->mixture_accumulator, 0u, maximum,
                                                   sustained_total_weight, critical_hit)) {
            return false;
        }
    }

    classify_attack_rolls(&hit_table, plan->hits_on, plan->critical_hits_on,
                          plan->hit_auto_fails_through, &hit_categories);

    maximum =
        normal_hit->maximum > critical_hit->maximum ? normal_hit->maximum : critical_hit->maximum;
    memset(workspace->mixture_accumulator, 0, sizeof(workspace->mixture_accumulator));
    workspace->mixture_accumulator[0] = hit_categories.failed * (uint64_t)PROBABILITY_SCALE;

    outcome = 0;
    while (outcome <= maximum) {
        uint64_t normal_weight = outcome <= normal_hit->maximum
                                     ? (uint64_t)normal_hit->mass[outcome] * hit_categories.normal
                                     : 0u;
        uint64_t critical_weight =
            outcome <= critical_hit->maximum
                ? (uint64_t)critical_hit->mass[outcome] * hit_categories.critical
                : 0u;
        uint64_t combined = 0;

        if (!uint64_add_checked(normal_weight, critical_weight, &combined) ||
            !uint64_add_checked(workspace->mixture_accumulator[outcome], combined,
                                &workspace->mixture_accumulator[outcome])) {
            return false;
        }
        outcome++;
    }

    if (!uint64_multiply_checked(hit_categories.total, (uint64_t)PROBABILITY_SCALE,
                                 &total_weight)) {
        return false;
    }

    return probability_distribution_from_weights(workspace->mixture_accumulator, 0, maximum,
                                                 total_weight, result);
}

/*@ requires \valid_read(weapon) && \valid_read(plan);
    requires \valid(workspace) && \valid(result);
    assigns *workspace, *result;
*/
static bool build_single_attack_expected_damage(const struct weapon_profile *weapon,
                                                const struct attack_plan *plan,
                                                struct calculator_workspace *workspace,
                                                struct fraction *result) {
    struct roll_table hit_table;
    struct roll_categories hit_categories;
    struct fraction normal_mean;
    struct fraction critical_mean;
    struct fraction weighted_normal;
    struct fraction weighted_critical;
    struct fraction weight;
    bool lethal = false;
    bool auto_hits = false;

    if (weapon == NULL || plan == NULL || workspace == NULL || result == NULL) {
        return false;
    }

    if (!build_conditional_hit_exact_distribution(weapon, plan, false, &workspace->exact_a,
                                                  &workspace->exact_b) ||
        !distribution_mean(&workspace->exact_b, &normal_mean)) {
        return false;
    }

    auto_hits = (plan->flags & ATTACK_PLAN_AUTO_HITS) != 0;
    if (auto_hits) {
        *result = normal_mean;
        return true;
    }

    lethal = (plan->flags & ATTACK_PLAN_LETHAL_HITS) != 0;
    if (lethal) {
        if (!build_conditional_hit_exact_distribution(weapon, plan, true, &workspace->exact_a,
                                                      &workspace->exact_b) ||
            !distribution_mean(&workspace->exact_b, &critical_mean)) {
            return false;
        }
    } else {
        critical_mean = normal_mean;
    }

    if (plan->sustained_hits.dice_count != 0u || plan->sustained_hits.modifier != 0u) {
        struct fraction additional;

        if (!distribution_from_dice_value(plan->sustained_hits, &workspace->exact_a) ||
            !distribution_mean(&workspace->exact_a, &additional)) {
            return false;
        }

        if (!fraction_multiply(normal_mean, additional, &additional) ||
            !fraction_add(critical_mean, additional, &critical_mean)) {
            return false;
        }
    }

    if (!roll_table_build(plan->hit_reroll_mask, &hit_table)) {
        return false;
    }
    classify_attack_rolls(&hit_table, plan->hits_on, plan->critical_hits_on,
                          plan->hit_auto_fails_through, &hit_categories);

    weight.numerator = hit_categories.normal;
    weight.denominator = hit_categories.total;
    if (!fraction_multiply(normal_mean, weight, &weighted_normal)) {
        return false;
    }

    weight.numerator = hit_categories.critical;
    if (!fraction_multiply(critical_mean, weight, &weighted_critical)) {
        return false;
    }

    return fraction_add(weighted_normal, weighted_critical, result);
}

/*@ requires \valid_read(source) && \valid(workspace) && \valid(result);
    assigns *workspace, *result;
*/
static bool apply_feel_no_pain(const struct probability_distribution *source,
                               uint8_t feel_no_pain_on, struct calculator_workspace *workspace,
                               struct probability_distribution *result) {
    struct probability_distribution *one_point = NULL;
    struct probability_distribution *current = NULL;
    struct probability_distribution *next = NULL;
    uint8_t successful_faces = 0;
    uint8_t failed_faces = 0;
    uint32_t incoming_damage = 0;
    const uint64_t total_weight = (uint64_t)PROBABILITY_SCALE * (uint64_t)PROBABILITY_SCALE;

    if (source == NULL || workspace == NULL || result == NULL) {
        return false;
    }

    if (feel_no_pain_on == 0 || feel_no_pain_on > 6u) {
        if (result != source) {
            memcpy(result, source, sizeof(*result));
        }
        return true;
    }

    if (feel_no_pain_on < 2u) {
        return false;
    }

    successful_faces = (uint8_t)(7u - feel_no_pain_on);
    failed_faces = (uint8_t)(6u - successful_faces);

    distribution_clear(&workspace->exact_a);
    if (successful_faces != 0 &&
        !distribution_add_outcome(&workspace->exact_a, 0, successful_faces)) {
        return false;
    }
    if (failed_faces != 0 && !distribution_add_outcome(&workspace->exact_a, 1, failed_faces)) {
        return false;
    }

    one_point = &workspace->probability_a;
    current = &workspace->probability_c;
    next = &workspace->probability_d;

    if (!probability_distribution_from_exact(&workspace->exact_a, one_point) ||
        !probability_distribution_from_constant(0, current)) {
        return false;
    }

    memset(workspace->mixture_accumulator, 0, sizeof(workspace->mixture_accumulator));

    incoming_damage = 0;
    while (incoming_damage <= source->maximum) {
        uint32_t source_mass = source->mass[incoming_damage];

        if (source_mass != 0) {
            uint32_t suffered = current->minimum;

            while (suffered <= current->maximum) {
                if (current->mass[suffered] != 0) {
                    uint64_t product = (uint64_t)source_mass * (uint64_t)current->mass[suffered];

                    if (!uint64_add_checked(workspace->mixture_accumulator[suffered], product,
                                            &workspace->mixture_accumulator[suffered])) {
                        return false;
                    }
                }

                suffered++;
            }
        }

        if (incoming_damage < source->maximum) {
            struct probability_distribution *swap = NULL;

            if (!probability_distribution_convolve_internal(
                    current, one_point, workspace->convolution_accumulator, next)) {
                return false;
            }

            swap = current;
            current = next;
            next = swap;
        }

        incoming_damage++;
    }

    return probability_distribution_from_weights(workspace->mixture_accumulator, 0, source->maximum,
                                                 total_weight, result);
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_add_flags(struct attack_plan *plan, const struct weapon_profile *weapon,
                              const struct target_profile *target,
                              const union rule_payload *payload) {
    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL) {
        return false;
    }

    plan->flags |= payload->u32[0];
    return true;
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_set_wounds_on(struct attack_plan *plan, const struct weapon_profile *weapon,
                                  const struct target_profile *target,
                                  const union rule_payload *payload) {
    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL || payload->u8[0] < 2u || payload->u8[0] > 6u) {
        return false;
    }

    plan->wounds_on = payload->u8[0];
    return true;
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_set_critical_wounds_on(struct attack_plan *plan,
                                           const struct weapon_profile *weapon,
                                           const struct target_profile *target,
                                           const union rule_payload *payload) {
    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL || payload->u8[0] < 2u || payload->u8[0] > 6u) {
        return false;
    }

    plan->critical_wounds_on = payload->u8[0];
    return true;
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_or_hit_reroll_mask(struct attack_plan *plan,
                                       const struct weapon_profile *weapon,
                                       const struct target_profile *target,
                                       const union rule_payload *payload) {
    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL) {
        return false;
    }

    plan->hit_reroll_mask |= payload->u8[0] & VALID_D6_FACE_MASK;
    return true;
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_or_wound_reroll_mask(struct attack_plan *plan,
                                         const struct weapon_profile *weapon,
                                         const struct target_profile *target,
                                         const union rule_payload *payload) {
    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL) {
        return false;
    }

    plan->wound_reroll_mask |= payload->u8[0] & VALID_D6_FACE_MASK;
    return true;
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_hit_auto_fails_through(struct attack_plan *plan,
                                           const struct weapon_profile *weapon,
                                           const struct target_profile *target,
                                           const union rule_payload *payload) {
    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL || payload->u8[0] > 6u) {
        return false;
    }

    if (payload->u8[0] > plan->hit_auto_fails_through) {
        plan->hit_auto_fails_through = payload->u8[0];
    }
    return true;
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_set_sustained_hits(struct attack_plan *plan,
                                       const struct weapon_profile *weapon,
                                       const struct target_profile *target,
                                       const union rule_payload *payload) {
    (void)weapon;
    (void)target;

    struct dice_value additional_hits;

    if (plan == NULL || payload == NULL) {
        return false;
    }
    additional_hits = (struct dice_value){payload->u16[0], payload->u16[1], payload->u16[2]};
    if (!dice_value_is_valid(additional_hits) ||
        (additional_hits.dice_count == 0u && additional_hits.modifier == 0u)) {
        return false;
    }
    plan->sustained_hits = additional_hits;
    return true;
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_hit_modifier(struct attack_plan *plan, const struct weapon_profile *weapon,
                                 const struct target_profile *target,
                                 const union rule_payload *payload) {
    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL) {
        return false;
    }

    plan->hit_modifier += (int8_t)payload->u8[0];
    return true;
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_wound_modifier(struct attack_plan *plan, const struct weapon_profile *weapon,
                                   const struct target_profile *target,
                                   const union rule_payload *payload) {
    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL) {
        return false;
    }

    plan->wound_modifier += (int8_t)payload->u8[0];
    return true;
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_cover(struct attack_plan *plan, const struct weapon_profile *weapon,
                          const struct target_profile *target, const union rule_payload *payload) {
    (void)payload;

    if (plan == NULL || weapon == NULL || target == NULL) {
        return false;
    }

    plan->saves_on = saves_on_with_cover(target->save, target->invulnerable_save, weapon->ap);
    return true;
}

uint64_t greatest_common_divisor(uint64_t a, uint64_t b) {
    /*@ loop assigns a, b;
        loop variant b;
    */
    while (b != 0) {
        uint64_t remainder = a % b;
        a = b;
        b = remainder;
    }

    return a;
}

bool fraction_reduce(struct fraction *value) {
    uint64_t divisor = 0;

    if (value == NULL || value->denominator == 0) {
        return false;
    }

    if (value->numerator == 0) {
        value->denominator = 1;
        return true;
    }

    divisor = greatest_common_divisor(value->numerator, value->denominator);

    value->numerator /= divisor;
    value->denominator /= divisor;
    return true;
}

bool fraction_multiply(struct fraction left, struct fraction right, struct fraction *result) {
    uint64_t first_divisor = 0;
    uint64_t second_divisor = 0;
    uint64_t numerator = 0;
    uint64_t denominator = 0;

    if (result == NULL || left.denominator == 0 || right.denominator == 0) {
        return false;
    }

    first_divisor = greatest_common_divisor(left.numerator, right.denominator);
    left.numerator /= first_divisor;
    right.denominator /= first_divisor;

    second_divisor = greatest_common_divisor(right.numerator, left.denominator);
    right.numerator /= second_divisor;
    left.denominator /= second_divisor;

    if (!uint64_multiply_checked(left.numerator, right.numerator, &numerator) ||
        !uint64_multiply_checked(left.denominator, right.denominator, &denominator)) {
        return false;
    }

    result->numerator = numerator;
    result->denominator = denominator;
    return fraction_reduce(result);
}

bool fraction_add(struct fraction left, struct fraction right, struct fraction *result) {
    uint64_t common_divisor = 0;
    uint64_t left_multiplier = 0;
    uint64_t right_multiplier = 0;
    uint64_t left_term = 0;
    uint64_t right_term = 0;
    uint64_t numerator = 0;
    uint64_t denominator = 0;

    if (result == NULL || left.denominator == 0 || right.denominator == 0) {
        return false;
    }

    common_divisor = greatest_common_divisor(left.denominator, right.denominator);
    left_multiplier = right.denominator / common_divisor;
    right_multiplier = left.denominator / common_divisor;

    if (!uint64_multiply_checked(left.numerator, left_multiplier, &left_term) ||
        !uint64_multiply_checked(right.numerator, right_multiplier, &right_term) ||
        !uint64_add_checked(left_term, right_term, &numerator) ||
        !uint64_multiply_checked(left.denominator, left_multiplier, &denominator)) {
        return false;
    }

    result->numerator = numerator;
    result->denominator = denominator;
    return fraction_reduce(result);
}

bool dice_value_is_valid(struct dice_value dice) {
    uint64_t maximum = dice.modifier;

    if (dice.dice_count == 0) {
        return dice.dice_sides == 0 && dice.modifier <= MAX_DISTRIBUTION_RESULT;
    }

    if (dice.dice_sides == 0) {
        return false;
    }

    maximum += (uint64_t)dice.dice_count * dice.dice_sides;
    return maximum <= MAX_DISTRIBUTION_RESULT;
}

bool distribution_is_valid(const struct distribution *distribution) {
    uint64_t sum = 0;
    uint32_t outcome = 0;
    uint32_t first_nonzero = 0;
    uint32_t last_nonzero = 0;
    bool found = false;

    if (distribution == NULL || distribution->total_ways == 0 ||
        distribution->minimum > distribution->maximum ||
        distribution->maximum > MAX_DISTRIBUTION_RESULT) {
        return false;
    }

    outcome = 0;
    /*@ loop invariant 0 <= outcome && outcome <= MAX_DISTRIBUTION_RESULT + 1;
        loop assigns outcome, sum, first_nonzero, last_nonzero, found;
        loop variant MAX_DISTRIBUTION_RESULT + 1 - outcome;
    */
    while (outcome <= MAX_DISTRIBUTION_RESULT) {
        uint64_t ways = distribution->ways[outcome];

        if (ways != 0) {
            if (!found) {
                first_nonzero = outcome;
                found = true;
            }
            last_nonzero = outcome;

            if (!uint64_add_checked(sum, ways, &sum)) {
                return false;
            }
        }

        outcome++;
    }

    return found && first_nonzero == distribution->minimum &&
           last_nonzero == distribution->maximum && sum == distribution->total_ways;
}

void distribution_clear(struct distribution *distribution) {
    if (distribution == NULL) {
        return;
    }

    memset(distribution, 0, sizeof(*distribution));
}

bool distribution_add_outcome(struct distribution *distribution, uint32_t outcome, uint64_t ways) {
    bool was_empty = false;
    uint64_t new_outcome_ways = 0;
    uint64_t new_total_ways = 0;

    if (distribution == NULL || outcome > MAX_DISTRIBUTION_RESULT || ways == 0 ||
        !uint64_add_checked(distribution->ways[outcome], ways, &new_outcome_ways) ||
        !uint64_add_checked(distribution->total_ways, ways, &new_total_ways)) {
        return false;
    }

    was_empty = distribution->total_ways == 0;

    distribution->ways[outcome] = new_outcome_ways;
    distribution->total_ways = new_total_ways;

    if (was_empty) {
        distribution->minimum = outcome;
        distribution->maximum = outcome;
    } else {
        if (outcome < distribution->minimum) {
            distribution->minimum = outcome;
        }
        if (outcome > distribution->maximum) {
            distribution->maximum = outcome;
        }
    }

    return true;
}

bool distribution_reduce_weights(struct distribution *distribution) {
    uint64_t divisor = 0;
    uint32_t outcome = 0;

    if (distribution == NULL || distribution->total_ways == 0) {
        return false;
    }

    outcome = distribution->minimum;
    /*@ loop invariant distribution->minimum <= outcome &&
                       outcome <= distribution->maximum + 1;
        loop assigns outcome, divisor;
        loop variant distribution->maximum + 1 - outcome;
    */
    while (outcome <= distribution->maximum) {
        if (distribution->ways[outcome] != 0) {
            divisor = greatest_common_divisor(divisor, distribution->ways[outcome]);
        }
        outcome++;
    }

    if (divisor == 0) {
        return false;
    }

    if (divisor == 1) {
        return true;
    }

    outcome = distribution->minimum;
    /*@ loop invariant distribution->minimum <= outcome &&
                       outcome <= distribution->maximum + 1;
        loop assigns outcome, distribution->ways[distribution->minimum .. distribution->maximum];
        loop variant distribution->maximum + 1 - outcome;
    */
    while (outcome <= distribution->maximum) {
        distribution->ways[outcome] /= divisor;
        outcome++;
    }
    distribution->total_ways /= divisor;
    return true;
}

bool distribution_from_constant(uint32_t value, struct distribution *result) {
    if (result == NULL || value > MAX_DISTRIBUTION_RESULT) {
        return false;
    }

    distribution_clear(result);
    return distribution_add_outcome(result, value, 1);
}

bool distribution_from_die(uint16_t sides, struct distribution *result) {
    uint16_t face = 1;

    if (result == NULL || sides == 0 || sides > MAX_DISTRIBUTION_RESULT) {
        return false;
    }

    distribution_clear(result);

    /*@ loop invariant 1 <= face && face <= sides + 1;
        loop assigns face, *result;
        loop variant sides + 1 - face;
    */
    while (face <= sides) {
        if (!distribution_add_outcome(result, face, 1)) {
            distribution_clear(result);
            return false;
        }
        face++;
    }

    return true;
}

bool distribution_from_dice_value(struct dice_value dice, struct distribution *result) {
    struct distribution scratch;
    struct distribution *current = result;
    struct distribution *next = &scratch;
    uint16_t die = 0;

    if (result == NULL || !dice_value_is_valid(dice)) {
        return false;
    }

    if (!distribution_from_constant(dice.modifier, result)) {
        return false;
    }

    /*@ loop invariant 0 <= die && die <= dice.dice_count;
        loop assigns die, scratch, *result, current, next;
        loop variant dice.dice_count - die;
    */
    while (die < dice.dice_count) {
        struct distribution *swap = NULL;

        if (!distribution_add_uniform_die(current, dice.dice_sides, next)) {
            distribution_clear(result);
            return false;
        }

        swap = current;
        current = next;
        next = swap;
        die++;
    }

    if (current != result) {
        memcpy(result, current, sizeof(*result));
    }

    return true;
}

/*@ requires \valid(result);
    assigns *result;
*/
static bool distribution_from_modified_scaled_dice_value(struct dice_value dice,
                                                         uint16_t multiplier, int32_t modifier,
                                                         uint32_t minimum,
                                                         struct distribution *result) {
    struct distribution base;
    uint32_t outcome = 0u;

    if (result == NULL || multiplier == 0u || minimum > MAX_DISTRIBUTION_RESULT ||
        !distribution_from_dice_value(dice, &base)) {
        return false;
    }

    distribution_clear(result);
    outcome = base.minimum;
    /*@ loop invariant base.minimum <= outcome && outcome <= base.maximum + 1;
        loop assigns outcome, *result;
        loop variant base.maximum + 1 - outcome;
    */
    while (outcome <= base.maximum) {
        int64_t modified = (int64_t)outcome * multiplier + modifier;
        uint32_t mapped = minimum;

        if (modified > (int64_t)minimum) {
            if (modified > MAX_DISTRIBUTION_RESULT) {
                distribution_clear(result);
                return false;
            }
            mapped = (uint32_t)modified;
        }
        if (base.ways[outcome] != 0u &&
            !distribution_add_outcome(result, mapped, base.ways[outcome])) {
            distribution_clear(result);
            return false;
        }
        outcome++;
    }
    return distribution_reduce_weights(result);
}

/*@ requires \valid(result);
    assigns *result;
*/
static bool distribution_from_modified_scaled_dice_values_with_addition(
    struct dice_value dice, struct dice_value addition, uint16_t multiplier, int32_t modifier,
    uint32_t minimum, struct distribution *result) {
    struct distribution base;
    struct distribution extra;
    uint32_t outcome = 0u;

    if (result == NULL || multiplier == 0u || minimum > MAX_DISTRIBUTION_RESULT ||
        !distribution_from_dice_value(dice, &base) ||
        !distribution_from_dice_value(addition, &extra)) {
        return false;
    }

    distribution_clear(result);
    outcome = base.minimum;
    /*@ loop invariant base.minimum <= outcome && outcome <= base.maximum + 1;
        loop assigns outcome, *result;
        loop variant base.maximum + 1 - outcome;
    */
    while (outcome <= base.maximum) {
        uint32_t extra_outcome = extra.minimum;

        /*@ loop invariant extra.minimum <= extra_outcome &&
                           extra_outcome <= extra.maximum + 1;
            loop assigns extra_outcome, *result;
            loop variant extra.maximum + 1 - extra_outcome;
        */
        while (extra_outcome <= extra.maximum) {
            int64_t modified = (int64_t)outcome * multiplier + modifier + extra_outcome;
            uint32_t mapped = minimum;
            uint64_t combined_ways = 0u;

            if (modified > (int64_t)minimum) {
                if (modified > MAX_DISTRIBUTION_RESULT) {
                    distribution_clear(result);
                    return false;
                }
                mapped = (uint32_t)modified;
            }
            if (base.ways[outcome] != 0u && extra.ways[extra_outcome] != 0u &&
                (!uint64_multiply_checked(base.ways[outcome], extra.ways[extra_outcome],
                                          &combined_ways) ||
                 !distribution_add_outcome(result, mapped, combined_ways))) {
                distribution_clear(result);
                return false;
            }
            extra_outcome++;
        }
        outcome++;
    }
    return distribution_reduce_weights(result);
}

/*@ requires \valid(result);
    assigns *result;
*/
static bool distribution_from_modified_scaled_dice_values(struct dice_value dice,
                                                          struct dice_value addition,
                                                          uint16_t multiplier, int32_t modifier,
                                                          uint32_t minimum,
                                                          struct distribution *result) {
    if (addition.dice_count == 0u && addition.modifier == 0u) {
        return distribution_from_modified_scaled_dice_value(dice, multiplier, modifier, minimum,
                                                            result);
    }
    return distribution_from_modified_scaled_dice_values_with_addition(dice, addition, multiplier,
                                                                       modifier, minimum, result);
}

bool distribution_from_modified_dice_value(struct dice_value dice, int32_t modifier,
                                           uint32_t minimum, struct distribution *result) {
    return distribution_from_modified_scaled_dice_values(dice, (struct dice_value){0u, 0u, 0u}, 1u,
                                                         modifier, minimum, result);
}

/*@ requires \valid_read(weapon);
    assigns \nothing;
    ensures 1 <= \result;
*/
static uint16_t weapon_profile_count(const struct weapon_profile *weapon) {
    return weapon->weapon_count == 0u ? 1u : weapon->weapon_count;
}

/*@ assigns \nothing;
    ensures \result >= 1;
*/
static uint16_t characteristic_multiplier(uint16_t multiplier) {
    return multiplier == 0u ? 1u : multiplier;
}

/*@ requires \valid_read(weapon) && \valid(result);
    assigns *result;
*/
static bool distribution_from_weapon_attacks(const struct weapon_profile *weapon,
                                             struct distribution *result) {
    struct distribution per_weapon;
    struct distribution current;
    struct distribution next;
    struct dice_value attacks;
    uint16_t count = 0u;
    uint16_t repeat_count = 0u;

    if (weapon == NULL || result == NULL) {
        return false;
    }
    attacks = weapon->attacks_replacement == 0u
                  ? weapon->attacks
                  : (struct dice_value){0u, 0u, weapon->attacks_replacement};
    if (!distribution_from_modified_scaled_dice_values(
            attacks, weapon->attacks_addition,
            characteristic_multiplier(weapon->attacks_multiplier), weapon->attacks_modifier, 1u,
            &per_weapon) ||
        !distribution_from_constant(0u, &current)) {
        return false;
    }
    repeat_count = weapon_profile_count(weapon);
    /*@ loop invariant count <= repeat_count;
        loop assigns count, current, next;
        loop variant repeat_count - count;
    */
    while (count < repeat_count) {
        if (!distribution_convolve(&current, &per_weapon, &next)) {
            return false;
        }
        memcpy(&current, &next, sizeof(current));
        count++;
    }
    memcpy(result, &current, sizeof(*result));
    return true;
}

/*@ requires \valid_read(weapon) && \valid(result);
    assigns *result;
*/
static bool distribution_from_weapon_damage(const struct weapon_profile *weapon,
                                            struct distribution *result) {
    struct dice_value damage;

    if (weapon == NULL) {
        return false;
    }
    damage = weapon->damage_replacement_active
                 ? (struct dice_value){0u, 0u, weapon->damage_replacement}
                 : weapon->damage;
    return distribution_from_dice_value(damage, result);
}

/*@ requires \valid_read(weapon);
    assigns \nothing;
    ensures 1 <= \result;
*/
static uint16_t weapon_modified_strength(const struct weapon_profile *weapon) {
    uint16_t strength =
        weapon->strength_replacement == 0u ? weapon->strength : weapon->strength_replacement;
    int64_t modified = (int64_t)strength * characteristic_multiplier(weapon->strength_multiplier) +
                       weapon->strength_modifier;

    if (modified < 1) {
        return 1u;
    }
    return modified > UINT16_MAX ? UINT16_MAX : (uint16_t)modified;
}

bool weapon_profile_resolve_characteristic_roll(const struct weapon_profile *source,
                                                uint16_t outcome, struct weapon_profile *result) {
    uint32_t minimum = 0u;
    uint32_t maximum = 0u;
    int32_t adjusted = 0;

    if (source == NULL || result == NULL ||
        (source->characteristic_modifier_roll_flags &
         (uint8_t)~(CHARACTERISTIC_ROLL_ATTACKS | CHARACTERISTIC_ROLL_STRENGTH |
                    CHARACTERISTIC_ROLL_DAMAGE)) != 0u ||
        source->characteristic_modifier_roll_flags == 0u ||
        !dice_value_is_valid(source->characteristic_modifier_roll) ||
        source->characteristic_modifier_roll.dice_count == 0u) {
        return false;
    }
    minimum = (uint32_t)source->characteristic_modifier_roll.modifier +
              source->characteristic_modifier_roll.dice_count;
    maximum = (uint32_t)source->characteristic_modifier_roll.modifier +
              (uint32_t)source->characteristic_modifier_roll.dice_count *
                  source->characteristic_modifier_roll.dice_sides;
    if (outcome < minimum || outcome > maximum) {
        return false;
    }
    memcpy(result, source, sizeof(*result));
    if ((source->characteristic_modifier_roll_flags & CHARACTERISTIC_ROLL_ATTACKS) != 0u) {
        adjusted = (int32_t)result->attacks_modifier + outcome;
        if (adjusted > INT16_MAX) {
            return false;
        }
        result->attacks_modifier = (int16_t)adjusted;
    }
    if ((source->characteristic_modifier_roll_flags & CHARACTERISTIC_ROLL_STRENGTH) != 0u) {
        adjusted = (int32_t)result->strength_modifier + outcome;
        if (adjusted > INT16_MAX) {
            return false;
        }
        result->strength_modifier = (int16_t)adjusted;
    }
    if ((source->characteristic_modifier_roll_flags & CHARACTERISTIC_ROLL_DAMAGE) != 0u) {
        adjusted = (int32_t)result->damage_modifier + outcome;
        if (adjusted > INT16_MAX) {
            return false;
        }
        result->damage_modifier = (int16_t)adjusted;
    }
    result->characteristic_modifier_roll = (struct dice_value){0u, 0u, 0u};
    result->characteristic_modifier_roll_flags = 0u;
    result->characteristic_modifier_roll_group = 0u;
    return true;
}

bool distribution_convolve(const struct distribution *left, const struct distribution *right,
                           struct distribution *result) {
    struct distribution temporary;
    uint32_t left_outcome = 0;

    if (left == NULL || right == NULL || result == NULL || left->total_ways == 0 ||
        right->total_ways == 0 || left->maximum + right->maximum > MAX_DISTRIBUTION_RESULT) {
        return false;
    }

    distribution_clear(&temporary);

    left_outcome = left->minimum;
    /*@ loop invariant left->minimum <= left_outcome &&
                       left_outcome <= left->maximum + 1;
        loop assigns left_outcome, temporary;
        loop variant left->maximum + 1 - left_outcome;
    */
    while (left_outcome <= left->maximum) {
        uint32_t right_outcome = right->minimum;

        if (left->ways[left_outcome] != 0) {
            /*@ loop invariant right->minimum <= right_outcome &&
                               right_outcome <= right->maximum + 1;
                loop assigns right_outcome, temporary;
                loop variant right->maximum + 1 - right_outcome;
            */
            while (right_outcome <= right->maximum) {
                if (right->ways[right_outcome] != 0) {
                    uint64_t combined_ways = 0;

                    if (!uint64_multiply_checked(left->ways[left_outcome],
                                                 right->ways[right_outcome], &combined_ways) ||
                        !distribution_add_outcome(&temporary, left_outcome + right_outcome,
                                                  combined_ways)) {
                        return false;
                    }
                }

                right_outcome++;
            }
        }

        left_outcome++;
    }

    if (!distribution_reduce_weights(&temporary)) {
        return false;
    }

    memcpy(result, &temporary, sizeof(*result));
    return true;
}

bool distribution_shift(const struct distribution *source, uint32_t amount,
                        struct distribution *result) {
    struct distribution temporary;
    uint32_t outcome = 0;

    if (source == NULL || result == NULL || source->total_ways == 0 ||
        amount > MAX_DISTRIBUTION_RESULT || source->maximum > MAX_DISTRIBUTION_RESULT - amount) {
        return false;
    }

    distribution_clear(&temporary);
    outcome = source->minimum;

    /*@ loop invariant source->minimum <= outcome && outcome <= source->maximum + 1;
        loop assigns outcome, temporary;
        loop variant source->maximum + 1 - outcome;
    */
    while (outcome <= source->maximum) {
        if (source->ways[outcome] != 0 &&
            !distribution_add_outcome(&temporary, outcome + amount, source->ways[outcome])) {
            return false;
        }
        outcome++;
    }

    memcpy(result, &temporary, sizeof(*result));
    return true;
}

uint32_t distribution_minimum(const struct distribution *distribution) {
    if (distribution == NULL || distribution->total_ways == 0) {
        return 0;
    }

    return distribution->minimum;
}

uint32_t distribution_maximum(const struct distribution *distribution) {
    if (distribution == NULL || distribution->total_ways == 0) {
        return 0;
    }

    return distribution->maximum;
}

bool distribution_mean(const struct distribution *distribution, struct fraction *result) {
    uint64_t weighted_sum = 0;
    uint32_t outcome = 0;

    if (distribution == NULL || result == NULL || distribution->total_ways == 0) {
        return false;
    }

    outcome = distribution->minimum;
    while (outcome <= distribution->maximum) {
        if (distribution->ways[outcome] != 0) {
            uint64_t term = 0;

            if (!uint64_multiply_checked(outcome, distribution->ways[outcome], &term) ||
                !uint64_add_checked(weighted_sum, term, &weighted_sum)) {
                return false;
            }
        }
        outcome++;
    }

    result->numerator = weighted_sum;
    result->denominator = distribution->total_ways;
    return fraction_reduce(result);
}

bool distribution_quantile(const struct distribution *distribution, uint64_t quantile_numerator,
                           uint64_t quantile_denominator, uint32_t *result) {
    uint64_t required = 0;
    uint64_t cumulative = 0;
    uint32_t outcome = 0;

    if (distribution == NULL || result == NULL || distribution->total_ways == 0 ||
        !quantile_required_mass(distribution->total_ways, quantile_numerator, quantile_denominator,
                                &required)) {
        return false;
    }

    outcome = distribution->minimum;
    while (outcome <= distribution->maximum) {
        if (!uint64_add_checked(cumulative, distribution->ways[outcome], &cumulative)) {
            return false;
        }

        if (cumulative >= required) {
            *result = outcome;
            return true;
        }

        outcome++;
    }

    return false;
}

bool distribution_summarize(const struct distribution *distribution,
                            struct distribution_summary *summary) {
    if (distribution == NULL || summary == NULL || distribution->total_ways == 0) {
        return false;
    }

    summary->minimum = distribution->minimum;
    summary->maximum = distribution->maximum;

    return distribution_quantile(distribution, 1, 4, &summary->first_quartile) &&
           distribution_quantile(distribution, 1, 2, &summary->median) &&
           distribution_quantile(distribution, 3, 4, &summary->third_quartile) &&
           distribution_mean(distribution, &summary->mean);
}

void probability_distribution_clear(struct probability_distribution *distribution) {
    if (distribution == NULL) {
        return;
    }

    memset(distribution, 0, sizeof(*distribution));
}

bool probability_distribution_is_normalized(const struct probability_distribution *distribution) {
    uint64_t mass_sum = 0u;
    uint32_t outcome = 0u;

    if (distribution == NULL || distribution->minimum > distribution->maximum ||
        distribution->maximum > MAX_DISTRIBUTION_RESULT ||
        distribution->total_mass != PROBABILITY_SCALE) {
        return false;
    }

    /*@ loop invariant 0 <= outcome && outcome <= MAX_DISTRIBUTION_RESULT + 1;
        loop invariant mass_sum == whc_probability_mass_sum(distribution, outcome);
        loop invariant mass_sum <= (uint64_t)outcome * UINT32_MAX;
        loop invariant \forall integer index; 0 <= index < outcome ==>
            (index < distribution->minimum || index > distribution->maximum) ==>
                distribution->mass[index] == 0;
        loop assigns outcome, mass_sum;
        loop variant MAX_DISTRIBUTION_RESULT + 1 - outcome;
    */
    while (outcome <= MAX_DISTRIBUTION_RESULT) {
        if ((outcome < distribution->minimum || outcome > distribution->maximum) &&
            distribution->mass[outcome] != 0u) {
            return false;
        }
        /*@ assert whc_probability_mass_sum(distribution, outcome + 1) ==
                       whc_probability_mass_sum(distribution, outcome) +
                           distribution->mass[outcome];
        */
        mass_sum += distribution->mass[outcome];
        outcome++;
    }

    return mass_sum == PROBABILITY_SCALE;
}

bool probability_distribution_from_exact(const struct distribution *source,
                                         struct probability_distribution *result) {
    if (source == NULL || result == NULL || source->total_ways == 0) {
        return false;
    }

    return probability_distribution_from_weights(source->ways, source->minimum, source->maximum,
                                                 source->total_ways, result);
}

bool probability_distribution_mean(const struct probability_distribution *distribution,
                                   struct fraction *result) {
    uint64_t weighted_sum = 0;
    uint32_t outcome = 0;

    if (distribution == NULL || result == NULL ||
        !probability_distribution_is_normalized(distribution)) {
        return false;
    }

    outcome = distribution->minimum;
    while (outcome <= distribution->maximum) {
        uint64_t term = (uint64_t)outcome * (uint64_t)distribution->mass[outcome];

        if (!uint64_add_checked(weighted_sum, term, &weighted_sum)) {
            return false;
        }
        outcome++;
    }

    result->numerator = weighted_sum;
    result->denominator = distribution->total_mass;
    return fraction_reduce(result);
}

bool probability_distribution_quantile(const struct probability_distribution *distribution,
                                       uint64_t quantile_numerator, uint64_t quantile_denominator,
                                       uint32_t *result) {
    uint64_t required = 0;
    uint64_t cumulative = 0;
    uint32_t outcome = 0;

    if (distribution == NULL || result == NULL ||
        !probability_distribution_is_normalized(distribution) ||
        !quantile_required_mass(distribution->total_mass, quantile_numerator, quantile_denominator,
                                &required)) {
        return false;
    }

    outcome = distribution->minimum;
    while (outcome <= distribution->maximum) {
        cumulative += distribution->mass[outcome];

        if (cumulative >= required) {
            *result = outcome;
            return true;
        }

        outcome++;
    }

    return false;
}

bool probability_distribution_summarize(const struct probability_distribution *distribution,
                                        struct distribution_summary *summary) {
    if (distribution == NULL || summary == NULL ||
        !probability_distribution_is_normalized(distribution)) {
        return false;
    }

    summary->minimum = distribution->minimum;
    summary->maximum = distribution->maximum;

    return probability_distribution_quantile(distribution, 1, 4, &summary->first_quartile) &&
           probability_distribution_quantile(distribution, 1, 2, &summary->median) &&
           probability_distribution_quantile(distribution, 3, 4, &summary->third_quartile) &&
           probability_distribution_mean(distribution, &summary->mean);
}

void rule_set_clear(struct rule_set *rules) {
    if (rules == NULL) {
        return;
    }

    memset(rules, 0, sizeof(*rules));
}

bool rule_set_add(struct rule_set *rules, attack_rule_compile_function compile,
                  union rule_payload payload) {
    struct rule_entry *entry = NULL;

    if (rules == NULL || compile == NULL || rules->count >= MAX_PROFILE_RULES) {
        return false;
    }

    entry = &rules->entries[rules->count];
    entry->compile = compile;
    entry->payload = payload;
    rules->count++;
    return true;
}

bool rule_add_lethal_hits(struct rule_set *rules) {
    union rule_payload payload = {0};
    payload.u32[0] = ATTACK_PLAN_LETHAL_HITS;
    return rule_set_add(rules, compile_add_flags, payload);
}

bool rule_add_devastating_wounds(struct rule_set *rules) {
    union rule_payload payload = {0};
    payload.u32[0] = ATTACK_PLAN_CRITICAL_WOUNDS_BYPASS_SAVE;
    return rule_set_add(rules, compile_add_flags, payload);
}

bool rule_add_twin_linked(struct rule_set *rules) {
    union rule_payload payload = {0};
    payload.u32[0] = ATTACK_PLAN_REROLL_FAILED_WOUNDS;
    return rule_set_add(rules, compile_add_flags, payload);
}

bool rule_add_reroll_failed_hits(struct rule_set *rules) {
    union rule_payload payload = {0};
    payload.u32[0] = ATTACK_PLAN_REROLL_FAILED_HITS;
    return rule_set_add(rules, compile_add_flags, payload);
}

bool rule_add_reroll_failed_wounds(struct rule_set *rules) {
    union rule_payload payload = {0};
    payload.u32[0] = ATTACK_PLAN_REROLL_FAILED_WOUNDS;
    return rule_set_add(rules, compile_add_flags, payload);
}

bool rule_add_wounds_on(struct rule_set *rules, uint8_t target) {
    union rule_payload payload = {0};
    payload.u8[0] = target;
    return rule_set_add(rules, compile_set_wounds_on, payload);
}

bool rule_add_critical_wounds_on(struct rule_set *rules, uint8_t target) {
    union rule_payload payload = {0};
    payload.u8[0] = target;
    return rule_set_add(rules, compile_set_critical_wounds_on, payload);
}

bool rule_add_hit_reroll_mask(struct rule_set *rules, uint8_t face_mask) {
    union rule_payload payload = {0};
    payload.u8[0] = face_mask & VALID_D6_FACE_MASK;
    return rule_set_add(rules, compile_or_hit_reroll_mask, payload);
}

bool rule_add_wound_reroll_mask(struct rule_set *rules, uint8_t face_mask) {
    union rule_payload payload = {0};
    payload.u8[0] = face_mask & VALID_D6_FACE_MASK;
    return rule_set_add(rules, compile_or_wound_reroll_mask, payload);
}

bool rule_add_hit_auto_fails_through(struct rule_set *rules, uint8_t face) {
    union rule_payload payload = {0};

    if (face > 6u) {
        return false;
    }
    payload.u8[0] = face;
    return rule_set_add(rules, compile_hit_auto_fails_through, payload);
}

bool rule_add_sustained_hits(struct rule_set *rules, uint8_t additional_hits) {
    return rule_add_sustained_hits_dice(rules,
                                        (struct dice_value){0u, 0u, (uint16_t)additional_hits});
}

bool rule_add_sustained_hits_dice(struct rule_set *rules, struct dice_value additional_hits) {
    union rule_payload payload = {0};

    if (!dice_value_is_valid(additional_hits) ||
        (additional_hits.dice_count == 0u && additional_hits.modifier == 0u)) {
        return false;
    }

    payload.u16[0] = additional_hits.dice_count;
    payload.u16[1] = additional_hits.dice_sides;
    payload.u16[2] = additional_hits.modifier;
    return rule_set_add(rules, compile_set_sustained_hits, payload);
}

bool rule_add_torrent(struct rule_set *rules) {
    union rule_payload payload = {0};
    payload.u32[0] = ATTACK_PLAN_AUTO_HITS;
    return rule_set_add(rules, compile_add_flags, payload);
}

bool rule_add_hit_modifier(struct rule_set *rules, int8_t modifier) {
    union rule_payload payload = {0};

    if (modifier == 0) {
        return false;
    }
    payload.u8[0] = (uint8_t)modifier;
    return rule_set_add(rules, compile_hit_modifier, payload);
}

bool rule_add_wound_modifier(struct rule_set *rules, int8_t modifier) {
    union rule_payload payload = {0};

    if (modifier == 0) {
        return false;
    }
    payload.u8[0] = (uint8_t)modifier;
    return rule_set_add(rules, compile_wound_modifier, payload);
}

bool rule_add_wound_bonus(struct rule_set *rules, uint8_t bonus) {
    if (bonus == 0u || bonus > 5u) {
        return false;
    }
    return rule_add_wound_modifier(rules, (int8_t)bonus);
}

bool rule_add_cover(struct rule_set *rules) {
    union rule_payload payload = {0};
    return rule_set_add(rules, compile_cover, payload);
}

bool attack_plan_add_damage_transform(struct attack_plan *plan, damage_transform_function transform,
                                      union rule_payload payload) {
    struct damage_transform_entry *entry = NULL;

    if (plan == NULL || transform == NULL ||
        plan->damage_transform_count >= MAX_DAMAGE_TRANSFORMS) {
        return false;
    }

    entry = &plan->damage_transforms[plan->damage_transform_count];
    entry->apply = transform;
    entry->payload = payload;
    plan->damage_transform_count++;
    return true;
}

bool attack_plan_is_valid(const struct attack_plan *plan) {
    uint8_t transform_index = 0u;
    uint32_t allowed_flags =
        (uint32_t)ATTACK_PLAN_LETHAL_HITS | (uint32_t)ATTACK_PLAN_CRITICAL_WOUNDS_BYPASS_SAVE |
        (uint32_t)ATTACK_PLAN_REROLL_FAILED_HITS | (uint32_t)ATTACK_PLAN_REROLL_FAILED_WOUNDS |
        (uint32_t)ATTACK_PLAN_REROLL_FAILED_SAVES | (uint32_t)ATTACK_PLAN_AUTO_HITS;

    if (plan == NULL || plan->hits_on < 2u || plan->hits_on > 6u || plan->wounds_on < 2u ||
        plan->wounds_on > 6u || plan->saves_on < 2u || plan->saves_on > 7u ||
        plan->critical_hits_on < 2u || plan->critical_hits_on > 6u ||
        plan->critical_wounds_on < 2u || plan->critical_wounds_on > 6u ||
        (plan->feel_no_pain_on != 0u &&
         (plan->feel_no_pain_on < 2u || plan->feel_no_pain_on > 6u)) ||
        plan->hit_auto_fails_through > 6u ||
        (plan->hit_reroll_mask & (uint8_t)~VALID_D6_FACE_MASK) != 0u ||
        (plan->wound_reroll_mask & (uint8_t)~VALID_D6_FACE_MASK) != 0u ||
        (plan->save_reroll_mask & (uint8_t)~VALID_D6_FACE_MASK) != 0u ||
        !dice_value_is_valid(plan->sustained_hits) || plan->damage_divisor == 0u ||
        plan->damage_multiplier == 0u || plan->damage_floor > 1u ||
        (plan->flags & ~allowed_flags) != 0u ||
        plan->damage_transform_count > MAX_DAMAGE_TRANSFORMS) {
        return false;
    }

    /*@ loop invariant 0 <= transform_index && transform_index <= plan->damage_transform_count;
        loop invariant \forall integer index; 0 <= index < transform_index ==>
            plan->damage_transforms[index].apply != \null;
        loop assigns transform_index;
        loop variant plan->damage_transform_count - transform_index;
    */
    while (transform_index < plan->damage_transform_count) {
        if (plan->damage_transforms[transform_index].apply == NULL) {
            return false;
        }
        transform_index++;
    }
    /*@ assert 2 <= plan->hits_on && plan->hits_on <= 6; */
    /*@ assert 2 <= plan->wounds_on && plan->wounds_on <= 6; */
    /*@ assert 2 <= plan->saves_on && plan->saves_on <= 7; */
    /*@ assert 2 <= plan->critical_hits_on && plan->critical_hits_on <= 6; */
    /*@ assert 2 <= plan->critical_wounds_on && plan->critical_wounds_on <= 6; */
    /*@ assert plan->feel_no_pain_on == 0 ||
               (2 <= plan->feel_no_pain_on && plan->feel_no_pain_on <= 6); */
    /*@ assert plan->hit_auto_fails_through <= 6; */
    /*@ assert (plan->hit_reroll_mask & 0x81) == 0; */
    /*@ assert (plan->wound_reroll_mask & 0x81) == 0; */
    /*@ assert (plan->save_reroll_mask & 0x81) == 0; */
    /*@ assert whc_valid_dice_value(plan->sustained_hits); */
    /*@ assert plan->damage_divisor > 0 && plan->damage_multiplier > 0 &&
               plan->damage_floor <= 1; */
    /*@ assert (plan->flags & ~0x3f) == 0; */
    /*@ assert plan->damage_transform_count <= MAX_DAMAGE_TRANSFORMS; */
    /*@ assert \forall integer index; 0 <= index < plan->damage_transform_count ==>
            plan->damage_transforms[index].apply != \null; */
    /*@ assert \valid_read(plan); */
    return true;
}

bool attack_plan_build(const struct weapon_profile *weapon, const struct target_profile *target,
                       struct attack_plan *plan) {
    uint8_t rule_index = 0;

    if (weapon == NULL || target == NULL || plan == NULL || !dice_value_is_valid(weapon->attacks) ||
        !dice_value_is_valid(weapon->attacks_addition) || !dice_value_is_valid(weapon->damage) ||
        weapon->characteristic_modifier_roll_flags != 0u ||
        weapon->characteristic_modifier_roll_group != 0u ||
        weapon->characteristic_modifier_roll.dice_count != 0u ||
        weapon->characteristic_modifier_roll.dice_sides != 0u ||
        weapon->characteristic_modifier_roll.modifier != 0u || weapon->hits_on < 2u ||
        weapon->hits_on > 6u || weapon->strength == 0 || target->toughness == 0 ||
        target->save < 2u || target->save > 7u ||
        (target->invulnerable_save != 0 &&
         (target->invulnerable_save < 2u || target->invulnerable_save > 6u)) ||
        (target->feel_no_pain != 0 && (target->feel_no_pain < 2u || target->feel_no_pain > 6u)) ||
        (weapon->hit_reroll_mask & (uint8_t)~VALID_D6_FACE_MASK) != 0u ||
        (weapon->wound_reroll_mask & (uint8_t)~VALID_D6_FACE_MASK) != 0u ||
        weapon->rules.count > MAX_PROFILE_RULES || target->rules.count > MAX_PROFILE_RULES) {
        return false;
    }

    memset(plan, 0, sizeof(*plan));
    plan->hits_on = weapon->hits_on;
    plan->wounds_on = wounds_on(weapon_modified_strength(weapon), target->toughness);
    plan->saves_on = saves_on(target->save, target->invulnerable_save, weapon->ap);
    plan->critical_hits_on = weapon->critical_hits_on == 0 ? 6u : weapon->critical_hits_on;
    plan->critical_wounds_on = 6u;
    plan->feel_no_pain_on = target->feel_no_pain;
    plan->damage_modifier = (int32_t)weapon->damage_modifier - target->reduction;
    plan->damage_divisor = target->damage_divisor == 0u ? 1u : target->damage_divisor;
    plan->damage_multiplier = characteristic_multiplier(weapon->damage_multiplier);
    plan->damage_floor =
        (uint16_t)(weapon->damage_replacement_active && weapon->damage_replacement == 0u ? 0u : 1u);
    plan->hit_modifier = weapon->hit_modifier;
    plan->wound_modifier = weapon->wound_modifier;
    plan->hit_reroll_mask = weapon->hit_reroll_mask & VALID_D6_FACE_MASK;
    plan->wound_reroll_mask = weapon->wound_reroll_mask & VALID_D6_FACE_MASK;

    rule_index = 0;
    /*@ loop invariant 0 <= rule_index && rule_index <= weapon->rules.count;
        loop assigns rule_index, *plan;
        loop variant weapon->rules.count - rule_index;
    */
    while (rule_index < weapon->rules.count) {
        const struct rule_entry *entry = &weapon->rules.entries[rule_index];

        if (entry->compile == NULL || !entry->compile(plan, weapon, target, &entry->payload)) {
            return false;
        }
        rule_index++;
    }

    rule_index = 0;
    /*@ loop invariant 0 <= rule_index && rule_index <= target->rules.count;
        loop assigns rule_index, *plan;
        loop variant target->rules.count - rule_index;
    */
    while (rule_index < target->rules.count) {
        const struct rule_entry *entry = &target->rules.entries[rule_index];

        if (entry->compile == NULL || !entry->compile(plan, weapon, target, &entry->payload)) {
            return false;
        }
        rule_index++;
    }

    plan->hits_on = modified_roll_threshold(plan->hits_on, plan->hit_modifier);
    plan->wounds_on = modified_roll_threshold(plan->wounds_on, plan->wound_modifier);

    if (plan->hits_on < 2u || plan->hits_on > 6u || plan->wounds_on < 2u || plan->wounds_on > 6u ||
        plan->saves_on < 2u || plan->saves_on > 7u || plan->critical_hits_on < 2u ||
        plan->critical_hits_on > 6u || plan->critical_wounds_on < 2u ||
        plan->critical_wounds_on > 6u || plan->hit_auto_fails_through > 6u ||
        (plan->feel_no_pain_on != 0 &&
         (plan->feel_no_pain_on < 2u || plan->feel_no_pain_on > 6u))) {
        return false;
    }

    if ((plan->flags & ATTACK_PLAN_REROLL_FAILED_HITS) != 0) {
        plan->hit_reroll_mask |=
            failed_roll_mask(plan->hits_on, plan->critical_hits_on, plan->hit_auto_fails_through);
    }

    if ((plan->flags & ATTACK_PLAN_REROLL_FAILED_WOUNDS) != 0) {
        plan->wound_reroll_mask |= failed_roll_mask(plan->wounds_on, plan->critical_wounds_on, 0u);
    }

    if ((plan->flags & ATTACK_PLAN_REROLL_FAILED_SAVES) != 0) {
        plan->save_reroll_mask |= failed_roll_mask(plan->saves_on, 0u, 0u);
    }

    plan->hit_reroll_mask &= VALID_D6_FACE_MASK;
    plan->wound_reroll_mask &= VALID_D6_FACE_MASK;
    plan->save_reroll_mask &= VALID_D6_FACE_MASK;
    return attack_plan_is_valid(plan);
}

uint8_t wounds_on(uint16_t strength, uint16_t toughness) {
    uint32_t strength_wide = strength;
    uint32_t toughness_wide = toughness;

    return (strength_wide >= toughness_wide * 2u)   ? 2u
           : (strength_wide > toughness_wide)       ? 3u
           : (strength_wide == toughness_wide)      ? 4u
           : (toughness_wide >= strength_wide * 2u) ? 6u
                                                    : 5u;
}

uint8_t modified_roll_threshold(uint8_t succeeds_on, int16_t modifier) {
    int16_t capped_modifier = modifier;
    int16_t modified = succeeds_on;

    if (succeeds_on < 2u || succeeds_on > 6u) {
        return succeeds_on;
    }
    if (capped_modifier > 1) {
        capped_modifier = 1;
    } else if (capped_modifier < -1) {
        capped_modifier = -1;
    }
    modified -= capped_modifier;
    if (modified < 2) {
        return 2u;
    }
    if (modified > 6) {
        return 6u;
    }
    return (uint8_t)modified;
}

uint8_t saves_on(uint8_t save, uint8_t invulnerable_save, uint16_t ap) {
    uint32_t modified_save = (uint32_t)save + ap;
    uint32_t best_save = modified_save;

    if (invulnerable_save != 0 && invulnerable_save < best_save) {
        best_save = invulnerable_save;
    }

    if (best_save > 7u) {
        return 7u;
    }

    return (uint8_t)best_save;
}

uint8_t saves_on_with_cover(uint8_t save, uint8_t invulnerable_save, uint16_t ap) {
    uint32_t armour_save = (uint32_t)save + ap;
    uint32_t best_save = 0;

    if (!(ap == 0u && save <= 3u) && armour_save > 2u) {
        armour_save--;
    }

    best_save = armour_save;
    if (invulnerable_save != 0u && invulnerable_save < best_save) {
        best_save = invulnerable_save;
    }

    return best_save > 7u ? 7u : (uint8_t)best_save;
}

uint32_t allocate_damage_to_unit(uint32_t applied_damage, uint32_t incoming_damage,
                                 uint16_t wounds_per_model, uint16_t model_count) {
    uint64_t capacity = (uint64_t)wounds_per_model * model_count;
    uint32_t wounds_on_current = 0;
    uint32_t remaining = 0;
    uint32_t unit_remaining = 0;
    uint32_t allocated = 0;

    if (wounds_per_model == 0u || model_count == 0u || applied_damage >= capacity) {
        return capacity > UINT32_MAX ? applied_damage : (uint32_t)capacity;
    }

    wounds_on_current = applied_damage % wounds_per_model;
    remaining = (uint32_t)wounds_per_model - wounds_on_current;
    unit_remaining = (uint32_t)capacity - applied_damage;
    if (remaining > unit_remaining) {
        remaining = unit_remaining;
    }
    allocated = incoming_damage < remaining ? incoming_damage : remaining;
    return applied_damage + allocated;
}

uint32_t target_unit_capacity(const struct target_unit_layout *layout) {
    uint32_t capacity = 0u;
    uint16_t index = 0u;

    if (layout == NULL || layout->segment_count == 0u ||
        layout->segment_count > MAX_TARGET_SEGMENTS) {
        return 0u;
    }

    while (index < layout->segment_count) {
        uint32_t segment_capacity =
            (uint32_t)layout->wounds_per_model[index] * layout->model_counts[index];
        if (layout->wounds_per_model[index] == 0u || layout->model_counts[index] == 0u ||
            segment_capacity > MAX_DISTRIBUTION_RESULT - capacity) {
            return 0u;
        }
        capacity += segment_capacity;
        index++;
    }

    if (layout->initial_wounds_lost >= layout->wounds_per_model[0]) {
        return 0u;
    }
    return capacity;
}

/*@ requires whc_valid_target_unit_layout(layout);
    requires capacity == whc_target_capacity(layout);
    requires applied_damage < capacity;
    requires \valid(segment_index) && \valid(wounds_remaining);
    assigns *segment_index, *wounds_remaining;
    ensures \result ==> *segment_index < layout->segment_count;
    ensures \result ==> 1 <= *wounds_remaining;
*/
static bool target_unit_position_with_capacity(const struct target_unit_layout *layout,
                                               uint32_t capacity, uint32_t applied_damage,
                                               uint16_t *segment_index,
                                               uint16_t *wounds_remaining) {
    uint32_t offset = 0u;
    uint16_t index = 0u;

    if (layout == NULL || segment_index == NULL || wounds_remaining == NULL || capacity == 0u ||
        applied_damage >= capacity) {
        return false;
    }

    while (index < layout->segment_count) {
        uint32_t segment_capacity =
            (uint32_t)layout->wounds_per_model[index] * layout->model_counts[index];
        if (applied_damage < offset + segment_capacity) {
            uint32_t within_model = (applied_damage - offset) % layout->wounds_per_model[index];
            *segment_index = index;
            *wounds_remaining = (uint16_t)(layout->wounds_per_model[index] - within_model);
            return true;
        }
        offset += segment_capacity;
        index++;
    }
    return false;
}

/*@ requires whc_valid_target_unit_layout(layout);
    requires applied_damage < whc_target_capacity(layout);
    requires \valid(segment_index) && \valid(wounds_remaining);
    assigns *segment_index, *wounds_remaining;
    ensures \result ==> *segment_index < layout->segment_count;
    ensures \result ==> 1 <= *wounds_remaining;
*/
static bool target_unit_position(const struct target_unit_layout *layout, uint32_t applied_damage,
                                 uint16_t *segment_index, uint16_t *wounds_remaining) {
    uint32_t capacity = target_unit_capacity(layout);
    return target_unit_position_with_capacity(layout, capacity, applied_damage, segment_index,
                                              wounds_remaining);
}

uint32_t allocate_damage_to_target_unit(const struct target_unit_layout *layout,
                                        uint32_t applied_damage, uint32_t incoming_damage) {
    uint32_t capacity = target_unit_capacity(layout);
    uint16_t segment_index = 0u;
    uint16_t wounds_remaining = 0u;
    uint32_t allocated = 0u;

    if (capacity == 0u || applied_damage >= capacity) {
        return capacity == 0u ? applied_damage : capacity;
    }
    if (!target_unit_position(layout, applied_damage, &segment_index, &wounds_remaining)) {
        return applied_damage;
    }
    (void)segment_index;
    allocated = incoming_damage < wounds_remaining ? incoming_damage : wounds_remaining;
    return applied_damage + allocated;
}

/*@ requires \valid_read(current);
    requires \valid_read(incoming + (0 .. layout->segment_count - 1));
    requires whc_valid_target_unit_layout(layout);
    requires \valid(accumulator + (0 .. MAX_DISTRIBUTION_RESULT));
    requires \valid(result);
    assigns accumulator[0 .. MAX_DISTRIBUTION_RESULT], *result;
    ensures \result ==> whc_normalized_probability_distribution(result);
*/
static bool probability_distribution_allocate_mixed_attack_internal(
    const struct probability_distribution *current, const struct probability_distribution *incoming,
    const struct target_unit_layout *layout, uint64_t *accumulator,
    struct probability_distribution *result) {
    uint32_t applied = 0u;
    uint32_t maximum = 0u;
    uint32_t capacity = target_unit_capacity(layout);
    const uint64_t total_weight = (uint64_t)PROBABILITY_SCALE * PROBABILITY_SCALE;

    if (current == NULL || incoming == NULL || layout == NULL || accumulator == NULL ||
        result == NULL || capacity == 0u || current->total_mass != PROBABILITY_SCALE ||
        current->minimum > current->maximum || current->maximum > capacity) {
        return false;
    }
    memset(accumulator, 0, sizeof(uint64_t) * (MAX_DISTRIBUTION_RESULT + 1u));

    applied = current->minimum;
    while (applied <= current->maximum) {
        uint32_t current_mass = current->mass[applied];
        if (current_mass != 0u && applied == capacity) {
            uint64_t product = (uint64_t)current_mass * PROBABILITY_SCALE;
            if (!uint64_add_checked(accumulator[capacity], product, &accumulator[capacity])) {
                return false;
            }
            maximum = capacity;
        } else if (current_mass != 0u) {
            uint16_t segment_index = 0u;
            uint16_t wounds_remaining = 0u;
            uint32_t damage = 0u;
            const struct probability_distribution *attack = NULL;

            if (!target_unit_position_with_capacity(layout, capacity, applied, &segment_index,
                                                    &wounds_remaining)) {
                return false;
            }
            attack = &incoming[segment_index];
            if (attack->total_mass != PROBABILITY_SCALE || attack->minimum > attack->maximum) {
                return false;
            }
            damage = attack->minimum;
            while (damage <= attack->maximum) {
                if (attack->mass[damage] != 0u) {
                    uint32_t allocated = damage < wounds_remaining ? damage : wounds_remaining;
                    uint32_t next = applied + allocated;
                    uint64_t product = (uint64_t)current_mass * attack->mass[damage];
                    if (!uint64_add_checked(accumulator[next], product, &accumulator[next])) {
                        return false;
                    }
                    if (next > maximum) {
                        maximum = next;
                    }
                }
                damage++;
            }
        }
        applied++;
    }

    return probability_distribution_from_weights(accumulator, 0u, maximum, total_weight, result);
}

/*@ requires \valid_read(state);
    assigns \nothing;
*/
static uint32_t deferred_state_hash(const struct deferred_volley_state *state, size_t state_size) {
    const uint8_t *bytes = (const uint8_t *)state;
    uint32_t hash = UINT32_C(2166136261);
    size_t index = 0u;

    while (index < state_size) {
        hash ^= bytes[index];
        hash *= UINT32_C(16777619);
        index++;
    }
    return hash;
}

/*@ requires \valid(table);
    requires 1 <= weapon_count <= MAX_VOLLEY_WEAPONS;
    assigns *table;
*/
static bool deferred_state_table_create(struct deferred_state_table *table, uint16_t weapon_count) {
    if (table == NULL) {
        return false;
    }
    memset(table, 0, sizeof(*table));
    table->entries = calloc(DEFERRED_STATE_TABLE_CAPACITY, sizeof(*table->entries));
    table->slots = calloc(DEFERRED_STATE_LIMIT, sizeof(*table->slots));
    if (table->entries == NULL || table->slots == NULL) {
        free(table->entries);
        free(table->slots);
        memset(table, 0, sizeof(*table));
        return false;
    }
    table->generation = 1u;
    table->state_size =
        offsetof(struct deferred_volley_state, devastating_wounds) +
        (size_t)weapon_count * sizeof(table->entries[0].state.devastating_wounds[0]);
    return true;
}

/*@ requires \valid(table);
    assigns *table;
*/
static void deferred_state_table_destroy(struct deferred_state_table *table) {
    if (table != NULL) {
        free(table->entries);
        free(table->slots);
        memset(table, 0, sizeof(*table));
    }
}

/*@ requires \valid(table) && table->entries != \null;
    assigns *table, table->entries[0 .. DEFERRED_STATE_TABLE_CAPACITY - 1];
*/
static void deferred_state_table_reset(struct deferred_state_table *table) {
    table->count = 0u;
    table->generation++;
    if (table->generation == 0u) {
        memset(table->entries, 0, sizeof(*table->entries) * (size_t)DEFERRED_STATE_TABLE_CAPACITY);
        table->generation = 1u;
    }
}

/*@ requires \valid(table) && table->entries != \null && \valid_read(state);
    assigns table->entries[0 .. DEFERRED_STATE_TABLE_CAPACITY - 1], table->count,
            table->peak_count;
*/
static bool deferred_state_table_add_weight(struct deferred_state_table *table,
                                            const struct deferred_volley_state *state,
                                            uint64_t weight) {
    uint32_t slot = 0u;
    uint32_t probes = 0u;

    if (weight == 0u) {
        return true;
    }
    slot = deferred_state_hash(state, table->state_size) % DEFERRED_STATE_TABLE_CAPACITY;
    while (probes < DEFERRED_STATE_TABLE_CAPACITY) {
        struct deferred_state_entry *entry = &table->entries[slot];
        if (entry->generation != table->generation) {
            if (table->count >= DEFERRED_STATE_LIMIT) {
                return false;
            }
            entry->state = *state;
            entry->weight = weight;
            entry->mass = 0u;
            entry->generation = table->generation;
            table->slots[table->count] = slot;
            table->count++;
            if (table->count > table->peak_count) {
                table->peak_count = table->count;
            }
            return true;
        }
        if (memcmp(&entry->state, state, table->state_size) == 0) {
            return uint64_add_checked(entry->weight, weight, &entry->weight);
        }
        slot++;
        if (slot == DEFERRED_STATE_TABLE_CAPACITY) {
            slot = 0u;
        }
        probes++;
    }
    return false;
}

/*@ requires \valid(table) && table->entries != \null;
    assigns table->entries[0 .. DEFERRED_STATE_TABLE_CAPACITY - 1];
*/
static bool deferred_state_table_normalize(struct deferred_state_table *table) {
    uint64_t total_weight = 0u;
    uint64_t cumulative = 0u;
    uint32_t previous_mass = 0u;
    uint32_t index = 0u;
    uint32_t retained = 0u;
    uint32_t original_count = table->count;

    while (index < original_count) {
        struct deferred_state_entry *entry = &table->entries[table->slots[index]];
        if (!uint64_add_checked(total_weight, entry->weight, &total_weight)) {
            return false;
        }
        index++;
    }
    if (total_weight == 0u) {
        return false;
    }
    index = 0u;
    while (index < original_count) {
        uint32_t slot = table->slots[index];
        struct deferred_state_entry *entry = &table->entries[slot];
        uint32_t scaled = 0u;
        if (!uint64_add_checked(cumulative, entry->weight, &cumulative)) {
            return false;
        }
        scaled = ratio_to_probability_mass(cumulative, total_weight);
        entry->mass = scaled - previous_mass;
        entry->weight = 0u;
        previous_mass = scaled;
        if (entry->mass != 0u) {
            table->slots[retained] = slot;
            retained++;
        }
        index++;
    }
    table->count = retained;
    return cumulative == total_weight && previous_mass == PROBABILITY_SCALE;
}

/*@ requires \valid(destination) && destination->entries != \null;
    requires \valid_read(state) && \valid(cumulative_weight) && \valid(previous_mass);
    requires branch_weight <= total_weight;
    assigns destination->entries[0 .. DEFERRED_STATE_TABLE_CAPACITY - 1],
            destination->count, *cumulative_weight, *previous_mass;
*/
static bool deferred_state_add_scaled_branch(struct deferred_state_table *destination,
                                             const struct deferred_volley_state *state,
                                             uint32_t source_mass, uint64_t branch_weight,
                                             uint64_t total_weight, uint64_t *cumulative_weight,
                                             uint32_t *previous_mass) {
    uint32_t scaled = 0u;
    uint32_t branch_mass = 0u;
    uint64_t product = 0u;

    if (total_weight == 0u || branch_weight > total_weight - *cumulative_weight ||
        !uint64_add_checked(*cumulative_weight, branch_weight, cumulative_weight)) {
        return false;
    }
    scaled = ratio_to_probability_mass(*cumulative_weight, total_weight);
    branch_mass = scaled - *previous_mass;
    *previous_mass = scaled;
    if (!uint64_multiply_checked(source_mass, branch_mass, &product)) {
        return false;
    }
    return deferred_state_table_add_weight(destination, state, product);
}

/*@ requires \valid_read(weapon) && \valid_read(plan);
    requires \valid(workspace) && \valid(result);
    assigns *workspace, *result;
*/
static bool build_successful_damage_packet(const struct weapon_profile *weapon,
                                           const struct attack_plan *plan,
                                           struct calculator_workspace *workspace,
                                           struct probability_distribution *result) {
    uint32_t raw_damage = 0u;

    if (!distribution_from_weapon_damage(weapon, &workspace->exact_a)) {
        return false;
    }
    distribution_clear(&workspace->exact_b);
    raw_damage = workspace->exact_a.minimum;
    while (raw_damage <= workspace->exact_a.maximum) {
        uint64_t ways = workspace->exact_a.ways[raw_damage];
        if (ways != 0u) {
            uint32_t mapped = 0u;
            if (!apply_damage_plan(plan, raw_damage, &mapped) ||
                !distribution_add_outcome(&workspace->exact_b, mapped, ways)) {
                return false;
            }
        }
        raw_damage++;
    }
    if (!distribution_reduce_weights(&workspace->exact_b) ||
        !probability_distribution_from_exact(&workspace->exact_b, &workspace->probability_b) ||
        !apply_feel_no_pain(&workspace->probability_b, plan->feel_no_pain_on, workspace,
                            &workspace->probability_b)) {
        return false;
    }
    if (result != &workspace->probability_b) {
        memcpy(result, &workspace->probability_b, sizeof(*result));
    }
    return true;
}

/*@ requires \valid_read(layout) && \valid(state) && \valid(result);
    assigns *result;
*/
static bool deferred_allocate_packet(const struct target_unit_layout *layout,
                                     struct deferred_volley_state *state, uint32_t damage,
                                     struct deferred_volley_state *result) {
    uint32_t capacity = target_unit_capacity(layout);
    uint16_t segment_index = 0u;
    uint16_t wounds_remaining = 0u;
    uint32_t allocated = 0u;

    *result = *state;
    if (state->applied >= capacity ||
        !target_unit_position_with_capacity(layout, capacity, state->applied, &segment_index,
                                            &wounds_remaining)) {
        return state->applied == capacity;
    }
    allocated = damage < wounds_remaining ? damage : wounds_remaining;
    result->applied = (uint16_t)(state->applied + allocated);
    if (result->applied == capacity) {
        result->attacks_remaining = 0u;
        result->wounds_remaining = 0u;
        result->automatic_wound_pending = 0u;
        memset(result->devastating_wounds, 0, sizeof(result->devastating_wounds));
    }
    return true;
}

/*@ requires \valid_read(source) && source->entries != \null;
    assigns \nothing;
*/
static bool deferred_states_have_attacks(const struct deferred_state_table *source) {
    uint32_t index = 0u;
    while (index < source->count) {
        const struct deferred_state_entry *entry = &source->entries[source->slots[index]];
        if (entry->mass != 0u && entry->state.attacks_remaining != 0u) {
            return true;
        }
        index++;
    }
    return false;
}

/*@ requires \valid_read(source) && source->entries != \null;
    assigns \nothing;
*/
static bool deferred_states_have_wounds(const struct deferred_state_table *source) {
    uint32_t index = 0u;
    while (index < source->count) {
        const struct deferred_state_entry *entry = &source->entries[source->slots[index]];
        if (entry->mass != 0u &&
            (entry->state.automatic_wound_pending != 0u || entry->state.wounds_remaining != 0u)) {
            return true;
        }
        index++;
    }
    return false;
}

/*@ requires \valid_read(source) && source->entries != \null;
    requires weapon_index < MAX_VOLLEY_WEAPONS;
    assigns \nothing;
*/
static bool deferred_states_have_packets(const struct deferred_state_table *source,
                                         uint16_t weapon_index) {
    uint32_t index = 0u;
    while (index < source->count) {
        const struct deferred_state_entry *entry = &source->entries[source->slots[index]];
        if (entry->mass != 0u && entry->state.devastating_wounds[weapon_index] != 0u) {
            return true;
        }
        index++;
    }
    return false;
}

/*@ requires \valid_read(source) && source->entries != \null;
    requires \valid(destination) && destination->entries != \null;
    requires \valid_read(attack_count);
    assigns destination->entries[0 .. DEFERRED_STATE_TABLE_CAPACITY - 1], *destination;
*/
static bool deferred_sample_attack_count(const struct deferred_state_table *source,
                                         struct deferred_state_table *destination,
                                         const struct distribution *attack_count) {
    uint32_t index = 0u;
    deferred_state_table_reset(destination);
    while (index < source->count) {
        const struct deferred_state_entry *entry = &source->entries[source->slots[index]];
        if (entry->mass != 0u) {
            uint64_t cumulative = 0u;
            uint32_t previous = 0u;
            uint32_t attacks = attack_count->minimum;
            while (attacks <= attack_count->maximum) {
                uint64_t ways = attack_count->ways[attacks];
                if (ways != 0u) {
                    struct deferred_volley_state state = entry->state;
                    if (attacks > UINT16_MAX) {
                        return false;
                    }
                    state.attacks_remaining = (uint16_t)attacks;
                    if (!deferred_state_add_scaled_branch(destination, &state, entry->mass, ways,
                                                          attack_count->total_ways, &cumulative,
                                                          &previous)) {
                        return false;
                    }
                }
                attacks++;
            }
            if (cumulative != attack_count->total_ways || previous != PROBABILITY_SCALE) {
                return false;
            }
        }
        index++;
    }
    return deferred_state_table_normalize(destination);
}

/*@ requires \valid_read(source) && source->entries != \null;
    requires \valid(destination) && destination->entries != \null;
    requires \valid_read(plans + (0 .. layout->segment_count - 1));
    requires \valid_read(sustained + (0 .. layout->segment_count - 1));
    requires \valid_read(layout);
    assigns destination->entries[0 .. DEFERRED_STATE_TABLE_CAPACITY - 1], *destination;
*/
static bool deferred_resolve_hit(const struct deferred_state_table *source,
                                 struct deferred_state_table *destination,
                                 const struct attack_plan *plans,
                                 const struct distribution *sustained,
                                 const struct target_unit_layout *layout) {
    uint32_t capacity = target_unit_capacity(layout);
    uint32_t index = 0u;
    deferred_state_table_reset(destination);
    while (index < source->count) {
        const struct deferred_state_entry *entry = &source->entries[source->slots[index]];
        if (entry->mass != 0u) {
            struct deferred_volley_state base = entry->state;
            uint64_t cumulative = 0u;
            uint32_t previous = 0u;
            if (base.attacks_remaining == 0u) {
                if (!deferred_state_add_scaled_branch(destination, &base, entry->mass,
                                                      PROBABILITY_SCALE, PROBABILITY_SCALE,
                                                      &cumulative, &previous)) {
                    return false;
                }
            } else if (base.applied >= capacity) {
                base.attacks_remaining = 0u;
                base.wounds_remaining = 0u;
                base.automatic_wound_pending = 0u;
                memset(base.devastating_wounds, 0, sizeof(base.devastating_wounds));
                if (!deferred_state_add_scaled_branch(destination, &base, entry->mass,
                                                      PROBABILITY_SCALE, PROBABILITY_SCALE,
                                                      &cumulative, &previous)) {
                    return false;
                }
            } else {
                uint16_t segment = 0u;
                uint16_t wounds_remaining = 0u;
                const struct attack_plan *plan = NULL;
                if (!target_unit_position_with_capacity(layout, capacity, base.applied, &segment,
                                                        &wounds_remaining)) {
                    return false;
                }
                plan = &plans[segment];
                base.attacks_remaining--;
                if ((plan->flags & ATTACK_PLAN_AUTO_HITS) != 0u) {
                    base.wounds_remaining = 1u;
                    if (!deferred_state_add_scaled_branch(destination, &base, entry->mass,
                                                          PROBABILITY_SCALE, PROBABILITY_SCALE,
                                                          &cumulative, &previous)) {
                        return false;
                    }
                } else {
                    struct roll_table hit_table;
                    struct roll_categories hit;
                    const struct distribution *extra = &sustained[segment];
                    uint64_t total = 0u;
                    uint64_t weight = 0u;
                    if (!roll_table_build(plan->hit_reroll_mask, &hit_table) ||
                        !uint64_multiply_checked(hit_table.total_ways, extra->total_ways, &total)) {
                        return false;
                    }
                    classify_attack_rolls(&hit_table, plan->hits_on, plan->critical_hits_on,
                                          plan->hit_auto_fails_through, &hit);
                    if (!uint64_multiply_checked(hit.failed, extra->total_ways, &weight) ||
                        !deferred_state_add_scaled_branch(destination, &base, entry->mass, weight,
                                                          total, &cumulative, &previous)) {
                        return false;
                    }
                    if (hit.normal != 0u) {
                        struct deferred_volley_state normal = base;
                        normal.wounds_remaining = 1u;
                        if (!uint64_multiply_checked(hit.normal, extra->total_ways, &weight) ||
                            !deferred_state_add_scaled_branch(destination, &normal, entry->mass,
                                                              weight, total, &cumulative,
                                                              &previous)) {
                            return false;
                        }
                    }
                    {
                        uint32_t count = extra->minimum;
                        while (count <= extra->maximum) {
                            if (extra->ways[count] != 0u && hit.critical != 0u) {
                                struct deferred_volley_state critical = base;
                                uint32_t rolling = count;
                                if ((plan->flags & ATTACK_PLAN_LETHAL_HITS) != 0u) {
                                    critical.automatic_wound_pending = 1u;
                                } else {
                                    rolling++;
                                }
                                if (rolling > UINT16_MAX) {
                                    return false;
                                }
                                critical.wounds_remaining = (uint16_t)rolling;
                                if (!uint64_multiply_checked(hit.critical, extra->ways[count],
                                                             &weight) ||
                                    !deferred_state_add_scaled_branch(destination, &critical,
                                                                      entry->mass, weight, total,
                                                                      &cumulative, &previous)) {
                                    return false;
                                }
                            }
                            count++;
                        }
                    }
                }
            }
        }
        index++;
    }
    return deferred_state_table_normalize(destination);
}

/*@ requires \valid_read(source) && source->entries != \null;
    requires \valid(destination) && destination->entries != \null;
    requires \valid_read(plans + (0 .. layout->segment_count - 1));
    requires \valid_read(packets + (0 .. layout->segment_count - 1));
    requires \valid_read(first_failed_save_packets + (0 .. layout->segment_count - 1));
    requires \valid_read(layout);
    assigns destination->entries[0 .. DEFERRED_STATE_TABLE_CAPACITY - 1], *destination;
*/
static bool deferred_resolve_automatic_wound(
    const struct deferred_state_table *source, struct deferred_state_table *destination,
    const struct attack_plan *plans, const struct probability_distribution *packets,
    const struct probability_distribution *first_failed_save_packets,
    const struct target_unit_layout *layout) {
    uint32_t capacity = target_unit_capacity(layout);
    uint32_t index = 0u;
    deferred_state_table_reset(destination);
    while (index < source->count) {
        const struct deferred_state_entry *entry = &source->entries[source->slots[index]];
        if (entry->mass != 0u) {
            struct deferred_volley_state base = entry->state;
            uint64_t cumulative = 0u;
            uint32_t previous = 0u;
            if (base.automatic_wound_pending == 0u || base.applied >= capacity) {
                base.automatic_wound_pending = 0u;
                if (base.applied >= capacity) {
                    base.attacks_remaining = 0u;
                    base.wounds_remaining = 0u;
                    memset(base.devastating_wounds, 0, sizeof(base.devastating_wounds));
                }
                if (!deferred_state_add_scaled_branch(destination, &base, entry->mass,
                                                      PROBABILITY_SCALE, PROBABILITY_SCALE,
                                                      &cumulative, &previous)) {
                    return false;
                }
            } else {
                uint16_t segment = 0u;
                uint16_t wounds_remaining = 0u;
                struct roll_table save_table;
                struct save_categories save;
                uint64_t total = 0u;
                uint64_t weight = 0u;
                uint32_t damage = 0u;
                const struct probability_distribution *packet = NULL;
                if (!target_unit_position_with_capacity(layout, capacity, base.applied, &segment,
                                                        &wounds_remaining) ||
                    !roll_table_build(plans[segment].save_reroll_mask, &save_table) ||
                    !uint64_multiply_checked(save_table.total_ways, PROBABILITY_SCALE, &total)) {
                    return false;
                }
                classify_saves(&save_table, plans[segment].saves_on, &save);
                base.automatic_wound_pending = 0u;
                if (!uint64_multiply_checked(save.succeeded, PROBABILITY_SCALE, &weight) ||
                    !deferred_state_add_scaled_branch(destination, &base, entry->mass, weight,
                                                      total, &cumulative, &previous)) {
                    return false;
                }
                packet = base.first_failed_save_replacement_remaining != 0u
                             ? &first_failed_save_packets[segment]
                             : &packets[segment];
                if (save.failed != 0u && base.first_failed_save_replacement_remaining != 0u) {
                    base.first_failed_save_replacement_remaining = 0u;
                }
                damage = packet->minimum;
                while (damage <= packet->maximum) {
                    if (packet->mass[damage] != 0u && save.failed != 0u) {
                        struct deferred_volley_state allocated;
                        if (!deferred_allocate_packet(layout, &base, damage, &allocated) ||
                            !uint64_multiply_checked(save.failed, packet->mass[damage], &weight) ||
                            !deferred_state_add_scaled_branch(destination, &allocated, entry->mass,
                                                              weight, total, &cumulative,
                                                              &previous)) {
                            return false;
                        }
                    }
                    damage++;
                }
                if (cumulative != total || previous != PROBABILITY_SCALE) {
                    return false;
                }
            }
        }
        index++;
    }
    return deferred_state_table_normalize(destination);
}

/*@ requires \valid_read(source) && source->entries != \null;
    requires \valid(destination) && destination->entries != \null;
    requires \valid_read(plans + (0 .. layout->segment_count - 1));
    requires \valid_read(packets + (0 .. layout->segment_count - 1));
    requires \valid_read(first_failed_save_packets + (0 .. layout->segment_count - 1));
    requires \valid_read(layout);
    requires weapon_index < MAX_VOLLEY_WEAPONS;
    assigns destination->entries[0 .. DEFERRED_STATE_TABLE_CAPACITY - 1], *destination;
*/
static bool deferred_resolve_rolling_wound(
    const struct deferred_state_table *source, struct deferred_state_table *destination,
    const struct attack_plan *plans, const struct probability_distribution *packets,
    const struct probability_distribution *first_failed_save_packets,
    const struct target_unit_layout *layout, uint16_t weapon_index) {
    uint32_t capacity = target_unit_capacity(layout);
    uint32_t index = 0u;
    deferred_state_table_reset(destination);
    while (index < source->count) {
        const struct deferred_state_entry *entry = &source->entries[source->slots[index]];
        if (entry->mass != 0u) {
            struct deferred_volley_state base = entry->state;
            uint64_t cumulative = 0u;
            uint32_t previous = 0u;
            if (base.wounds_remaining == 0u || base.applied >= capacity) {
                base.wounds_remaining = 0u;
                if (base.applied >= capacity) {
                    base.attacks_remaining = 0u;
                    base.automatic_wound_pending = 0u;
                    memset(base.devastating_wounds, 0, sizeof(base.devastating_wounds));
                }
                if (!deferred_state_add_scaled_branch(destination, &base, entry->mass,
                                                      PROBABILITY_SCALE, PROBABILITY_SCALE,
                                                      &cumulative, &previous)) {
                    return false;
                }
            } else {
                uint16_t segment = 0u;
                uint16_t target_wounds = 0u;
                struct roll_table wound_table;
                struct roll_table save_table;
                struct roll_categories wound;
                struct save_categories save;
                uint64_t total = 0u;
                uint64_t weight = 0u;
                uint64_t wounded = 0u;
                uint64_t saveable = 0u;
                uint64_t bypassing = 0u;
                uint32_t damage = 0u;
                bool devastating = false;
                struct deferred_volley_state failed_save_base;
                const struct attack_plan *plan = NULL;
                const struct probability_distribution *packet = NULL;
                if (!target_unit_position_with_capacity(layout, capacity, base.applied, &segment,
                                                        &target_wounds)) {
                    return false;
                }
                plan = &plans[segment];
                packet = base.first_failed_save_replacement_remaining != 0u
                             ? &first_failed_save_packets[segment]
                             : &packets[segment];
                if (!roll_table_build(plan->wound_reroll_mask, &wound_table) ||
                    !roll_table_build(plan->save_reroll_mask, &save_table) ||
                    !uint64_product3_checked(wound_table.total_ways, save_table.total_ways,
                                             PROBABILITY_SCALE, &total)) {
                    return false;
                }
                classify_attack_rolls(&wound_table, plan->wounds_on, plan->critical_wounds_on, 0u,
                                      &wound);
                classify_saves(&save_table, plan->saves_on, &save);
                devastating = (plan->flags & ATTACK_PLAN_CRITICAL_WOUNDS_BYPASS_SAVE) != 0u;
                saveable = wound.normal + (devastating ? 0u : wound.critical);
                bypassing = devastating ? wound.critical : 0u;
                base.wounds_remaining--;
                if (!uint64_product3_checked(wound.failed, save.total, PROBABILITY_SCALE,
                                             &weight) ||
                    !deferred_state_add_scaled_branch(destination, &base, entry->mass, weight,
                                                      total, &cumulative, &previous)) {
                    return false;
                }
                if (!uint64_multiply_checked(saveable, save.succeeded, &wounded) ||
                    !uint64_multiply_checked(wounded, PROBABILITY_SCALE, &weight) ||
                    !deferred_state_add_scaled_branch(destination, &base, entry->mass, weight,
                                                      total, &cumulative, &previous)) {
                    return false;
                }
                failed_save_base = base;
                if (saveable != 0u && save.failed != 0u &&
                    failed_save_base.first_failed_save_replacement_remaining != 0u) {
                    failed_save_base.first_failed_save_replacement_remaining = 0u;
                }
                damage = packet->minimum;
                while (damage <= packet->maximum) {
                    if (packet->mass[damage] != 0u && saveable != 0u && save.failed != 0u) {
                        struct deferred_volley_state allocated;
                        if (!deferred_allocate_packet(layout, &failed_save_base, damage,
                                                      &allocated) ||
                            !uint64_multiply_checked(saveable, save.failed, &wounded) ||
                            !uint64_multiply_checked(wounded, packet->mass[damage], &weight) ||
                            !deferred_state_add_scaled_branch(destination, &allocated, entry->mass,
                                                              weight, total, &cumulative,
                                                              &previous)) {
                            return false;
                        }
                    }
                    damage++;
                }
                if (bypassing != 0u) {
                    struct deferred_volley_state deferred = base;
                    if (deferred.devastating_wounds[weapon_index] == UINT16_MAX) {
                        return false;
                    }
                    deferred.devastating_wounds[weapon_index]++;
                    if (!uint64_product3_checked(bypassing, save.total, PROBABILITY_SCALE,
                                                 &weight) ||
                        !deferred_state_add_scaled_branch(destination, &deferred, entry->mass,
                                                          weight, total, &cumulative, &previous)) {
                        return false;
                    }
                }
                if (cumulative != total || previous != PROBABILITY_SCALE) {
                    return false;
                }
            }
        }
        index++;
    }
    return deferred_state_table_normalize(destination);
}

/*@ requires \valid_read(weapon) && \valid_read(targets + (0 .. layout->segment_count - 1));
    requires \valid_read(layout) && \valid(workspace);
    requires \valid(plans + (0 .. layout->segment_count - 1));
    requires \valid(sustained + (0 .. layout->segment_count - 1));
    assigns *workspace, plans[0 .. layout->segment_count - 1],
            sustained[0 .. layout->segment_count - 1];
*/
static bool deferred_prepare_weapon(const struct weapon_profile *weapon,
                                    const struct target_profile *targets,
                                    const struct target_unit_layout *layout,
                                    struct calculator_workspace *workspace,
                                    struct attack_plan *plans, struct distribution *sustained) {
    uint16_t segment = 0u;
    while (segment < layout->segment_count) {
        struct weapon_profile replacement_weapon;
        struct attack_plan replacement_plan;
        if (targets[segment].wounds != layout->wounds_per_model[segment] ||
            !attack_plan_build(weapon, &targets[segment], &plans[segment]) ||
            !distribution_from_dice_value(plans[segment].sustained_hits, &sustained[segment]) ||
            !build_successful_damage_packet(weapon, &plans[segment], workspace,
                                            &workspace->target_attacks[segment])) {
            return false;
        }
        replacement_weapon = *weapon;
        replacement_weapon.damage_replacement =
            targets[segment].first_failed_save_damage_replacement;
        replacement_weapon.damage_replacement_active =
            targets[segment].first_failed_save_damage_replacement_active;
        if (replacement_weapon.damage_replacement_active) {
            if (!attack_plan_build(&replacement_weapon, &targets[segment], &replacement_plan) ||
                !build_successful_damage_packet(
                    &replacement_weapon, &replacement_plan, workspace,
                    &workspace->target_first_failed_save_attacks[segment])) {
                return false;
            }
        } else {
            memcpy(&workspace->target_first_failed_save_attacks[segment],
                   &workspace->target_attacks[segment], sizeof(workspace->target_attacks[segment]));
        }
        segment++;
    }
    return true;
}

/*@ requires \valid_read(weapon) && \valid_read(targets + (0 .. layout->segment_count - 1));
    requires \valid_read(layout) && \valid(workspace);
    requires \valid(current) && \valid(next) && *current != *next;
    requires (*current)->entries != \null && (*next)->entries != \null;
    requires weapon_index < MAX_VOLLEY_WEAPONS;
    assigns *workspace, **current, **next, *current, *next;
*/
static bool deferred_resolve_weapon_ordinary(const struct weapon_profile *weapon,
                                             const struct target_profile *targets,
                                             const struct target_unit_layout *layout,
                                             uint16_t weapon_index,
                                             struct calculator_workspace *workspace,
                                             struct deferred_state_table **current,
                                             struct deferred_state_table **next) {
    struct attack_plan plans[MAX_TARGET_SEGMENTS];
    struct distribution *sustained = NULL;
    struct deferred_state_table *swap = NULL;
    bool result = false;

    sustained = calloc(layout->segment_count, sizeof(*sustained));
    if (sustained == NULL ||
        !deferred_prepare_weapon(weapon, targets, layout, workspace, plans, sustained) ||
        !distribution_from_weapon_attacks(weapon, &workspace->exact_a) ||
        !deferred_sample_attack_count(*current, *next, &workspace->exact_a)) {
        goto cleanup;
    }
    swap = *current;
    *current = *next;
    *next = swap;

    while (deferred_states_have_attacks(*current)) {
        if (!deferred_resolve_hit(*current, *next, plans, sustained, layout)) {
            goto cleanup;
        }
        swap = *current;
        *current = *next;
        *next = swap;
        while (deferred_states_have_wounds(*current)) {
            if (!deferred_resolve_automatic_wound(*current, *next, plans, workspace->target_attacks,
                                                  workspace->target_first_failed_save_attacks,
                                                  layout)) {
                goto cleanup;
            }
            swap = *current;
            *current = *next;
            *next = swap;
            if (!deferred_resolve_rolling_wound(*current, *next, plans, workspace->target_attacks,
                                                workspace->target_first_failed_save_attacks, layout,
                                                weapon_index)) {
                goto cleanup;
            }
            swap = *current;
            *current = *next;
            *next = swap;
        }
    }
    result = true;

cleanup:
    free(sustained);
    return result;
}

/*@ requires \valid_read(weapon) && \valid_read(targets + (0 .. layout->segment_count - 1));
    requires \valid_read(layout) && \valid(workspace);
    requires \valid(current) && \valid(next) && *current != *next;
    requires (*current)->entries != \null && (*next)->entries != \null;
    requires weapon_index < MAX_VOLLEY_WEAPONS;
    assigns *workspace, **current, **next, *current, *next;
*/
static bool deferred_resolve_weapon_packets(const struct weapon_profile *weapon,
                                            const struct target_profile *targets,
                                            const struct target_unit_layout *layout,
                                            uint16_t weapon_index,
                                            struct calculator_workspace *workspace,
                                            struct deferred_state_table **current,
                                            struct deferred_state_table **next) {
    struct attack_plan plans[MAX_TARGET_SEGMENTS];
    struct distribution *sustained = NULL;
    struct deferred_state_table *swap = NULL;
    uint32_t capacity = target_unit_capacity(layout);
    bool result = false;

    sustained = calloc(layout->segment_count, sizeof(*sustained));
    if (sustained == NULL ||
        !deferred_prepare_weapon(weapon, targets, layout, workspace, plans, sustained)) {
        goto cleanup;
    }
    while (deferred_states_have_packets(*current, weapon_index)) {
        uint32_t index = 0u;
        deferred_state_table_reset(*next);
        while (index < (*current)->count) {
            const struct deferred_state_entry *entry =
                &(*current)->entries[(*current)->slots[index]];
            if (entry->mass != 0u) {
                struct deferred_volley_state base = entry->state;
                uint64_t cumulative = 0u;
                uint32_t previous = 0u;
                if (base.devastating_wounds[weapon_index] == 0u) {
                    if (!deferred_state_add_scaled_branch(*next, &base, entry->mass,
                                                          PROBABILITY_SCALE, PROBABILITY_SCALE,
                                                          &cumulative, &previous)) {
                        goto cleanup;
                    }
                } else if (base.applied >= capacity) {
                    base.attacks_remaining = 0u;
                    base.wounds_remaining = 0u;
                    base.automatic_wound_pending = 0u;
                    memset(base.devastating_wounds, 0, sizeof(base.devastating_wounds));
                    if (!deferred_state_add_scaled_branch(*next, &base, entry->mass,
                                                          PROBABILITY_SCALE, PROBABILITY_SCALE,
                                                          &cumulative, &previous)) {
                        goto cleanup;
                    }
                } else {
                    uint16_t segment = 0u;
                    uint16_t target_wounds = 0u;
                    uint32_t damage = 0u;
                    const struct probability_distribution *packet = NULL;
                    if (!target_unit_position_with_capacity(layout, capacity, base.applied,
                                                            &segment, &target_wounds)) {
                        goto cleanup;
                    }
                    base.devastating_wounds[weapon_index]--;
                    packet = &workspace->target_attacks[segment];
                    damage = packet->minimum;
                    while (damage <= packet->maximum) {
                        if (packet->mass[damage] != 0u) {
                            struct deferred_volley_state allocated;
                            if (!deferred_allocate_packet(layout, &base, damage, &allocated) ||
                                !deferred_state_add_scaled_branch(
                                    *next, &allocated, entry->mass, packet->mass[damage],
                                    PROBABILITY_SCALE, &cumulative, &previous)) {
                                goto cleanup;
                            }
                        }
                        damage++;
                    }
                    if (cumulative != PROBABILITY_SCALE || previous != PROBABILITY_SCALE) {
                        goto cleanup;
                    }
                }
            }
            index++;
        }
        if (!deferred_state_table_normalize(*next)) {
            goto cleanup;
        }
        swap = *current;
        *current = *next;
        *next = swap;
    }
    result = true;

cleanup:
    free(sustained);
    return result;
}

/*@ requires \valid_read(source) && source->entries != \null;
    requires \valid_read(layout) && \valid(workspace) && \valid(result);
    assigns *workspace, *result;
*/
static bool deferred_states_to_distribution(const struct deferred_state_table *source,
                                            const struct target_unit_layout *layout,
                                            struct calculator_workspace *workspace,
                                            struct probability_distribution *result) {
    uint32_t index = 0u;
    uint32_t minimum = MAX_DISTRIBUTION_RESULT;
    uint32_t maximum = 0u;
    memset(workspace->mixture_accumulator, 0, sizeof(workspace->mixture_accumulator));
    while (index < source->count) {
        const struct deferred_state_entry *entry = &source->entries[source->slots[index]];
        if (entry->mass != 0u) {
            uint32_t applied = entry->state.applied - layout->initial_wounds_lost;
            if (!uint64_add_checked(workspace->mixture_accumulator[applied], entry->mass,
                                    &workspace->mixture_accumulator[applied])) {
                return false;
            }
            if (applied < minimum) {
                minimum = applied;
            }
            if (applied > maximum) {
                maximum = applied;
            }
        }
        index++;
    }
    return minimum <= maximum &&
           probability_distribution_from_weights(workspace->mixture_accumulator, minimum, maximum,
                                                 PROBABILITY_SCALE, result);
}

/*@ requires \valid_read(targets + (0 .. weapon_count * segment_count - 1));
    requires 1 <= weapon_count <= MAX_VOLLEY_WEAPONS;
    requires 1 <= segment_count <= MAX_TARGET_SEGMENTS;
    requires \valid(active);
    assigns *active;
*/
static bool target_first_failed_save_replacement(const struct target_profile *targets,
                                                 uint16_t weapon_count, uint16_t segment_count,
                                                 bool *active) {
    uint32_t count = (uint32_t)weapon_count * segment_count;
    uint32_t index = 0u;
    uint16_t value = 0u;

    if (targets == NULL || active == NULL || weapon_count == 0u ||
        weapon_count > MAX_VOLLEY_WEAPONS || segment_count == 0u ||
        segment_count > MAX_TARGET_SEGMENTS) {
        return false;
    }
    *active = targets[0].first_failed_save_damage_replacement_active;
    value = targets[0].first_failed_save_damage_replacement;
    while (index < count) {
        if (targets[index].first_failed_save_damage_replacement_active != *active ||
            (*active && targets[index].first_failed_save_damage_replacement != value)) {
            return false;
        }
        index++;
    }
    return true;
}

/*@ requires \valid_read(weapons + (0 .. weapon_count - 1));
    requires \valid_read(targets + (0 .. weapon_count * layout->segment_count - 1));
    requires \valid_read(layout) && \valid(workspace) && \valid(result);
    requires \valid(cumulative_means + (0 .. weapon_count - 1));
    requires 1 <= weapon_count <= MAX_VOLLEY_WEAPONS;
    assigns *workspace, *result, cumulative_means[0 .. weapon_count - 1];
*/
static bool calculate_deferred_ordered_volley_prefix(
    const struct weapon_profile *weapons, const struct target_profile *targets,
    uint16_t weapon_count, const struct target_unit_layout *layout,
    struct calculator_workspace *workspace, struct probability_distribution *result,
    struct fraction *cumulative_means, bool collect_ordinary_means) {
    struct deferred_state_table tables[2];
    struct deferred_state_table *current = &tables[0];
    struct deferred_state_table *next = &tables[1];
    struct deferred_volley_state initial;
    uint16_t weapon_index = 0u;
    bool replacement_active = false;
    bool success = false;

    memset(tables, 0, sizeof(tables));
    memset(&initial, 0, sizeof(initial));
    initial.applied = layout->initial_wounds_lost;
    if (!target_first_failed_save_replacement(targets, weapon_count, layout->segment_count,
                                              &replacement_active)) {
        goto cleanup;
    }
    initial.first_failed_save_replacement_remaining = replacement_active ? 1u : 0u;
    if (!deferred_state_table_create(current, weapon_count) ||
        !deferred_state_table_create(next, weapon_count) ||
        !deferred_state_table_add_weight(current, &initial, PROBABILITY_SCALE) ||
        !deferred_state_table_normalize(current)) {
        goto cleanup;
    }
    while (weapon_index < weapon_count) {
        const struct target_profile *weapon_targets =
            targets + (uint32_t)weapon_index * layout->segment_count;
        if (!deferred_resolve_weapon_ordinary(&weapons[weapon_index], weapon_targets, layout,
                                              weapon_index, workspace, &current, &next)) {
            goto cleanup;
        }
        if (collect_ordinary_means &&
            (!deferred_states_to_distribution(current, layout, workspace, result) ||
             !probability_distribution_mean(result, &cumulative_means[weapon_index]))) {
            goto cleanup;
        }
        weapon_index++;
    }
    weapon_index = 0u;
    while (weapon_index < weapon_count) {
        const struct target_profile *weapon_targets =
            targets + (uint32_t)weapon_index * layout->segment_count;
        if (!deferred_resolve_weapon_packets(&weapons[weapon_index], weapon_targets, layout,
                                             weapon_index, workspace, &current, &next)) {
            goto cleanup;
        }
        weapon_index++;
    }
    success = deferred_states_to_distribution(current, layout, workspace, result);

cleanup:
    if (tables[0].peak_count > workspace->peak_sparse_states) {
        workspace->peak_sparse_states = tables[0].peak_count;
    }
    if (tables[1].peak_count > workspace->peak_sparse_states) {
        workspace->peak_sparse_states = tables[1].peak_count;
    }
    deferred_state_table_destroy(&tables[0]);
    deferred_state_table_destroy(&tables[1]);
    return success;
}

/*@ requires \valid_read(weapon) && \valid_read(targets) && \valid_read(layout);
    requires \valid_read(current) && \valid(workspace) && \valid(result);
    assigns *workspace, *result;
*/
static bool advance_resolved_weapon_applied_damage_distribution(
    const struct weapon_profile *weapon, const struct target_profile *targets,
    const struct target_unit_layout *layout, const struct probability_distribution *current,
    struct calculator_workspace *workspace, struct probability_distribution *result) {
    struct probability_distribution *attack_count = NULL;
    struct probability_distribution *state = NULL;
    struct probability_distribution *next = NULL;
    struct probability_distribution *final_distribution = NULL;
    uint32_t capacity = target_unit_capacity(layout);
    uint16_t segment_index = 0u;
    uint32_t attack_number = 0u;
    uint32_t mixture_minimum = capacity;
    uint32_t mixture_maximum = 0u;
    const uint64_t total_weight = (uint64_t)PROBABILITY_SCALE * PROBABILITY_SCALE;

    if (weapon == NULL || targets == NULL || layout == NULL || current == NULL ||
        workspace == NULL || result == NULL || capacity == 0u ||
        !probability_distribution_is_normalized(current) ||
        current->minimum < layout->initial_wounds_lost || current->maximum > capacity) {
        return false;
    }

    while (segment_index < layout->segment_count) {
        struct attack_plan plan;
        if (targets[segment_index].first_failed_save_damage_replacement_active ||
            targets[segment_index].wounds != layout->wounds_per_model[segment_index] ||
            !attack_plan_build(weapon, &targets[segment_index], &plan) ||
            !build_single_attack_probability_distribution(weapon, &plan, workspace,
                                                          &workspace->probability_b) ||
            !apply_feel_no_pain(&workspace->probability_b, plan.feel_no_pain_on, workspace,
                                &workspace->probability_b)) {
            return false;
        }
        memcpy(&workspace->target_attacks[segment_index], &workspace->probability_b,
               sizeof(workspace->probability_b));
        segment_index++;
    }

    if (!distribution_from_weapon_attacks(weapon, &workspace->exact_a) ||
        !probability_distribution_from_exact(&workspace->exact_a, &workspace->probability_a)) {
        return false;
    }

    attack_count = &workspace->probability_a;
    state = &workspace->probability_c;
    next = &workspace->probability_d;
    memcpy(state, current, sizeof(*state));
    memset(workspace->mixture_accumulator, 0, sizeof(workspace->mixture_accumulator));

    attack_number = 0u;
    while (attack_number <= attack_count->maximum) {
        uint32_t attack_mass = attack_count->mass[attack_number];
        if (attack_mass != 0u) {
            uint32_t applied = state->minimum;
            while (applied <= state->maximum) {
                if (state->mass[applied] != 0u) {
                    uint64_t product = (uint64_t)attack_mass * state->mass[applied];
                    if (!uint64_add_checked(workspace->mixture_accumulator[applied], product,
                                            &workspace->mixture_accumulator[applied])) {
                        return false;
                    }
                    if (applied < mixture_minimum) {
                        mixture_minimum = applied;
                    }
                    if (applied > mixture_maximum) {
                        mixture_maximum = applied;
                    }
                }
                applied++;
            }
        }
        if (attack_number < attack_count->maximum) {
            struct probability_distribution *swap = NULL;
            if (!probability_distribution_allocate_mixed_attack_internal(
                    state, workspace->target_attacks, layout, workspace->convolution_accumulator,
                    next)) {
                return false;
            }
            swap = state;
            state = next;
            next = swap;
        }
        attack_number++;
    }

    final_distribution = next;
    if (mixture_minimum > mixture_maximum ||
        !probability_distribution_from_weights(workspace->mixture_accumulator, mixture_minimum,
                                               mixture_maximum, total_weight, final_distribution)) {
        return false;
    }
    if (result != final_distribution) {
        memcpy(result, final_distribution, sizeof(*result));
    }
    return true;
}

bool advance_weapon_applied_damage_distribution(const struct weapon_profile *weapon,
                                                const struct target_profile *targets,
                                                const struct target_unit_layout *layout,
                                                const struct probability_distribution *current,
                                                struct calculator_workspace *workspace,
                                                struct probability_distribution *result) {
    struct distribution characteristic_roll;
    uint64_t accumulator[MAX_DISTRIBUTION_RESULT + 1u];
    uint64_t total_weight = 0u;
    uint32_t minimum = MAX_DISTRIBUTION_RESULT;
    uint32_t maximum = 0u;
    uint32_t outcome = 0u;

    if (weapon == NULL || targets == NULL || layout == NULL || current == NULL ||
        workspace == NULL || result == NULL) {
        return false;
    }
    if (weapon->characteristic_modifier_roll_flags == 0u) {
        if (weapon->characteristic_modifier_roll.dice_count != 0u ||
            weapon->characteristic_modifier_roll.dice_sides != 0u ||
            weapon->characteristic_modifier_roll.modifier != 0u ||
            weapon->characteristic_modifier_roll_group != 0u) {
            return false;
        }
        return advance_resolved_weapon_applied_damage_distribution(weapon, targets, layout, current,
                                                                   workspace, result);
    }
    if (!distribution_from_dice_value(weapon->characteristic_modifier_roll, &characteristic_roll) ||
        !uint64_multiply_checked(PROBABILITY_SCALE, characteristic_roll.total_ways,
                                 &total_weight)) {
        return false;
    }
    memset(accumulator, 0, sizeof(accumulator));
    outcome = characteristic_roll.minimum;
    while (outcome <= characteristic_roll.maximum) {
        uint64_t ways = characteristic_roll.ways[outcome];
        if (ways != 0u) {
            struct weapon_profile resolved;
            struct probability_distribution conditional;
            uint32_t applied = 0u;
            if (!weapon_profile_resolve_characteristic_roll(weapon, (uint16_t)outcome, &resolved) ||
                !advance_resolved_weapon_applied_damage_distribution(
                    &resolved, targets, layout, current, workspace, &conditional)) {
                return false;
            }
            applied = conditional.minimum;
            while (applied <= conditional.maximum) {
                uint64_t weighted = 0u;
                if (conditional.mass[applied] != 0u &&
                    (!uint64_multiply_checked(conditional.mass[applied], ways, &weighted) ||
                     !uint64_add_checked(accumulator[applied], weighted, &accumulator[applied]))) {
                    return false;
                }
                applied++;
            }
            if (conditional.minimum < minimum) {
                minimum = conditional.minimum;
            }
            if (conditional.maximum > maximum) {
                maximum = conditional.maximum;
            }
        }
        outcome++;
    }
    return minimum <= maximum && probability_distribution_from_weights(
                                     accumulator, minimum, maximum, total_weight, result);
}

/*@ requires \valid_read(weapons) && \valid_read(targets) && \valid_read(layout);
    requires \valid(workspace) && \valid(result) && \valid(cumulative_means);
    assigns *workspace, *result, *cumulative_means;
*/
static bool calculate_resolved_ordered_volley_applied_damage_distribution(
    const struct weapon_profile *weapons, const struct target_profile *targets,
    uint16_t weapon_count, const struct target_unit_layout *layout,
    struct calculator_workspace *workspace, struct probability_distribution *result,
    struct fraction *cumulative_means) {
    struct probability_distribution *current = NULL;
    struct probability_distribution *next = NULL;
    uint16_t weapon_index = 0u;
    uint32_t capacity = target_unit_capacity(layout);
    bool replacement_active = false;
    bool uses_deferred_states = false;
    bool uses_deferred_packets = false;

    if (weapons == NULL || targets == NULL || layout == NULL || workspace == NULL ||
        result == NULL || cumulative_means == NULL || weapon_count == 0u ||
        weapon_count > MAX_VOLLEY_WEAPONS || capacity == 0u ||
        !probability_distribution_from_constant(layout->initial_wounds_lost,
                                                &workspace->probability_e)) {
        return false;
    }
    if (!target_first_failed_save_replacement(targets, weapon_count, layout->segment_count,
                                              &replacement_active)) {
        return false;
    }
    workspace->peak_sparse_states = 0u;
    uses_deferred_states = replacement_active;

    weapon_index = 0u;
    while (weapon_index < weapon_count) {
        uint16_t segment_index = 0u;
        while (segment_index < layout->segment_count) {
            struct attack_plan plan;
            const struct target_profile *target =
                &targets[(uint32_t)weapon_index * layout->segment_count + segment_index];
            if (!attack_plan_build(&weapons[weapon_index], target, &plan)) {
                return false;
            }
            if ((plan.flags & ATTACK_PLAN_CRITICAL_WOUNDS_BYPASS_SAVE) != 0u) {
                uses_deferred_states = true;
                uses_deferred_packets = true;
            }
            segment_index++;
        }
        weapon_index++;
    }

    if (uses_deferred_states) {
        if (replacement_active && !uses_deferred_packets) {
            return calculate_deferred_ordered_volley_prefix(
                weapons, targets, weapon_count, layout, workspace, result, cumulative_means, true);
        }
        weapon_index = 0u;
        while (weapon_index < weapon_count) {
            if (!calculate_deferred_ordered_volley_prefix(
                    weapons, targets, (uint16_t)(weapon_index + 1u), layout, workspace, result,
                    cumulative_means, false) ||
                !probability_distribution_mean(result, &cumulative_means[weapon_index])) {
                return false;
            }
            weapon_index++;
        }
        return true;
    }

    weapon_index = 0u;
    current = &workspace->probability_e;
    next = &workspace->probability_f;
    while (weapon_index < weapon_count) {
        const struct target_profile *weapon_targets =
            targets + (uint32_t)weapon_index * layout->segment_count;
        uint64_t baseline = 0u;
        if (!advance_weapon_applied_damage_distribution(&weapons[weapon_index], weapon_targets,
                                                        layout, current, workspace, next) ||
            !probability_distribution_mean(next, &cumulative_means[weapon_index]) ||
            !uint64_multiply_checked(layout->initial_wounds_lost,
                                     cumulative_means[weapon_index].denominator, &baseline) ||
            cumulative_means[weapon_index].numerator < baseline) {
            return false;
        }
        cumulative_means[weapon_index].numerator -= baseline;
        if (!fraction_reduce(&cumulative_means[weapon_index])) {
            return false;
        }
        {
            struct probability_distribution *swap = current;
            current = next;
            next = swap;
        }
        weapon_index++;
    }

    memset(workspace->mixture_accumulator, 0, sizeof(workspace->mixture_accumulator));
    {
        uint32_t applied = current->minimum;
        while (applied <= current->maximum) {
            workspace->mixture_accumulator[applied - layout->initial_wounds_lost] =
                current->mass[applied];
            applied++;
        }
    }
    return probability_distribution_from_weights(
        workspace->mixture_accumulator, current->minimum - layout->initial_wounds_lost,
        current->maximum - layout->initial_wounds_lost, PROBABILITY_SCALE, result);
}

bool calculate_ordered_volley_applied_damage_distribution(const struct weapon_profile *weapons,
                                                          const struct target_profile *targets,
                                                          uint16_t weapon_count,
                                                          const struct target_unit_layout *layout,
                                                          struct calculator_workspace *workspace,
                                                          struct probability_distribution *result,
                                                          struct fraction *cumulative_means) {
    struct distribution *rolls = NULL;
    struct dice_value *roll_values = NULL;
    struct weapon_profile *resolved = NULL;
    uint16_t *outcomes = NULL;
    uint16_t *roll_groups = NULL;
    uint16_t *weapon_dimensions = NULL;
    struct fraction cumulative_sums[MAX_VOLLEY_WEAPONS];
    uint64_t accumulator[MAX_DISTRIBUTION_RESULT + 1u];
    uint64_t total_combination_ways = 1u;
    uint64_t total_weight = 0u;
    uint32_t combination_count = 1u;
    uint32_t minimum = MAX_DISTRIBUTION_RESULT;
    uint32_t maximum = 0u;
    uint32_t peak_sparse_states = 0u;
    uint16_t weapon_index = 0u;
    uint16_t dimension_count = 0u;
    bool has_roll = false;
    bool success = false;
    bool done = false;

    if (weapons == NULL || targets == NULL || layout == NULL || workspace == NULL ||
        result == NULL || cumulative_means == NULL || weapon_count == 0u ||
        weapon_count > MAX_VOLLEY_WEAPONS) {
        return false;
    }
    rolls = calloc(weapon_count, sizeof(*rolls));
    roll_values = calloc(weapon_count, sizeof(*roll_values));
    resolved = calloc(weapon_count, sizeof(*resolved));
    outcomes = calloc(weapon_count, sizeof(*outcomes));
    roll_groups = calloc(weapon_count, sizeof(*roll_groups));
    weapon_dimensions = calloc(weapon_count, sizeof(*weapon_dimensions));
    if (rolls == NULL || roll_values == NULL || resolved == NULL || outcomes == NULL ||
        roll_groups == NULL || weapon_dimensions == NULL) {
        goto cleanup;
    }
    while (weapon_index < weapon_count) {
        const struct weapon_profile *weapon = &weapons[weapon_index];
        cumulative_sums[weapon_index] = (struct fraction){0u, 1u};
        if (weapon->characteristic_modifier_roll_flags == 0u) {
            if (weapon->characteristic_modifier_roll.dice_count != 0u ||
                weapon->characteristic_modifier_roll.dice_sides != 0u ||
                weapon->characteristic_modifier_roll.modifier != 0u ||
                weapon->characteristic_modifier_roll_group != 0u) {
                goto cleanup;
            }
            weapon_dimensions[weapon_index] = UINT16_MAX;
        } else {
            uint16_t dimension = dimension_count;
            uint32_t support = 0u;
            has_roll = true;
            if (weapon->characteristic_modifier_roll_group != 0u) {
                dimension = 0u;
                while (dimension < dimension_count &&
                       roll_groups[dimension] != weapon->characteristic_modifier_roll_group) {
                    dimension++;
                }
            }
            if (dimension < dimension_count) {
                if (roll_values[dimension].dice_count !=
                        weapon->characteristic_modifier_roll.dice_count ||
                    roll_values[dimension].dice_sides !=
                        weapon->characteristic_modifier_roll.dice_sides ||
                    roll_values[dimension].modifier !=
                        weapon->characteristic_modifier_roll.modifier) {
                    goto cleanup;
                }
            } else {
                if (!distribution_from_dice_value(weapon->characteristic_modifier_roll,
                                                  &rolls[dimension])) {
                    goto cleanup;
                }
                roll_values[dimension] = weapon->characteristic_modifier_roll;
                roll_groups[dimension] = weapon->characteristic_modifier_roll_group;
                outcomes[dimension] = (uint16_t)rolls[dimension].minimum;
                support = rolls[dimension].maximum - rolls[dimension].minimum + 1u;
                if (support > MAX_CHARACTERISTIC_ROLL_COMBINATIONS / combination_count ||
                    !uint64_multiply_checked(total_combination_ways, rolls[dimension].total_ways,
                                             &total_combination_ways)) {
                    goto cleanup;
                }
                combination_count *= support;
                dimension_count++;
            }
            weapon_dimensions[weapon_index] = dimension;
        }
        weapon_index++;
    }
    if (!has_roll) {
        success = calculate_resolved_ordered_volley_applied_damage_distribution(
            weapons, targets, weapon_count, layout, workspace, result, cumulative_means);
        goto cleanup;
    }
    if (!uint64_multiply_checked(PROBABILITY_SCALE, total_combination_ways, &total_weight)) {
        goto cleanup;
    }
    memset(accumulator, 0, sizeof(accumulator));
    while (!done) {
        struct probability_distribution conditional;
        struct fraction conditional_means[MAX_VOLLEY_WEAPONS];
        uint64_t combination_ways = 1u;
        uint32_t damage = 0u;
        bool advanced = false;

        weapon_index = 0u;
        while (weapon_index < weapon_count) {
            if (weapons[weapon_index].characteristic_modifier_roll_flags == 0u) {
                resolved[weapon_index] = weapons[weapon_index];
            } else if (!weapon_profile_resolve_characteristic_roll(
                           &weapons[weapon_index], outcomes[weapon_dimensions[weapon_index]],
                           &resolved[weapon_index])) {
                goto cleanup;
            }
            weapon_index++;
        }
        weapon_index = 0u;
        while (weapon_index < dimension_count) {
            if (!uint64_multiply_checked(combination_ways,
                                         rolls[weapon_index].ways[outcomes[weapon_index]],
                                         &combination_ways)) {
                goto cleanup;
            }
            weapon_index++;
        }
        if (!calculate_resolved_ordered_volley_applied_damage_distribution(
                resolved, targets, weapon_count, layout, workspace, &conditional,
                conditional_means)) {
            goto cleanup;
        }
        if (workspace->peak_sparse_states > peak_sparse_states) {
            peak_sparse_states = workspace->peak_sparse_states;
        }
        damage = conditional.minimum;
        while (damage <= conditional.maximum) {
            uint64_t weighted = 0u;
            if (conditional.mass[damage] != 0u &&
                (!uint64_multiply_checked(conditional.mass[damage], combination_ways, &weighted) ||
                 !uint64_add_checked(accumulator[damage], weighted, &accumulator[damage]))) {
                goto cleanup;
            }
            damage++;
        }
        if (conditional.minimum < minimum) {
            minimum = conditional.minimum;
        }
        if (conditional.maximum > maximum) {
            maximum = conditional.maximum;
        }
        weapon_index = 0u;
        while (weapon_index < weapon_count) {
            struct fraction weight = {combination_ways, total_combination_ways};
            struct fraction weighted = conditional_means[weapon_index];
            if (!fraction_multiply(weighted, weight, &weighted) ||
                !fraction_add(cumulative_sums[weapon_index], weighted,
                              &cumulative_sums[weapon_index])) {
                goto cleanup;
            }
            weapon_index++;
        }

        weapon_index = dimension_count;
        while (weapon_index > 0u) {
            weapon_index--;
            if (outcomes[weapon_index] < rolls[weapon_index].maximum) {
                outcomes[weapon_index]++;
                advanced = true;
                break;
            }
            outcomes[weapon_index] = (uint16_t)rolls[weapon_index].minimum;
        }
        done = !advanced;
    }
    if (minimum > maximum || !probability_distribution_from_weights(accumulator, minimum, maximum,
                                                                    total_weight, result)) {
        goto cleanup;
    }
    memcpy(cumulative_means, cumulative_sums, sizeof(*cumulative_means) * (size_t)weapon_count);
    workspace->peak_sparse_states = peak_sparse_states;
    success = true;

cleanup:
    free(rolls);
    free(roll_values);
    free(resolved);
    free(outcomes);
    free(roll_groups);
    free(weapon_dimensions);
    return success;
}

/*@ requires \valid_read(weapon) && \valid_read(target);
    requires \valid(workspace) && \valid(result);
    assigns *workspace, *result;
*/
static bool calculate_resolved_attack_damage_distribution(const struct weapon_profile *weapon,
                                                          const struct target_profile *target,
                                                          uint16_t target_models,
                                                          bool apply_to_unit,
                                                          struct calculator_workspace *workspace,
                                                          struct probability_distribution *result) {
    struct attack_plan plan;
    struct probability_distribution *attack_count = NULL;
    struct probability_distribution *single_attack = NULL;
    struct probability_distribution *current = NULL;
    struct probability_distribution *next = NULL;
    struct probability_distribution *final_distribution = NULL;
    uint32_t attack_number = 0;
    uint32_t maximum_damage = 0;
    const uint64_t total_weight = (uint64_t)PROBABILITY_SCALE * (uint64_t)PROBABILITY_SCALE;

    if (weapon == NULL || target == NULL || workspace == NULL || result == NULL ||
        (apply_to_unit && (target_models == 0u || target->wounds == 0u))) {
        return false;
    }
    if (target->first_failed_save_damage_replacement_active) {
        struct target_profile deferred_target = *target;
        struct target_unit_layout layout;
        struct fraction cumulative_mean;
        memset(&layout, 0, sizeof(layout));
        layout.segment_count = 1u;
        if (apply_to_unit) {
            layout.wounds_per_model[0] = target->wounds;
            layout.model_counts[0] = target_models;
        } else {
            deferred_target.wounds = MAX_DISTRIBUTION_RESULT;
            layout.wounds_per_model[0] = MAX_DISTRIBUTION_RESULT;
            layout.model_counts[0] = 1u;
        }
        if (target_unit_capacity(&layout) == 0u) {
            return false;
        }
        return calculate_deferred_ordered_volley_prefix(weapon, &deferred_target, 1u, &layout,
                                                        workspace, result, &cumulative_mean, false);
    }
    if (!attack_plan_build(weapon, target, &plan) ||
        !build_single_attack_probability_distribution(weapon, &plan, workspace,
                                                      &workspace->probability_b) ||
        !apply_feel_no_pain(&workspace->probability_b, plan.feel_no_pain_on, workspace,
                            &workspace->probability_b) ||
        !distribution_from_weapon_attacks(weapon, &workspace->exact_a) ||
        !probability_distribution_from_exact(&workspace->exact_a, &workspace->probability_a)) {
        return false;
    }

    attack_count = &workspace->probability_a;
    single_attack = &workspace->probability_b;
    current = &workspace->probability_c;
    next = &workspace->probability_d;

    if (single_attack->maximum != 0u &&
        attack_count->maximum > MAX_DISTRIBUTION_RESULT / single_attack->maximum) {
        return false;
    }

    maximum_damage = attack_count->maximum * single_attack->maximum;
    if (apply_to_unit) {
        uint64_t capacity = (uint64_t)target->wounds * target_models;
        if (capacity < maximum_damage) {
            maximum_damage = (uint32_t)capacity;
        }
    }

    if (!probability_distribution_from_constant(0u, current)) {
        return false;
    }

    memset(workspace->mixture_accumulator, 0, sizeof(workspace->mixture_accumulator));
    attack_number = 0u;
    while (attack_number <= attack_count->maximum) {
        uint32_t attack_mass = attack_count->mass[attack_number];

        if (attack_mass != 0u) {
            uint32_t damage = current->minimum;
            while (damage <= current->maximum) {
                if (current->mass[damage] != 0u) {
                    uint64_t product = (uint64_t)attack_mass * current->mass[damage];
                    if (!uint64_add_checked(workspace->mixture_accumulator[damage], product,
                                            &workspace->mixture_accumulator[damage])) {
                        return false;
                    }
                }
                damage++;
            }
        }

        if (attack_number < attack_count->maximum) {
            struct probability_distribution *swap = NULL;
            bool advanced =
                apply_to_unit
                    ? probability_distribution_allocate_attack_internal(
                          current, single_attack, target->wounds, target_models,
                          workspace->convolution_accumulator, next)
                    : probability_distribution_convolve_internal(
                          current, single_attack, workspace->convolution_accumulator, next);
            if (!advanced) {
                return false;
            }
            swap = current;
            current = next;
            next = swap;
        }
        attack_number++;
    }

    final_distribution = next;
    if (!probability_distribution_from_weights(workspace->mixture_accumulator, 0u, maximum_damage,
                                               total_weight, final_distribution)) {
        return false;
    }
    if (result != final_distribution) {
        memcpy(result, final_distribution, sizeof(*result));
    }
    return true;
}

/*@ requires \valid_read(weapon) && \valid_read(target);
    requires \valid(workspace) && \valid(result);
    assigns *workspace, *result;
*/
static bool calculate_attack_damage_distribution_internal(const struct weapon_profile *weapon,
                                                          const struct target_profile *target,
                                                          uint16_t target_models,
                                                          bool apply_to_unit,
                                                          struct calculator_workspace *workspace,
                                                          struct probability_distribution *result) {
    struct distribution characteristic_roll;
    uint64_t accumulator[MAX_DISTRIBUTION_RESULT + 1u];
    uint64_t total_weight = 0u;
    uint32_t minimum = MAX_DISTRIBUTION_RESULT;
    uint32_t maximum = 0u;
    uint32_t outcome = 0u;

    if (weapon == NULL || target == NULL || workspace == NULL || result == NULL) {
        return false;
    }
    if (weapon->characteristic_modifier_roll_flags == 0u) {
        if (weapon->characteristic_modifier_roll.dice_count != 0u ||
            weapon->characteristic_modifier_roll.dice_sides != 0u ||
            weapon->characteristic_modifier_roll.modifier != 0u ||
            weapon->characteristic_modifier_roll_group != 0u) {
            return false;
        }
        return calculate_resolved_attack_damage_distribution(weapon, target, target_models,
                                                             apply_to_unit, workspace, result);
    }
    if (!distribution_from_dice_value(weapon->characteristic_modifier_roll, &characteristic_roll) ||
        !uint64_multiply_checked(PROBABILITY_SCALE, characteristic_roll.total_ways,
                                 &total_weight)) {
        return false;
    }
    memset(accumulator, 0, sizeof(accumulator));
    outcome = characteristic_roll.minimum;
    while (outcome <= characteristic_roll.maximum) {
        uint64_t ways = characteristic_roll.ways[outcome];
        if (ways != 0u) {
            struct weapon_profile resolved;
            struct probability_distribution conditional;
            uint32_t damage = 0u;
            if (!weapon_profile_resolve_characteristic_roll(weapon, (uint16_t)outcome, &resolved) ||
                !calculate_resolved_attack_damage_distribution(
                    &resolved, target, target_models, apply_to_unit, workspace, &conditional)) {
                return false;
            }
            damage = conditional.minimum;
            while (damage <= conditional.maximum) {
                uint64_t weighted = 0u;
                if (conditional.mass[damage] != 0u &&
                    (!uint64_multiply_checked(conditional.mass[damage], ways, &weighted) ||
                     !uint64_add_checked(accumulator[damage], weighted, &accumulator[damage]))) {
                    return false;
                }
                damage++;
            }
            if (conditional.minimum < minimum) {
                minimum = conditional.minimum;
            }
            if (conditional.maximum > maximum) {
                maximum = conditional.maximum;
            }
        }
        outcome++;
    }
    return minimum <= maximum && probability_distribution_from_weights(
                                     accumulator, minimum, maximum, total_weight, result);
}

bool calculate_attack_damage_distribution(const struct weapon_profile *weapon,
                                          const struct target_profile *target,
                                          struct calculator_workspace *workspace,
                                          struct probability_distribution *result) {
    return calculate_attack_damage_distribution_internal(weapon, target, 0u, false, workspace,
                                                         result);
}

bool calculate_attack_applied_damage_distribution(const struct weapon_profile *weapon,
                                                  const struct target_profile *target,
                                                  uint16_t target_models,
                                                  struct calculator_workspace *workspace,
                                                  struct probability_distribution *result) {
    return calculate_attack_damage_distribution_internal(weapon, target, target_models, true,
                                                         workspace, result);
}

/*@ requires \valid_read(weapon) && \valid_read(target);
    requires \valid(workspace) && \valid(result);
    assigns *workspace, *result;
*/
static bool calculate_resolved_attack_expected_damage(const struct weapon_profile *weapon,
                                                      const struct target_profile *target,
                                                      struct calculator_workspace *workspace,
                                                      struct fraction *result) {
    struct attack_plan plan;
    struct fraction attack_mean;
    struct fraction single_attack_mean;

    if (weapon == NULL || target == NULL || workspace == NULL || result == NULL) {
        return false;
    }
    if (target->first_failed_save_damage_replacement_active) {
        if (!calculate_resolved_attack_damage_distribution(weapon, target, 0u, false, workspace,
                                                           &workspace->probability_d)) {
            return false;
        }
        return probability_distribution_mean(&workspace->probability_d, result);
    }
    if (!attack_plan_build(weapon, target, &plan) ||
        !build_single_attack_expected_damage(weapon, &plan, workspace, &single_attack_mean)) {
        return false;
    }

    if (plan.feel_no_pain_on != 0) {
        struct fraction damage_survival = {.numerator = (uint64_t)plan.feel_no_pain_on - 1u,
                                           .denominator = 6u};

        if (!fraction_multiply(single_attack_mean, damage_survival, &single_attack_mean)) {
            return false;
        }
    }

    if (!distribution_from_weapon_attacks(weapon, &workspace->exact_a) ||
        !distribution_mean(&workspace->exact_a, &attack_mean)) {
        return false;
    }

    return fraction_multiply(attack_mean, single_attack_mean, result);
}

bool calculate_attack_expected_damage(const struct weapon_profile *weapon,
                                      const struct target_profile *target,
                                      struct calculator_workspace *workspace,
                                      struct fraction *result) {
    struct distribution characteristic_roll;
    struct fraction mean = {0u, 1u};
    uint32_t outcome = 0u;

    if (weapon == NULL || target == NULL || workspace == NULL || result == NULL) {
        return false;
    }
    if (weapon->characteristic_modifier_roll_flags == 0u) {
        if (weapon->characteristic_modifier_roll.dice_count != 0u ||
            weapon->characteristic_modifier_roll.dice_sides != 0u ||
            weapon->characteristic_modifier_roll.modifier != 0u ||
            weapon->characteristic_modifier_roll_group != 0u) {
            return false;
        }
        return calculate_resolved_attack_expected_damage(weapon, target, workspace, result);
    }
    if (!distribution_from_dice_value(weapon->characteristic_modifier_roll, &characteristic_roll)) {
        return false;
    }
    outcome = characteristic_roll.minimum;
    while (outcome <= characteristic_roll.maximum) {
        uint64_t ways = characteristic_roll.ways[outcome];
        if (ways != 0u) {
            struct weapon_profile resolved;
            struct fraction conditional;
            struct fraction weight = {ways, characteristic_roll.total_ways};
            if (!weapon_profile_resolve_characteristic_roll(weapon, (uint16_t)outcome, &resolved) ||
                !calculate_resolved_attack_expected_damage(&resolved, target, workspace,
                                                           &conditional) ||
                !fraction_multiply(conditional, weight, &conditional) ||
                !fraction_add(mean, conditional, &mean)) {
                return false;
            }
        }
        outcome++;
    }
    *result = mean;
    return true;
}

bool calculate_attack_damage_summary(const struct weapon_profile *weapon,
                                     const struct target_profile *target,
                                     struct calculator_workspace *workspace,
                                     struct distribution_summary *summary) {
    struct fraction exact_mean;

    if (workspace == NULL || summary == NULL) {
        return false;
    }

    if (!calculate_attack_damage_distribution(weapon, target, workspace,
                                              &workspace->probability_d) ||
        !probability_distribution_summarize(&workspace->probability_d, summary) ||
        !calculate_attack_expected_damage(weapon, target, workspace, &exact_mean)) {
        return false;
    }

    summary->mean = exact_mean;
    return true;
}

bool calculate_attack_applied_damage_summary(const struct weapon_profile *weapon,
                                             const struct target_profile *target,
                                             uint16_t target_models,
                                             struct calculator_workspace *workspace,
                                             struct distribution_summary *summary) {
    if (workspace == NULL || summary == NULL ||
        !calculate_attack_applied_damage_distribution(weapon, target, target_models, workspace,
                                                      &workspace->probability_d)) {
        return false;
    }
    return probability_distribution_summarize(&workspace->probability_d, summary);
}
