#include "warhammercalculator/calculator.h"

#include <limits.h>
#include <string.h>

#define VALID_D6_FACE_MASK UINT8_C(0x7E)

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

/*@ assigns \nothing;
    ensures \result <==> ((critical_on >= 2 && face >= critical_on) || face >= succeeds_on);
*/
static bool roll_is_success(uint8_t face, uint8_t succeeds_on, uint8_t critical_on) {
    bool critical = critical_on >= 2u && critical_on <= 6u && face >= critical_on;

    return critical || (succeeds_on <= 6u && face >= succeeds_on);
}

/*@ assigns \nothing;
    ensures (\result & ~VALID_D6_FACE_MASK) == 0;
*/
static uint8_t failed_roll_mask(uint8_t succeeds_on, uint8_t critical_on) {
    uint8_t mask = 0;
    uint8_t face = 1;

    while (face <= 6u) {
        if (!roll_is_success(face, succeeds_on, critical_on)) {
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
                                  uint8_t critical_on, struct roll_categories *categories) {
    uint8_t face = 1;

    memset(categories, 0, sizeof(*categories));

    while (face <= 6u) {
        uint64_t ways = table->ways[face];
        bool critical = critical_on >= 2u && critical_on <= 6u && face >= critical_on;

        if (critical) {
            categories->critical += ways;
        } else if (succeeds_on <= 6u && face >= succeeds_on) {
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
    uint32_t damage = raw_damage;
    uint8_t transform_index = 0;

    if (plan == NULL || result == NULL) {
        return false;
    }

    if (damage != 0 && plan->damage_reduction != 0) {
        if (damage > plan->damage_reduction) {
            damage -= plan->damage_reduction;
        } else {
            damage = 0;
        }

        if (damage < plan->damage_floor) {
            damage = plan->damage_floor;
        }
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
        !distribution_from_dice_value(weapon->damage, damage_distribution) ||
        !roll_table_build(plan->hit_reroll_mask, &hit_table) ||
        !roll_table_build(plan->wound_reroll_mask, &wound_table) ||
        !roll_table_build(plan->save_reroll_mask, &save_table)) {
        return false;
    }

    classify_attack_rolls(&hit_table, plan->hits_on, plan->critical_hits_on, &hit_categories);
    classify_attack_rolls(&wound_table, plan->wounds_on, plan->critical_wounds_on,
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
    conditional.sustained_hits = 0u;
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
    uint8_t extra_hit = 0;
    uint32_t outcome = 0;
    uint32_t maximum = 0;
    uint64_t total_weight = 0;
    bool lethal = false;
    bool auto_hits = false;

    if (weapon == NULL || plan == NULL || workspace == NULL || result == NULL) {
        return false;
    }

    auto_hits = (plan->flags & ATTACK_PLAN_AUTO_HITS) != 0;
    if (plan->sustained_hits == 0u && !auto_hits) {
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
    critical_hit = lethal ? automatic_wound : normal_hit;
    next = &workspace->probability_d;

    extra_hit = 0;
    while (extra_hit < plan->sustained_hits) {
        struct probability_distribution *swap = NULL;

        if (!probability_distribution_convolve_internal(critical_hit, normal_hit,
                                                        workspace->convolution_accumulator, next)) {
            return false;
        }

        swap = critical_hit;
        critical_hit = next;
        next = swap == normal_hit ? automatic_wound : swap;
        extra_hit++;
    }

    classify_attack_rolls(&hit_table, plan->hits_on, plan->critical_hits_on, &hit_categories);

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

    if (plan->sustained_hits != 0u) {
        struct fraction additional = {.numerator = plan->sustained_hits, .denominator = 1u};

        if (!fraction_multiply(normal_mean, additional, &additional) ||
            !fraction_add(critical_mean, additional, &critical_mean)) {
            return false;
        }
    }

    if (!roll_table_build(plan->hit_reroll_mask, &hit_table)) {
        return false;
    }
    classify_attack_rolls(&hit_table, plan->hits_on, plan->critical_hits_on, &hit_categories);

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
static bool compile_set_sustained_hits(struct attack_plan *plan,
                                       const struct weapon_profile *weapon,
                                       const struct target_profile *target,
                                       const union rule_payload *payload) {
    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL || payload->u8[0] > 6u) {
        return false;
    }

    plan->sustained_hits = payload->u8[0];
    return true;
}

/*@ requires \valid(plan) && \valid_read(weapon) && \valid_read(target) && \valid_read(payload);
    assigns *plan;
*/
static bool compile_wound_bonus(struct attack_plan *plan, const struct weapon_profile *weapon,
                                const struct target_profile *target,
                                const union rule_payload *payload) {
    uint8_t bonus = 0;

    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL || payload->u8[0] > 5u) {
        return false;
    }

    bonus = payload->u8[0];
    plan->wounds_on =
        plan->wounds_on > (uint8_t)(2u + bonus) ? (uint8_t)(plan->wounds_on - bonus) : 2u;
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

    if (distribution == NULL || result == NULL || distribution->total_mass != PROBABILITY_SCALE) {
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

    if (distribution == NULL || result == NULL || distribution->total_mass != PROBABILITY_SCALE ||
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
    if (distribution == NULL || summary == NULL || distribution->total_mass != PROBABILITY_SCALE) {
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

bool rule_add_sustained_hits(struct rule_set *rules, uint8_t additional_hits) {
    union rule_payload payload = {0};

    if (additional_hits == 0u || additional_hits > 6u) {
        return false;
    }

    payload.u8[0] = additional_hits;
    return rule_set_add(rules, compile_set_sustained_hits, payload);
}

bool rule_add_torrent(struct rule_set *rules) {
    union rule_payload payload = {0};
    payload.u32[0] = ATTACK_PLAN_AUTO_HITS;
    return rule_set_add(rules, compile_add_flags, payload);
}

bool rule_add_wound_bonus(struct rule_set *rules, uint8_t bonus) {
    union rule_payload payload = {0};

    if (bonus == 0u || bonus > 5u) {
        return false;
    }

    payload.u8[0] = bonus;
    return rule_set_add(rules, compile_wound_bonus, payload);
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

bool attack_plan_build(const struct weapon_profile *weapon, const struct target_profile *target,
                       struct attack_plan *plan) {
    uint8_t rule_index = 0;

    if (weapon == NULL || target == NULL || plan == NULL || !dice_value_is_valid(weapon->attacks) ||
        !dice_value_is_valid(weapon->damage) || weapon->hits_on < 2u || weapon->hits_on > 6u ||
        weapon->strength == 0 || target->toughness == 0 || target->save < 2u || target->save > 7u ||
        (target->invulnerable_save != 0 &&
         (target->invulnerable_save < 2u || target->invulnerable_save > 6u)) ||
        (target->feel_no_pain != 0 && (target->feel_no_pain < 2u || target->feel_no_pain > 6u)) ||
        weapon->rules.count > MAX_PROFILE_RULES || target->rules.count > MAX_PROFILE_RULES) {
        return false;
    }

    memset(plan, 0, sizeof(*plan));
    plan->hits_on = weapon->hits_on;
    plan->wounds_on = wounds_on(weapon->strength, target->toughness);
    plan->saves_on = saves_on(target->save, target->invulnerable_save, weapon->ap);
    plan->critical_hits_on = weapon->critical_hits_on == 0 ? 6u : weapon->critical_hits_on;
    plan->critical_wounds_on = 6u;
    plan->feel_no_pain_on = target->feel_no_pain;
    plan->damage_reduction = target->reduction;
    plan->damage_floor = 1;

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

    if (plan->hits_on < 2u || plan->hits_on > 6u || plan->wounds_on < 2u || plan->wounds_on > 6u ||
        plan->saves_on < 2u || plan->saves_on > 7u || plan->critical_hits_on < 2u ||
        plan->critical_hits_on > 6u || plan->critical_wounds_on < 2u ||
        plan->critical_wounds_on > 6u ||
        (plan->feel_no_pain_on != 0 &&
         (plan->feel_no_pain_on < 2u || plan->feel_no_pain_on > 6u))) {
        return false;
    }

    if ((plan->flags & ATTACK_PLAN_REROLL_FAILED_HITS) != 0) {
        plan->hit_reroll_mask |= failed_roll_mask(plan->hits_on, plan->critical_hits_on);
    }

    if ((plan->flags & ATTACK_PLAN_REROLL_FAILED_WOUNDS) != 0) {
        plan->wound_reroll_mask |= failed_roll_mask(plan->wounds_on, plan->critical_wounds_on);
    }

    if ((plan->flags & ATTACK_PLAN_REROLL_FAILED_SAVES) != 0) {
        plan->save_reroll_mask |= failed_roll_mask(plan->saves_on, 0);
    }

    plan->hit_reroll_mask &= VALID_D6_FACE_MASK;
    plan->wound_reroll_mask &= VALID_D6_FACE_MASK;
    plan->save_reroll_mask &= VALID_D6_FACE_MASK;
    return true;
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

static bool calculate_attack_damage_distribution_internal(const struct weapon_profile *weapon,
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
        (apply_to_unit && (target_models == 0u || target->wounds == 0u)) ||
        !attack_plan_build(weapon, target, &plan) ||
        !build_single_attack_probability_distribution(weapon, &plan, workspace,
                                                      &workspace->probability_b) ||
        !apply_feel_no_pain(&workspace->probability_b, plan.feel_no_pain_on, workspace,
                            &workspace->probability_b) ||
        !distribution_from_dice_value(weapon->attacks, &workspace->exact_a) ||
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

bool calculate_attack_expected_damage(const struct weapon_profile *weapon,
                                      const struct target_profile *target,
                                      struct calculator_workspace *workspace,
                                      struct fraction *result) {
    struct attack_plan plan;
    struct fraction attack_mean;
    struct fraction single_attack_mean;

    if (weapon == NULL || target == NULL || workspace == NULL || result == NULL ||
        !attack_plan_build(weapon, target, &plan) ||
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

    if (!distribution_from_dice_value(weapon->attacks, &workspace->exact_a) ||
        !distribution_mean(&workspace->exact_a, &attack_mean)) {
        return false;
    }

    return fraction_multiply(attack_mean, single_attack_mean, result);
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
