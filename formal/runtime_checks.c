#include "warhammercalculator/calculator.h"
#include "warhammercalculator/web_api.h"

#include <assert.h>
#include <stdint.h>

#ifdef NDEBUG
#error "Runtime contract checks require active assertions"
#endif

/*@ terminates \true;
    ensures \result == 0;
*/
int main(void) {
    uint8_t save = 2u;
    struct weapon_profile weapon = {0};
    struct target_profile target = {0};
    struct calculator_workspace workspace;
    struct attack_plan plan;
    struct probability_distribution distribution;
    uint64_t mass_sum = 0u;
    uint32_t outcome = 0u;
    uint32_t battle_profiles[WHC_BATTLE_PROFILE_FIELDS] = {3u, 2u};
    uint32_t battle_health[WHC_BATTLE_HEALTH_FIELDS] = {99u, 99u};
    uint32_t invalid_battle_event[WHC_BATTLE_EVENT_FIELDS] = {0u};
    uint32_t battle_clock[WHC_BATTLE_CLOCK_FIELDS] = {0u};
    uint32_t next_battle_clock[WHC_BATTLE_CLOCK_FIELDS] = {0u};

    /*@ loop invariant 2 <= save && save <= 8;
        loop assigns save;
        loop variant 8 - save;
    */
    while (save <= 7u) {
        uint8_t invulnerable = 0u;

        /*@ loop invariant 0 <= invulnerable && invulnerable <= 7;
            loop assigns invulnerable;
            loop variant 7 - invulnerable;
        */
        while (invulnerable <= 6u) {
            uint16_t ap = 0u;

            if (invulnerable == 1u) {
                invulnerable = 2u;
            }

            /*@ loop invariant 0 <= ap && ap <= 13;
                loop assigns ap;
                loop variant 13 - ap;
            */
            while (ap <= 12u) {
                uint8_t threshold = saves_on(save, invulnerable, ap);
                uint8_t covered = saves_on_with_cover(save, invulnerable, ap);

                assert(threshold >= 2u && threshold <= 7u);
                assert(covered >= 2u && covered <= threshold);
                if (invulnerable != 0u) {
                    assert(threshold <= invulnerable);
                }
                ap++;
            }

            invulnerable++;
        }

        save++;
    }

    assert(saves_on(2u, 0u, 4u) == 6u);
    assert(saves_on_with_cover(2u, 0u, 4u) == 5u);
    assert(saves_on_with_cover(3u, 0u, 0u) == 3u);
    assert(modified_roll_threshold(4u, 10) == 3u);
    assert(modified_roll_threshold(4u, -10) == 5u);

    weapon.attacks = (struct dice_value){0u, 0u, 4u};
    weapon.attacks_multiplier = 2u;
    weapon.attacks_addition = (struct dice_value){1u, 3u, 0u};
    weapon.hits_on = 3u;
    weapon.strength = 10u;
    weapon.ap = 3u;
    weapon.damage = (struct dice_value){1u, 6u, 1u};
    weapon.damage_multiplier = 2u;
    weapon.critical_hits_on = 6u;
    weapon.hit_modifier = 2;
    weapon.wound_modifier = -2;
    weapon.hit_reroll_mask = UINT8_C(1) << 1u;
    weapon.wound_reroll_mask = UINT8_C(1) << 1u;
    target.toughness = 10u;
    target.save = 2u;
    target.wounds = 12u;
    target.damage_divisor = 2u;

    assert(attack_plan_build(&weapon, &target, &plan));
    assert(attack_plan_is_valid(&plan));
    assert(plan.hits_on == 2u);
    assert(plan.wounds_on == 5u);
    assert(plan.hit_reroll_mask == (UINT8_C(1) << 1u));
    assert(plan.wound_reroll_mask == (UINT8_C(1) << 1u));
    assert(plan.damage_divisor == 2u);
    assert(plan.damage_multiplier == 2u);
    assert(calculate_attack_damage_distribution(&weapon, &target, &workspace, &distribution));
    assert(probability_distribution_is_normalized(&distribution));
    assert(distribution.minimum <= distribution.maximum);
    assert(distribution.maximum <= MAX_DISTRIBUTION_RESULT);

    outcome = distribution.minimum;
    /*@ loop invariant distribution.minimum <= outcome && outcome <= distribution.maximum + 1;
        loop assigns outcome, mass_sum;
        loop variant distribution.maximum + 1 - outcome;
    */
    while (outcome <= distribution.maximum) {
        mass_sum += distribution.mass[outcome];
        outcome++;
    }

    assert(mass_sum == PROBABILITY_SCALE);
    assert(distribution.total_mass == PROBABILITY_SCALE);

    distribution.mass[distribution.minimum]--;
    assert(!probability_distribution_is_normalized(&distribution));
    plan.flags |= UINT32_C(1) << 31u;
    assert(!attack_plan_is_valid(&plan));
    assert(whc_replay_battle_health_events(battle_profiles, 1u, NULL, 0u, battle_health));
    assert(battle_health[0] == 2u);
    assert(battle_health[1] == 0u);
    invalid_battle_event[0] = WHC_BATTLE_STATE_VERSION;
    invalid_battle_event[1] = WHC_BATTLE_EVENT_ATTACK;
    invalid_battle_event[2] = 1u;
    battle_health[0] = 97u;
    battle_health[1] = 98u;
    assert(!whc_replay_battle_health_events(battle_profiles, 1u, invalid_battle_event, 1u,
                                            battle_health));
    assert(battle_health[0] == 97u);
    assert(battle_health[1] == 98u);
    assert(whc_start_battle_clock(0u, battle_clock));
    assert(battle_clock[0] == WHC_BATTLE_CLOCK_ACTIVE);
    assert(whc_next_battle_clock(battle_clock, next_battle_clock));
    assert(next_battle_clock[3] == WHC_BATTLE_PHASE_COMMAND);
    assert(next_battle_clock[4] == 1u);
    assert(whc_ranged_target_eligibility_is_valid(
        24000u, 24000u, 12000u, 2u, 2u, WHC_TARGET_VISIBLE | WHC_TARGET_REVIEWED_BY_PLAYER));
    assert(!whc_ranged_target_eligibility_is_valid(
        24000u, 24000u, 25000u, 2u, 2u, WHC_TARGET_VISIBLE | WHC_TARGET_REVIEWED_BY_PLAYER));
    assert(whc_ranged_target_eligibility_is_valid(
        48000u, 48000u, 32000u, 1u, 1u,
        WHC_TARGET_INDIRECT_FIRE | WHC_TARGET_WEAPON_HAS_INDIRECT | WHC_TARGET_REVIEWED_BY_PLAYER));
    assert(whc_weapon_inventory_declaration_is_valid(
        2u, 1u, 1u, 1u, WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT, WHC_WEAPON_INDIRECT));
    assert(!whc_weapon_inventory_declaration_is_valid(2u, 1u, 2u, 1u, WHC_WEAPON_ASSAULT,
                                                      WHC_WEAPON_ASSAULT));
    assert(!whc_weapon_inventory_declaration_is_valid(2u, 1u, 0u, 1u, WHC_WEAPON_ASSAULT,
                                                      WHC_WEAPON_INDIRECT));
    assert(whc_weapon_bearer_declaration_is_valid(
        2u, 1u, 0u, 1u, WHC_WEAPON_ASSAULT | WHC_WEAPON_INDIRECT, WHC_WEAPON_INDIRECT));
    assert(!whc_weapon_bearer_declaration_is_valid(2u, 1u, 1u, 1u, WHC_WEAPON_ASSAULT,
                                                   WHC_WEAPON_ASSAULT));
    assert(!whc_weapon_bearer_declaration_is_valid(2u, 3u, 0u, 1u, WHC_WEAPON_ASSAULT,
                                                   WHC_WEAPON_ASSAULT));
    const uint32_t charge_flags = WHC_CHARGE_REVIEWED_BY_PLAYER | WHC_CHARGE_PHASE_START_ELIGIBLE |
                                  WHC_CHARGE_STARTED_OUTSIDE_ENGAGEMENT |
                                  WHC_CHARGE_ALL_TARGETS_ENGAGED | WHC_CHARGE_UNIT_COHERENCY |
                                  WHC_CHARGE_NON_TARGETS_AVOIDED | WHC_CHARGE_ALL_MODELS_CLOSER |
                                  WHC_CHARGE_BASE_CONTACT_MAXIMIZED;
    assert(whc_charge_resolution_is_valid(3u, 4u, 0, 7000u, 9000u, 6500u, 1u, true, charge_flags));
    assert(!whc_charge_resolution_is_valid(3u, 4u, 0, 7000u, 9000u, 8000u, 1u, true, charge_flags));
    const uint32_t fight_enemy_flags =
        WHC_FIGHT_MOVE_REVIEWED_BY_PLAYER | WHC_FIGHT_MOVE_UNIT_COHERENCY |
        WHC_FIGHT_MOVE_ENGAGEMENT_RANGE | WHC_FIGHT_MOVE_CLOSER_TO_ENEMY |
        WHC_FIGHT_MOVE_BASE_CONTACT_MAXIMIZED | WHC_FIGHT_MOVE_BASE_CONTACT_STATIONARY;
    assert(whc_fight_move_is_valid(WHC_FIGHT_MOVE_PILE_IN, WHC_FIGHT_DESTINATION_ENEMY, 3000u,
                                   fight_enemy_flags));
    assert(!whc_fight_move_is_valid(WHC_FIGHT_MOVE_PILE_IN, WHC_FIGHT_DESTINATION_NONE, 3000u,
                                    fight_enemy_flags));
    assert(whc_heroic_intervention_is_valid(3u, 4u, 0, 7000u, 5500u, 5500u, true, charge_flags,
                                            WHC_HEROIC_FLAGS_MASK));
    assert(!whc_heroic_intervention_is_valid(3u, 4u, 0, 7000u, 6001u, 5500u, true, charge_flags,
                                             WHC_HEROIC_FLAGS_MASK));
    assert(
        !whc_heroic_intervention_is_valid(3u, 4u, 0, 7000u, 5500u, 5500u, true, charge_flags,
                                          WHC_HEROIC_FLAGS_MASK & ~WHC_HEROIC_SOLE_TRIGGER_TARGET));
    assert(whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_NORMAL_MOVE_START,
                                       WHC_BATTLE_PHASE_MOVEMENT, 24000u,
                                       WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_CHARGE_DECLARED,
                                       WHC_BATTLE_PHASE_CHARGE, 12000u,
                                       WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(!whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_CHARGE_DECLARED,
                                        WHC_BATTLE_PHASE_MOVEMENT, 12000u,
                                        WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(!whc_fire_overwatch_is_valid(
        WHC_FIRE_OVERWATCH_SET_UP, WHC_BATTLE_PHASE_MOVEMENT, 24001u,
        WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(whc_hazardous_resolution_is_valid(1u, 0u, false, 3u, 0u, 0u, 0u, 3u, true,
                                              WHC_HAZARDOUS_FLAGS_MASK));
    assert(whc_hazardous_resolution_is_valid(1u, 0u, false, 5u, 5u, 3u, 2u, 1u, false,
                                              WHC_HAZARDOUS_FLAGS_MASK));
    assert(!whc_hazardous_resolution_is_valid(2u, 0u, false, 3u, 0u, 0u, 0u, 3u, true,
                                               WHC_HAZARDOUS_FLAGS_MASK));
    return 0;
}
