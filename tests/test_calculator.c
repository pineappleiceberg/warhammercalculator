#include "warhammercalculator/calculator.h"
#include "warhammercalculator/web_api.h"

#include <assert.h>
#include <inttypes.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#ifdef NDEBUG
#error "Calculator tests require active assertions"
#endif

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
            0u, 0u, test_case->attacks, 0u, 1u, test_case->hits_on, test_case->strength,
            test_case->ap, 0u, 0u, test_case->damage, test_case->critical_hits_on,
            test_case->toughness, test_case->save, test_case->invulnerable_save,
            test_case->feel_no_pain, test_case->wounds, 0u, test_case->flags,
            test_case->critical_wounds_on, test_case->target_models, 0u, 0u,
            test_case->sustained_hits, 0u, 0u, 0u, 0u, test_case->hit_modifier,
            test_case->wound_modifier, 0, 0, 0, 0u, 0u, false, 1u, 1u, 1u, 1u, &summary));
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

    assert(whc_calculate_summary(0, 0, 1, 0, 1, 3, 4, 0, 0, 0, 2, 6, 4, 3, 0, 0, 10, 0, 0, 0, 1, 0,
                                 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0u, 0u, false, 1u, 1u, 1u, 1u,
                                 &summary));
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

    assert(whc_calculate_summary(0, 0, 1, 0, 2, 6, 2, 0, 0, 0, 1, 6, 1, 7, 0, 0, 10, 0, combined, 0,
                                 10, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0u, 0u, false, 1u, 1u, 1u,
                                 1u, &summary));
    assert(summary.mean_numerator_low == 20);
    assert(summary.mean_denominator_low == 1);

    assert(whc_calculate_summary(0, 0, 1, 0, 1, 6, 2, 1, 0, 0, 1, 6, 1, 3, 0, 0, 10, 0,
                                 WHC_RULE_TORRENT | WHC_RULE_TARGET_COVER, 0, 1, 0, 0, 0, 0, 0, 0,
                                 0, 0, 0, 0, 0, 0, 0u, 0u, false, 1u, 1u, 1u, 1u, &summary));
    assert(summary.mean_numerator_low == 5);
    assert(summary.mean_denominator_low == 18);
}

/*@ terminates \true; */
static void test_indirect_fire_restrictions(void) {
    struct whc_web_summary summary;
    uint32_t indirect = WHC_RULE_INDIRECT_NOT_VISIBLE | WHC_RULE_IGNORES_COVER;

    assert(whc_calculate_summary(0, 0, 1, 0, 1, 2, 10, 0, 0, 0, 1, 3, 1, 7, 0, 0, 2, 0, indirect, 0,
                                 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0u, 0u, false, 1u, 1u, 1u,
                                 1u, &summary));
    assert(summary.mean_numerator_low == 5);
    assert(summary.mean_numerator_high == 0);
    assert(summary.mean_denominator_low == 12);
    assert(summary.mean_denominator_high == 0);

    assert(!whc_calculate_summary(0, 0, 1, 0, 1, 2, 10, 0, 0, 0, 1, 6, 1, 7, 0, 0, 2, 0,
                                  indirect | WHC_RULE_TORRENT, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                                  0, 0, 0u, 0u, false, 1u, 1u, 1u, 1u, &summary));
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

    assert(whc_calculate_summary(1u, 6u, 0u, 0u, 2u, 2u, 10u, 0u, 0u, 0u, 1u, 6u, 1u, 7u, 0u, 0u,
                                 10u, 0u, WHC_RULE_TORRENT, 0u, 1u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0,
                                 0, -1, 0, 0, 0u, 0u, false, 1u, 1u, 1u, 1u, &summary));
    assert(summary.mean_numerator_low == 40u);
    assert(summary.mean_denominator_low == 9u);

    weapon.attacks_replacement = 4u;
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 5u);
    assert(mean.denominator == 1u);

    assert(whc_calculate_summary(1u, 6u, 0u, 4u, 2u, 2u, 10u, 0u, 0u, 0u, 1u, 6u, 1u, 7u, 0u, 0u,
                                 10u, 0u, WHC_RULE_TORRENT, 0u, 1u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0,
                                 0, -1, 0, 0, 0u, 0u, false, 1u, 1u, 1u, 1u, &summary));
    assert(summary.minimum == 0u);
    assert(summary.maximum == 6u);
    assert(summary.mean_numerator_low == 5u);
    assert(summary.mean_denominator_low == 1u);

    assert(whc_calculate_summary(1u, 6u, 0u, 4u, 1u, 2u, 10u, 0u, 0u, 0u, 1u, 6u, 1u, 7u, 0u, 0u,
                                 10u, 0u, WHC_RULE_TORRENT | WHC_RULE_RAPID_FIRE_ACTIVE, 0u, 1u, 0u,
                                 0u, 0u, 1u, 3u, 0u, 0u, 0, 0, -1, 0, 0, 0u, 0u, false, 1u, 1u, 1u,
                                 1u, &summary));
    assert(summary.maximum == 6u);
    assert(summary.mean_numerator_low == 25u);
    assert(summary.mean_denominator_low == 6u);

    memset(&weapon, 0, sizeof(weapon));
    memset(&target, 0, sizeof(target));
    weapon.attacks = (struct dice_value){0u, 0u, 1u};
    weapon.weapon_count = 1u;
    weapon.hits_on = 2u;
    weapon.strength = 2u;
    weapon.strength_replacement = 8u;
    weapon.strength_modifier = -1;
    weapon.damage = (struct dice_value){1u, 6u, 0u};
    weapon.damage_replacement_active = true;
    weapon.damage_replacement = 0u;
    target.toughness = 7u;
    target.save = 7u;
    assert(rule_add_torrent(&weapon.rules));
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 0u);
    assert(mean.denominator == 1u);

    weapon.damage_modifier = 2;
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 1u);
    assert(mean.denominator == 1u);

    assert(whc_calculate_summary(0u, 0u, 1u, 0u, 1u, 2u, 2u, 0u, 1u, 6u, 0u, 6u, 7u, 7u, 0u, 0u,
                                 10u, 0u, WHC_RULE_TORRENT | WHC_RULE_MELTA_ACTIVE, 0u, 1u, 0u, 0u,
                                 0u, 0u, 0u, 0u, 2u, 0, 0, 0, -1, 0, 8u, 0u, true, 1u, 1u, 1u, 1u,
                                 &summary));
    assert(summary.mean_numerator_low == 1u);
    assert(summary.mean_denominator_low == 1u);
}

/*@ terminates \true; */
static void test_damage_division_modifier_order(void) {
    struct weapon_profile weapon;
    struct target_profile target;
    struct calculator_workspace workspace;
    struct fraction mean;
    struct probability_distribution distribution;
    struct whc_web_summary summary;

    initialize_profiles(&weapon, &target);
    weapon.hits_on = 2u;
    weapon.strength = 10u;
    weapon.damage = (struct dice_value){0u, 0u, 5u};
    weapon.damage_modifier = 1;
    target.toughness = 1u;
    target.save = 7u;
    target.damage_divisor = 2u;
    assert(rule_add_torrent(&weapon.rules));

    assert(calculate_attack_damage_distribution(&weapon, &target, &workspace, &distribution));
    assert(distribution.maximum == 4u);
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 10u);
    assert(mean.denominator == 3u);

    target.reduction = 1u;
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 5u);
    assert(mean.denominator == 2u);

    weapon.damage_replacement_active = true;
    weapon.damage_replacement = 0u;
    target.reduction = 0u;
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 5u);
    assert(mean.denominator == 6u);

    assert(whc_calculate_summary(0u, 0u, 1u, 0u, 1u, 2u, 10u, 0u, 0u, 0u, 5u, 6u, 1u, 7u, 0u, 0u,
                                 10u, 0u, WHC_RULE_TORRENT, 0u, 1u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0,
                                 0, 0, 0, 1, 0u, 0u, false, 2u, 1u, 1u, 1u, &summary));
    assert(summary.maximum == 4u);
    assert(summary.mean_numerator_low == 10u);
    assert(summary.mean_denominator_low == 3u);
}

