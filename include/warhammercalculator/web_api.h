#ifndef WARHAMMERCALCULATOR_WEB_API_H
#define WARHAMMERCALCULATOR_WEB_API_H

#include "warhammercalculator/calculator.h"

#include <stdbool.h>
#include <stdint.h>

enum whc_rule_flags {
    WHC_RULE_LETHAL_HITS = UINT32_C(1) << 0,
    WHC_RULE_DEVASTATING_WOUNDS = UINT32_C(1) << 1,
    WHC_RULE_TWIN_LINKED = UINT32_C(1) << 2,
    WHC_RULE_REROLL_FAILED_HITS = UINT32_C(1) << 3,
    WHC_RULE_TORRENT = UINT32_C(1) << 4,
    WHC_RULE_HEAVY_ACTIVE = UINT32_C(1) << 5,
    WHC_RULE_LANCE_ACTIVE = UINT32_C(1) << 6,
    WHC_RULE_BLAST = UINT32_C(1) << 7,
    WHC_RULE_RAPID_FIRE_ACTIVE = UINT32_C(1) << 8,
    WHC_RULE_MELTA_ACTIVE = UINT32_C(1) << 9,
    WHC_RULE_TARGET_COVER = UINT32_C(1) << 10,
    WHC_RULE_IGNORES_COVER = UINT32_C(1) << 11,
    WHC_RULE_INDIRECT_NOT_VISIBLE = UINT32_C(1) << 12,
    WHC_RULE_REROLL_HIT_ONES = UINT32_C(1) << 13,
    WHC_RULE_REROLL_FAILED_WOUNDS = UINT32_C(1) << 14,
    WHC_RULE_REROLL_WOUND_ONES = UINT32_C(1) << 15
};

struct whc_web_summary {
    uint32_t minimum;
    uint32_t first_quartile;
    uint32_t median;
    uint32_t third_quartile;
    uint32_t maximum;
    uint32_t mean_numerator_low;
    uint32_t mean_numerator_high;
    uint32_t mean_denominator_low;
    uint32_t mean_denominator_high;
    uint32_t applied_minimum;
    uint32_t applied_first_quartile;
    uint32_t applied_median;
    uint32_t applied_third_quartile;
    uint32_t applied_maximum;
    uint32_t applied_mean_numerator_low;
    uint32_t applied_mean_numerator_high;
    uint32_t applied_mean_denominator_low;
    uint32_t applied_mean_denominator_high;
};

struct whc_web_weapon_input {
    uint32_t attack_dice_count;
    uint32_t attack_dice_sides;
    uint32_t attack_modifier;
    uint32_t attacks_replacement;
    uint32_t weapon_count;
    uint32_t hits_on;
    uint32_t strength;
    uint32_t ap;
    uint32_t damage_dice_count;
    uint32_t damage_dice_sides;
    uint32_t damage_modifier;
    uint32_t critical_hits_on;
    uint32_t rule_flags;
    uint32_t critical_wounds_on;
    uint32_t sustained_hits_dice_count;
    uint32_t sustained_hits_dice_sides;
    uint32_t sustained_hits;
    uint32_t rapid_fire_dice_count;
    uint32_t rapid_fire_dice_sides;
    uint32_t rapid_fire;
    uint32_t melta;
    int32_t hit_modifier;
    int32_t wound_modifier;
    int32_t attacks_characteristic_modifier;
    int32_t strength_characteristic_modifier;
    int32_t damage_characteristic_modifier;
    uint32_t strength_replacement;
    uint32_t damage_replacement;
    uint32_t damage_replacement_active;
    uint32_t attacks_multiplier;
    uint32_t strength_multiplier;
    uint32_t damage_multiplier;
    uint32_t characteristic_modifier_dice_count;
    uint32_t characteristic_modifier_dice_sides;
    uint32_t characteristic_modifier_bonus;
    uint32_t characteristic_modifier_flags;
    uint32_t characteristic_modifier_group;
};

struct whc_web_target_input {
    uint32_t toughness;
    uint32_t save;
    uint32_t invulnerable_save;
    uint32_t feel_no_pain;
    uint32_t wounds;
    uint32_t damage_reduction;
    uint32_t model_count;
    uint32_t damage_divisor;
    uint32_t first_failed_save_damage_replacement;
    uint32_t first_failed_save_damage_replacement_active;
    uint32_t allocated_attack_damage_replacement;
    uint32_t allocated_attack_damage_replacement_uses;
    uint32_t allocated_attack_damage_replacement_skip;
};

