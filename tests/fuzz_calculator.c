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
    uint32_t battle_clock[WHC_BATTLE_CLOCK_FIELDS];
    uint32_t next_battle_clock[WHC_BATTLE_CLOCK_FIELDS];
    uint32_t battle_clock_advances;
    uint32_t published_range;
    uint32_t effective_range;
    uint32_t measured_distance;
    uint32_t eligible_weapon_count;
    uint32_t declared_weapon_count;
    uint32_t target_flags;
    bool target_eligible;
    bool expected_target_eligible;
    uint32_t charge_die_one;
    uint32_t charge_die_two;
    int32_t charge_modifier;
    uint32_t charge_distance;
    uint32_t heroic_start_distance;
    uint32_t maximum_model_move;
    bool charge_successful;
    uint32_t charge_flags;
    uint32_t heroic_flags;
    bool heroic_valid;
    bool expected_heroic_valid;
    uint32_t overwatch_trigger;
    uint32_t overwatch_phase;
    uint32_t overwatch_distance;
    uint32_t overwatch_flags;
    bool overwatch_valid;
    bool expected_overwatch_valid;
    uint32_t hazardous_initial_roll;
    uint32_t hazardous_reroll;
    bool hazardous_reroll_explained;
    uint32_t hazardous_remaining_wounds;
    uint32_t hazardous_feel_no_pain;
    uint32_t hazardous_roll_count;
    uint32_t hazardous_ignored;
    uint32_t hazardous_damage;
    bool hazardous_destroyed;
    uint32_t hazardous_flags;
    bool hazardous_valid;
    bool expected_hazardous_valid;
    uint32_t go_to_ground_phase;
    uint32_t go_to_ground_cp_before;
    uint32_t go_to_ground_cost;
    uint32_t go_to_ground_cp_after;
    bool go_to_ground_already_used;
    bool go_to_ground_battle_shocked;
    uint32_t go_to_ground_flags;
    bool go_to_ground_valid;
    bool expected_go_to_ground_valid;
    uint32_t declaration_count;
    uint32_t unique_declaration_count;
    uint32_t target_run_count;
    uint32_t unique_target_count;
    uint32_t profile_run_count;
    uint32_t unique_target_profile_count;
    uint32_t declaration_flags;
    bool declaration_valid;
    bool expected_declaration_valid;
    uint32_t transport_used_capacity;
    uint32_t transport_capacity;
    uint32_t transport_allowance_models;
    uint32_t transport_allowance_maximum;
    uint32_t transport_mode_count;
    bool transport_valid;
    bool expected_transport_valid;
    uint32_t transport_chain_length;
    uint32_t transport_unique_formations;
    uint32_t transport_root_location;
    uint32_t transport_reserve_eligibility_count;
    bool transport_chain_valid;
    bool expected_transport_chain_valid;
    uint32_t setup_is_dedicated_transport;
    uint32_t setup_starting_passenger_count;
    uint32_t setup_is_aircraft;
    uint32_t setup_has_hover;
    uint32_t setup_aircraft_mode;
    uint32_t setup_root_location;
    bool setup_valid;
    bool expected_setup_valid;

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
    battle_events[0] = WHC_BATTLE_EVENT_VERSION;
    switch (next_byte(&input) % 3u) {
    case 0u:
        battle_events[1] = WHC_BATTLE_EVENT_ATTACK;
        break;
    case 1u:
        battle_events[1] = WHC_BATTLE_EVENT_TRANSPORT_DAMAGE;
        break;
    default:
        battle_events[1] = WHC_BATTLE_EVENT_HAZARDOUS_DAMAGE;
        break;
    }
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
        battle_events[revert] = WHC_BATTLE_EVENT_VERSION;
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
    assert(whc_start_battle_clock(next_byte(&input) % 2u, battle_clock));
    battle_clock_advances = next_byte(&input) % 171u;
    index = 0u;
    while (index < battle_clock_advances && battle_clock[0] == WHC_BATTLE_CLOCK_ACTIVE) {
        assert(whc_next_battle_clock(battle_clock, next_battle_clock));
        memcpy(battle_clock, next_battle_clock, sizeof(battle_clock));
        index++;
    }
    assert(battle_clock[0] == WHC_BATTLE_CLOCK_ACTIVE ||
           battle_clock[0] == WHC_BATTLE_CLOCK_COMPLETE);
    published_range = next_u16(&input);
    effective_range = next_u16(&input);
    measured_distance = next_u16(&input);
    eligible_weapon_count = next_byte(&input);
    declared_weapon_count = next_byte(&input);
    target_flags = next_byte(&input);
    target_eligible = whc_ranged_target_eligibility_is_valid(
        published_range, effective_range, measured_distance, eligible_weapon_count,
        declared_weapon_count, target_flags);
    expected_target_eligible = published_range > 0u && effective_range > 0u &&
                               measured_distance > 0u && measured_distance <= effective_range &&
                               declared_weapon_count > 0u &&
                               declared_weapon_count <= eligible_weapon_count &&
                               (target_flags & WHC_TARGET_REVIEWED_BY_PLAYER) != 0u &&
                               ((target_flags & WHC_TARGET_FULLY_VISIBLE) == 0u ||
                                (target_flags & WHC_TARGET_VISIBLE) != 0u) &&
                               (((target_flags & WHC_TARGET_VISIBLE) != 0u &&
                                 (target_flags & WHC_TARGET_INDIRECT_FIRE) == 0u) ||
                                ((target_flags & WHC_TARGET_VISIBLE) == 0u &&
                                 (target_flags & WHC_TARGET_INDIRECT_FIRE) != 0u &&
                                 (target_flags & WHC_TARGET_WEAPON_HAS_INDIRECT) != 0u)) &&
                               (published_range == effective_range ||
                                (target_flags & WHC_TARGET_RANGE_OVERRIDE_EXPLAINED) != 0u);
    assert(target_eligible == expected_target_eligible);
    charge_die_one = next_byte(&input);
    charge_die_two = next_byte(&input);
    charge_modifier = (int32_t)next_byte(&input) - 128;
    charge_distance = next_u16(&input);
    heroic_start_distance = next_u16(&input);
    maximum_model_move = next_u16(&input);
    charge_successful = next_byte(&input) % 2u != 0u;
    charge_flags = next_u16(&input);
    heroic_flags = next_byte(&input);
    heroic_valid = whc_heroic_intervention_is_valid(
        charge_die_one, charge_die_two, charge_modifier, charge_distance, heroic_start_distance,
        maximum_model_move, charge_successful, charge_flags, heroic_flags);
    expected_heroic_valid =
        heroic_start_distance > 0u && heroic_start_distance <= 6000u &&
        heroic_flags == WHC_HEROIC_FLAGS_MASK &&
        whc_charge_resolution_is_valid(charge_die_one, charge_die_two, charge_modifier,
                                       charge_distance, heroic_start_distance, maximum_model_move,
                                       1u, charge_successful, charge_flags);
    assert(heroic_valid == expected_heroic_valid);
    overwatch_trigger = next_byte(&input);
    overwatch_phase = next_byte(&input);
    overwatch_distance = next_u16(&input);
    overwatch_flags = next_byte(&input);
    overwatch_valid = whc_fire_overwatch_is_valid(overwatch_trigger, overwatch_phase,
                                                  overwatch_distance, overwatch_flags);
    expected_overwatch_valid =
        overwatch_trigger >= WHC_FIRE_OVERWATCH_SET_UP &&
        overwatch_trigger <= WHC_FIRE_OVERWATCH_CHARGE_DECLARED &&
        (overwatch_phase == WHC_BATTLE_PHASE_MOVEMENT ||
         overwatch_phase == WHC_BATTLE_PHASE_CHARGE) &&
        overwatch_distance > 0u && overwatch_distance <= 24000u &&
        overwatch_flags == WHC_FIRE_OVERWATCH_FLAGS_MASK &&
        (overwatch_trigger == WHC_FIRE_OVERWATCH_SET_UP ||
         (overwatch_trigger == WHC_FIRE_OVERWATCH_CHARGE_DECLARED
              ? overwatch_phase == WHC_BATTLE_PHASE_CHARGE
              : overwatch_phase == WHC_BATTLE_PHASE_MOVEMENT));
    assert(overwatch_valid == expected_overwatch_valid);
    hazardous_initial_roll = next_byte(&input);
    hazardous_reroll = next_byte(&input);
    hazardous_reroll_explained = next_byte(&input) % 2u != 0u;
    hazardous_remaining_wounds = next_u16(&input);
    hazardous_feel_no_pain = next_byte(&input);
    hazardous_roll_count = next_byte(&input);
    hazardous_ignored = next_byte(&input);
    hazardous_damage = next_byte(&input);
    hazardous_destroyed = next_byte(&input) % 2u != 0u;
    hazardous_flags = next_byte(&input);
    hazardous_valid = whc_hazardous_resolution_is_valid(
        hazardous_initial_roll, hazardous_reroll, hazardous_reroll_explained,
        hazardous_remaining_wounds, hazardous_feel_no_pain, hazardous_roll_count,
        hazardous_ignored, hazardous_damage, hazardous_destroyed, hazardous_flags);
    const uint32_t hazardous_final_roll =
        hazardous_reroll == 0u ? hazardous_initial_roll : hazardous_reroll;
    const bool hazardous_common =
        hazardous_initial_roll >= 1u && hazardous_initial_roll <= 6u &&
        hazardous_reroll <= 6u &&
        (hazardous_reroll == 0u || hazardous_reroll_explained) &&
        hazardous_final_roll == 1u && hazardous_remaining_wounds > 0u &&
        hazardous_remaining_wounds <= 1024u &&
        (hazardous_feel_no_pain == 0u ||
         (hazardous_feel_no_pain >= 2u && hazardous_feel_no_pain <= 6u)) &&
        hazardous_flags == WHC_HAZARDOUS_FLAGS_MASK;
    const bool hazardous_damage_valid =
        hazardous_feel_no_pain == 0u
            ? hazardous_roll_count == 0u && hazardous_ignored == 0u &&
                  hazardous_damage ==
                      (hazardous_remaining_wounds < 3u ? hazardous_remaining_wounds : 3u)
            : hazardous_roll_count >= 1u && hazardous_roll_count <= 3u &&
                  hazardous_ignored <= hazardous_roll_count &&
                  hazardous_damage == hazardous_roll_count - hazardous_ignored &&
                  (hazardous_damage == hazardous_remaining_wounds ||
                   (hazardous_damage < hazardous_remaining_wounds &&
                    hazardous_roll_count == 3u));
    expected_hazardous_valid =
        hazardous_common && hazardous_damage_valid &&
        (hazardous_destroyed ? hazardous_damage == hazardous_remaining_wounds
                             : hazardous_damage < hazardous_remaining_wounds);
    assert(hazardous_valid == expected_hazardous_valid);
    go_to_ground_phase = next_byte(&input);
    go_to_ground_cp_before = next_u16(&input);
    go_to_ground_cost = next_byte(&input);
    go_to_ground_cp_after = next_u16(&input);
    go_to_ground_already_used = next_byte(&input) % 2u != 0u;
    go_to_ground_battle_shocked = next_byte(&input) % 2u != 0u;
    go_to_ground_flags = next_byte(&input);
    go_to_ground_valid = whc_go_to_ground_is_valid(
        go_to_ground_phase, go_to_ground_cp_before, go_to_ground_cost,
        go_to_ground_cp_after, go_to_ground_already_used, go_to_ground_battle_shocked,
        go_to_ground_flags);
    expected_go_to_ground_valid =
        go_to_ground_phase == WHC_BATTLE_PHASE_SHOOTING && go_to_ground_cp_before >= 1u &&
        go_to_ground_cp_before <= 100000u && go_to_ground_cost == 1u &&
        go_to_ground_cp_after == go_to_ground_cp_before - go_to_ground_cost &&
        !go_to_ground_already_used && !go_to_ground_battle_shocked &&
        go_to_ground_flags == WHC_GO_TO_GROUND_FLAGS_MASK;
    assert(go_to_ground_valid == expected_go_to_ground_valid);
    declaration_count = next_u16(&input);
    unique_declaration_count = next_u16(&input);
    target_run_count = next_u16(&input);
    unique_target_count = next_u16(&input);
    profile_run_count = next_u16(&input);
    unique_target_profile_count = next_u16(&input);
    declaration_flags = next_byte(&input);
    declaration_valid = whc_ranged_declaration_is_valid(
        declaration_count, unique_declaration_count, target_run_count, unique_target_count,
        profile_run_count, unique_target_profile_count, declaration_flags);
    expected_declaration_valid =
        declaration_count >= 1u && declaration_count <= 256u &&
        unique_declaration_count == declaration_count &&
        target_run_count == unique_target_count && unique_target_count >= 1u &&
        unique_target_count <= declaration_count &&
        profile_run_count == unique_target_profile_count &&
        unique_target_profile_count >= unique_target_count &&
        unique_target_profile_count <= declaration_count &&
        declaration_flags == WHC_RANGED_DECLARATION_FLAGS_MASK;
    assert(declaration_valid == expected_declaration_valid);
    transport_used_capacity = next_u16(&input);
    transport_capacity = next_u16(&input);
    transport_allowance_models = next_u16(&input);
    transport_allowance_maximum = next_u16(&input);
    transport_mode_count = next_byte(&input);
    transport_valid = whc_transport_load_is_valid(
        transport_used_capacity, transport_capacity, transport_allowance_models,
        transport_allowance_maximum, transport_mode_count);
    expected_transport_valid =
        transport_capacity > 0u && transport_used_capacity <= transport_capacity &&
        transport_mode_count <= 1u &&
        ((transport_allowance_maximum == 0u && transport_allowance_models == 0u) ||
         (transport_allowance_maximum > 0u &&
          transport_allowance_models <= transport_allowance_maximum));
    assert(transport_valid == expected_transport_valid);
    transport_chain_length = next_u16(&input);
    transport_unique_formations = next_u16(&input);
    transport_root_location = next_byte(&input);
    transport_reserve_eligibility_count = next_u16(&input);
    transport_chain_valid = whc_transport_deployment_chain_is_valid(
        transport_chain_length, transport_unique_formations, transport_root_location,
        transport_reserve_eligibility_count);
    expected_transport_chain_valid =
        transport_chain_length >= 1u && transport_chain_length <= 257u &&
        transport_unique_formations == transport_chain_length &&
        transport_root_location <= WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES &&
        transport_reserve_eligibility_count <= transport_chain_length &&
        ((transport_root_location == WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED &&
          transport_reserve_eligibility_count == 0u) ||
         transport_root_location == WHC_DEPLOYMENT_ROOT_BATTLEFIELD ||
         transport_reserve_eligibility_count == transport_chain_length);
    assert(transport_chain_valid == expected_transport_chain_valid);
    setup_is_dedicated_transport = next_byte(&input);
    setup_starting_passenger_count = next_u16(&input);
    setup_is_aircraft = next_byte(&input);
    setup_has_hover = next_byte(&input);
    setup_aircraft_mode = next_byte(&input);
    setup_root_location = next_byte(&input);
    setup_valid = whc_initial_deployment_is_valid(
        setup_is_dedicated_transport, setup_starting_passenger_count,
        setup_is_aircraft, setup_has_hover, setup_aircraft_mode,
        setup_root_location);
    expected_setup_valid =
        setup_is_dedicated_transport <= 1u && setup_is_aircraft <= 1u &&
        setup_has_hover <= 1u && setup_aircraft_mode <= WHC_AIRCRAFT_MODE_HOVER &&
        setup_root_location <= WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES &&
        ((!setup_is_aircraft && setup_aircraft_mode == WHC_AIRCRAFT_MODE_NONE) ||
         (setup_is_aircraft &&
          (setup_aircraft_mode == WHC_AIRCRAFT_MODE_AIRCRAFT ||
           (setup_aircraft_mode == WHC_AIRCRAFT_MODE_HOVER && setup_has_hover)))) &&
        ((setup_is_dedicated_transport && setup_starting_passenger_count == 0u &&
          setup_root_location == WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED) ||
         ((!setup_is_dedicated_transport || setup_starting_passenger_count > 0u) &&
          setup_root_location != WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED &&
          (!setup_is_aircraft ||
           (setup_aircraft_mode == WHC_AIRCRAFT_MODE_AIRCRAFT &&
            setup_root_location == WHC_DEPLOYMENT_ROOT_RESERVES) ||
           (setup_aircraft_mode == WHC_AIRCRAFT_MODE_HOVER &&
            (setup_root_location == WHC_DEPLOYMENT_ROOT_BATTLEFIELD ||
             setup_root_location == WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES)))));
    assert(setup_valid == expected_setup_valid);
    return 0;
}