/*@ terminates \true; */
static void test_characteristic_multiplier_order(void) {
    struct weapon_profile weapon;
    struct target_profile target;
    struct calculator_workspace workspace;
    struct fraction mean;
    struct probability_distribution distribution;
    struct whc_web_summary summary;
    struct whc_web_weapon_input web_weapon;
    struct whc_web_target_input web_target;
    struct whc_web_applied_summary web_summary;
    struct whc_web_mean cumulative_mean;
    struct whc_web_exact_complexity web_complexity;
    uint64_t web_numerator;
    uint64_t web_denominator;

    initialize_profiles(&weapon, &target);
    weapon.attacks = (struct dice_value){0u, 0u, 3u};
    weapon.attacks_multiplier = 2u;
    weapon.attacks_modifier = 1;
    weapon.hits_on = 2u;
    weapon.strength = 4u;
    weapon.strength_multiplier = 2u;
    weapon.strength_modifier = 1;
    weapon.damage = (struct dice_value){0u, 0u, 5u};
    weapon.damage_multiplier = 2u;
    weapon.damage_modifier = 1;
    target.toughness = 8u;
    target.save = 7u;
    target.damage_divisor = 2u;
    assert(rule_add_torrent(&weapon.rules));

    assert(calculate_attack_damage_distribution(&weapon, &target, &workspace, &distribution));
    assert(distribution.maximum == 42u);
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 28u);
    assert(mean.denominator == 1u);

    assert(whc_calculate_summary(0u, 0u, 3u, 0u, 1u, 2u, 4u, 0u, 0u, 0u, 5u, 6u, 8u, 7u, 0u, 0u,
                                 10u, 0u, WHC_RULE_TORRENT, 0u, 1u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0,
                                 0, 1, 1, 1, 0u, 0u, false, 2u, 2u, 2u, 2u, &summary));
    assert(summary.maximum == 42u);
    assert(summary.mean_numerator_low == 28u);
    assert(summary.mean_denominator_low == 1u);

    assert(whc_calculate_summary(
        0u, 0u, 3u, 0u, 1u, 2u, 10u, 0u, 0u, 0u, 1u, 6u, 1u, 7u, 0u, 0u, 10u, 0u,
        WHC_RULE_TORRENT | WHC_RULE_RAPID_FIRE_ACTIVE | WHC_RULE_BLAST, 0u, 10u, 0u, 0u, 0u, 0u, 0u,
        2u, 0u, 0, 0, 1, 0, 0, 0u, 0u, false, 1u, 2u, 1u, 1u, &summary));
    assert(summary.maximum == 11u);
    assert(summary.mean_numerator_low == 55u);
    assert(summary.mean_denominator_low == 6u);

    assert(whc_calculate_summary(1u, 6u, 0u, 0u, 1u, 2u, 10u, 0u, 0u, 0u, 1u, 6u, 1u, 7u, 0u, 0u,
                                 20u, 0u, WHC_RULE_TORRENT | WHC_RULE_RAPID_FIRE_ACTIVE, 0u, 1u, 0u,
                                 0u, 0u, 1u, 3u, 0u, 0u, 0, 0, 0, 0, 0, 0u, 0u, false, 1u, 2u, 1u,
                                 1u, &summary));
    assert(summary.maximum == 15u);
    assert(summary.mean_numerator_low == 15u);
    assert(summary.mean_denominator_low == 2u);

    memset(&web_weapon, 0, sizeof(web_weapon));
    memset(&web_target, 0, sizeof(web_target));
    web_weapon.attack_modifier = 3u;
    web_weapon.attacks_multiplier = 2u;
    web_weapon.attacks_characteristic_modifier = 1;
    web_weapon.weapon_count = 1u;
    web_weapon.hits_on = 2u;
    web_weapon.strength = 4u;
    web_weapon.strength_multiplier = 2u;
    web_weapon.strength_characteristic_modifier = 1;
    web_weapon.damage_modifier = 5u;
    web_weapon.damage_multiplier = 2u;
    web_weapon.damage_characteristic_modifier = 1;
    web_weapon.critical_hits_on = 6u;
    web_weapon.rule_flags = WHC_RULE_TORRENT;
    web_target.toughness = 8u;
    web_target.save = 7u;
    web_target.wounds = 100u;
    web_target.model_count = 1u;
    web_target.damage_divisor = 2u;
    assert(whc_calculate_ordered_volley_summary(&web_weapon, 1u, &web_target, 1u, 0u, &web_summary,
                                                &cumulative_mean));
    assert(whc_estimate_ordered_volley_complexity(&web_weapon, 1u, &web_target, 1u, 0u,
                                                  &web_complexity));
    assert(web_complexity.maximum_attack_events == 7u);
    assert(web_summary.maximum == 42u);
    web_numerator =
        web_summary.mean_numerator_low | ((uint64_t)web_summary.mean_numerator_high << 32u);
    web_denominator =
        web_summary.mean_denominator_low | ((uint64_t)web_summary.mean_denominator_high << 32u);
    assert(web_numerator * 100u >= web_denominator * 2799u);
    assert(web_numerator * 100u <= web_denominator * 2801u);
}

/*@ terminates \true; */
static void test_shared_random_characteristic_modifier(void) {
    struct weapon_profile weapon;
    struct target_profile target;
    struct calculator_workspace workspace;
    struct probability_distribution distribution;
    struct fraction mean;
    struct attack_plan unresolved_plan;
    struct target_unit_layout layout;
    struct fraction cumulative_mean;
    struct fraction cumulative_means[2];
    struct exact_complexity complexity;
    struct weapon_profile grouped_weapons[2];
    struct target_profile grouped_targets[2];
    struct whc_web_summary web_summary;
    uint64_t web_numerator = 0u;
    uint64_t web_denominator = 0u;
    long double ordered_mean = 0.0L;
    uint64_t grouped_zero_mass = 0u;

    initialize_profiles(&weapon, &target);
    weapon.attacks = (struct dice_value){0u, 0u, 1u};
    weapon.hits_on = 2u;
    weapon.strength = 3u;
    weapon.damage = (struct dice_value){0u, 0u, 1u};
    weapon.characteristic_modifier_roll = (struct dice_value){1u, 3u, 0u};
    weapon.characteristic_modifier_roll_flags =
        CHARACTERISTIC_ROLL_ATTACKS | CHARACTERISTIC_ROLL_STRENGTH;
    target.toughness = 5u;
    target.save = 7u;
    target.wounds = 20u;
    assert(rule_add_torrent(&weapon.rules));
    assert(!attack_plan_build(&weapon, &target, &unresolved_plan));
    assert(calculate_attack_damage_distribution(&weapon, &target, &workspace, &distribution));
    assert(distribution.maximum == 4u);
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 29u);
    assert(mean.denominator == 18u);

    weapon.attacks = (struct dice_value){0u, 0u, 2u};
    weapon.strength = 10u;
    weapon.characteristic_modifier_roll_flags = CHARACTERISTIC_ROLL_DAMAGE;
    target.toughness = 1u;
    assert(calculate_attack_damage_distribution(&weapon, &target, &workspace, &distribution));
    assert(calculate_attack_expected_damage(&weapon, &target, &workspace, &mean));
    assert(mean.numerator == 5u);
    assert(mean.denominator == 1u);
    assert(distribution.maximum == 8u);
    assert(distribution.mass[5] == 0u);
    assert(distribution.mass[7] == 0u);

    weapon.attacks = (struct dice_value){0u, 0u, 1u};
    weapon.strength = 3u;
    weapon.characteristic_modifier_roll_flags =
        CHARACTERISTIC_ROLL_ATTACKS | CHARACTERISTIC_ROLL_STRENGTH;
    target.toughness = 5u;

    assert(whc_calculate_summary_with_characteristic_roll(
        0u, 0u, 1u, 0u, 1u, 2u, 3u, 0u, 0u, 0u, 1u, 6u, 5u, 7u, 0u, 0u, 20u, 0u, WHC_RULE_TORRENT,
        0u, 1u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0, 0, 0, 0, 0, 0u, 0u, false, 1u, 1u, 1u, 1u, 1u, 3u,
        0u, CHARACTERISTIC_ROLL_ATTACKS | CHARACTERISTIC_ROLL_STRENGTH, 0u, false, 0u, 0u, 0u,
        &web_summary));
    web_numerator =
        web_summary.mean_numerator_low | ((uint64_t)web_summary.mean_numerator_high << 32u);
    web_denominator =
        web_summary.mean_denominator_low | ((uint64_t)web_summary.mean_denominator_high << 32u);
    assert(web_numerator == 29u);
    assert(web_denominator == 18u);

    target.save = 2u;
    assert(rule_add_devastating_wounds(&weapon.rules));
    memset(&layout, 0, sizeof(layout));
    layout.wounds_per_model[0] = 20u;
    layout.model_counts[0] = 1u;
    layout.segment_count = 1u;
    assert(estimate_ordered_volley_complexity(&weapon, &target, 1u, &layout, &complexity));
    assert(complexity.maximum_attack_events == 4u);
    assert(calculate_ordered_volley_applied_damage_distribution(
        &weapon, &target, 1u, &layout, &workspace, &distribution, &cumulative_mean));
    assert(probability_distribution_mean(&distribution, &mean));
    ordered_mean = (long double)mean.numerator / mean.denominator;
    assert(ordered_mean > 0.68517L);
    assert(ordered_mean < 0.68520L);

    weapon.rules.count = 0u;
    target.save = 7u;
    assert(rule_add_torrent(&weapon.rules));
    grouped_weapons[0] = weapon;
    grouped_weapons[1] = weapon;
    grouped_weapons[0].characteristic_modifier_roll_group = 42u;
    grouped_weapons[1].characteristic_modifier_roll_group = 42u;
    grouped_targets[0] = target;
    grouped_targets[1] = target;
    assert(calculate_ordered_volley_applied_damage_distribution(grouped_weapons, grouped_targets,
                                                                2u, &layout, &workspace,
                                                                &distribution, cumulative_means));
    grouped_zero_mass = distribution.mass[0];
    grouped_weapons[1].characteristic_modifier_roll_group = 0u;
    assert(calculate_ordered_volley_applied_damage_distribution(grouped_weapons, grouped_targets,
                                                                2u, &layout, &workspace,
                                                                &distribution, cumulative_means));
    assert(distribution.mass[0] != grouped_zero_mass);
    grouped_weapons[1].characteristic_modifier_roll_group = 42u;
    grouped_weapons[1].characteristic_modifier_roll.dice_sides = 4u;
    assert(!calculate_ordered_volley_applied_damage_distribution(grouped_weapons, grouped_targets,
                                                                 2u, &layout, &workspace,
                                                                 &distribution, cumulative_means));
}

