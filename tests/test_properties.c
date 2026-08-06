#include "warhammercalculator/calculator.h"

#include <assert.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/*@ requires \valid(state);
    assigns *state;
    ensures \result <= UINT32_MAX;
*/
static uint32_t next_random(uint32_t *state) {
    uint32_t value = *state;

    value ^= value << 13u;
    value ^= value >> 17u;
    value ^= value << 5u;
    *state = value;
    return value;
}

/*@ requires \valid(state);
    requires maximum > 0;
    assigns *state;
    ensures \result < maximum;
*/
static uint32_t random_below(uint32_t *state, uint32_t maximum) {
    return next_random(state) % maximum;
}

/*@ requires value.denominator != 0;
    assigns \nothing;
*/
static long double fraction_value(struct fraction value) {
    return (long double)value.numerator / (long double)value.denominator;
}

/*@ requires \valid_read(distribution);
    assigns \nothing;
*/
static void assert_probability_invariants(const struct probability_distribution *distribution) {
    uint64_t mass = 0u;
    uint32_t outcome = 0u;

    assert(probability_distribution_is_normalized(distribution));
    assert(distribution->minimum <= distribution->maximum);
    assert(distribution->maximum <= MAX_DISTRIBUTION_RESULT);
    while (outcome <= MAX_DISTRIBUTION_RESULT) {
        mass += distribution->mass[outcome];
        if (outcome < distribution->minimum || outcome > distribution->maximum) {
            assert(distribution->mass[outcome] == 0u);
        }
        outcome++;
    }
    assert(mass == PROBABILITY_SCALE);
    assert(distribution->total_mass == PROBABILITY_SCALE);
}

/*@ terminates \true; */
static void test_dice_properties(void) {
    uint32_t state = UINT32_C(0x6d2b79f5);
    uint32_t iteration = 0u;

    while (iteration < 5000u) {
        struct dice_value dice;
        struct distribution distribution;
        struct distribution_summary summary;
        uint64_t ways = 0u;
        uint32_t outcome = 0u;

        dice.dice_count = (uint16_t)random_below(&state, 4u);
        dice.dice_sides = dice.dice_count == 0u ? 0u : (uint16_t)(2u + random_below(&state, 7u));
        dice.modifier = (uint16_t)random_below(&state, 9u);
        assert(dice_value_is_valid(dice));
        assert(distribution_from_dice_value(dice, &distribution));
        assert(distribution_is_valid(&distribution));
        assert(distribution.minimum ==
               (uint32_t)dice.modifier + (dice.dice_count == 0u ? 0u : dice.dice_count));
        assert(distribution.maximum ==
               (uint32_t)dice.modifier + (uint32_t)dice.dice_count * dice.dice_sides);
        while (outcome <= MAX_DISTRIBUTION_RESULT) {
            ways += distribution.ways[outcome];
            outcome++;
        }
        assert(ways == distribution.total_ways);
        assert(distribution_summarize(&distribution, &summary));
        assert(summary.minimum <= summary.first_quartile);
        assert(summary.first_quartile <= summary.median);
        assert(summary.median <= summary.third_quartile);
        assert(summary.third_quartile <= summary.maximum);
        iteration++;
    }
}

/*@ terminates \true; */
static void test_allocation_properties(void) {
    uint32_t state = UINT32_C(0xa341316c);
    uint32_t iteration = 0u;

    while (iteration < 10000u) {
        uint16_t wounds = (uint16_t)(1u + random_below(&state, 20u));
        uint16_t models = (uint16_t)(1u + random_below(&state, 20u));
        uint32_t capacity = (uint32_t)wounds * models;
        uint32_t applied = random_below(&state, capacity + 21u);
        uint32_t incoming = random_below(&state, 41u);
        uint32_t before = applied < capacity ? applied : capacity;
        uint32_t remaining = before == capacity ? 0u : wounds - before % wounds;
        uint32_t expected = before + (incoming < remaining ? incoming : remaining);
        uint32_t actual = allocate_damage_to_unit(applied, incoming, wounds, models);

        assert(actual == expected);
        assert(actual >= before);
        assert(actual <= capacity);
        assert(actual - before <= incoming);
        iteration++;
    }
}

