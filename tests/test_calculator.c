#include "warhammercalculator/calculator.h"
#include "warhammercalculator/web_api.h"

#include <assert.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>

/*@ terminates \true; */
static void test_dice(void) {
    struct distribution d;
    struct distribution_summary s;
    struct dice_value two_d6 = {2, 6, 0};

    assert(distribution_from_dice_value(two_d6, &d));
    assert(d.minimum == 2);
    assert(d.maximum == 12);
    assert(d.total_ways == 36);
    assert(d.ways[2] == 1);
    assert(d.ways[7] == 6);
    assert(d.ways[12] == 1);
    assert(distribution_summarize(&d, &s));
    assert(s.first_quartile == 5);
    assert(s.median == 7);
    assert(s.third_quartile == 9);
    assert(s.mean.numerator == 7);
    assert(s.mean.denominator == 1);
}

/*@ requires \valid(weapon) && \valid(target);
    requires \separated(weapon, target);
    assigns *weapon, *target;
    ensures weapon->hits_on == 3 && weapon->strength == 4;
    ensures target->toughness == 4 && target->save == 3;
*/
static void initialize_profiles(struct weapon_profile *weapon, struct target_profile *target) {
    memset(weapon, 0, sizeof(*weapon));
    memset(target, 0, sizeof(*target));

    memcpy(weapon->name, "Test weapon", sizeof("Test weapon"));
    weapon->attacks = (struct dice_value){0, 0, 1};
    weapon->hits_on = 3;
    weapon->strength = 4;
    weapon->ap = 0;
    weapon->damage = (struct dice_value){0, 0, 2};
    weapon->critical_hits_on = 6;

    memcpy(target->name, "Test target", sizeof("Test target"));
    target->toughness = 4;
    target->save = 3;
    target->invulnerable_save = 0;
    target->feel_no_pain = 0;
    target->wounds = 10;
    target->reduction = 0;
}

struct rule_interaction_case {
    const char *name;
    uint16_t attacks;
    uint8_t hits_on;
    uint16_t strength;
    uint16_t ap;
    uint16_t damage;
    uint8_t critical_hits_on;
    uint16_t toughness;
    uint8_t save;
    uint8_t invulnerable_save;
    uint8_t feel_no_pain;
    uint16_t wounds;
    uint16_t target_models;
    uint32_t flags;
    uint8_t critical_wounds_on;
    uint16_t sustained_hits;
    int16_t hit_modifier;
    int16_t wound_modifier;
    uint64_t expected_numerator;
    uint64_t expected_denominator;
    uint64_t applied_numerator;
    uint64_t applied_denominator;
};

#define WHC_RULE_CASE(case_name, attacks, hits_on, strength, ap, damage, critical_hits_on,         \
                      toughness, save, invulnerable_save, feel_no_pain, wounds, target_models,     \
                      flags, critical_wounds_on, sustained_hits, hit_modifier, wound_modifier,     \
                      expected_numerator, expected_denominator, applied_numerator,                 \
                      applied_denominator)                                                         \
    {#case_name,                                                                                   \
     attacks,                                                                                      \
     hits_on,                                                                                      \
     strength,                                                                                     \
     ap,                                                                                           \
     damage,                                                                                       \
     critical_hits_on,                                                                             \
     toughness,                                                                                    \
     save,                                                                                         \
     invulnerable_save,                                                                            \
     feel_no_pain,                                                                                 \
     wounds,                                                                                       \
     target_models,                                                                                \
     flags,                                                                                        \
     critical_wounds_on,                                                                           \
     sustained_hits,                                                                               \
     hit_modifier,                                                                                 \
     wound_modifier,                                                                               \
     expected_numerator,                                                                           \
     expected_denominator,                                                                         \
     applied_numerator,                                                                            \
     applied_denominator},
static const struct rule_interaction_case rule_interaction_cases[] = {
#include "rules_interaction_cases.inc"
};
#undef WHC_RULE_CASE