/*@ terminates \true; */
static void test_first_failed_save_damage_replacement(void) {
    struct weapon_profile weapons[2];
    struct target_profile targets[2];
    struct calculator_workspace workspace;
    struct probability_distribution distribution;
    struct distribution_summary summary;
    struct target_unit_layout layout;
    struct fraction cumulative_means[2];
    struct exact_complexity complexity;
    struct whc_web_weapon_input web_weapon;
    struct whc_web_target_input web_target;
    struct whc_web_applied_summary web_summary;
    struct whc_web_mean web_mean;
    long double mean = 0.0L;

    initialize_profiles(&weapons[0], &targets[0]);
    weapons[0].attacks = (struct dice_value){0u, 0u, 2u};
    weapons[0].hits_on = 2u;
    weapons[0].strength = 10u;
    weapons[0].damage = (struct dice_value){0u, 0u, 3u};
    targets[0].toughness = 1u;
    targets[0].save = 7u;
    targets[0].wounds = 20u;
    targets[0].first_failed_save_damage_replacement = 0u;
    targets[0].first_failed_save_damage_replacement_active = true;
    assert(rule_add_torrent(&weapons[0].rules));

    assert(calculate_attack_damage_summary(&weapons[0], &targets[0], &workspace, &summary));
    mean = (long double)summary.mean.numerator / summary.mean.denominator;
    assert(mean > 2.08332L && mean < 2.08335L);
    assert(summary.maximum == 3u);
    assert(calculate_attack_applied_damage_distribution(&weapons[0], &targets[0], 1u, &workspace,
                                                        &distribution));
    assert(distribution.maximum == 3u);

    memset(&layout, 0, sizeof(layout));
    layout.wounds_per_model[0] = 20u;
    layout.model_counts[0] = 1u;
    layout.segment_count = 1u;
    weapons[0].attacks.modifier = 1u;
    weapons[1] = weapons[0];
    targets[1] = targets[0];
    assert(estimate_ordered_volley_complexity(weapons, targets, 2u, &layout, &complexity));
    assert(complexity.uses_deferred_states);
    assert(calculate_ordered_volley_applied_damage_distribution(
        weapons, targets, 2u, &layout, &workspace, &distribution, cumulative_means));
    assert(cumulative_means[0].numerator == 0u);
    mean = (long double)cumulative_means[1].numerator / cumulative_means[1].denominator;
    assert(mean > 2.08332L && mean < 2.08335L);

    assert(rule_add_devastating_wounds(&weapons[0].rules));
    weapons[0].attacks.modifier = 2u;
    assert(calculate_attack_damage_summary(&weapons[0], &targets[0], &workspace, &summary));
    mean = (long double)summary.mean.numerator / summary.mean.denominator;
    assert(mean > 2.33332L && mean < 2.33335L);

    memset(&web_weapon, 0, sizeof(web_weapon));
    memset(&web_target, 0, sizeof(web_target));
    web_weapon.attack_modifier = 2u;
    web_weapon.weapon_count = 1u;
    web_weapon.hits_on = 2u;
    web_weapon.strength = 10u;
    web_weapon.damage_modifier = 3u;
    web_weapon.critical_hits_on = 6u;
    web_weapon.rule_flags = WHC_RULE_TORRENT;
    web_target.toughness = 1u;
    web_target.save = 7u;
    web_target.wounds = 20u;
    web_target.model_count = 1u;
    web_target.damage_divisor = 1u;
    web_target.first_failed_save_damage_replacement_active = 1u;
    assert(whc_calculate_ordered_volley_summary(&web_weapon, 1u, &web_target, 1u, 0u, &web_summary,
                                                &web_mean));
    assert(web_summary.maximum == 3u);
    assert(web_summary.peak_sparse_states > 0u);
}

/*@ terminates \true; */
static void test_allocated_attack_damage_replacement(void) {
    struct weapon_profile weapons[2];
    struct target_profile targets[2];
    struct calculator_workspace workspace;
    struct probability_distribution distribution;
    struct distribution_summary summary;
    struct target_unit_layout layout;
    struct fraction cumulative_means[2];
    struct fraction mean;
    struct exact_complexity complexity;
    struct whc_web_weapon_input web_weapon;
    struct whc_web_target_input web_target;
    struct whc_web_applied_summary web_summary;
    struct whc_web_mean web_mean;

    memset(weapons, 0, sizeof(weapons));
    memset(targets, 0, sizeof(targets));
    memset(&workspace, 0, sizeof(workspace));
    memset(&layout, 0, sizeof(layout));
    weapons[0].attacks = (struct dice_value){0u, 0u, 2u};
    weapons[0].weapon_count = 1u;
    weapons[0].hits_on = 6u;
    weapons[0].strength = 2u;
    weapons[0].damage = (struct dice_value){0u, 0u, 3u};
    targets[0].toughness = 1u;
    targets[0].save = 7u;
    targets[0].wounds = 20u;
    targets[0].damage_divisor = 1u;
    targets[0].allocated_attack_damage_replacement = 0u;
    targets[0].allocated_attack_damage_replacement_uses = 1u;
    assert(
        calculate_attack_damage_distribution(&weapons[0], &targets[0], &workspace, &distribution));
    assert(probability_distribution_mean(&distribution, &mean));
    assert(fabsl((long double)mean.numerator / mean.denominator - 5.0L / 12.0L) < 1e-8L);

    weapons[0].attacks = (struct dice_value){0u, 0u, 1u};
    weapons[0].critical_hits_on = 6u;
    assert(rule_add_sustained_hits(&weapons[0].rules, 1u));
    assert(calculate_attack_damage_summary(&weapons[0], &targets[0], &workspace, &summary));
    assert(summary.minimum == 0u && summary.maximum == 0u);

    memset(&weapons[0].rules, 0, sizeof(weapons[0].rules));
    weapons[0].critical_hits_on = 0u;
    assert(rule_add_torrent(&weapons[0].rules));
    assert(rule_add_devastating_wounds(&weapons[0].rules));
    assert(calculate_attack_damage_summary(&weapons[0], &targets[0], &workspace, &summary));
    assert(summary.minimum == 0u && summary.maximum == 0u);

    memset(weapons, 0, sizeof(weapons));
    weapons[0].attacks = (struct dice_value){0u, 0u, 1u};
    weapons[0].weapon_count = 1u;
    weapons[0].hits_on = 2u;
    weapons[0].strength = 2u;
    weapons[0].damage = (struct dice_value){0u, 0u, 1u};
    assert(rule_add_torrent(&weapons[0].rules));
    weapons[1] = weapons[0];
    weapons[1].damage = (struct dice_value){0u, 0u, 5u};
    targets[1] = targets[0];
    layout.segment_count = 1u;
    layout.wounds_per_model[0] = 20u;
    layout.model_counts[0] = 1u;
    targets[0].allocated_attack_damage_replacement_skip = 0u;
    targets[1].allocated_attack_damage_replacement_skip = 0u;
    assert(calculate_ordered_volley_applied_damage_distribution(
        weapons, targets, 2u, &layout, &workspace, &distribution, cumulative_means));
    assert(probability_distribution_mean(&distribution, &mean));
    assert(fabsl((long double)mean.numerator / mean.denominator - 25.0L / 6.0L) < 1e-8L);
    targets[0].allocated_attack_damage_replacement_skip = 1u;
    targets[1].allocated_attack_damage_replacement_skip = 1u;
    assert(calculate_ordered_volley_applied_damage_distribution(
        weapons, targets, 2u, &layout, &workspace, &distribution, cumulative_means));
    assert(probability_distribution_mean(&distribution, &mean));
    assert(fabsl((long double)mean.numerator / mean.denominator - 5.0L / 6.0L) < 1e-8L);
    assert(estimate_ordered_volley_complexity(weapons, targets, 2u, &layout, &complexity));
    assert(complexity.uses_deferred_states);

    targets[0].first_failed_save_damage_replacement_active = true;
    targets[1].first_failed_save_damage_replacement_active = true;
    targets[0].first_failed_save_damage_replacement = 1u;
    targets[1].first_failed_save_damage_replacement = 1u;
    assert(!calculate_ordered_volley_applied_damage_distribution(
        weapons, targets, 2u, &layout, &workspace, &distribution, cumulative_means));

    memset(&web_weapon, 0, sizeof(web_weapon));
    memset(&web_target, 0, sizeof(web_target));
    web_weapon.attack_modifier = 1u;
    web_weapon.weapon_count = 1u;
    web_weapon.hits_on = 2u;
    web_weapon.strength = 2u;
    web_weapon.damage_modifier = 3u;
    web_weapon.rule_flags = WHC_RULE_TORRENT;
    web_weapon.attacks_multiplier = 1u;
    web_weapon.strength_multiplier = 1u;
    web_weapon.damage_multiplier = 1u;
    web_target.toughness = 1u;
    web_target.save = 7u;
    web_target.wounds = 20u;
    web_target.model_count = 1u;
    web_target.damage_divisor = 1u;
    web_target.allocated_attack_damage_replacement_uses = 1u;
    assert(whc_calculate_ordered_volley_summary(&web_weapon, 1u, &web_target, 1u, 0u, &web_summary,
                                                &web_mean));
    assert(web_summary.maximum == 0u);
}

