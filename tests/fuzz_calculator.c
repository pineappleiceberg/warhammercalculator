#include "warhammercalculator/calculator.h"
#include "warhammercalculator/web_api.h"

#include <assert.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

struct fuzz_input {
    const uint8_t *data;
    size_t size;
    size_t offset;
};

/*@ requires \valid(input);
    requires input->size == 0 || \valid_read(input->data + (0 .. input->size - 1));
    assigns input->offset;
*/
static uint8_t next_byte(struct fuzz_input *input) {
    uint8_t value = 0u;

    if (input->size != 0u) {
        value = input->data[input->offset % input->size];
        input->offset++;
    }
    return value;
}

/*@ requires \valid(input);
    requires input->size == 0 || \valid_read(input->data + (0 .. input->size - 1));
    assigns input->offset;
*/
static uint16_t next_u16(struct fuzz_input *input) {
    uint16_t low = next_byte(input);
    uint16_t high = next_byte(input);

    return (uint16_t)(low | (uint16_t)(high << 8u));
}

/*@ requires \valid_read(summary);
    assigns \nothing;
*/
static void assert_summary(const struct whc_web_summary *summary) {
    assert(summary->minimum <= summary->first_quartile);
    assert(summary->first_quartile <= summary->median);
    assert(summary->median <= summary->third_quartile);
    assert(summary->third_quartile <= summary->maximum);
    assert(summary->maximum <= MAX_DISTRIBUTION_RESULT);
    assert(summary->mean_denominator_low != 0u || summary->mean_denominator_high != 0u);
    assert(summary->applied_minimum <= summary->applied_first_quartile);
    assert(summary->applied_first_quartile <= summary->applied_median);
    assert(summary->applied_median <= summary->applied_third_quartile);
    assert(summary->applied_third_quartile <= summary->applied_maximum);
    assert(summary->applied_maximum <= MAX_DISTRIBUTION_RESULT);
    assert(summary->applied_mean_denominator_low != 0u ||
           summary->applied_mean_denominator_high != 0u);
}

/*@ requires \valid(input) && \valid(weapon);
    requires input->size == 0 || \valid_read(input->data + (0 .. input->size - 1));
    requires \separated(input, weapon);
    assigns input->offset, *weapon;
*/
static void generate_weapon(struct fuzz_input *input, struct whc_web_weapon_input *weapon) {
    memset(weapon, 0, sizeof(*weapon));
    weapon->attack_dice_count = next_byte(input) % 2u;
    weapon->attack_dice_sides = weapon->attack_dice_count == 0u ? 0u : 2u + next_byte(input) % 5u;
    weapon->attack_modifier = next_byte(input) % 5u;
    weapon->attacks_replacement = next_byte(input) % 4u == 0u ? 1u + next_byte(input) % 8u : 0u;
    weapon->weapon_count = 1u + next_byte(input) % 4u;
    weapon->hits_on = 2u + next_byte(input) % 5u;
    weapon->strength = 1u + next_byte(input) % 16u;
    weapon->strength_replacement = next_byte(input) % 4u == 0u ? 1u + next_byte(input) % 16u : 0u;
    weapon->ap = next_byte(input) % 6u;
    weapon->damage_dice_count = next_byte(input) % 2u;
    weapon->damage_dice_sides = weapon->damage_dice_count == 0u ? 0u : 2u + next_byte(input) % 5u;
    weapon->damage_modifier = next_byte(input) % 5u;
    weapon->damage_replacement_active = next_byte(input) % 4u == 0u;
    weapon->damage_replacement = next_byte(input) % 7u;
    weapon->attacks_multiplier = 1u + (next_byte(input) % 4u == 0u ? 1u : 0u);
    weapon->strength_multiplier = 1u + next_byte(input) % 2u;
    weapon->damage_multiplier = 1u + next_byte(input) % 2u;
    weapon->critical_hits_on = 5u + next_byte(input) % 2u;
    weapon->rule_flags = next_u16(input);
    weapon->critical_wounds_on = next_byte(input) % 3u == 0u ? 0u : 5u + next_byte(input) % 2u;
    weapon->sustained_hits_dice_count = next_byte(input) % 2u;
    weapon->sustained_hits_dice_sides =
        weapon->sustained_hits_dice_count == 0u ? 0u : 2u + next_byte(input) % 3u;
    weapon->sustained_hits = next_byte(input) % 3u;
    weapon->rapid_fire_dice_count = next_byte(input) % 2u;
    weapon->rapid_fire_dice_sides =
        weapon->rapid_fire_dice_count == 0u ? 0u : 2u + next_byte(input) % 3u;
    weapon->rapid_fire = next_byte(input) % 3u;
    weapon->melta = next_byte(input) % 4u;
    weapon->hit_modifier = (int32_t)(next_byte(input) % 5u) - 2;
    weapon->wound_modifier = (int32_t)(next_byte(input) % 5u) - 2;
    weapon->attacks_characteristic_modifier = (int32_t)(next_byte(input) % 7u) - 3;
    weapon->strength_characteristic_modifier = (int32_t)(next_byte(input) % 7u) - 3;
    weapon->damage_characteristic_modifier = (int32_t)(next_byte(input) % 7u) - 3;
    if (next_byte(input) % 4u == 0u) {
        weapon->characteristic_modifier_dice_count = 1u;
        weapon->characteristic_modifier_dice_sides = 2u + next_byte(input) % 3u;
        weapon->characteristic_modifier_bonus = next_byte(input) % 2u;
        weapon->characteristic_modifier_flags = 1u + next_byte(input) % 7u;
        weapon->characteristic_modifier_group = next_byte(input) % 4u;
    }
}