/*@ terminates \true; */
static void test_rule_interaction_corpus(void) {
    size_t index = 0u;

    while (index < sizeof(rule_interaction_cases) / sizeof(rule_interaction_cases[0])) {
        const struct rule_interaction_case *test_case = &rule_interaction_cases[index];
        struct whc_web_summary summary;
        uint64_t expected_numerator = 0u;
        uint64_t expected_denominator = 0u;
        uint64_t applied_numerator = 0u;
        uint64_t applied_denominator = 0u;
        long double applied_value = 0.0L;
        long double expected_applied_value = 0.0L;
        long double applied_difference = 0.0L;

        assert(whc_calculate_summary(
            0u, 0u, test_case->attacks, 1u, test_case->hits_on, test_case->strength, test_case->ap,
            0u, 0u, test_case->damage, test_case->critical_hits_on, test_case->toughness,
            test_case->save, test_case->invulnerable_save, test_case->feel_no_pain,
            test_case->wounds, 0u, test_case->flags, test_case->critical_wounds_on,
            test_case->target_models, 0u, 0u, test_case->sustained_hits, 0u, 0u, 0u, 0u,
            test_case->hit_modifier, test_case->wound_modifier, 0, 0, 0, &summary));
        expected_numerator =
            summary.mean_numerator_low | ((uint64_t)summary.mean_numerator_high << 32u);
        expected_denominator =
            summary.mean_denominator_low | ((uint64_t)summary.mean_denominator_high << 32u);
        applied_numerator = summary.applied_mean_numerator_low |
                            ((uint64_t)summary.applied_mean_numerator_high << 32u);
        applied_denominator = summary.applied_mean_denominator_low |
                              ((uint64_t)summary.applied_mean_denominator_high << 32u);
        applied_value = (long double)applied_numerator / (long double)applied_denominator;
        expected_applied_value =
            (long double)test_case->applied_numerator / (long double)test_case->applied_denominator;
        applied_difference = applied_value > expected_applied_value
                                 ? applied_value - expected_applied_value
                                 : expected_applied_value - applied_value;
        if (expected_numerator != test_case->expected_numerator ||
            expected_denominator != test_case->expected_denominator ||
            applied_difference >= 1.0e-8L) {
            fprintf(stderr,
                    "%s: potential=%" PRIu64 "/%" PRIu64 ", applied=%" PRIu64 "/%" PRIu64 "\n",
                    test_case->name, expected_numerator, expected_denominator, applied_numerator,
                    applied_denominator);
        }
        assert(expected_numerator == test_case->expected_numerator);
        assert(expected_denominator == test_case->expected_denominator);
        assert(applied_difference < 1.0e-8L);
        index++;
    }
}

/*@ terminates \true; */
static void test_probability_and_plan_validators(void) {
    struct weapon_profile weapon;
    struct target_profile target;
    struct attack_plan plan;
    struct attack_plan invalid_plan;
    struct calculator_workspace workspace;
    struct probability_distribution distribution;
    struct probability_distribution invalid_distribution;

    initialize_profiles(&weapon, &target);
    assert(attack_plan_build(&weapon, &target, &plan));
    assert(attack_plan_is_valid(&plan));

    invalid_plan = plan;
    invalid_plan.flags |= UINT32_C(1) << 31u;
    assert(!attack_plan_is_valid(&invalid_plan));
    invalid_plan = plan;
    invalid_plan.hit_reroll_mask |= UINT8_C(1);
    assert(!attack_plan_is_valid(&invalid_plan));
    invalid_plan = plan;
    invalid_plan.sustained_hits = (struct dice_value){1u, 0u, 0u};
    assert(!attack_plan_is_valid(&invalid_plan));
    invalid_plan = plan;
    invalid_plan.damage_transform_count = 1u;
    invalid_plan.damage_transforms[0].apply = NULL;
    assert(!attack_plan_is_valid(&invalid_plan));

    assert(calculate_attack_damage_distribution(&weapon, &target, &workspace, &distribution));
    assert(probability_distribution_is_normalized(&distribution));
    invalid_distribution = distribution;
    invalid_distribution.mass[invalid_distribution.minimum]--;
    assert(!probability_distribution_is_normalized(&invalid_distribution));
    assert(!probability_distribution_summarize(&invalid_distribution,
                                               &(struct distribution_summary){0}));
    assert(!probability_distribution_mean(&invalid_distribution, &(struct fraction){0}));
    invalid_distribution = distribution;
    invalid_distribution.total_mass--;
    assert(!probability_distribution_is_normalized(&invalid_distribution));
    invalid_distribution = distribution;
    invalid_distribution.mass[MAX_DISTRIBUTION_RESULT] = 1u;
    assert(!probability_distribution_is_normalized(&invalid_distribution));
}