/*@ terminates \true; */
static void test_battle_health_replay(void) {
    uint32_t profiles[2u * WHC_BATTLE_PROFILE_FIELDS] = {3u, 2u, 5u, 1u};
    uint32_t events[3u * WHC_BATTLE_EVENT_FIELDS];
    uint32_t health[2u * WHC_BATTLE_HEALTH_FIELDS] = {0u};
    const uint32_t first = 0u;
    const uint32_t revert = WHC_BATTLE_EVENT_FIELDS;
    const uint32_t final = 2u * WHC_BATTLE_EVENT_FIELDS;

    memset(events, 0, sizeof(events));
    events[first] = WHC_BATTLE_EVENT_VERSION;
    events[first + 1u] = WHC_BATTLE_EVENT_ATTACK;
    events[first + 2u] = 2u;
    events[first + 4u] = 8u;
    events[first + 5u] = 2u;
    events[first + 6u] = 0u;
    events[first + 7u] = 2u;
    events[first + 8u] = 0u;
    events[first + 9u] = 0u;
    events[first + 10u] = 0u;
    events[first + 11u] = 1u;
    events[first + 12u] = 1u;
    events[first + 13u] = 0u;
    events[first + 14u] = 1u;
    events[first + 15u] = 2u;

    events[revert] = WHC_BATTLE_EVENT_VERSION;
    events[revert + 1u] = WHC_BATTLE_EVENT_REVERT;
    events[revert + 3u] = 0u;

    events[final] = WHC_BATTLE_EVENT_VERSION;
    events[final + 1u] = WHC_BATTLE_EVENT_ATTACK;
    events[final + 2u] = 2u;
    events[final + 4u] = 4u;
    events[final + 5u] = 1u;
    events[final + 6u] = 0u;
    events[final + 7u] = 2u;
    events[final + 8u] = 0u;
    events[final + 9u] = 1u;
    events[final + 10u] = 1u;
    events[final + 11u] = 1u;
    events[final + 12u] = 1u;
    events[final + 13u] = 0u;
    events[final + 14u] = 1u;
    events[final + 15u] = 0u;

    assert(whc_replay_battle_health_events(profiles, 2u, events, 3u, health));
    assert(health[0] == 1u);
    assert(health[1] == 1u);
    assert(health[2] == 1u);
    assert(health[3] == 0u);

    events[final + 4u] = 5u;
    health[0] = 91u;
    health[1] = 92u;
    health[2] = 93u;
    health[3] = 94u;
    assert(!whc_replay_battle_health_events(profiles, 2u, events, 3u, health));
    assert(health[0] == 91u);
    assert(health[1] == 92u);
    assert(health[2] == 93u);
    assert(health[3] == 94u);

    events[final + 4u] = 4u;
    events[revert + 3u] = 1u;
    assert(!whc_replay_battle_health_events(profiles, 2u, events, 3u, health));
    assert(health[0] == 91u);
    assert(health[1] == 92u);
    assert(health[2] == 93u);
    assert(health[3] == 94u);

    events[revert + 3u] = 0u;
    events[final + 4u] = 5u;
    events[final + 15u] = 1u;
    assert(!whc_replay_battle_health_events(profiles, 2u, events, 3u, health));
    assert(health[0] == 91u);
    assert(health[1] == 92u);
    assert(health[2] == 93u);
    assert(health[3] == 94u);
}

/*@ terminates \true; */
static void test_transport_damage_replay(void) {
    uint32_t profiles[WHC_BATTLE_PROFILE_FIELDS] = {2u, 2u};
    uint32_t events[WHC_BATTLE_EVENT_FIELDS] = {0u};
    uint32_t health[WHC_BATTLE_HEALTH_FIELDS] = {91u, 92u};

    events[0] = WHC_BATTLE_EVENT_VERSION;
    events[1] = WHC_BATTLE_EVENT_TRANSPORT_DAMAGE;
    events[2] = 1u;
    events[4] = 1u;
    events[5] = 0u;
    events[6] = 0u;
    events[7] = 2u;
    events[8] = 0u;
    events[9] = 2u;
    events[10] = 1u;

    assert(whc_replay_battle_health_events(profiles, 1u, events, 1u, health));
    assert(health[0] == 2u);
    assert(health[1] == 1u);

    events[4] = 2u;
    health[0] = 91u;
    health[1] = 92u;
    assert(!whc_replay_battle_health_events(profiles, 1u, events, 1u, health));
    assert(health[0] == 91u);
    assert(health[1] == 92u);
}

/*@ terminates \true; */
static void test_ranged_target_eligibility(void) {
    const uint32_t reviewed_visible = WHC_TARGET_VISIBLE | WHC_TARGET_REVIEWED_BY_PLAYER;
    const uint32_t reviewed_indirect =
        WHC_TARGET_INDIRECT_FIRE | WHC_TARGET_WEAPON_HAS_INDIRECT | WHC_TARGET_REVIEWED_BY_PLAYER;

    assert(
        whc_ranged_target_eligibility_is_valid(24000u, 24000u, 18000u, 3u, 3u, reviewed_visible));
    assert(whc_ranged_target_eligibility_is_valid(24000u, 24000u, 24000u, 3u, 1u,
                                                  reviewed_visible | WHC_TARGET_FULLY_VISIBLE));
    assert(
        whc_ranged_target_eligibility_is_valid(48000u, 48000u, 32000u, 2u, 2u, reviewed_indirect));
    assert(whc_ranged_target_eligibility_is_valid(
        24000u, 30000u, 25000u, 1u, 1u, reviewed_visible | WHC_TARGET_RANGE_OVERRIDE_EXPLAINED));
    assert(!whc_ranged_target_eligibility_is_valid(0u, 24000u, 18000u, 3u, 3u, reviewed_visible));
    assert(
        !whc_ranged_target_eligibility_is_valid(24000u, 24000u, 24001u, 3u, 3u, reviewed_visible));
    assert(
        !whc_ranged_target_eligibility_is_valid(24000u, 24000u, 18000u, 3u, 0u, reviewed_visible));
    assert(
        !whc_ranged_target_eligibility_is_valid(24000u, 24000u, 18000u, 3u, 4u, reviewed_visible));
    assert(!whc_ranged_target_eligibility_is_valid(24000u, 24000u, 18000u, 3u, 3u,
                                                   WHC_TARGET_VISIBLE));
    assert(!whc_ranged_target_eligibility_is_valid(
        24000u, 24000u, 18000u, 3u, 3u, WHC_TARGET_FULLY_VISIBLE | WHC_TARGET_REVIEWED_BY_PLAYER));
    assert(!whc_ranged_target_eligibility_is_valid(
        24000u, 24000u, 18000u, 3u, 3u, WHC_TARGET_INDIRECT_FIRE | WHC_TARGET_REVIEWED_BY_PLAYER));
    assert(
        !whc_ranged_target_eligibility_is_valid(24000u, 30000u, 25000u, 1u, 1u, reviewed_visible));
}

