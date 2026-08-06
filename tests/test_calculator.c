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
                                 0, 0, 0, 0, 0, &summary));
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
                                 10, 0, 0, 0, 0, 0, 1, 2, &summary));
    assert(summary.mean_numerator_low == 20);
    assert(summary.mean_denominator_low == 1);

    assert(whc_calculate_summary(0, 0, 1, 1, 6, 2, 1, 0, 0, 1, 6, 1, 3, 0, 0, 10, 0,
                                 WHC_RULE_TORRENT | WHC_RULE_TARGET_COVER, 0, 1, 0, 0, 0, 0, 0, 0,
                                 0, &summary));
    assert(summary.mean_numerator_low == 5);
    assert(summary.mean_denominator_low == 18);
}

/*@ terminates \true; */
static void test_indirect_fire_restrictions(void) {
    struct whc_web_summary summary;
    uint32_t indirect = WHC_RULE_INDIRECT_NOT_VISIBLE | WHC_RULE_IGNORES_COVER;

    assert(whc_calculate_summary(0, 0, 1, 1, 2, 10, 0, 0, 0, 1, 3, 1, 7, 0, 0, 2, 0, indirect, 0, 1,
                                 0, 0, 0, 0, 0, 0, 0, &summary));
    assert(summary.mean_numerator_low == 5);
    assert(summary.mean_numerator_high == 0);
    assert(summary.mean_denominator_low == 12);
    assert(summary.mean_denominator_high == 0);

    assert(!whc_calculate_summary(0, 0, 1, 1, 2, 10, 0, 0, 0, 1, 6, 1, 7, 0, 0, 2, 0,
                                  indirect | WHC_RULE_TORRENT, 0, 1, 0, 0, 0, 0, 0, 0, 0,
                                  &summary));
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

/*@ terminates \true;
    ensures \result == 0;
*/
int main(void) {
    assert(greatest_common_divisor(48, 18) == 6);
    test_dice();
    test_basic_attack();
    test_rules();
    test_random_attacks_damage_and_fnp();
    test_web_api();
    test_sustained_hits_torrent_and_lance();
    test_web_api_context_rules();
    test_indirect_fire_restrictions();
    test_save_thresholds();
    test_unit_damage_allocation();
    test_ordered_mixed_profile_volley();
    puts("all tests passed");
    return 0;
}
