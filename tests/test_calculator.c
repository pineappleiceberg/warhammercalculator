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
                                 0, &summary));
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
                                 10, 0, 1, 2, &summary));
    assert(summary.mean_numerator_low == 20);
    assert(summary.mean_denominator_low == 1);

    assert(whc_calculate_summary(0, 0, 1, 1, 6, 2, 1, 0, 0, 1, 6, 1, 3, 0, 0, 10, 0,
                                 WHC_RULE_TORRENT | WHC_RULE_TARGET_COVER, 0, 1, 0, 0, 0,
                                 &summary));
    assert(summary.mean_numerator_low == 5);
    assert(summary.mean_denominator_low == 18);
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
    test_save_thresholds();
    test_unit_damage_allocation();
    puts("all tests passed");
    return 0;
}