/*@ requires \valid(input) && \valid(target);
    requires input->size == 0 || \valid_read(input->data + (0 .. input->size - 1));
    requires \separated(input, target);
    assigns input->offset, *target;
*/
static void generate_target(struct fuzz_input *input, struct whc_web_target_input *target) {
    memset(target, 0, sizeof(*target));
    target->toughness = 1u + next_byte(input) % 16u;
    target->save = 2u + next_byte(input) % 6u;
    target->invulnerable_save = next_byte(input) % 3u == 0u ? 0u : 2u + next_byte(input) % 5u;
    target->feel_no_pain = next_byte(input) % 3u == 0u ? 0u : 2u + next_byte(input) % 5u;
    target->wounds = 1u + next_byte(input) % 12u;
    target->damage_reduction = next_byte(input) % 4u;
    target->damage_divisor = next_byte(input) % 4u + 1u;
    target->model_count = 1u + next_byte(input) % 5u;
    target->first_failed_save_damage_replacement = next_byte(input) % 4u;
    target->first_failed_save_damage_replacement_active = next_byte(input) % 3u == 0u;
    target->allocated_attack_damage_replacement = next_byte(input) % 4u;
    target->allocated_attack_damage_replacement_uses = next_byte(input) % 3u;
    target->allocated_attack_damage_replacement_skip = next_byte(input) % 4u;
    if (target->first_failed_save_damage_replacement_active != 0u &&
        target->allocated_attack_damage_replacement_uses != 0u) {
        target->allocated_attack_damage_replacement = target->first_failed_save_damage_replacement;
    }
}