/*@ terminates \true; */
static void test_weapon_inventory_declaration(void) {
    const uint32_t assault_indirect = WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT;

    assert(whc_weapon_inventory_declaration_is_valid(3u, 5u, 0u, 3u, assault_indirect,
                                                     WHC_WEAPON_INDIRECT));
    assert(whc_weapon_inventory_declaration_is_valid(3u, 1u, 2u, 1u, WHC_WEAPON_ASSAULT,
                                                     WHC_WEAPON_ASSAULT));
    assert(!whc_weapon_inventory_declaration_is_valid(0u, 5u, 0u, 1u, 0u, 0u));
    assert(!whc_weapon_inventory_declaration_is_valid(3u, 0u, 0u, 1u, 0u, 0u));
    assert(!whc_weapon_inventory_declaration_is_valid(3u, 5u, 3u, 1u, 0u, 0u));
    assert(!whc_weapon_inventory_declaration_is_valid(3u, 5u, 2u, 2u, 0u, 0u));
    assert(!whc_weapon_inventory_declaration_is_valid(3u, 5u, 0u, 1u, WHC_WEAPON_ASSAULT,
                                                      WHC_WEAPON_INDIRECT));
}

/*@ terminates \true; */
static void test_weapon_bearer_declaration(void) {
    const uint32_t assault_indirect = WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT;

    assert(whc_weapon_bearer_declaration_is_valid(3u, 2u, 0u, 2u, assault_indirect,
                                                  WHC_WEAPON_INDIRECT));
    assert(whc_weapon_bearer_declaration_is_valid(3u, 1u, 0u, 1u, WHC_WEAPON_ASSAULT,
                                                  WHC_WEAPON_ASSAULT));
    assert(!whc_weapon_bearer_declaration_is_valid(3u, 4u, 0u, 1u, 0u, 0u));
    assert(!whc_weapon_bearer_declaration_is_valid(3u, 1u, 1u, 1u, 0u, 0u));
    assert(!whc_weapon_bearer_declaration_is_valid(3u, 2u, 1u, 2u, 0u, 0u));
    assert(!whc_weapon_bearer_declaration_is_valid(3u, 2u, 0u, 1u, WHC_WEAPON_ASSAULT,
                                                   WHC_WEAPON_INDIRECT));
}

/*@ terminates \true; */
static void test_charge_resolution(void) {
    const uint32_t common = WHC_CHARGE_REVIEWED_BY_PLAYER | WHC_CHARGE_PHASE_START_ELIGIBLE |
                            WHC_CHARGE_STARTED_OUTSIDE_ENGAGEMENT;
    const uint32_t successful = common | WHC_CHARGE_ALL_TARGETS_ENGAGED |
                                WHC_CHARGE_UNIT_COHERENCY | WHC_CHARGE_NON_TARGETS_AVOIDED |
                                WHC_CHARGE_ALL_MODELS_CLOSER | WHC_CHARGE_BASE_CONTACT_MAXIMIZED;

    assert(whc_charge_resolution_is_valid(3u, 4u, 0, 7000u, 8500u, 6500u, 1u, true, successful));
    assert(whc_charge_resolution_is_valid(1u, 2u, 0, 3000u, 11000u, 0u, 2u, false,
                                          common | WHC_CHARGE_FAILURE_EXPLAINED));
    assert(!whc_charge_resolution_is_valid(3u, 4u, 0, 7000u, 8500u, 7500u, 1u, true, successful));
    assert(!whc_charge_resolution_is_valid(3u, 4u, 0, 7000u, 12500u, 6500u, 1u, true, successful));
    assert(!whc_charge_resolution_is_valid(3u, 4u, 1, 7000u, 8500u, 6500u, 1u, true, successful));
    assert(whc_charge_resolution_is_valid(3u, 4u, 1, 7000u, 8500u, 6500u, 1u, true,
                                          successful | WHC_CHARGE_ROLL_OVERRIDE_EXPLAINED));
}

/*@ terminates \true; */
static void test_fight_move(void) {
    const uint32_t enemy = WHC_FIGHT_MOVE_REVIEWED_BY_PLAYER | WHC_FIGHT_MOVE_UNIT_COHERENCY |
                           WHC_FIGHT_MOVE_ENGAGEMENT_RANGE | WHC_FIGHT_MOVE_CLOSER_TO_ENEMY |
                           WHC_FIGHT_MOVE_BASE_CONTACT_MAXIMIZED |
                           WHC_FIGHT_MOVE_BASE_CONTACT_STATIONARY;
    const uint32_t pile_none =
        WHC_FIGHT_MOVE_REVIEWED_BY_PLAYER | WHC_FIGHT_MOVE_BASE_CONTACT_STATIONARY |
        WHC_FIGHT_MOVE_ENEMY_DESTINATION_IMPOSSIBLE | WHC_FIGHT_MOVE_OUTCOME_EXPLAINED;
    const uint32_t objective = WHC_FIGHT_MOVE_REVIEWED_BY_PLAYER | WHC_FIGHT_MOVE_UNIT_COHERENCY |
                               WHC_FIGHT_MOVE_BASE_CONTACT_STATIONARY |
                               WHC_FIGHT_MOVE_ENEMY_DESTINATION_IMPOSSIBLE |
                               WHC_FIGHT_MOVE_OBJECTIVE_RANGE | WHC_FIGHT_MOVE_CLOSER_TO_OBJECTIVE |
                               WHC_FIGHT_MOVE_OUTCOME_EXPLAINED;
    const uint32_t consolidation_none = pile_none | WHC_FIGHT_MOVE_OBJECTIVE_DESTINATION_IMPOSSIBLE;
    const uint32_t rule_restricted =
        WHC_FIGHT_MOVE_REVIEWED_BY_PLAYER | WHC_FIGHT_MOVE_BASE_CONTACT_STATIONARY |
        WHC_FIGHT_MOVE_OUTCOME_EXPLAINED | WHC_FIGHT_MOVE_RULE_RESTRICTED;

    assert(
        whc_fight_move_is_valid(WHC_FIGHT_MOVE_PILE_IN, WHC_FIGHT_DESTINATION_ENEMY, 3000u, enemy));
    assert(
        whc_fight_move_is_valid(WHC_FIGHT_MOVE_PILE_IN, WHC_FIGHT_DESTINATION_NONE, 0u, pile_none));
    assert(whc_fight_move_is_valid(WHC_FIGHT_MOVE_CONSOLIDATION, WHC_FIGHT_DESTINATION_OBJECTIVE,
                                   2500u, objective));
    assert(whc_fight_move_is_valid(WHC_FIGHT_MOVE_CONSOLIDATION, WHC_FIGHT_DESTINATION_NONE, 0u,
                                   consolidation_none));
    assert(whc_fight_move_is_valid(WHC_FIGHT_MOVE_PILE_IN, WHC_FIGHT_DESTINATION_NONE, 0u,
                                   rule_restricted));
    assert(whc_fight_move_is_valid(WHC_FIGHT_MOVE_CONSOLIDATION, WHC_FIGHT_DESTINATION_NONE, 0u,
                                   rule_restricted));
    assert(!whc_fight_move_is_valid(WHC_FIGHT_MOVE_PILE_IN, WHC_FIGHT_DESTINATION_ENEMY, 0u,
                                    rule_restricted));
    assert(!whc_fight_move_is_valid(WHC_FIGHT_MOVE_PILE_IN, WHC_FIGHT_DESTINATION_OBJECTIVE, 1000u,
                                    objective));
    assert(!whc_fight_move_is_valid(WHC_FIGHT_MOVE_PILE_IN, WHC_FIGHT_DESTINATION_NONE, 1u,
                                    pile_none));
    assert(!whc_fight_move_is_valid(WHC_FIGHT_MOVE_CONSOLIDATION, WHC_FIGHT_DESTINATION_ENEMY,
                                    3001u, enemy));
    assert(!whc_fight_move_is_valid(WHC_FIGHT_MOVE_CONSOLIDATION, WHC_FIGHT_DESTINATION_ENEMY,
                                    1000u, enemy & ~WHC_FIGHT_MOVE_BASE_CONTACT_STATIONARY));
}

