#include "warhammercalculator/web_api.h"

#include <string.h>

bool whc_calculate_summary(uint16_t attack_dice_count, uint16_t attack_dice_sides,
                           uint16_t attack_modifier, uint16_t weapon_count, uint8_t hits_on,
                           uint16_t strength, uint16_t ap, uint16_t damage_dice_count,
                           uint16_t damage_dice_sides, uint16_t damage_modifier,
                           uint8_t critical_hits_on, uint16_t toughness, uint8_t save,
                           uint8_t invulnerable_save, uint8_t feel_no_pain, uint16_t wounds,
                           uint16_t damage_reduction, uint32_t rule_flags,
                           uint8_t critical_wounds_on, uint16_t target_models,
                           uint8_t sustained_hits, uint16_t rapid_fire, uint16_t melta,
                           struct whc_web_summary *summary) {
    static struct calculator_workspace workspace;
    struct weapon_profile weapon;
    struct target_profile target;
    struct distribution_summary calculated;
    uint32_t attacks_per_weapon = attack_modifier;
    uint32_t total_attack_dice = 0;
    uint32_t total_attack_modifier = 0;
    uint32_t effective_damage_modifier = damage_modifier;
    int16_t hit_modifier = 0;
    uint8_t effective_hits_on = hits_on;
    bool target_has_cover = false;

    if (weapon_count == 0u || sustained_hits > 6u) {
        return false;
    }

    if ((rule_flags & WHC_RULE_RAPID_FIRE_ACTIVE) != 0u) {
        attacks_per_weapon += rapid_fire;
    }
    if ((rule_flags & WHC_RULE_BLAST) != 0u) {
        attacks_per_weapon += target_models / 5u;
    }
    if ((rule_flags & WHC_RULE_MELTA_ACTIVE) != 0u) {
        effective_damage_modifier += melta;
    }

    total_attack_dice = (uint32_t)attack_dice_count * weapon_count;
    total_attack_modifier = attacks_per_weapon * weapon_count;
    if (total_attack_dice > UINT16_MAX || total_attack_modifier > UINT16_MAX ||
        effective_damage_modifier > UINT16_MAX) {
        return false;
    }

    if ((rule_flags & WHC_RULE_HEAVY_ACTIVE) != 0u) {
        hit_modifier++;
    }
    if ((rule_flags & WHC_RULE_INDIRECT_NOT_VISIBLE) != 0u) {
        hit_modifier--;
    }
    if (hit_modifier > 1) {
        hit_modifier = 1;
    } else if (hit_modifier < -1) {
        hit_modifier = -1;
    }
    if (hit_modifier > 0 && effective_hits_on > 2u) {
        effective_hits_on--;
    } else if (hit_modifier < 0 && effective_hits_on < 6u) {
        effective_hits_on++;
    }

    target_has_cover = (rule_flags & WHC_RULE_TARGET_COVER) != 0u ||
                       (rule_flags & WHC_RULE_INDIRECT_NOT_VISIBLE) != 0u;
    if ((rule_flags & WHC_RULE_IGNORES_COVER) != 0u) {
        target_has_cover = false;
    }

    memset(&weapon, 0, sizeof(weapon));
    memset(&target, 0, sizeof(target));

    weapon.attacks = (struct dice_value){(uint16_t)total_attack_dice, attack_dice_sides,
                                         (uint16_t)total_attack_modifier};
    weapon.hits_on = effective_hits_on;
    weapon.strength = strength;
    weapon.ap = ap;
    weapon.damage = (struct dice_value){damage_dice_count, damage_dice_sides,
                                        (uint16_t)effective_damage_modifier};
    weapon.critical_hits_on = critical_hits_on;

    target.toughness = toughness;
    target.save = save;
    target.invulnerable_save = invulnerable_save;
    target.feel_no_pain = feel_no_pain;
    target.wounds = wounds;
    target.reduction = damage_reduction;

    if (((rule_flags & WHC_RULE_LETHAL_HITS) != 0u && !rule_add_lethal_hits(&weapon.rules)) ||
        ((rule_flags & WHC_RULE_DEVASTATING_WOUNDS) != 0u &&
         !rule_add_devastating_wounds(&weapon.rules)) ||
        ((rule_flags & WHC_RULE_TWIN_LINKED) != 0u && !rule_add_twin_linked(&weapon.rules)) ||
        ((rule_flags & WHC_RULE_REROLL_FAILED_HITS) != 0u &&
         !rule_add_reroll_failed_hits(&weapon.rules)) ||
        ((rule_flags & WHC_RULE_TORRENT) != 0u && !rule_add_torrent(&weapon.rules)) ||
        (sustained_hits != 0u && !rule_add_sustained_hits(&weapon.rules, sustained_hits)) ||
        ((rule_flags & WHC_RULE_LANCE_ACTIVE) != 0u && !rule_add_wound_bonus(&weapon.rules, 1u)) ||
        (critical_wounds_on != 0u &&
         !rule_add_critical_wounds_on(&weapon.rules, critical_wounds_on)) ||
        (target_has_cover && !(ap == 0u && save <= 3u) && !rule_add_cover(&target.rules))) {
        return false;
    }

    if (summary == NULL ||
        !calculate_attack_damage_summary(&weapon, &target, &workspace, &calculated)) {
        return false;
    }

    summary->minimum = calculated.minimum;
    summary->first_quartile = calculated.first_quartile;
    summary->median = calculated.median;
    summary->third_quartile = calculated.third_quartile;
    summary->maximum = calculated.maximum;
    summary->mean_numerator_low = (uint32_t)calculated.mean.numerator;
    summary->mean_numerator_high = (uint32_t)(calculated.mean.numerator >> 32u);
    summary->mean_denominator_low = (uint32_t)calculated.mean.denominator;
    summary->mean_denominator_high = (uint32_t)(calculated.mean.denominator >> 32u);

    return true;
}
