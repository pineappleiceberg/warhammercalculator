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
    WHC_RULE_INDIRECT_NOT_VISIBLE = UINT32_C(1) << 12
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
};

bool whc_calculate_summary(uint16_t attack_dice_count, uint16_t attack_dice_sides,
                           uint16_t attack_modifier, uint16_t weapon_count, uint8_t hits_on,
                           uint16_t strength, uint16_t ap, uint16_t damage_dice_count,
                           uint16_t damage_dice_sides, uint16_t damage_modifier,
                           uint8_t critical_hits_on, uint16_t toughness, uint8_t save,
                           uint8_t invulnerable_save, uint8_t feel_no_pain, uint16_t wounds,
                           uint16_t damage_reduction, uint32_t rule_flags,
                           uint8_t critical_wounds_on, uint16_t target_models,
                           uint8_t sustained_hits, uint16_t rapid_fire, uint16_t melta,
                           struct whc_web_summary *summary);

#endif