/*@ terminates \true; */
static void test_basic_attack(void) {
    struct weapon_profile weapon;
    struct target_profile target;
    struct calculator_workspace workspace;
    struct probability_distribution d;
    struct distribution_summary s;

    initialize_profiles(&weapon, &target);

    assert(calculate_attack_damage_distribution(&weapon, &target, &workspace, &d));
    assert(d.minimum == 0);
    assert(d.maximum == 2);
    assert(probability_distribution_summarize(&d, &s));

    printf("basic: min=%u q1=%u med=%u q3=%u max=%u mean=%" PRIu64 "/%" PRIu64 "\n", s.minimum,
           s.first_quartile, s.median, s.third_quartile, s.maximum, s.mean.numerator,
           s.mean.denominator);

    assert(s.mean.numerator > 0);
    assert(s.median == 0);

    {
        struct fraction exact_mean;
        assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &exact_mean));
        assert(exact_mean.numerator == 2);
        assert(exact_mean.denominator == 9);
    }
}

/*@ terminates \true; */
static void test_rules(void) {
    struct weapon_profile weapon;
    struct target_profile target;
    struct calculator_workspace workspace;
    struct distribution_summary s;

    initialize_profiles(&weapon, &target);
    assert(rule_add_lethal_hits(&weapon.rules));
    assert(rule_add_twin_linked(&weapon.rules));
    assert(rule_add_devastating_wounds(&weapon.rules));
    assert(rule_add_critical_wounds_on(&weapon.rules, 6));

    assert(calculate_attack_damage_summary(&weapon, &target, &workspace, &s));

    printf("rules: min=%u q1=%u med=%u q3=%u max=%u mean=%" PRIu64 "/%" PRIu64 "\n", s.minimum,
           s.first_quartile, s.median, s.third_quartile, s.maximum, s.mean.numerator,
           s.mean.denominator);
}

/*@ terminates \true; */
static void test_random_attacks_damage_and_fnp(void) {
    struct weapon_profile weapon;
    struct target_profile target;
    struct calculator_workspace workspace;
    struct distribution_summary s;

    initialize_profiles(&weapon, &target);
    weapon.attacks = (struct dice_value){1, 6, 1};
    weapon.damage = (struct dice_value){1, 3, 1};
    weapon.ap = 2;
    target.feel_no_pain = 5;

    assert(calculate_attack_damage_summary(&weapon, &target, &workspace, &s));

    printf("random: min=%u q1=%u med=%u q3=%u max=%u mean=%" PRIu64 "/%" PRIu64 "\n", s.minimum,
           s.first_quartile, s.median, s.third_quartile, s.maximum, s.mean.numerator,
           s.mean.denominator);
}

/*@ terminates \true; */
static void test_web_api(void) {
    struct whc_web_summary summary;

    assert(whc_calculate_summary(0, 0, 1, 1, 3, 4, 0, 0, 0, 2, 6, 4, 3, 0, 0, 10, 0, 0, 0, 1, 0, 0,
                                 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, &summary));
    assert(summary.mean_numerator_low == 2);
    assert(summary.mean_numerator_high == 0);
    assert(summary.mean_denominator_low == 9);
    assert(summary.mean_denominator_high == 0);
    assert(summary.applied_maximum == 2);
    assert(summary.applied_mean_denominator_low != 0 || summary.applied_mean_denominator_high != 0);
}