struct whc_web_applied_summary {
    uint32_t minimum;
    uint32_t first_quartile;
    uint32_t median;
    uint32_t third_quartile;
    uint32_t maximum;
    uint32_t mean_numerator_low;
    uint32_t mean_numerator_high;
    uint32_t mean_denominator_low;
    uint32_t mean_denominator_high;
    uint32_t peak_sparse_states;
};

struct whc_web_mean {
    uint32_t numerator_low;
    uint32_t numerator_high;
    uint32_t denominator_low;
    uint32_t denominator_high;
};

struct whc_web_exact_complexity {
    uint32_t estimated_state_upper_bound;
    uint32_t state_limit;
    uint32_t maximum_attack_events;
    uint32_t target_capacity;
    uint32_t uses_deferred_states;
    uint32_t exact_guaranteed_by_bound;
};

/*@ requires \valid(summary);
    requires weapon_count > 0;
    requires target_models > 0;
    requires 2 <= hits_on && hits_on <= 6;
    requires strength > 0 && toughness > 0;
    requires 2 <= save && save <= 7;
    requires invulnerable_save == 0 || (2 <= invulnerable_save && invulnerable_save <= 6);
    requires feel_no_pain == 0 || (2 <= feel_no_pain && feel_no_pain <= 6);
    requires critical_hits_on == 0 || (2 <= critical_hits_on && critical_hits_on <= 6);
    requires critical_wounds_on == 0 || (2 <= critical_wounds_on && critical_wounds_on <= 6);
    ensures \result ==> summary->minimum <= summary->first_quartile;
    ensures \result ==> summary->first_quartile <= summary->median;
    ensures \result ==> summary->median <= summary->third_quartile;
    ensures \result ==> summary->third_quartile <= summary->maximum;
    ensures \result ==> summary->mean_denominator_low != 0 || summary->mean_denominator_high != 0;
    ensures \result ==> summary->applied_minimum <= summary->applied_first_quartile;
    ensures \result ==> summary->applied_first_quartile <= summary->applied_median;
    ensures \result ==> summary->applied_median <= summary->applied_third_quartile;
    ensures \result ==> summary->applied_third_quartile <= summary->applied_maximum;
*/
bool whc_calculate_summary_with_characteristic_roll(
    uint16_t attack_dice_count, uint16_t attack_dice_sides, uint16_t attack_modifier,
    uint16_t attacks_replacement, uint16_t weapon_count, uint8_t hits_on, uint16_t strength,
    uint16_t ap, uint16_t damage_dice_count, uint16_t damage_dice_sides, uint16_t damage_modifier,
    uint8_t critical_hits_on, uint16_t toughness, uint8_t save, uint8_t invulnerable_save,
    uint8_t feel_no_pain, uint16_t wounds, uint16_t damage_reduction, uint32_t rule_flags,
    uint8_t critical_wounds_on, uint16_t target_models, uint16_t sustained_hits_dice_count,
    uint16_t sustained_hits_dice_sides, uint16_t sustained_hits, uint16_t rapid_fire_dice_count,
    uint16_t rapid_fire_dice_sides, uint16_t rapid_fire, uint16_t melta, int16_t hit_modifier,
    int16_t wound_modifier, int16_t attacks_modifier, int16_t strength_modifier,
    int16_t damage_characteristic_modifier, uint16_t strength_replacement,
    uint16_t damage_replacement, bool damage_replacement_active, uint16_t damage_divisor,
    uint16_t attacks_multiplier, uint16_t strength_multiplier, uint16_t damage_multiplier,
    uint16_t characteristic_modifier_dice_count, uint16_t characteristic_modifier_dice_sides,
    uint16_t characteristic_modifier_bonus, uint8_t characteristic_modifier_flags,
    uint16_t first_failed_save_damage_replacement, bool first_failed_save_damage_replacement_active,
    uint16_t allocated_attack_damage_replacement, uint16_t allocated_attack_damage_replacement_uses,
    uint16_t allocated_attack_damage_replacement_skip, struct whc_web_summary *summary);

