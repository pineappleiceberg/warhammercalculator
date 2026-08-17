#include "warhammercalculator/battle_state.h"
#include "warhammercalculator/calculator.h"

#include <stddef.h>

/*@ assigns \nothing;
    ensures \result == 6;
*/
uint8_t whc_prove_ap4_against_save2(void) {
    uint8_t result = saves_on(2u, 0u, 4u);

    /*@ assert result == 6; */
    return result;
}

/*@ requires 2 <= save && save <= 7;
    requires invulnerable_save == 0 || (2 <= invulnerable_save && invulnerable_save <= 6);
    requires ap < UINT16_MAX;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_ap_monotonic(uint8_t save, uint8_t invulnerable_save, uint16_t ap) {
    uint8_t lower_ap = saves_on(save, invulnerable_save, ap);
    uint8_t higher_ap = saves_on(save, invulnerable_save, (uint16_t)(ap + 1u));

    /*@ assert lower_ap <= higher_ap; */
    return lower_ap <= higher_ap;
}

/*@ requires 2 <= save && save <= 7;
    requires 2 <= invulnerable_save && invulnerable_save <= 6;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_invulnerable_save_caps_ap(uint8_t save, uint8_t invulnerable_save, uint16_t ap) {
    uint8_t threshold = saves_on(save, invulnerable_save, ap);

    /*@ assert threshold <= invulnerable_save; */
    return threshold <= invulnerable_save;
}

/*@ requires 2 <= save && save <= 3;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_cover_does_not_improve_good_save_against_ap0(uint8_t save) {
    uint8_t without_cover = saves_on(save, 0u, 0u);
    uint8_t with_cover = saves_on_with_cover(save, 0u, 0u);

    /*@ assert without_cover == with_cover; */
    return without_cover == with_cover;
}

/*@ requires 2 <= save && save <= 7;
    requires invulnerable_save == 0 || (2 <= invulnerable_save && invulnerable_save <= 6);
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_cover_never_worsens_save(uint8_t save, uint8_t invulnerable_save, uint16_t ap) {
    uint8_t without_cover = saves_on(save, invulnerable_save, ap);
    uint8_t with_cover = saves_on_with_cover(save, invulnerable_save, ap);

    /*@ assert with_cover <= without_cover; */
    return with_cover <= without_cover;
}

/*@ requires wounds_per_model > 0 && model_count > 0;
    requires applied_damage <= (uint64_t)wounds_per_model * model_count;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_allocation_respects_unit_capacity(uint32_t applied_damage, uint32_t incoming_damage,
                                                 uint16_t wounds_per_model, uint16_t model_count) {
    uint32_t result =
        allocate_damage_to_unit(applied_damage, incoming_damage, wounds_per_model, model_count);
    uint64_t capacity = (uint64_t)wounds_per_model * model_count;

    /*@ assert result <= capacity; */
    return result <= capacity;
}

/*@ requires wounds_per_model > 0 && model_count > 0;
    requires applied_damage <= (uint64_t)wounds_per_model * model_count;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_zero_damage_changes_nothing(uint32_t applied_damage, uint16_t wounds_per_model,
                                           uint16_t model_count) {
    uint32_t result = allocate_damage_to_unit(applied_damage, 0u, wounds_per_model, model_count);

    /*@ assert result == applied_damage; */
    return result == applied_damage;
}

/*@ requires 1 <= face && face <= 3;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_indirect_low_hit_rolls_fail(uint8_t face) {
    bool result = attack_roll_succeeds(face, 2u, 2u, 3u);

    /*@ assert !result; */
    return !result;
}

/*@ requires 2 <= succeeds_on && succeeds_on <= 6;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_roll_modifier_caps(uint8_t succeeds_on) {
    uint8_t large_bonus = modified_roll_threshold(succeeds_on, 10);
    uint8_t single_bonus = modified_roll_threshold(succeeds_on, 1);
    uint8_t large_penalty = modified_roll_threshold(succeeds_on, -10);
    uint8_t single_penalty = modified_roll_threshold(succeeds_on, -1);
    uint8_t unchanged = modified_roll_threshold(succeeds_on, 0);

    /*@ assert large_bonus == single_bonus; */
    /*@ assert large_penalty == single_penalty; */
    /*@ assert unchanged == succeeds_on; */
    return large_bonus == single_bonus && large_penalty == single_penalty &&
           unchanged == succeeds_on;
}

/*@ requires whc_valid_target_unit_layout(layout);
    requires applied_damage <= whc_target_capacity(layout);
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_mixed_allocation_respects_capacity(const struct target_unit_layout *layout,
                                                  uint32_t applied_damage,
                                                  uint32_t incoming_damage) {
    uint32_t result = allocate_damage_to_target_unit(layout, applied_damage, incoming_damage);

    /*@ assert result <= whc_target_capacity(layout); */
    return result <= target_unit_capacity(layout);
}

/*@ requires whc_valid_target_unit_layout(layout);
    requires applied_damage <= whc_target_capacity(layout);
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_zero_mixed_damage_changes_nothing(const struct target_unit_layout *layout,
                                                 uint32_t applied_damage) {
    uint32_t result = allocate_damage_to_target_unit(layout, applied_damage, 0u);

    /*@ assert result == applied_damage; */
    return result == applied_damage;
}

/*@ requires wounds > 0 && models > 0;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_empty_battle_replay_initializes_health(uint32_t wounds, uint32_t models) {
    uint32_t profiles[WHC_BATTLE_PROFILE_FIELDS] = {wounds, models};
    uint32_t health[WHC_BATTLE_HEALTH_FIELDS] = {0u, 0u};
    bool replayed = whc_replay_battle_health_events(profiles, 1u, NULL, 0u, health);

    /*@ assert replayed; */
    /*@ assert health[0] == models; */
    /*@ assert health[1] == 0; */
    return replayed && health[0] == models && health[1] == 0u;
}

/*@ requires first_player_index <= 1;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_battle_clock_start(uint32_t first_player_index) {
    uint32_t clock[WHC_BATTLE_CLOCK_FIELDS] = {0u};
    bool started = whc_start_battle_clock(first_player_index, clock);

    /*@ assert started; */
    /*@ assert clock[0] == WHC_BATTLE_CLOCK_ACTIVE; */
    /*@ assert clock[1] == 1 && clock[2] == 1; */
    /*@ assert clock[3] == WHC_BATTLE_PHASE_COMMAND && clock[4] == 0; */
    /*@ assert clock[5] == first_player_index; */
    /*@ assert clock[6] == first_player_index; */
    /*@ assert clock[7] == first_player_index; */
    return started && clock[0] == WHC_BATTLE_CLOCK_ACTIVE && clock[1] == 1u && clock[2] == 1u &&
           clock[3] == WHC_BATTLE_PHASE_COMMAND && clock[4] == 0u &&
           clock[5] == first_player_index && clock[6] == first_player_index &&
           clock[7] == first_player_index;
}

/*@ assigns \nothing;
    ensures \result;
*/
bool whc_prove_desperate_escape_model_trigger(bool unit_battle_shocked, bool moves_over_enemy_model,
                                              bool model_is_titanic, bool model_can_fly,
                                              bool already_tested_this_phase) {
    bool required = whc_desperate_escape_model_requires_test(
        unit_battle_shocked, moves_over_enemy_model, model_is_titanic, model_can_fly,
        already_tested_this_phase);
    bool expected =
        !already_tested_this_phase &&
        (unit_battle_shocked || (moves_over_enemy_model && !model_is_titanic && !model_can_fly));

    /*@ assert required == expected; */
    return required == expected;
}