/*@ terminates \true; */
static void test_sustained_hits_torrent_and_lance(void) {
    struct weapon_profile weapon;
    struct target_profile target;
    struct calculator_workspace workspace;
    struct fraction mean;
    struct distribution_summary summary;

    initialize_profiles(&weapon, &target);
    weapon.attacks = (struct dice_value){0, 0, 1};
    weapon.hits_on = 6;
    weapon.strength = 2;
    weapon.damage = (struct dice_value){0, 0, 1};
    target.toughness = 1;
    target.save = 7;

    assert(rule_add_sustained_hits(&weapon.rules, 1));
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 5);
    assert(mean.denominator == 18);
    assert(calculate_attack_damage_summary(&weapon, &target, &workspace, &summary));
    assert(summary.maximum == 2);

    rule_set_clear(&weapon.rules);
    assert(rule_add_sustained_hits_dice(&weapon.rules, (struct dice_value){1, 3, 0}));
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 5);
    assert(mean.denominator == 12);
    assert(calculate_attack_damage_summary(&weapon, &target, &workspace, &summary));
    assert(summary.maximum == 4);

    rule_set_clear(&weapon.rules);
    assert(rule_add_lethal_hits(&weapon.rules));
    assert(rule_add_sustained_hits(&weapon.rules, 1));
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 11);
    assert(mean.denominator == 36);
    assert(calculate_attack_damage_summary(&weapon, &target, &workspace, &summary));
    assert(summary.maximum == 2);

    rule_set_clear(&weapon.rules);
    assert(rule_add_torrent(&weapon.rules));
    assert(rule_add_lethal_hits(&weapon.rules));
    assert(rule_add_sustained_hits(&weapon.rules, 3));
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 5);
    assert(mean.denominator == 6);
    assert(calculate_attack_damage_summary(&weapon, &target, &workspace, &summary));
    assert(summary.maximum == 1);

    rule_set_clear(&weapon.rules);
    weapon.strength = 4;
    target.toughness = 4;
    assert(rule_add_torrent(&weapon.rules));
    assert(rule_add_wound_bonus(&weapon.rules, 1));
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 2);
    assert(mean.denominator == 3);
}

/*@ terminates \true; */
static void test_web_api_context_rules(void) {
    struct whc_web_summary summary;
    uint32_t combined =
        WHC_RULE_TORRENT | WHC_RULE_RAPID_FIRE_ACTIVE | WHC_RULE_BLAST | WHC_RULE_MELTA_ACTIVE;

    assert(whc_calculate_summary(0, 0, 1, 2, 6, 2, 0, 0, 0, 1, 6, 1, 7, 0, 0, 10, 0, combined, 0,
                                 10, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, &summary));
    assert(summary.mean_numerator_low == 20);
    assert(summary.mean_denominator_low == 1);

    assert(whc_calculate_summary(0, 0, 1, 1, 6, 2, 1, 0, 0, 1, 6, 1, 3, 0, 0, 10, 0,
                                 WHC_RULE_TORRENT | WHC_RULE_TARGET_COVER, 0, 1, 0, 0, 0, 0, 0, 0,
                                 0, 0, 0, 0, 0, 0, &summary));
    assert(summary.mean_numerator_low == 5);
    assert(summary.mean_denominator_low == 18);
}

/*@ terminates \true; */
static void test_indirect_fire_restrictions(void) {
    struct whc_web_summary summary;
    uint32_t indirect = WHC_RULE_INDIRECT_NOT_VISIBLE | WHC_RULE_IGNORES_COVER;

    assert(whc_calculate_summary(0, 0, 1, 1, 2, 10, 0, 0, 0, 1, 3, 1, 7, 0, 0, 2, 0, indirect, 0, 1,
                                 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, &summary));
    assert(summary.mean_numerator_low == 5);
    assert(summary.mean_numerator_high == 0);
    assert(summary.mean_denominator_low == 12);
    assert(summary.mean_denominator_high == 0);

    assert(!whc_calculate_summary(0, 0, 1, 1, 2, 10, 0, 0, 0, 1, 6, 1, 7, 0, 0, 2, 0,
                                  indirect | WHC_RULE_TORRENT, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                                  0, 0, &summary));
}