/*@ requires size == 0 || \valid_read(data + (0 .. size - 1));
    assigns \nothing;
    terminates \true;
*/
int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    struct fuzz_input input = {data, size, 0u};
    struct whc_web_weapon_input weapons[3];
    struct whc_web_target_input targets[3];
    struct whc_web_summary summary;
    struct whc_web_applied_summary volley_summary;
    struct whc_web_exact_complexity complexity;
    struct whc_web_mean cumulative[3];
    struct dice_value dice;
    uint16_t weapon_count = (uint16_t)(1u + next_byte(&input) % 2u);
    uint16_t target_count = (uint16_t)(1u + next_byte(&input) % 2u);
    uint16_t index = 0u;
    bool valid = false;
    bool estimated = false;
    uint16_t initial_wounds_lost = 0u;
    uint32_t battle_profiles[2u * WHC_BATTLE_PROFILE_FIELDS];
    uint32_t battle_events[2u * WHC_BATTLE_EVENT_FIELDS];
    uint32_t battle_health[2u * WHC_BATTLE_HEALTH_FIELDS];
    uint32_t battle_event_count;
    uint32_t battle_damage;
    bool battle_replayed;

    while (index < weapon_count) {
        generate_weapon(&input, &weapons[index]);
        index++;
    }
    index = 0u;
    while (index < target_count) {
        generate_target(&input, &targets[index]);
        if (index != 0u) {
            targets[index].first_failed_save_damage_replacement =
                targets[0].first_failed_save_damage_replacement;
            targets[index].first_failed_save_damage_replacement_active =
                targets[0].first_failed_save_damage_replacement_active;
            targets[index].allocated_attack_damage_replacement =
                targets[0].allocated_attack_damage_replacement;
            targets[index].allocated_attack_damage_replacement_uses =
                targets[0].allocated_attack_damage_replacement_uses;
            targets[index].allocated_attack_damage_replacement_skip =
                targets[0].allocated_attack_damage_replacement_skip;
        }
        index++;
    }
    valid = whc_calculate_summary_with_characteristic_roll(
        (uint16_t)weapons[0].attack_dice_count, (uint16_t)weapons[0].attack_dice_sides,
        (uint16_t)weapons[0].attack_modifier, (uint16_t)weapons[0].attacks_replacement,
        (uint16_t)weapons[0].weapon_count, (uint8_t)weapons[0].hits_on,
        (uint16_t)weapons[0].strength, (uint16_t)weapons[0].ap,
        (uint16_t)weapons[0].damage_dice_count, (uint16_t)weapons[0].damage_dice_sides,
        (uint16_t)weapons[0].damage_modifier, (uint8_t)weapons[0].critical_hits_on,
        (uint16_t)targets[0].toughness, (uint8_t)targets[0].save,
        (uint8_t)targets[0].invulnerable_save, (uint8_t)targets[0].feel_no_pain,
        (uint16_t)targets[0].wounds, (uint16_t)targets[0].damage_reduction, weapons[0].rule_flags,
        (uint8_t)weapons[0].critical_wounds_on, (uint16_t)targets[0].model_count,
        (uint16_t)weapons[0].sustained_hits_dice_count,
        (uint16_t)weapons[0].sustained_hits_dice_sides, (uint16_t)weapons[0].sustained_hits,
        (uint16_t)weapons[0].rapid_fire_dice_count, (uint16_t)weapons[0].rapid_fire_dice_sides,
        (uint16_t)weapons[0].rapid_fire, (uint16_t)weapons[0].melta,
        (int16_t)weapons[0].hit_modifier, (int16_t)weapons[0].wound_modifier,
        (int16_t)weapons[0].attacks_characteristic_modifier,
        (int16_t)weapons[0].strength_characteristic_modifier,
        (int16_t)weapons[0].damage_characteristic_modifier,
        (uint16_t)weapons[0].strength_replacement, (uint16_t)weapons[0].damage_replacement,
        weapons[0].damage_replacement_active != 0u, (uint16_t)targets[0].damage_divisor,
        (uint16_t)weapons[0].attacks_multiplier, (uint16_t)weapons[0].strength_multiplier,
        (uint16_t)weapons[0].damage_multiplier,
        (uint16_t)weapons[0].characteristic_modifier_dice_count,
        (uint16_t)weapons[0].characteristic_modifier_dice_sides,
        (uint16_t)weapons[0].characteristic_modifier_bonus,
        (uint8_t)weapons[0].characteristic_modifier_flags,
        (uint16_t)targets[0].first_failed_save_damage_replacement,
        targets[0].first_failed_save_damage_replacement_active != 0u,
        (uint16_t)targets[0].allocated_attack_damage_replacement,
        (uint16_t)targets[0].allocated_attack_damage_replacement_uses,
        (uint16_t)targets[0].allocated_attack_damage_replacement_skip, &summary);
    if (valid) {
        assert_summary(&summary);
    }

    memset(cumulative, 0, sizeof(cumulative));
    initial_wounds_lost = (uint16_t)(next_byte(&input) % targets[0].wounds);
    estimated = whc_estimate_ordered_volley_complexity(weapons, weapon_count, targets, target_count,
                                                       initial_wounds_lost, &complexity);
    valid = next_byte(&input) % 16u == 15u &&
            whc_calculate_ordered_volley_summary(weapons, weapon_count, targets, target_count,
                                                 initial_wounds_lost, &volley_summary, cumulative);
    if (valid) {
        assert(estimated);
        assert(volley_summary.minimum <= volley_summary.first_quartile);
        assert(volley_summary.first_quartile <= volley_summary.median);
        assert(volley_summary.median <= volley_summary.third_quartile);
        assert(volley_summary.third_quartile <= volley_summary.maximum);
        assert(volley_summary.maximum <= MAX_DISTRIBUTION_RESULT);
        assert(volley_summary.peak_sparse_states <= complexity.estimated_state_upper_bound);
        assert(volley_summary.peak_sparse_states <= complexity.state_limit);
        index = 0u;
        while (index < weapon_count) {
            assert(cumulative[index].denominator_low != 0u ||
                   cumulative[index].denominator_high != 0u);
            index++;
        }
    }

    dice.dice_count = next_u16(&input);
    dice.dice_sides = next_u16(&input);
    dice.modifier = next_u16(&input);
    (void)dice_value_is_valid(dice);
    (void)allocate_damage_to_unit(next_u16(&input), next_u16(&input), 1u + next_byte(&input) % 20u,
                                  1u + next_byte(&input) % 20u);

    battle_profiles[0] = 1u + next_byte(&input) % 10u;
    battle_profiles[1] = 1u + next_byte(&input) % 5u;
    battle_profiles[2] = 1u + next_byte(&input) % 10u;
    battle_profiles[3] = 1u + next_byte(&input) % 5u;
    memset(battle_events, 0, sizeof(battle_events));
    battle_damage = next_byte(&input) % battle_profiles[0];
    battle_events[0] = WHC_BATTLE_STATE_VERSION;
    battle_events[1] = WHC_BATTLE_EVENT_ATTACK;
    battle_events[2] = 1u;
    battle_events[4] = battle_damage;
    battle_events[6] = 0u;
    battle_events[7] = battle_profiles[1];
    battle_events[8] = 0u;
    battle_events[9] = battle_profiles[1];
    battle_events[10] = battle_damage;
    battle_event_count = 1u;
    if (next_byte(&input) % 2u != 0u) {
        const uint32_t revert = WHC_BATTLE_EVENT_FIELDS;
        battle_events[revert] = WHC_BATTLE_STATE_VERSION;
        battle_events[revert + 1u] = WHC_BATTLE_EVENT_REVERT;
        battle_events[revert + 3u] = 0u;
        battle_event_count = 2u;
    }
    if (next_byte(&input) % 4u == 0u) {
        battle_events[next_byte(&input) % (battle_event_count * WHC_BATTLE_EVENT_FIELDS)] ^=
            1u + next_byte(&input);
    }
    battle_health[0] = 101u;
    battle_health[1] = 102u;
    battle_health[2] = 103u;
    battle_health[3] = 104u;
    battle_replayed = whc_replay_battle_health_events(battle_profiles, 2u, battle_events,
                                                      battle_event_count, battle_health);
    if (battle_replayed) {
        assert(battle_health[0] <= battle_profiles[1]);
        assert(battle_health[1] < battle_profiles[0]);
        assert(battle_health[2] <= battle_profiles[3]);
        assert(battle_health[3] < battle_profiles[2]);
    } else {
        assert(battle_health[0] == 101u);
        assert(battle_health[1] == 102u);
        assert(battle_health[2] == 103u);
        assert(battle_health[3] == 104u);
    }
    return 0;
}