/*@ terminates \true; */
static void test_heroic_intervention(void) {
    const uint32_t common = WHC_CHARGE_REVIEWED_BY_PLAYER | WHC_CHARGE_PHASE_START_ELIGIBLE |
                            WHC_CHARGE_STARTED_OUTSIDE_ENGAGEMENT;
    const uint32_t successful = common | WHC_CHARGE_ALL_TARGETS_ENGAGED |
                                WHC_CHARGE_UNIT_COHERENCY | WHC_CHARGE_NON_TARGETS_AVOIDED |
                                WHC_CHARGE_ALL_MODELS_CLOSER | WHC_CHARGE_BASE_CONTACT_MAXIMIZED;

    assert(whc_heroic_intervention_is_valid(3u, 4u, 0, 7000u, 5500u, 5500u, true, successful,
                                            WHC_HEROIC_FLAGS_MASK));
    assert(whc_heroic_intervention_is_valid(1u, 2u, 0, 3000u, 6000u, 0u, false,
                                            common | WHC_CHARGE_FAILURE_EXPLAINED,
                                            WHC_HEROIC_FLAGS_MASK));
    assert(!whc_heroic_intervention_is_valid(3u, 4u, 0, 7000u, 6001u, 5500u, true, successful,
                                             WHC_HEROIC_FLAGS_MASK));
    assert(!whc_heroic_intervention_is_valid(3u, 4u, 0, 7000u, 5500u, 5500u, true, successful,
                                             WHC_HEROIC_FLAGS_MASK &
                                                 ~WHC_HEROIC_CHARGE_BONUS_SUPPRESSED));
    assert(!whc_heroic_intervention_is_valid(3u, 4u, 0, 7000u, 5500u, 7500u, true, successful,
                                             WHC_HEROIC_FLAGS_MASK));
}

/*@ terminates \true; */
static void test_fire_overwatch(void) {
    assert(whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_SET_UP, WHC_BATTLE_PHASE_MOVEMENT, 24000u,
                                       WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_SET_UP, WHC_BATTLE_PHASE_CHARGE, 1u,
                                       WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_NORMAL_MOVE_START,
                                       WHC_BATTLE_PHASE_MOVEMENT, 12000u,
                                       WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_CHARGE_DECLARED, WHC_BATTLE_PHASE_CHARGE,
                                       6000u, WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(!whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_CHARGE_DECLARED,
                                        WHC_BATTLE_PHASE_MOVEMENT, 6000u,
                                        WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(!whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_NORMAL_MOVE_END, WHC_BATTLE_PHASE_CHARGE,
                                        6000u, WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(!whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_ADVANCE_END, WHC_BATTLE_PHASE_MOVEMENT,
                                        24001u, WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(!whc_fire_overwatch_is_valid(
        WHC_FIRE_OVERWATCH_FALL_BACK_START, WHC_BATTLE_PHASE_MOVEMENT, 6000u,
        WHC_FIRE_OVERWATCH_FLAGS_MASK & ~WHC_FIRE_OVERWATCH_TARGET_VISIBLE));
}

/*@ terminates \true; */
static void test_hazardous_resolution(void) {
    uint32_t profiles[WHC_BATTLE_PROFILE_FIELDS] = {3u, 2u};
    uint32_t events[WHC_BATTLE_EVENT_FIELDS] = {0u};
    uint32_t health[WHC_BATTLE_HEALTH_FIELDS] = {99u, 99u};

    assert(whc_hazardous_resolution_is_valid(1u, 0u, false, 2u, 0u, 0u, 0u, 2u, true,
                                             WHC_HAZARDOUS_FLAGS_MASK));
    assert(whc_hazardous_resolution_is_valid(1u, 0u, false, 5u, 5u, 3u, 2u, 1u, false,
                                             WHC_HAZARDOUS_FLAGS_MASK));
    assert(whc_hazardous_resolution_is_valid(2u, 1u, true, 2u, 5u, 2u, 0u, 2u, true,
                                             WHC_HAZARDOUS_FLAGS_MASK));
    assert(whc_hazardous_resolution_is_valid(1u, 0u, false, 1u, 5u, 3u, 3u, 0u, false,
                                             WHC_HAZARDOUS_FLAGS_MASK));
    assert(!whc_hazardous_resolution_is_valid(2u, 0u, false, 3u, 0u, 0u, 0u, 3u, true,
                                              WHC_HAZARDOUS_FLAGS_MASK));
    assert(!whc_hazardous_resolution_is_valid(1u, 2u, true, 3u, 0u, 0u, 0u, 3u, true,
                                              WHC_HAZARDOUS_FLAGS_MASK));
    assert(!whc_hazardous_resolution_is_valid(1u, 0u, false, 2u, 5u, 3u, 0u, 3u, false,
                                              WHC_HAZARDOUS_FLAGS_MASK));

    events[0] = WHC_BATTLE_EVENT_VERSION;
    events[1] = WHC_BATTLE_EVENT_HAZARDOUS_DAMAGE;
    events[2] = 1u;
    events[4] = 3u;
    events[5] = 1u;
    events[WHC_BATTLE_EVENT_HEADER_FIELDS] = 0u;
    events[WHC_BATTLE_EVENT_HEADER_FIELDS + 1u] = 2u;
    events[WHC_BATTLE_EVENT_HEADER_FIELDS + 2u] = 0u;
    events[WHC_BATTLE_EVENT_HEADER_FIELDS + 3u] = 1u;
    events[WHC_BATTLE_EVENT_HEADER_FIELDS + 4u] = 0u;
    assert(whc_replay_battle_health_events(profiles, 1u, events, 1u, health));
    assert(health[0] == 1u && health[1] == 0u);
}

static void test_go_to_ground(void) {
    assert(whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, false, false,
                                     WHC_GO_TO_GROUND_FLAGS_MASK));
    assert(whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_SHOOTING, 1u, 1u, 0u, false, false,
                                     WHC_GO_TO_GROUND_FLAGS_MASK));
    assert(!whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_MOVEMENT, 2u, 1u, 1u, false, false,
                                      WHC_GO_TO_GROUND_FLAGS_MASK));
    assert(!whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_SHOOTING, 0u, 1u, 0u, false, false,
                                      WHC_GO_TO_GROUND_FLAGS_MASK));
    assert(!whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 0u, false, false,
                                      WHC_GO_TO_GROUND_FLAGS_MASK));
    assert(!whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, true, false,
                                      WHC_GO_TO_GROUND_FLAGS_MASK));
    assert(!whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, false, true,
                                      WHC_GO_TO_GROUND_FLAGS_MASK));
    assert(!whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, false, false,
                                      WHC_GO_TO_GROUND_FLAGS_MASK &
                                          ~WHC_GO_TO_GROUND_BENEFIT_OF_COVER));
}

static void test_counter_offensive(void) {
    assert(whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_FIGHT, 2u, 2u, 0u, false, false,
                                          WHC_COUNTER_OFFENSIVE_FLAGS_MASK));
    assert(whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_FIGHT, 3u, 2u, 1u, false, false,
                                          WHC_COUNTER_OFFENSIVE_FLAGS_MASK));
    assert(!whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 2u, 0u, false, false,
                                           WHC_COUNTER_OFFENSIVE_FLAGS_MASK));
    assert(!whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_FIGHT, 1u, 2u, 0u, false, false,
                                           WHC_COUNTER_OFFENSIVE_FLAGS_MASK));
    assert(!whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_FIGHT, 2u, 2u, 1u, false, false,
                                           WHC_COUNTER_OFFENSIVE_FLAGS_MASK));
    assert(!whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_FIGHT, 2u, 2u, 0u, true, false,
                                           WHC_COUNTER_OFFENSIVE_FLAGS_MASK));
    assert(!whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_FIGHT, 2u, 2u, 0u, false, true,
                                           WHC_COUNTER_OFFENSIVE_FLAGS_MASK));
    assert(!whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_FIGHT, 2u, 2u, 0u, false, false,
                                           WHC_COUNTER_OFFENSIVE_FLAGS_MASK - 1u));
}