/*@ requires 2 <= hits_on && hits_on <= 6;
    requires strength > 0 && toughness > 0;
    requires 2 <= save && save <= 7;
    requires invulnerable_save == 0 || (2 <= invulnerable_save && invulnerable_save <= 6);
    requires feel_no_pain == 0 || (2 <= feel_no_pain && feel_no_pain <= 6);
    requires critical_hits_on == 0 || (2 <= critical_hits_on && critical_hits_on <= 6);
    requires critical_wounds_on == 0 || (2 <= critical_wounds_on && critical_wounds_on <= 6);
    requires \valid(summary);
    assigns *summary;
    ensures \result ==> summary->minimum <= summary->first_quartile;
    ensures \result ==> summary->first_quartile <= summary->median;
    ensures \result ==> summary->median <= summary->third_quartile;
    ensures \result ==> summary->third_quartile <= summary->maximum;
    ensures \result ==> summary->mean_denominator_low != 0 ||
                         summary->mean_denominator_high != 0;
*/
bool whc_calculate_summary(
    uint16_t attack_dice_count, uint16_t attack_dice_sides, uint16_t attack_modifier,
    uint16_t attacks_replacement, uint16_t weapon_count, uint8_t hits_on, uint16_t strength,
    uint16_t ap, uint16_t damage_dice_count, uint16_t damage_dice_sides, uint16_t damage_modifier,
    uint8_t critical_hits_on, uint16_t toughness, uint8_t save, uint8_t invulnerable_save,
    uint8_t feel_no_pain, uint16_t wounds, uint16_t damage_reduction, uint32_t rule_flags,
    uint8_t critical_wounds_on, uint16_t target_models, uint16_t sustained_hits_dice_count,
    uint16_t sustained_hits_dice_sides, uint16_t sustained_hits, uint16_t rapid_fire_dice_count,
    uint16_t rapid_fire_dice_sides, uint16_t rapid_fire, uint16_t melta, int16_t hit_modifier,
    int16_t wound_modifier, int16_t attacks_modifier, int16_t strength_modifier,
    int16_t damage_characteristic_modifier, uint16_t strength_replacement,
    uint16_t damage_replacement, bool damage_replacement_active, uint16_t damage_divisor,
    uint16_t attacks_multiplier, uint16_t strength_multiplier, uint16_t damage_multiplier,
    struct whc_web_summary *summary);

/*@ requires 1 <= weapon_count && weapon_count <= MAX_VOLLEY_WEAPONS;
    requires 1 <= target_segment_count && target_segment_count <= MAX_TARGET_SEGMENTS;
    requires \valid_read(weapons + (0 .. weapon_count - 1));
    requires \valid_read(targets + (0 .. target_segment_count - 1));
    requires \valid(summary);
    requires \valid(cumulative_means + (0 .. weapon_count - 1));
    assigns *summary, cumulative_means[0 .. weapon_count - 1];
    ensures \result ==> summary->minimum <= summary->first_quartile;
    ensures \result ==> summary->first_quartile <= summary->median;
    ensures \result ==> summary->median <= summary->third_quartile;
    ensures \result ==> summary->third_quartile <= summary->maximum;
    ensures \result ==> summary->mean_denominator_low != 0 ||
                         summary->mean_denominator_high != 0;
    ensures \result ==> summary->peak_sparse_states <= MAX_EXACT_DEFERRED_STATES;
*/
bool whc_calculate_ordered_volley_summary(const struct whc_web_weapon_input *weapons,
                                          uint16_t weapon_count,
                                          const struct whc_web_target_input *targets,
                                          uint16_t target_segment_count,
                                          uint16_t initial_wounds_lost,
                                          struct whc_web_applied_summary *summary,
                                          struct whc_web_mean *cumulative_means);

/*@ requires 1 <= weapon_count && weapon_count <= MAX_VOLLEY_WEAPONS;
    requires 1 <= target_segment_count && target_segment_count <= MAX_TARGET_SEGMENTS;
    requires \valid_read(weapons + (0 .. weapon_count - 1));
    requires \valid_read(targets + (0 .. target_segment_count - 1));
    requires \valid(result);
    assigns *result;
    ensures \result ==> result->state_limit == MAX_EXACT_DEFERRED_STATES;
    ensures \result ==> result->uses_deferred_states <= 1;
    ensures \result ==> result->exact_guaranteed_by_bound <= 1;
*/
bool whc_estimate_ordered_volley_complexity(const struct whc_web_weapon_input *weapons,
                                            uint16_t weapon_count,
                                            const struct whc_web_target_input *targets,
                                            uint16_t target_segment_count,
                                            uint16_t initial_wounds_lost,
                                            struct whc_web_exact_complexity *result);

#endif