/*@ terminates \true; */
static void test_roll_modifiers_and_rerolls(void) {
    struct weapon_profile weapon;
    struct target_profile target;
    struct calculator_workspace workspace;
    struct attack_plan plan;
    struct fraction mean;

    initialize_profiles(&weapon, &target);
    weapon.damage = (struct dice_value){0u, 0u, 1u};
    target.save = 7u;

    assert(modified_roll_threshold(4u, 0) == 4u);
    assert(modified_roll_threshold(4u, 10) == 3u);
    assert(modified_roll_threshold(4u, -10) == 5u);
    assert(modified_roll_threshold(2u, 1) == 2u);
    assert(modified_roll_threshold(6u, -1) == 6u);

    weapon.hit_modifier = 2;
    weapon.wound_modifier = -2;
    weapon.hit_reroll_mask = UINT8_C(1) << 1u;
    weapon.wound_reroll_mask = UINT8_C(1) << 1u;
    assert(attack_plan_build(&weapon, &target, &plan));
    assert(plan.hits_on == 2u);
    assert(plan.wounds_on == 5u);
    assert(plan.hit_reroll_mask == (UINT8_C(1) << 1u));
    assert(plan.wound_reroll_mask == (UINT8_C(1) << 1u));

    weapon.hit_modifier = 0;
    weapon.wound_modifier = 0;
    weapon.hit_reroll_mask = 0u;
    weapon.wound_reroll_mask = 0u;
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 1u && mean.denominator == 3u);

    weapon.hit_reroll_mask = UINT8_C(1) << 1u;
    weapon.wound_reroll_mask = UINT8_C(1) << 1u;
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 49u && mean.denominator == 108u);

    weapon.hit_reroll_mask = 0u;
    weapon.wound_reroll_mask = 0u;
    assert(rule_add_reroll_failed_hits(&weapon.rules));
    assert(rule_add_reroll_failed_wounds(&weapon.rules));
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 2u && mean.denominator == 3u);

    rule_set_clear(&weapon.rules);
    weapon.hit_modifier = 1;
    weapon.wound_modifier = 1;
    assert(rule_add_hit_modifier(&weapon.rules, 1));
    assert(rule_add_wound_modifier(&weapon.rules, 1));
    assert(attack_plan_build(&weapon, &target, &plan));
    assert(plan.hits_on == 2u);
    assert(plan.wounds_on == 3u);
}

/*@ terminates \true; */
static void test_save_thresholds(void) {
    assert(saves_on(2, 0, 4) == 6);
    assert(saves_on_with_cover(2, 0, 4) == 5);
    assert(saves_on(2, 4, 4) == 4);
    assert(saves_on_with_cover(3, 0, 0) == 3);
    assert(saves_on_with_cover(4, 0, 0) == 3);
    assert(saves_on(6, 0, 2) == 7);
}

/*@ terminates \true; */
static void test_unit_damage_allocation(void) {
    struct weapon_profile weapon;
    struct target_profile target;
    struct calculator_workspace workspace;
    struct distribution_summary potential;
    struct distribution_summary applied;

    assert(allocate_damage_to_unit(0, 3, 2, 3) == 2);
    assert(allocate_damage_to_unit(2, 3, 2, 3) == 4);
    assert(allocate_damage_to_unit(3, 3, 2, 3) == 4);
    assert(allocate_damage_to_unit(6, 3, 2, 3) == 6);

    initialize_profiles(&weapon, &target);
    weapon.attacks = (struct dice_value){0, 0, 2};
    weapon.hits_on = 2;
    weapon.strength = 10;
    weapon.damage = (struct dice_value){0, 0, 3};
    target.toughness = 1;
    target.save = 7;
    target.wounds = 2;

    assert(calculate_attack_damage_summary(&weapon, &target, &workspace, &potential));
    assert(calculate_attack_applied_damage_summary(&weapon, &target, 2, &workspace, &applied));
    assert(potential.maximum == 6);
    assert(applied.maximum == 4);
    assert(applied.mean.numerator * potential.mean.denominator <
           potential.mean.numerator * applied.mean.denominator);
}