static void test_smokescreen(void) {
    assert(whc_smokescreen_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, false, false,
                                    WHC_SMOKESCREEN_FLAGS_MASK));
    assert(whc_smokescreen_is_valid(WHC_BATTLE_PHASE_SHOOTING, 1u, 1u, 0u, false, false,
                                    WHC_SMOKESCREEN_FLAGS_MASK));
    assert(!whc_smokescreen_is_valid(WHC_BATTLE_PHASE_MOVEMENT, 2u, 1u, 1u, false, false,
                                     WHC_SMOKESCREEN_FLAGS_MASK));
    assert(!whc_smokescreen_is_valid(WHC_BATTLE_PHASE_SHOOTING, 0u, 1u, 0u, false, false,
                                     WHC_SMOKESCREEN_FLAGS_MASK));
    assert(!whc_smokescreen_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 0u, false, false,
                                     WHC_SMOKESCREEN_FLAGS_MASK));
    assert(!whc_smokescreen_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, true, false,
                                     WHC_SMOKESCREEN_FLAGS_MASK));
    assert(!whc_smokescreen_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, false, true,
                                     WHC_SMOKESCREEN_FLAGS_MASK));
    assert(!whc_smokescreen_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, false, false,
                                     WHC_SMOKESCREEN_FLAGS_MASK & ~WHC_SMOKESCREEN_STEALTH));
}