/*@ requires \valid(weapon) && \valid(target) && \valid(state);
    requires \separated(weapon, target, state);
    assigns *weapon, *target, *state;
*/
static void generate_profiles(struct weapon_profile *weapon, struct target_profile *target,
                              uint32_t *state) {
    uint32_t flags = next_random(state);

    memset(weapon, 0, sizeof(*weapon));
    memset(target, 0, sizeof(*target));
    if ((flags & 1u) != 0u) {
        weapon->attacks = (struct dice_value){1u, (uint16_t)(2u + random_below(state, 3u)),
                                              (uint16_t)random_below(state, 3u)};
    } else {
        weapon->attacks = (struct dice_value){0u, 0u, (uint16_t)(1u + random_below(state, 5u))};
    }
    weapon->hits_on = (uint8_t)(2u + random_below(state, 5u));
    weapon->strength = (uint16_t)(1u + random_below(state, 16u));
    weapon->ap = (uint16_t)random_below(state, 5u);
    if ((flags & 2u) != 0u) {
        weapon->damage = (struct dice_value){1u, (uint16_t)(2u + random_below(state, 3u)),
                                             (uint16_t)random_below(state, 3u)};
    } else {
        weapon->damage = (struct dice_value){0u, 0u, (uint16_t)(1u + random_below(state, 5u))};
    }
    weapon->critical_hits_on = (uint8_t)(5u + random_below(state, 2u));
    target->toughness = (uint16_t)(1u + random_below(state, 16u));
    target->save = (uint8_t)(2u + random_below(state, 6u));
    target->invulnerable_save = (flags & 4u) != 0u ? (uint8_t)(2u + random_below(state, 5u)) : 0u;
    target->feel_no_pain = 0u;
    target->wounds = (uint16_t)(1u + random_below(state, 10u));
    target->reduction = (uint16_t)random_below(state, 3u);
    if ((flags & 8u) != 0u) {
        assert(rule_add_lethal_hits(&weapon->rules));
    }
    if ((flags & 16u) != 0u) {
        assert(rule_add_devastating_wounds(&weapon->rules));
    }
    if ((flags & 32u) != 0u) {
        assert(rule_add_twin_linked(&weapon->rules));
    }
    if ((flags & 64u) != 0u) {
        assert(rule_add_reroll_failed_hits(&weapon->rules));
    }
    if ((flags & 128u) != 0u) {
        assert(rule_add_sustained_hits(&weapon->rules, (uint8_t)(1u + random_below(state, 2u))));
    }
}

/*@ terminates \true; */
static void test_attack_properties(void) {
    uint32_t state = UINT32_C(0xc8013ea4);
    uint32_t iteration = 0u;

    while (iteration < 300u) {
        struct weapon_profile weapon;
        struct weapon_profile better_ap;
        struct target_profile target;
        struct target_profile protected_target;
        struct calculator_workspace workspace;
        struct probability_distribution potential;
        struct probability_distribution applied;
        struct attack_plan plan;
        struct distribution_summary summary;
        struct fraction baseline_mean;
        struct fraction better_ap_mean;
        struct fraction protected_mean;
        uint16_t target_models = (uint16_t)(1u + random_below(&state, 5u));

        generate_profiles(&weapon, &target, &state);
        assert(attack_plan_build(&weapon, &target, &plan));
        assert(attack_plan_is_valid(&plan));
        assert(calculate_attack_damage_distribution(&weapon, &target, &workspace, &potential));
        assert_probability_invariants(&potential);
        assert(probability_distribution_summarize(&potential, &summary));
        assert(summary.minimum <= summary.first_quartile);
        assert(summary.first_quartile <= summary.median);
        assert(summary.median <= summary.third_quartile);
        assert(summary.third_quartile <= summary.maximum);
        assert(calculate_attack_applied_damage_distribution(&weapon, &target, target_models,
                                                            &workspace, &applied));
        assert_probability_invariants(&applied);
        assert(applied.maximum <= (uint32_t)target.wounds * target_models);
        assert(applied.maximum <= potential.maximum);
        assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &baseline_mean));

        better_ap = weapon;
        if (better_ap.ap < UINT16_MAX) {
            better_ap.ap++;
        }
        assert(calculate_attack_expected_damage(&better_ap, &target, &workspace, &better_ap_mean));
        assert(fraction_value(better_ap_mean) + 1.0e-15L >= fraction_value(baseline_mean));

        protected_target = target;
        protected_target.feel_no_pain = (uint8_t)(2u + random_below(&state, 5u));
        assert(calculate_attack_expected_damage(&weapon, &protected_target, &workspace,
                                                &protected_mean));
        assert(fraction_value(protected_mean) <= fraction_value(baseline_mean) + 1.0e-15L);
        iteration++;
    }
}

/*@ terminates \true;
    ensures \result == 0;
*/
int main(void) {
    test_dice_properties();
    test_allocation_properties();
    test_attack_properties();
    puts("all generated properties passed");
    return 0;
}