/*@ terminates \true; */
static void test_ordered_mixed_profile_volley(void) {
    struct weapon_profile weapons[2];
    struct weapon_profile reversed[2];
    struct target_profile targets[4];
    struct target_unit_layout layout = {
        .wounds_per_model = {1u, 2u},
        .model_counts = {1u, 1u},
        .segment_count = 2u,
        .initial_wounds_lost = 0u,
    };
    struct target_unit_layout wounded = {
        .wounds_per_model = {2u, 2u},
        .model_counts = {1u, 1u},
        .segment_count = 2u,
        .initial_wounds_lost = 1u,
    };
    struct calculator_workspace workspace;
    struct probability_distribution forward_distribution;
    struct probability_distribution reverse_distribution;
    struct fraction forward_means[2];
    struct fraction reverse_means[2];
    struct fraction forward_final;
    struct fraction reverse_final;
    struct whc_web_weapon_input web_weapons[2];
    struct whc_web_weapon_input web_reversed[2];
    struct whc_web_target_input web_targets[2];
    struct whc_web_applied_summary web_forward;
    struct whc_web_applied_summary web_reverse;
    struct whc_web_mean web_forward_means[2];
    struct whc_web_mean web_reverse_means[2];
    struct whc_web_exact_complexity web_complexity;
    uint64_t web_forward_numerator = 0u;
    uint64_t web_forward_denominator = 0u;
    uint64_t web_reverse_numerator = 0u;
    uint64_t web_reverse_denominator = 0u;
    uint16_t index = 0u;

    memset(weapons, 0, sizeof(weapons));
    memset(targets, 0, sizeof(targets));
    while (index < 2u) {
        weapons[index].attacks = (struct dice_value){0u, 0u, 1u};
        weapons[index].hits_on = 2u;
        weapons[index].strength = 10u;
        weapons[index].damage = (struct dice_value){0u, 0u, (uint16_t)(index + 1u)};
        assert(rule_add_torrent(&weapons[index].rules));
        index++;
    }
    weapons[0].ap = 0u;
    weapons[1].ap = 6u;
    reversed[0] = weapons[1];
    reversed[1] = weapons[0];

    index = 0u;
    while (index < 4u) {
        uint16_t segment = (uint16_t)(index % 2u);
        targets[index].toughness = 1u;
        targets[index].save = segment == 0u ? 7u : 2u;
        targets[index].wounds = layout.wounds_per_model[segment];
        index++;
    }

    assert(target_unit_capacity(&layout) == 3u);
    assert(allocate_damage_to_target_unit(&wounded, 1u, 3u) == 2u);
    assert(allocate_damage_to_target_unit(&wounded, 2u, 3u) == 4u);
    assert(calculate_ordered_volley_applied_damage_distribution(
        weapons, targets, 2u, &layout, &workspace, &forward_distribution, forward_means));
    assert(calculate_ordered_volley_applied_damage_distribution(
        reversed, targets, 2u, &layout, &workspace, &reverse_distribution, reverse_means));
    assert(probability_distribution_mean(&forward_distribution, &forward_final));
    assert(probability_distribution_mean(&reverse_distribution, &reverse_final));
    assert(forward_distribution.maximum == 3u);
    assert(reverse_distribution.maximum == 2u);
    assert(forward_means[1].numerator * forward_means[0].denominator >=
           forward_means[0].numerator * forward_means[1].denominator);
    assert(forward_final.numerator * reverse_final.denominator >
           reverse_final.numerator * forward_final.denominator);
    targets[0].save = 7u;
    targets[0].wounds = 2u;
    assert(distribution_from_constant(1u, &workspace.exact_a));
    assert(probability_distribution_from_exact(&workspace.exact_a, &workspace.probability_e));
    assert(advance_weapon_applied_damage_distribution(&weapons[1], targets, &wounded,
                                                      &workspace.probability_e, &workspace,
                                                      &forward_distribution));
    assert(forward_distribution.maximum == 2u);
    assert(calculate_ordered_volley_applied_damage_distribution(
        &weapons[1], targets, 1u, &wounded, &workspace, &forward_distribution, forward_means));
    assert(forward_distribution.maximum == 1u);

    memset(web_weapons, 0, sizeof(web_weapons));
    memset(web_targets, 0, sizeof(web_targets));
    index = 0u;
    while (index < 2u) {
        web_weapons[index].attack_modifier = 1u;
        web_weapons[index].weapon_count = 1u;
        web_weapons[index].hits_on = 2u;
        web_weapons[index].strength = 10u;
        web_weapons[index].damage_modifier = index + 1u;
        web_weapons[index].rule_flags = WHC_RULE_TORRENT;
        web_weapons[index].ap = index == 0u ? 0u : 6u;
        web_targets[index].toughness = 1u;
        web_targets[index].save = index == 0u ? 7u : 2u;
        web_targets[index].wounds = index + 1u;
        web_targets[index].model_count = 1u;
        index++;
    }
    web_reversed[0] = web_weapons[1];
    web_reversed[1] = web_weapons[0];
    assert(whc_calculate_ordered_volley_summary(web_weapons, 2u, web_targets, 2u, 0u, &web_forward,
                                                web_forward_means));
    assert(whc_estimate_ordered_volley_complexity(web_weapons, 2u, web_targets, 2u, 0u,
                                                  &web_complexity));
    assert(web_complexity.uses_deferred_states == 0u);
    assert(web_complexity.exact_guaranteed_by_bound == 1u);
    assert(web_complexity.estimated_state_upper_bound == 4u);
    assert(web_complexity.state_limit == MAX_EXACT_DEFERRED_STATES);
    assert(whc_calculate_ordered_volley_summary(web_reversed, 2u, web_targets, 2u, 0u, &web_reverse,
                                                web_reverse_means));
    web_forward_numerator =
        ((uint64_t)web_forward.mean_numerator_high << 32u) | web_forward.mean_numerator_low;
    web_forward_denominator =
        ((uint64_t)web_forward.mean_denominator_high << 32u) | web_forward.mean_denominator_low;
    web_reverse_numerator =
        ((uint64_t)web_reverse.mean_numerator_high << 32u) | web_reverse.mean_numerator_low;
    web_reverse_denominator =
        ((uint64_t)web_reverse.mean_denominator_high << 32u) | web_reverse.mean_denominator_low;
    assert(web_forward_numerator * web_reverse_denominator >
           web_reverse_numerator * web_forward_denominator);
    assert(web_forward_means[1].denominator_low != 0u ||
           web_forward_means[1].denominator_high != 0u);
    web_targets[0].save = 7u;
    web_targets[0].wounds = 2u;
    web_targets[0].model_count = 2u;
    assert(whc_calculate_ordered_volley_summary(&web_weapons[1], 1u, web_targets, 1u, 1u,
                                                &web_forward, web_forward_means));
    assert(web_forward.maximum == 1u);
}

