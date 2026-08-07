#include "warhammercalculator/web_api.h"

#include <string.h>

bool whc_calculate_summary(
    uint16_t attack_dice_count, uint16_t attack_dice_sides, uint16_t attack_modifier,
    uint16_t attacks_replacement, uint16_t weapon_count, uint8_t hits_on, uint16_t strength,
    uint16_t ap, uint16_t damage_dice_count, uint16_t damage_dice_sides, uint16_t damage_modifier,
    uint8_t critical_hits_on, uint16_t toughness, uint8_t save, uint8_t invulnerable_save,
    uint8_t feel_no_pain, uint16_t wounds, uint16_t damage_reduction, uint32_t rule_flags,
    uint8_t critical_wounds_on, uint16_t target_models, uint16_t sustained_hits_dice_count,
    uint16_t sustained_hits_dice_sides, uint16_t sustained_hits, uint16_t rapid_fire_dice_count,
    uint16_t rapid_fire_dice_sides, uint16_t rapid_fire, uint16_t melta,
    int16_t explicit_hit_modifier, int16_t explicit_wound_modifier,
    int16_t explicit_attacks_modifier, int16_t explicit_strength_modifier,
    int16_t explicit_damage_modifier, uint16_t strength_replacement, uint16_t damage_replacement,
    bool damage_replacement_active, uint16_t damage_divisor, struct whc_web_summary *summary) {
    static struct calculator_workspace workspace;
    struct weapon_profile weapon;
    struct target_profile target;
    struct distribution_summary calculated;
    struct distribution_summary applied;
    int32_t attacks_characteristic_modifier = explicit_attacks_modifier;
    int32_t damage_characteristic_modifier = explicit_damage_modifier;
    int32_t hit_modifier = explicit_hit_modifier;
    int32_t wound_modifier = explicit_wound_modifier;
    bool target_has_cover = false;
    uint16_t effective_attack_dice_count = attack_dice_count;
    uint16_t effective_attack_dice_sides = attack_dice_sides;
    uint16_t effective_attack_modifier = attack_modifier;
    struct dice_value sustained_hits_value = {sustained_hits_dice_count, sustained_hits_dice_sides,
                                              sustained_hits};
    struct dice_value rapid_fire_value = {rapid_fire_dice_count, rapid_fire_dice_sides, rapid_fire};

    if (weapon_count == 0u || target_models == 0u || !dice_value_is_valid(sustained_hits_value) ||
        !dice_value_is_valid(rapid_fire_value) ||
        ((rule_flags & WHC_RULE_INDIRECT_NOT_VISIBLE) != 0u &&
         (rule_flags & WHC_RULE_TORRENT) != 0u)) {
        return false;
    }

    if (attacks_replacement != 0u) {
        effective_attack_dice_count = 0u;
        effective_attack_dice_sides = 0u;
        effective_attack_modifier = attacks_replacement;
    }

    if ((rule_flags & WHC_RULE_RAPID_FIRE_ACTIVE) != 0u) {
        uint32_t combined_dice_count = 0u;
        if (rapid_fire_dice_count != 0u && effective_attack_dice_count != 0u &&
            rapid_fire_dice_sides != effective_attack_dice_sides) {
            return false;
        }
        combined_dice_count = (uint32_t)effective_attack_dice_count + rapid_fire_dice_count;
        if (combined_dice_count > UINT16_MAX) {
            return false;
        }
        effective_attack_dice_count = (uint16_t)combined_dice_count;
        if (rapid_fire_dice_count != 0u) {
            effective_attack_dice_sides = rapid_fire_dice_sides;
        }
        attacks_characteristic_modifier += rapid_fire;
    }
    if ((rule_flags & WHC_RULE_BLAST) != 0u) {
        attacks_characteristic_modifier += (int32_t)(target_models / 5u);
    }
    if ((rule_flags & WHC_RULE_MELTA_ACTIVE) != 0u) {
        damage_characteristic_modifier += melta;
    }

    if (attacks_characteristic_modifier < INT16_MIN ||
        attacks_characteristic_modifier > INT16_MAX || damage_characteristic_modifier < INT16_MIN ||
        damage_characteristic_modifier > INT16_MAX) {
        return false;
    }

    if ((rule_flags & WHC_RULE_HEAVY_ACTIVE) != 0u) {
        hit_modifier++;
    }
    if ((rule_flags & WHC_RULE_INDIRECT_NOT_VISIBLE) != 0u) {
        hit_modifier--;
    }
    if ((rule_flags & WHC_RULE_LANCE_ACTIVE) != 0u) {
        wound_modifier++;
    }
    if (hit_modifier > 1) {
        hit_modifier = 1;
    } else if (hit_modifier < -1) {
        hit_modifier = -1;
    }
    if (wound_modifier > 1) {
        wound_modifier = 1;
    } else if (wound_modifier < -1) {
        wound_modifier = -1;
    }

    target_has_cover = (rule_flags & WHC_RULE_TARGET_COVER) != 0u ||
                       (rule_flags & WHC_RULE_INDIRECT_NOT_VISIBLE) != 0u;
    if ((rule_flags & WHC_RULE_IGNORES_COVER) != 0u) {
        target_has_cover = false;
    }

    memset(&weapon, 0, sizeof(weapon));
    memset(&target, 0, sizeof(target));

    weapon.attacks = (struct dice_value){effective_attack_dice_count, effective_attack_dice_sides,
                                         effective_attack_modifier};
    weapon.attacks_modifier = (int16_t)attacks_characteristic_modifier;
    weapon.weapon_count = weapon_count;
    weapon.hits_on = hits_on;
    weapon.strength = strength;
    weapon.strength_replacement = strength_replacement;
    weapon.strength_modifier = explicit_strength_modifier;
    weapon.ap = ap;
    weapon.damage = (struct dice_value){damage_dice_count, damage_dice_sides, damage_modifier};
    weapon.damage_replacement = damage_replacement;
    weapon.damage_replacement_active = damage_replacement_active;
    weapon.damage_modifier = (int16_t)damage_characteristic_modifier;
    weapon.critical_hits_on = critical_hits_on;
    weapon.hit_modifier = (int8_t)hit_modifier;
    weapon.wound_modifier = (int8_t)wound_modifier;
    if ((rule_flags & WHC_RULE_REROLL_HIT_ONES) != 0u) {
        weapon.hit_reroll_mask = UINT8_C(1) << 1u;
    }
    if ((rule_flags & WHC_RULE_REROLL_WOUND_ONES) != 0u) {
        weapon.wound_reroll_mask = UINT8_C(1) << 1u;
    }

    target.toughness = toughness;
    target.save = save;
    target.invulnerable_save = invulnerable_save;
    target.feel_no_pain = feel_no_pain;
    target.wounds = wounds;
    target.reduction = damage_reduction;
    target.damage_divisor = damage_divisor == 0u ? 1u : damage_divisor;

    if (((rule_flags & WHC_RULE_LETHAL_HITS) != 0u && !rule_add_lethal_hits(&weapon.rules)) ||
        ((rule_flags & WHC_RULE_DEVASTATING_WOUNDS) != 0u &&
         !rule_add_devastating_wounds(&weapon.rules)) ||
        ((rule_flags & (WHC_RULE_TWIN_LINKED | WHC_RULE_REROLL_FAILED_WOUNDS)) != 0u &&
         !rule_add_reroll_failed_wounds(&weapon.rules)) ||
        ((rule_flags & WHC_RULE_REROLL_FAILED_HITS) != 0u &&
         !rule_add_reroll_failed_hits(&weapon.rules)) ||
        ((rule_flags & WHC_RULE_TORRENT) != 0u && !rule_add_torrent(&weapon.rules)) ||
        ((rule_flags & WHC_RULE_INDIRECT_NOT_VISIBLE) != 0u &&
         !rule_add_hit_auto_fails_through(&weapon.rules, 3u)) ||
        ((sustained_hits_dice_count != 0u || sustained_hits != 0u) &&
         !rule_add_sustained_hits_dice(&weapon.rules, sustained_hits_value)) ||
        (critical_wounds_on != 0u &&
         !rule_add_critical_wounds_on(&weapon.rules, critical_wounds_on)) ||
        (target_has_cover && !(ap == 0u && save <= 3u) && !rule_add_cover(&target.rules))) {
        return false;
    }

    if (summary == NULL ||
        !calculate_attack_damage_summary(&weapon, &target, &workspace, &calculated) ||
        !calculate_attack_applied_damage_summary(&weapon, &target, target_models, &workspace,
                                                 &applied)) {
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
    summary->applied_minimum = applied.minimum;
    summary->applied_first_quartile = applied.first_quartile;
    summary->applied_median = applied.median;
    summary->applied_third_quartile = applied.third_quartile;
    summary->applied_maximum = applied.maximum;
    summary->applied_mean_numerator_low = (uint32_t)applied.mean.numerator;
    summary->applied_mean_numerator_high = (uint32_t)(applied.mean.numerator >> 32u);
    summary->applied_mean_denominator_low = (uint32_t)applied.mean.denominator;
    summary->applied_mean_denominator_high = (uint32_t)(applied.mean.denominator >> 32u);

    return true;
}

/*@ requires \valid_read(input) && \valid_read(target_input);
    requires \valid(weapon) && \valid(target);
    assigns *weapon, *target;
*/
static bool whc_build_volley_profiles(const struct whc_web_weapon_input *input,
                                      const struct whc_web_target_input *target_input,
                                      uint16_t target_models, struct weapon_profile *weapon,
                                      struct target_profile *target) {
    int32_t attacks_characteristic_modifier = 0;
    int32_t damage_characteristic_modifier = 0;
    uint32_t combined_dice_count = 0u;
    int32_t hit_modifier = 0;
    int32_t wound_modifier = 0;
    uint16_t effective_attack_dice_count = 0u;
    uint16_t effective_attack_dice_sides = 0u;
    uint16_t effective_attack_modifier = 0u;
    bool target_has_cover = false;
    struct dice_value sustained_hits_value;
    struct dice_value rapid_fire_value;

    if (input == NULL || target_input == NULL || weapon == NULL || target == NULL ||
        input->weapon_count == 0u || input->weapon_count > UINT16_MAX ||
        input->attack_dice_count > UINT16_MAX || input->attack_dice_sides > UINT16_MAX ||
        input->attack_modifier > UINT16_MAX || input->attacks_replacement > UINT16_MAX ||
        input->hits_on > UINT8_MAX || input->strength > UINT16_MAX || input->ap > UINT16_MAX ||
        input->damage_dice_count > UINT16_MAX || input->damage_dice_sides > UINT16_MAX ||
        input->damage_modifier > UINT16_MAX || input->critical_hits_on > UINT8_MAX ||
        input->critical_wounds_on > UINT8_MAX || input->sustained_hits_dice_count > UINT16_MAX ||
        input->sustained_hits_dice_sides > UINT16_MAX || input->sustained_hits > UINT16_MAX ||
        input->rapid_fire_dice_count > UINT16_MAX || input->rapid_fire_dice_sides > UINT16_MAX ||
        input->rapid_fire > UINT16_MAX || input->melta > UINT16_MAX ||
        input->hit_modifier < INT16_MIN || input->hit_modifier > INT16_MAX ||
        input->wound_modifier < INT16_MIN || input->wound_modifier > INT16_MAX ||
        input->attacks_characteristic_modifier < INT16_MIN ||
        input->attacks_characteristic_modifier > INT16_MAX ||
        input->strength_characteristic_modifier < INT16_MIN ||
        input->strength_characteristic_modifier > INT16_MAX ||
        input->damage_characteristic_modifier < INT16_MIN ||
        input->damage_characteristic_modifier > INT16_MAX ||
        input->strength_replacement > UINT16_MAX || input->damage_replacement > UINT16_MAX ||
        input->damage_replacement_active > 1u || target_input->toughness > UINT16_MAX ||
        target_input->save > UINT8_MAX || target_input->invulnerable_save > UINT8_MAX ||
        target_input->feel_no_pain > UINT8_MAX || target_input->wounds > UINT16_MAX ||
        target_input->damage_reduction > UINT16_MAX || target_input->damage_divisor > UINT16_MAX ||
        target_models == 0u ||
        ((input->rule_flags & WHC_RULE_INDIRECT_NOT_VISIBLE) != 0u &&
         (input->rule_flags & WHC_RULE_TORRENT) != 0u)) {
        return false;
    }

    attacks_characteristic_modifier = input->attacks_characteristic_modifier;
    damage_characteristic_modifier = input->damage_characteristic_modifier;
    hit_modifier = input->hit_modifier;
    wound_modifier = input->wound_modifier;
    effective_attack_dice_count = (uint16_t)input->attack_dice_count;
    effective_attack_dice_sides = (uint16_t)input->attack_dice_sides;
    effective_attack_modifier = (uint16_t)input->attack_modifier;
    sustained_hits_value = (struct dice_value){
        (uint16_t)input->sustained_hits_dice_count,
        (uint16_t)input->sustained_hits_dice_sides,
        (uint16_t)input->sustained_hits,
    };
    rapid_fire_value = (struct dice_value){
        (uint16_t)input->rapid_fire_dice_count,
        (uint16_t)input->rapid_fire_dice_sides,
        (uint16_t)input->rapid_fire,
    };
    if (!dice_value_is_valid(sustained_hits_value) || !dice_value_is_valid(rapid_fire_value)) {
        return false;
    }

    if (input->attacks_replacement != 0u) {
        effective_attack_dice_count = 0u;
        effective_attack_dice_sides = 0u;
        effective_attack_modifier = (uint16_t)input->attacks_replacement;
    }

    if ((input->rule_flags & WHC_RULE_RAPID_FIRE_ACTIVE) != 0u) {
        if (input->rapid_fire_dice_count != 0u && effective_attack_dice_count != 0u &&
            input->rapid_fire_dice_sides != effective_attack_dice_sides) {
            return false;
        }
        combined_dice_count = (uint32_t)effective_attack_dice_count + input->rapid_fire_dice_count;
        if (combined_dice_count > UINT16_MAX) {
            return false;
        }
        effective_attack_dice_count = (uint16_t)combined_dice_count;
        if (input->rapid_fire_dice_count != 0u) {
            effective_attack_dice_sides = (uint16_t)input->rapid_fire_dice_sides;
        }
        attacks_characteristic_modifier += (int32_t)input->rapid_fire;
    }
    if ((input->rule_flags & WHC_RULE_BLAST) != 0u) {
        attacks_characteristic_modifier += (int32_t)(target_models / 5u);
    }
    if ((input->rule_flags & WHC_RULE_MELTA_ACTIVE) != 0u) {
        damage_characteristic_modifier += (int32_t)input->melta;
    }

    if (attacks_characteristic_modifier < INT16_MIN ||
        attacks_characteristic_modifier > INT16_MAX || damage_characteristic_modifier < INT16_MIN ||
        damage_characteristic_modifier > INT16_MAX) {
        return false;
    }

    if ((input->rule_flags & WHC_RULE_HEAVY_ACTIVE) != 0u) {
        hit_modifier++;
    }
    if ((input->rule_flags & WHC_RULE_INDIRECT_NOT_VISIBLE) != 0u) {
        hit_modifier--;
    }
    if ((input->rule_flags & WHC_RULE_LANCE_ACTIVE) != 0u) {
        wound_modifier++;
    }
    if (hit_modifier > 1) {
        hit_modifier = 1;
    } else if (hit_modifier < -1) {
        hit_modifier = -1;
    }
    if (wound_modifier > 1) {
        wound_modifier = 1;
    } else if (wound_modifier < -1) {
        wound_modifier = -1;
    }

    memset(weapon, 0, sizeof(*weapon));
    memset(target, 0, sizeof(*target));
    weapon->attacks = (struct dice_value){
        effective_attack_dice_count,
        effective_attack_dice_sides,
        effective_attack_modifier,
    };
    weapon->attacks_modifier = (int16_t)attacks_characteristic_modifier;
    weapon->weapon_count = (uint16_t)input->weapon_count;
    weapon->hits_on = (uint8_t)input->hits_on;
    weapon->strength = (uint16_t)input->strength;
    weapon->strength_replacement = (uint16_t)input->strength_replacement;
    weapon->strength_modifier = (int16_t)input->strength_characteristic_modifier;
    weapon->ap = (uint16_t)input->ap;
    weapon->damage = (struct dice_value){
        (uint16_t)input->damage_dice_count,
        (uint16_t)input->damage_dice_sides,
        (uint16_t)input->damage_modifier,
    };
    weapon->damage_replacement = (uint16_t)input->damage_replacement;
    weapon->damage_replacement_active = input->damage_replacement_active != 0u;
    weapon->damage_modifier = (int16_t)damage_characteristic_modifier;
    weapon->critical_hits_on = (uint8_t)input->critical_hits_on;
    weapon->hit_modifier = (int8_t)hit_modifier;
    weapon->wound_modifier = (int8_t)wound_modifier;
    if ((input->rule_flags & WHC_RULE_REROLL_HIT_ONES) != 0u) {
        weapon->hit_reroll_mask = UINT8_C(1) << 1u;
    }
    if ((input->rule_flags & WHC_RULE_REROLL_WOUND_ONES) != 0u) {
        weapon->wound_reroll_mask = UINT8_C(1) << 1u;
    }

    target->toughness = (uint16_t)target_input->toughness;
    target->save = (uint8_t)target_input->save;
    target->invulnerable_save = (uint8_t)target_input->invulnerable_save;
    target->feel_no_pain = (uint8_t)target_input->feel_no_pain;
    target->wounds = (uint16_t)target_input->wounds;
    target->reduction = (uint16_t)target_input->damage_reduction;
    target->damage_divisor =
        target_input->damage_divisor == 0u ? 1u : (uint16_t)target_input->damage_divisor;

    target_has_cover = (input->rule_flags & WHC_RULE_TARGET_COVER) != 0u ||
                       (input->rule_flags & WHC_RULE_INDIRECT_NOT_VISIBLE) != 0u;
    if ((input->rule_flags & WHC_RULE_IGNORES_COVER) != 0u) {
        target_has_cover = false;
    }

    return (((input->rule_flags & WHC_RULE_LETHAL_HITS) == 0u ||
             rule_add_lethal_hits(&weapon->rules)) &&
            ((input->rule_flags & WHC_RULE_DEVASTATING_WOUNDS) == 0u ||
             rule_add_devastating_wounds(&weapon->rules)) &&
            ((input->rule_flags & (WHC_RULE_TWIN_LINKED | WHC_RULE_REROLL_FAILED_WOUNDS)) == 0u ||
             rule_add_reroll_failed_wounds(&weapon->rules)) &&
            ((input->rule_flags & WHC_RULE_REROLL_FAILED_HITS) == 0u ||
             rule_add_reroll_failed_hits(&weapon->rules)) &&
            ((input->rule_flags & WHC_RULE_TORRENT) == 0u || rule_add_torrent(&weapon->rules)) &&
            ((input->rule_flags & WHC_RULE_INDIRECT_NOT_VISIBLE) == 0u ||
             rule_add_hit_auto_fails_through(&weapon->rules, 3u)) &&
            ((input->sustained_hits_dice_count == 0u && input->sustained_hits == 0u) ||
             rule_add_sustained_hits_dice(&weapon->rules, sustained_hits_value)) &&
            (input->critical_wounds_on == 0u ||
             rule_add_critical_wounds_on(&weapon->rules, (uint8_t)input->critical_wounds_on)) &&
            (!target_has_cover || (input->ap == 0u && target_input->save <= 3u) ||
             rule_add_cover(&target->rules)));
}

bool whc_calculate_ordered_volley_summary(const struct whc_web_weapon_input *weapons,
                                          uint16_t weapon_count,
                                          const struct whc_web_target_input *targets,
                                          uint16_t target_segment_count,
                                          uint16_t initial_wounds_lost,
                                          struct whc_web_applied_summary *summary,
                                          struct whc_web_mean *cumulative_means) {
    static struct calculator_workspace workspace;
    static struct weapon_profile compiled_weapons[MAX_VOLLEY_WEAPONS];
    static struct target_profile compiled_targets[MAX_VOLLEY_WEAPONS * MAX_TARGET_SEGMENTS];
    static struct fraction means[MAX_VOLLEY_WEAPONS];
    struct target_unit_layout layout;
    struct distribution_summary calculated;
    uint32_t total_models = 0u;
    uint16_t weapon_index = 0u;
    uint16_t segment_index = 0u;

    if (weapons == NULL || targets == NULL || summary == NULL || cumulative_means == NULL ||
        weapon_count == 0u || weapon_count > MAX_VOLLEY_WEAPONS || target_segment_count == 0u ||
        target_segment_count > MAX_TARGET_SEGMENTS) {
        return false;
    }
    memset(&layout, 0, sizeof(layout));
    layout.segment_count = target_segment_count;
    layout.initial_wounds_lost = initial_wounds_lost;
    while (segment_index < target_segment_count) {
        if (targets[segment_index].wounds == 0u || targets[segment_index].wounds > UINT16_MAX ||
            targets[segment_index].model_count == 0u ||
            targets[segment_index].model_count > UINT16_MAX ||
            total_models + targets[segment_index].model_count > UINT16_MAX) {
            return false;
        }
        layout.wounds_per_model[segment_index] = (uint16_t)targets[segment_index].wounds;
        layout.model_counts[segment_index] = (uint16_t)targets[segment_index].model_count;
        total_models += targets[segment_index].model_count;
        segment_index++;
    }
    if (target_unit_capacity(&layout) == 0u) {
        return false;
    }

    while (weapon_index < weapon_count) {
        segment_index = 0u;
        while (segment_index < target_segment_count) {
            uint32_t target_index = (uint32_t)weapon_index * target_segment_count + segment_index;
            if (!whc_build_volley_profiles(&weapons[weapon_index], &targets[segment_index],
                                           (uint16_t)total_models, &compiled_weapons[weapon_index],
                                           &compiled_targets[target_index])) {
                return false;
            }
            segment_index++;
        }
        weapon_index++;
    }

    if (!calculate_ordered_volley_applied_damage_distribution(compiled_weapons, compiled_targets,
                                                              weapon_count, &layout, &workspace,
                                                              &workspace.probability_d, means) ||
        !probability_distribution_summarize(&workspace.probability_d, &calculated)) {
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
    summary->peak_sparse_states = workspace.peak_sparse_states;
    weapon_index = 0u;
    while (weapon_index < weapon_count) {
        cumulative_means[weapon_index].numerator_low = (uint32_t)means[weapon_index].numerator;
        cumulative_means[weapon_index].numerator_high =
            (uint32_t)(means[weapon_index].numerator >> 32u);
        cumulative_means[weapon_index].denominator_low = (uint32_t)means[weapon_index].denominator;
        cumulative_means[weapon_index].denominator_high =
            (uint32_t)(means[weapon_index].denominator >> 32u);
        weapon_index++;
    }
    return true;
}

bool whc_estimate_ordered_volley_complexity(const struct whc_web_weapon_input *weapons,
                                            uint16_t weapon_count,
                                            const struct whc_web_target_input *targets,
                                            uint16_t target_segment_count,
                                            uint16_t initial_wounds_lost,
                                            struct whc_web_exact_complexity *result) {
    static struct weapon_profile compiled_weapons[MAX_VOLLEY_WEAPONS];
    static struct target_profile compiled_targets[MAX_VOLLEY_WEAPONS * MAX_TARGET_SEGMENTS];
    struct target_unit_layout layout;
    struct exact_complexity estimated;
    uint32_t total_models = 0u;
    uint16_t weapon_index = 0u;
    uint16_t segment_index = 0u;

    if (weapons == NULL || targets == NULL || result == NULL || weapon_count == 0u ||
        weapon_count > MAX_VOLLEY_WEAPONS || target_segment_count == 0u ||
        target_segment_count > MAX_TARGET_SEGMENTS) {
        return false;
    }
    memset(&layout, 0, sizeof(layout));
    layout.segment_count = target_segment_count;
    layout.initial_wounds_lost = initial_wounds_lost;
    while (segment_index < target_segment_count) {
        if (targets[segment_index].wounds == 0u || targets[segment_index].wounds > UINT16_MAX ||
            targets[segment_index].model_count == 0u ||
            targets[segment_index].model_count > UINT16_MAX ||
            total_models + targets[segment_index].model_count > UINT16_MAX) {
            return false;
        }
        layout.wounds_per_model[segment_index] = (uint16_t)targets[segment_index].wounds;
        layout.model_counts[segment_index] = (uint16_t)targets[segment_index].model_count;
        total_models += targets[segment_index].model_count;
        segment_index++;
    }
    if (target_unit_capacity(&layout) == 0u) {
        return false;
    }

    while (weapon_index < weapon_count) {
        segment_index = 0u;
        while (segment_index < target_segment_count) {
            uint32_t target_index = (uint32_t)weapon_index * target_segment_count + segment_index;
            if (!whc_build_volley_profiles(&weapons[weapon_index], &targets[segment_index],
                                           (uint16_t)total_models, &compiled_weapons[weapon_index],
                                           &compiled_targets[target_index])) {
                return false;
            }
            segment_index++;
        }
        weapon_index++;
    }
    if (!estimate_ordered_volley_complexity(compiled_weapons, compiled_targets, weapon_count,
                                            &layout, &estimated)) {
        return false;
    }
    result->estimated_state_upper_bound = estimated.estimated_state_upper_bound;
    result->state_limit = estimated.state_limit;
    result->maximum_attack_events = estimated.maximum_attack_events;
    result->target_capacity = estimated.target_capacity;
    result->uses_deferred_states = estimated.uses_deferred_states ? 1u : 0u;
    result->exact_guaranteed_by_bound = estimated.exact_guaranteed_by_bound ? 1u : 0u;
    return true;
}