static void test_rapid_ingress(void) {
    assert(whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 2u, 2u, 2u,
                                      1u, 1u, false, false, false, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 1u, 1u, 1u,
                                      1u, 0u, false, false, true, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(!whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_REINFORCEMENTS,
                                       2u, 2u, 2u, 1u, 1u, false, false, false,
                                       WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(!whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_SHOOTING, WHC_MOVEMENT_STEP_END, 2u, 2u, 2u,
                                       1u, 1u, false, false, false, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(!whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 1u, 1u, 2u,
                                       1u, 1u, false, false, false, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(!whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 1u, 2u, 2u,
                                       1u, 1u, false, false, true, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(!whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 2u, 2u, 0u,
                                       1u, 0u, false, false, false, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(!whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 2u, 2u, 2u,
                                       1u, 1u, true, false, false, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(!whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 2u, 2u, 2u,
                                       1u, 1u, false, true, false, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(!whc_rapid_ingress_is_valid(
        WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 2u, 2u, 2u, 1u, 1u, false, false, false,
        WHC_RAPID_INGRESS_FLAGS_MASK & ~WHC_RAPID_INGRESS_PLACEMENT_LEGAL));
}

static void test_rule_coverage(void) {
    assert(whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_EXECUTABLE, true, false));
    assert(whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_IRRELEVANT, true, false));
    assert(whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_GUIDED, true, true));
    assert(!whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_GUIDED, true, false));
    assert(!whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_UNSUPPORTED, true, true));
    assert(!whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_EXECUTABLE, false, true));
    assert(!whc_rule_coverage_is_permitted(0u, true, true));
    assert(!whc_rule_coverage_is_permitted(5u, true, true));
}

static void test_ranged_declaration(void) {
    assert(
        whc_ranged_declaration_is_valid(3u, 3u, 2u, 2u, 3u, 3u, WHC_RANGED_DECLARATION_FLAGS_MASK));
    assert(
        whc_ranged_declaration_is_valid(2u, 2u, 1u, 1u, 1u, 1u, WHC_RANGED_DECLARATION_FLAGS_MASK));
    assert(!whc_ranged_declaration_is_valid(0u, 0u, 0u, 0u, 0u, 0u,
                                            WHC_RANGED_DECLARATION_FLAGS_MASK));
    assert(!whc_ranged_declaration_is_valid(3u, 2u, 2u, 2u, 3u, 3u,
                                            WHC_RANGED_DECLARATION_FLAGS_MASK));
    assert(!whc_ranged_declaration_is_valid(3u, 3u, 3u, 2u, 3u, 3u,
                                            WHC_RANGED_DECLARATION_FLAGS_MASK));
    assert(!whc_ranged_declaration_is_valid(3u, 3u, 2u, 2u, 3u, 3u,
                                            WHC_RANGED_DECLARATION_FLAGS_MASK &
                                                ~WHC_RANGED_DECLARATION_ALL_ELIGIBLE));
}

/*@ assigns \nothing;
 */
static void test_transport_load(void) {
    assert(whc_transport_load_is_valid(12u, 12u, 0u, 0u, 1u));
    assert(whc_transport_load_is_valid(4u, 6u, 1u, 1u, 1u));
    assert(whc_transport_load_is_valid(0u, 12u, 0u, 0u, 0u));
    assert(!whc_transport_load_is_valid(13u, 12u, 0u, 0u, 1u));
    assert(!whc_transport_load_is_valid(4u, 6u, 2u, 1u, 1u));
    assert(whc_transport_load_is_valid(4u, 6u, 0u, 1u, 1u));
    assert(!whc_transport_load_is_valid(4u, 6u, 1u, 0u, 1u));
    assert(!whc_transport_load_is_valid(4u, 6u, 0u, 0u, 2u));
    assert(!whc_transport_load_is_valid(0u, 0u, 0u, 0u, 0u));
}

/*@ assigns \nothing;
 */
static void test_transport_deployment_chain(void) {
    assert(whc_transport_deployment_chain_is_valid(1u, 1u, WHC_DEPLOYMENT_ROOT_BATTLEFIELD, 0u));
    assert(whc_transport_deployment_chain_is_valid(1u, 1u, WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED, 0u));
    assert(whc_transport_deployment_chain_is_valid(3u, 3u, WHC_DEPLOYMENT_ROOT_BATTLEFIELD, 0u));
    assert(whc_transport_deployment_chain_is_valid(3u, 3u, WHC_DEPLOYMENT_ROOT_RESERVES, 3u));
    assert(whc_transport_deployment_chain_is_valid(3u, 3u, WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES,
                                                   3u));
    assert(!whc_transport_deployment_chain_is_valid(3u, 2u, WHC_DEPLOYMENT_ROOT_BATTLEFIELD, 0u));
    assert(!whc_transport_deployment_chain_is_valid(3u, 3u, WHC_DEPLOYMENT_ROOT_RESERVES, 2u));
    assert(!whc_transport_deployment_chain_is_valid(0u, 0u, 0u, 0u));
}

/*@ assigns \nothing;
 */
static void test_initial_deployment(void) {
    assert(whc_initial_deployment_is_valid(0u, 0u, 0u, 0u, WHC_AIRCRAFT_MODE_NONE,
                                           WHC_DEPLOYMENT_ROOT_BATTLEFIELD));
    assert(whc_initial_deployment_is_valid(1u, 0u, 0u, 0u, WHC_AIRCRAFT_MODE_NONE,
                                           WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED));
    assert(!whc_initial_deployment_is_valid(1u, 0u, 0u, 0u, WHC_AIRCRAFT_MODE_NONE,
                                            WHC_DEPLOYMENT_ROOT_BATTLEFIELD));
    assert(whc_initial_deployment_is_valid(1u, 1u, 0u, 0u, WHC_AIRCRAFT_MODE_NONE,
                                           WHC_DEPLOYMENT_ROOT_BATTLEFIELD));
    assert(whc_initial_deployment_is_valid(0u, 0u, 1u, 0u, WHC_AIRCRAFT_MODE_AIRCRAFT,
                                           WHC_DEPLOYMENT_ROOT_RESERVES));
    assert(!whc_initial_deployment_is_valid(0u, 0u, 1u, 0u, WHC_AIRCRAFT_MODE_AIRCRAFT,
                                            WHC_DEPLOYMENT_ROOT_BATTLEFIELD));
    assert(whc_initial_deployment_is_valid(0u, 0u, 1u, 1u, WHC_AIRCRAFT_MODE_HOVER,
                                           WHC_DEPLOYMENT_ROOT_BATTLEFIELD));
    assert(whc_initial_deployment_is_valid(0u, 0u, 1u, 1u, WHC_AIRCRAFT_MODE_HOVER,
                                           WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES));
    assert(!whc_initial_deployment_is_valid(0u, 0u, 1u, 1u, WHC_AIRCRAFT_MODE_HOVER,
                                            WHC_DEPLOYMENT_ROOT_RESERVES));
}

/*@ assigns \nothing;
 */
static void test_battle_clock(void) {
    uint32_t current[WHC_BATTLE_CLOCK_FIELDS] = {0u};
    uint32_t next[WHC_BATTLE_CLOCK_FIELDS] = {0u};
    uint32_t advances = 0u;

    assert(whc_start_battle_clock(1u, current));
    assert(current[0] == WHC_BATTLE_CLOCK_ACTIVE);
    assert(current[5] == 1u && current[6] == 1u && current[7] == 1u);
    while (current[0] == WHC_BATTLE_CLOCK_ACTIVE) {
        assert(advances < 170u);
        assert(whc_next_battle_clock(current, next));
        if (next[3] == WHC_BATTLE_PHASE_FIGHT &&
            (next[4] == 0u || next[4] == 1u || next[4] == 2u)) {
            assert(next[7] == 1u - next[6]);
        }
        memcpy(current, next, sizeof(current));
        advances++;
    }
    assert(advances == 170u);
    assert(current[0] == WHC_BATTLE_CLOCK_COMPLETE);
    assert(current[1] == 5u && current[2] == 2u);
    assert(current[3] == WHC_BATTLE_PHASE_COMPLETE);
    assert(current[5] == 1u);
    assert(current[6] == WHC_BATTLE_PLAYER_NONE);
    next[0] = 91u;
    assert(!whc_next_battle_clock(current, next));
    assert(next[0] == 91u);
}

/*@ assigns \nothing;
 */
static void test_convex_silhouette(void) {
    const int32_t square[] = {-500, -500, 500, -500, 500, 500, -500, 500};
    const int32_t clockwise[] = {-500, 500, 500, 500, 500, -500, -500, -500};
    const int32_t concave[] = {-500, -500, 500, -500, 0, 0, 500, 500, -500, 500};
    const int32_t out_of_range[] = {-30001, -500, 500, -500, 500, 500, -500, 500};

    assert(whc_convex_silhouette_is_valid(square, 4u, WHC_CONVEX_SILHOUETTE_REVIEWED));
    assert(!whc_convex_silhouette_is_valid(clockwise, 4u, WHC_CONVEX_SILHOUETTE_REVIEWED));
    assert(!whc_convex_silhouette_is_valid(concave, 5u, WHC_CONVEX_SILHOUETTE_REVIEWED));
    assert(!whc_convex_silhouette_is_valid(out_of_range, 4u,
                                           WHC_CONVEX_SILHOUETTE_REVIEWED));
    assert(!whc_convex_silhouette_is_valid(square, 4u, 0u));
    assert(!whc_convex_silhouette_is_valid(NULL, 4u, WHC_CONVEX_SILHOUETTE_REVIEWED));
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
    test_damage_division_modifier_order();
    test_characteristic_multiplier_order();
    test_shared_random_characteristic_modifier();
    test_first_failed_save_damage_replacement();
    test_allocated_attack_damage_replacement();
    test_battle_health_replay();
    test_transport_damage_replay();
    test_ranged_target_eligibility();
    test_weapon_inventory_declaration();
    test_weapon_bearer_declaration();
    test_charge_resolution();
    test_fight_move();
    test_heroic_intervention();
    test_fire_overwatch();
    test_hazardous_resolution();
    test_go_to_ground();
    test_counter_offensive();
    test_smokescreen();
    test_rapid_ingress();
    test_rule_coverage();
    test_ranged_declaration();
    test_transport_load();
    test_transport_deployment_chain();
    test_initial_deployment();
    test_battle_clock();
    test_convex_silhouette();
    assert(whc_table_geometry_is_valid(60000u, 44000u, 5u, 5u, 12u, 4u, 2u, 6u,
                                       WHC_TABLE_GEOMETRY_FLAGS_MASK));
    assert(!whc_table_geometry_is_valid(44000u, 60000u, 5u, 5u, 12u, 4u, 2u, 6u,
                                        WHC_TABLE_GEOMETRY_FLAGS_MASK));
    assert(!whc_table_geometry_is_valid(60000u, 44000u, 5u, 4u, 12u, 4u, 2u, 6u,
                                        WHC_TABLE_GEOMETRY_FLAGS_MASK));
    assert(!whc_table_geometry_is_valid(60000u, 44000u, 5u, 5u, 11u, 4u, 2u, 5u,
                                        WHC_TABLE_GEOMETRY_FLAGS_MASK));
    assert(!whc_table_geometry_is_valid(60000u, 44000u, 5u, 5u, 12u, 4u, 2u, 6u,
                                        WHC_TABLE_GEOMETRY_FLAGS_MASK - 1u));
    assert(whc_terrain_footprint_set_is_valid(12u, 12u, 12u, 12u, 12u, 0u, 4u, 2u, 6u,
                                              WHC_TERRAIN_FOOTPRINT_FLAGS_MASK));
    assert(!whc_terrain_footprint_set_is_valid(12u, 11u, 12u, 11u, 12u, 0u, 4u, 2u, 6u,
                                               WHC_TERRAIN_FOOTPRINT_FLAGS_MASK));
    assert(!whc_terrain_footprint_set_is_valid(12u, 12u, 12u, 12u, 12u, 1u, 4u, 2u, 6u,
                                               WHC_TERRAIN_FOOTPRINT_FLAGS_MASK));
    assert(!whc_terrain_footprint_set_is_valid(12u, 12u, 12u, 12u, 12u, 0u, 4u, 2u, 6u,
                                               WHC_TERRAIN_FOOTPRINT_FLAGS_MASK - 1u));
    assert(whc_model_placement_set_is_valid(5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, 4u, 1u,
                                            WHC_MODEL_PLACEMENT_FLAGS_MASK));
    assert(!whc_model_placement_set_is_valid(5u, 4u, 4u, 4u, 4u, 4u, 4u, 4u, 3u, 1u,
                                             WHC_MODEL_PLACEMENT_FLAGS_MASK));
    assert(!whc_model_placement_set_is_valid(5u, 5u, 5u, 5u, 5u, 4u, 5u, 5u, 4u, 1u,
                                             WHC_MODEL_PLACEMENT_FLAGS_MASK));
    assert(!whc_model_placement_set_is_valid(5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, 4u, 1u,
                                             WHC_MODEL_PLACEMENT_FLAGS_MASK - 1u));
    assert(!whc_model_placement_set_is_valid(5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, UINT32_MAX, 6u,
                                             WHC_MODEL_PLACEMENT_FLAGS_MASK));
    assert(whc_model_position_set_is_valid(5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, 4u, 1u, 2u,
                                           2u, 5u, 5u, 5u, 5u, 5u, 5u, 5u,
                                           WHC_MODEL_POSITION_FLAGS_MASK));
    assert(!whc_model_position_set_is_valid(5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, 4u, 1u,
                                            2u, 1u, 5u, 5u, 5u, 5u, 5u, 5u, 5u,
                                            WHC_MODEL_POSITION_FLAGS_MASK));
    assert(!whc_model_position_set_is_valid(5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, 4u, 1u,
                                            2u, 2u, 5u, 5u, 5u, 5u, 5u, 5u, 4u,
                                            WHC_MODEL_POSITION_FLAGS_MASK));
    assert(!whc_model_position_set_is_valid(5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u,
                                            UINT32_MAX, 6u, 2u, 2u, 5u, 5u, 5u, 5u, 5u,
                                            5u, 5u, WHC_MODEL_POSITION_FLAGS_MASK));
    assert(whc_endpoint_clearance_facts_are_valid(5u, 5u, 4u, 4u, 0u, 0u,
                                                   WHC_ENDPOINT_CLEARANCE_FLAGS_MASK));
    assert(whc_endpoint_clearance_facts_are_valid(5u, 5u, 4u, 4u, 2u, 3u,
                                                   WHC_ENDPOINT_CLEARANCE_FLAGS_MASK));
    assert(whc_endpoint_clearance_facts_are_valid(5u, 4u, 4u, 4u, 6u, 16u, 2u));
    assert(!whc_endpoint_clearance_facts_are_valid(5u, 4u, 4u, 4u, 7u, 0u, 2u));
    assert(!whc_endpoint_clearance_facts_are_valid(5u, 5u, 4u, 4u, 0u, 0u, 2u));
    assert(!whc_endpoint_clearance_facts_are_valid(1001u, 1001u, 4u, 4u, 0u, 0u,
                                                    WHC_ENDPOINT_CLEARANCE_FLAGS_MASK));
    assert(whc_objective_control_facts_are_valid(
        2u, 2u, 6u, 1u, 1u, 0u, WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK));
    assert(whc_objective_control_facts_are_valid(
        2u, 2u, 6u, 2u, 0u, 1u, WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK));
    assert(whc_objective_control_facts_are_valid(
        2u, 2u, 0u, 2u, 0u, 1u, WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK));
    assert(!whc_objective_control_facts_are_valid(
        2u, 2u, 0u, 0u, 0u, 0u, WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK));
    assert(!whc_objective_control_facts_are_valid(
        2u, 2u, 6u, 2u, 1u, 0u, WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK));
    puts("all tests passed");

    return 0;
}