static void test_devastating_wounds_resolve_after_ordinary_attacks(void) {
    struct weapon_profile weapons[2];
    struct weapon_profile reversed[2];
    struct weapon_profile prefix_tightened[2];
    struct target_profile targets[2];
    struct target_unit_layout layout = {
        .wounds_per_model = {3u},
        .model_counts = {2u},
        .segment_count = 1u,
        .initial_wounds_lost = 0u,
    };
    struct calculator_workspace workspace;
    struct probability_distribution ordered;
    struct probability_distribution reverse_ordered;
    struct fraction means[2];
    struct fraction reverse_means[2];
    struct fraction mean;
    struct fraction reverse_mean;
    struct exact_complexity complexity;

    memset(weapons, 0, sizeof(weapons));
    memset(targets, 0, sizeof(targets));
    weapons[0].attacks = (struct dice_value){0u, 0u, 1u};
    weapons[0].hits_on = 2u;
    weapons[0].strength = 10u;
    weapons[0].ap = 6u;
    weapons[0].damage = (struct dice_value){0u, 0u, 2u};
    assert(rule_add_torrent(&weapons[0].rules));
    assert(rule_add_devastating_wounds(&weapons[0].rules));
    assert(rule_add_critical_wounds_on(&weapons[0].rules, 2u));
    weapons[1] = weapons[0];
    weapons[1].damage = (struct dice_value){0u, 0u, 3u};
    memset(&weapons[1].rules, 0, sizeof(weapons[1].rules));
    assert(rule_add_torrent(&weapons[1].rules));
    reversed[0] = weapons[1];
    reversed[1] = weapons[0];

    targets[0].toughness = 1u;
    targets[0].save = 7u;
    targets[0].wounds = 3u;
    targets[1] = targets[0];

    assert(estimate_ordered_volley_complexity(weapons, targets, 2u, &layout, &complexity));
    assert(complexity.uses_deferred_states);
    assert(complexity.exact_guaranteed_by_bound);
    assert(complexity.estimated_state_upper_bound == 112u);
    assert(complexity.maximum_attack_events == 2u);
    assert(complexity.target_capacity == 6u);
    weapons[0].attacks.modifier = 20u;
    assert(estimate_ordered_volley_complexity(weapons, targets, 2u, &layout, &complexity));
    assert(!complexity.exact_guaranteed_by_bound);
    assert(complexity.estimated_state_upper_bound > complexity.state_limit);
    weapons[0].attacks.modifier = 1u;

    assert(calculate_ordered_volley_applied_damage_distribution(weapons, targets, 2u, &layout,
                                                                &workspace, &ordered, means));
    assert(calculate_ordered_volley_applied_damage_distribution(
        reversed, targets, 2u, &layout, &workspace, &reverse_ordered, reverse_means));
    assert(ordered.maximum == 5u);
    assert(reverse_ordered.maximum == 5u);
    assert(probability_distribution_mean(&ordered, &mean));
    assert(probability_distribution_mean(&reverse_ordered, &reverse_mean));
    assert((double)mean.numerator / (double)mean.denominator > 4.16666666);
    assert((double)mean.numerator / (double)mean.denominator < 4.16666667);
    assert((double)reverse_mean.numerator / (double)reverse_mean.denominator > 4.16666666);
    assert((double)reverse_mean.numerator / (double)reverse_mean.denominator < 4.16666667);

    memset(&weapons[0].rules, 0, sizeof(weapons[0].rules));
    weapons[0].critical_hits_on = 2u;
    assert(rule_add_lethal_hits(&weapons[0].rules));
    assert(rule_add_sustained_hits(&weapons[0].rules, 1u));
    assert(rule_add_devastating_wounds(&weapons[0].rules));
    assert(rule_add_critical_wounds_on(&weapons[0].rules, 2u));
    assert(calculate_ordered_volley_applied_damage_distribution(weapons, targets, 2u, &layout,
                                                                &workspace, &ordered, means));
    assert(ordered.maximum == 5u);
    assert(probability_distribution_mean(&ordered, &mean));
    assert((double)mean.numerator / (double)mean.denominator > 875.0 / 216.0 - 1e-8);
    assert((double)mean.numerator / (double)mean.denominator < 875.0 / 216.0 + 1e-8);

    prefix_tightened[0] = weapons[1];
    prefix_tightened[0].attacks.modifier = 8u;
    prefix_tightened[0].damage.modifier = 1u;
    prefix_tightened[1] = weapons[1];
    prefix_tightened[1].damage.modifier = 2u;
    assert(rule_add_devastating_wounds(&prefix_tightened[1].rules));
    assert(rule_add_critical_wounds_on(&prefix_tightened[1].rules, 2u));
    assert(estimate_ordered_volley_complexity(prefix_tightened, targets, 2u, &layout, &complexity));
    assert(complexity.estimated_state_upper_bound == 1134u);
    assert(complexity.exact_guaranteed_by_bound);
    assert(calculate_ordered_volley_applied_damage_distribution(
        prefix_tightened, targets, 2u, &layout, &workspace, &ordered, means));
    assert(workspace.peak_sparse_states == 13u);
    assert(workspace.peak_sparse_states <= complexity.estimated_state_upper_bound);
}

/*@ terminates \true; */
static void test_signed_characteristic_modifiers(void) {
    struct distribution distribution;
    struct weapon_profile weapon;
    struct target_profile target;
    struct calculator_workspace workspace;
    struct fraction mean;
    struct whc_web_summary summary;

    assert(distribution_from_modified_dice_value((struct dice_value){1u, 6u, 0u}, -1, 1u,
                                                 &distribution));
    assert(distribution.minimum == 1u);
    assert(distribution.maximum == 5u);
    assert(distribution.total_ways == 6u);
    assert(distribution.ways[1] == 2u);

    memset(&weapon, 0, sizeof(weapon));
    memset(&target, 0, sizeof(target));
    weapon.attacks = (struct dice_value){1u, 6u, 0u};
    weapon.attacks_modifier = -1;
    weapon.weapon_count = 2u;
    weapon.hits_on = 2u;
    weapon.strength = 10u;
    weapon.damage = (struct dice_value){0u, 0u, 1u};
    target.toughness = 1u;
    target.save = 7u;
    assert(rule_add_torrent(&weapon.rules));
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 40u);
    assert(mean.denominator == 9u);

    assert(whc_calculate_summary(1u, 6u, 0u, 2u, 2u, 10u, 0u, 0u, 0u, 1u, 6u, 1u, 7u, 0u, 0u, 10u,
                                 0u, WHC_RULE_TORRENT, 0u, 1u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0, 0, -1,
                                 0, 0, &summary));
    assert(summary.mean_numerator_low == 40u);
    assert(summary.mean_denominator_low == 9u);
}

/*@ terminates \true;
    ensures \result == 0;
*/
int main(void) {
    assert(greatest_common_divisor(48, 18) == 6);
    test_dice();
    test_rule_interaction_corpus();
    test_probability_and_plan_validators();
    test_basic_attack();
    test_rules();
    test_random_attacks_damage_and_fnp();
    test_web_api();
    test_sustained_hits_torrent_and_lance();
    test_web_api_context_rules();
    test_indirect_fire_restrictions();
    test_roll_modifiers_and_rerolls();
    test_save_thresholds();
    test_unit_damage_allocation();
    test_ordered_mixed_profile_volley();
    test_devastating_wounds_resolve_after_ordinary_attacks();
    test_signed_characteristic_modifiers();
    puts("all tests passed");
    return 0;
}
