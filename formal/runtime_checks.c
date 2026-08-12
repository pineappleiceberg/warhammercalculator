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
    int32_t convex_silhouette[8] = {-1000, -1000, 1000, -1000, 1000, 1000, -1000, 1000};
    int32_t concave_silhouette[10] = {-1000, -1000, 1000, -1000, 0, 0, 1000, 1000, -1000, 1000};

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
    assert(whc_ranged_geometry_resolution_is_valid(2u, 2u, 3u, 3u, 0u,
                                                   WHC_RANGED_GEOMETRY_DIRECT_VISIBLE |
                                                       WHC_RANGED_GEOMETRY_VISIBILITY_PROOF |
                                                       WHC_RANGED_GEOMETRY_REVIEWED_BY_PLAYER));
    assert(whc_ranged_geometry_resolution_is_valid(2u, 0u, 3u, 2u, 1u,
                                                   WHC_RANGED_GEOMETRY_INDIRECT_FIRE |
                                                       WHC_RANGED_GEOMETRY_WEAPON_HAS_INDIRECT |
                                                       WHC_RANGED_GEOMETRY_REVIEWED_BY_PLAYER));
    assert(!whc_ranged_geometry_resolution_is_valid(2u, 1u, 3u, 3u, 0u,
                                                    WHC_RANGED_GEOMETRY_DIRECT_VISIBLE |
                                                        WHC_RANGED_GEOMETRY_VISIBILITY_PROOF |
                                                        WHC_RANGED_GEOMETRY_REVIEWED_BY_PLAYER));
    assert(whc_convex_silhouette_is_valid(convex_silhouette, 4u, WHC_CONVEX_SILHOUETTE_REVIEWED));
    assert(!whc_convex_silhouette_is_valid(concave_silhouette, 5u, WHC_CONVEX_SILHOUETTE_REVIEWED));
    assert(!whc_convex_silhouette_is_valid(convex_silhouette, 4u, 0u));
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
    const uint32_t fight_rule_restricted =
        WHC_FIGHT_MOVE_REVIEWED_BY_PLAYER | WHC_FIGHT_MOVE_BASE_CONTACT_STATIONARY |
        WHC_FIGHT_MOVE_OUTCOME_EXPLAINED | WHC_FIGHT_MOVE_RULE_RESTRICTED;
    assert(whc_fight_move_is_valid(WHC_FIGHT_MOVE_PILE_IN, WHC_FIGHT_DESTINATION_NONE, 0u,
                                   fight_rule_restricted));
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
    assert(whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_CHARGE_DECLARED, WHC_BATTLE_PHASE_CHARGE,
                                       12000u, WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(!whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_CHARGE_DECLARED,
                                        WHC_BATTLE_PHASE_MOVEMENT, 12000u,
                                        WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(!whc_fire_overwatch_is_valid(WHC_FIRE_OVERWATCH_SET_UP, WHC_BATTLE_PHASE_MOVEMENT,
                                        24001u, WHC_FIRE_OVERWATCH_FLAGS_MASK));
    assert(whc_hazardous_resolution_is_valid(1u, 0u, false, 3u, 0u, 0u, 0u, 3u, true,
                                             WHC_HAZARDOUS_FLAGS_MASK));
    assert(whc_hazardous_resolution_is_valid(1u, 0u, false, 5u, 5u, 3u, 2u, 1u, false,
                                             WHC_HAZARDOUS_FLAGS_MASK));
    assert(!whc_hazardous_resolution_is_valid(2u, 0u, false, 3u, 0u, 0u, 0u, 3u, true,
                                              WHC_HAZARDOUS_FLAGS_MASK));
    assert(whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, false, false,
                                     WHC_GO_TO_GROUND_FLAGS_MASK));
    assert(!whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, true, false,
                                      WHC_GO_TO_GROUND_FLAGS_MASK));
    assert(!whc_go_to_ground_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, false, false,
                                      WHC_GO_TO_GROUND_FLAGS_MASK &
                                          ~WHC_GO_TO_GROUND_SIX_PLUS_INVULNERABLE));
    assert(whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_FIGHT, 2u, 2u, 0u, false, false,
                                          WHC_COUNTER_OFFENSIVE_FLAGS_MASK));
    assert(!whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_FIGHT, 1u, 2u, 0u, false, false,
                                           WHC_COUNTER_OFFENSIVE_FLAGS_MASK));
    assert(!whc_counter_offensive_is_valid(WHC_BATTLE_PHASE_FIGHT, 2u, 2u, 0u, false, false,
                                           WHC_COUNTER_OFFENSIVE_FLAGS_MASK &
                                               ~WHC_COUNTER_OFFENSIVE_FIGHTS_NEXT));
    assert(whc_smokescreen_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, false, false,
                                    WHC_SMOKESCREEN_FLAGS_MASK));
    assert(!whc_smokescreen_is_valid(WHC_BATTLE_PHASE_SHOOTING, 0u, 1u, 0u, false, false,
                                     WHC_SMOKESCREEN_FLAGS_MASK));
    assert(
        !whc_smokescreen_is_valid(WHC_BATTLE_PHASE_SHOOTING, 2u, 1u, 1u, false, false,
                                  WHC_SMOKESCREEN_FLAGS_MASK & ~WHC_SMOKESCREEN_BENEFIT_OF_COVER));
    assert(whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 2u, 2u, 2u,
                                      1u, 1u, false, false, false, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 1u, 1u, 1u,
                                      1u, 0u, false, false, true, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(!whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_END, 1u, 1u, 1u,
                                       1u, 0u, false, false, false, WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(!whc_rapid_ingress_is_valid(WHC_BATTLE_PHASE_MOVEMENT, WHC_MOVEMENT_STEP_REINFORCEMENTS,
                                       2u, 2u, 2u, 1u, 1u, false, false, false,
                                       WHC_RAPID_INGRESS_FLAGS_MASK));
    assert(whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_EXECUTABLE, true, false));
    assert(whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_IRRELEVANT, true, false));
    assert(whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_GUIDED, true, true));
    assert(!whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_GUIDED, true, false));
    assert(!whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_UNSUPPORTED, true, true));
    assert(!whc_rule_coverage_is_permitted(WHC_RULE_COVERAGE_EXECUTABLE, false, true));
    assert(
        whc_ranged_declaration_is_valid(3u, 3u, 2u, 2u, 3u, 3u, WHC_RANGED_DECLARATION_FLAGS_MASK));
    assert(!whc_ranged_declaration_is_valid(3u, 3u, 3u, 2u, 3u, 3u,
                                            WHC_RANGED_DECLARATION_FLAGS_MASK));
    assert(!whc_ranged_declaration_is_valid(3u, 3u, 2u, 2u, 3u, 3u,
                                            WHC_RANGED_DECLARATION_FLAGS_MASK &
                                                ~WHC_RANGED_DECLARATION_PROFILES_CONTIGUOUS));
    assert(whc_transport_load_is_valid(12u, 12u, 0u, 0u, 1u));
    assert(whc_transport_load_is_valid(4u, 6u, 1u, 1u, 1u));
    assert(!whc_transport_load_is_valid(13u, 12u, 0u, 0u, 1u));
    assert(!whc_transport_load_is_valid(4u, 6u, 2u, 1u, 1u));
    assert(!whc_transport_load_is_valid(4u, 6u, 1u, 0u, 1u));
    assert(!whc_transport_load_is_valid(4u, 6u, 0u, 0u, 2u));
    assert(whc_transport_deployment_chain_is_valid(3u, 3u, WHC_DEPLOYMENT_ROOT_BATTLEFIELD, 0u));
    assert(whc_transport_deployment_chain_is_valid(1u, 1u, WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED, 0u));
    assert(whc_transport_deployment_chain_is_valid(3u, 3u, WHC_DEPLOYMENT_ROOT_STRATEGIC_RESERVES,
                                                   3u));
    assert(!whc_transport_deployment_chain_is_valid(3u, 2u, WHC_DEPLOYMENT_ROOT_BATTLEFIELD, 0u));
    assert(!whc_transport_deployment_chain_is_valid(3u, 3u, WHC_DEPLOYMENT_ROOT_RESERVES, 2u));
    assert(whc_initial_deployment_is_valid(1u, 0u, 0u, 0u, WHC_AIRCRAFT_MODE_NONE,
                                           WHC_DEPLOYMENT_ROOT_NOT_DEPLOYED));
    assert(whc_initial_deployment_is_valid(0u, 0u, 1u, 0u, WHC_AIRCRAFT_MODE_AIRCRAFT,
                                           WHC_DEPLOYMENT_ROOT_RESERVES));
    assert(whc_initial_deployment_is_valid(0u, 0u, 1u, 1u, WHC_AIRCRAFT_MODE_HOVER,
                                           WHC_DEPLOYMENT_ROOT_BATTLEFIELD));
    assert(!whc_initial_deployment_is_valid(0u, 0u, 1u, 1u, WHC_AIRCRAFT_MODE_HOVER,
                                            WHC_DEPLOYMENT_ROOT_RESERVES));
    assert(whc_table_geometry_is_valid(60000u, 44000u, 5u, 5u, 12u, 4u, 2u, 6u,
                                       WHC_TABLE_GEOMETRY_FLAGS_MASK));
    assert(!whc_table_geometry_is_valid(60000u, 44000u, 5u, 4u, 12u, 4u, 2u, 6u,
                                        WHC_TABLE_GEOMETRY_FLAGS_MASK));
    assert(whc_terrain_footprint_set_is_valid(12u, 12u, 12u, 12u, 12u, 0u, 4u, 2u, 6u,
                                              WHC_TERRAIN_FOOTPRINT_FLAGS_MASK));
    assert(!whc_terrain_footprint_set_is_valid(12u, 12u, 12u, 12u, 12u, 1u, 4u, 2u, 6u,
                                               WHC_TERRAIN_FOOTPRINT_FLAGS_MASK));
    assert(whc_model_placement_set_is_valid(3u, 3u, 3u, 3u, 3u, 3u, 3u, 3u, 2u, 1u,
                                            WHC_MODEL_PLACEMENT_FLAGS_MASK));
    assert(!whc_model_placement_set_is_valid(3u, 3u, 3u, 3u, 3u, 2u, 3u, 3u, 2u, 1u,
                                             WHC_MODEL_PLACEMENT_FLAGS_MASK));
    assert(!whc_model_placement_set_is_valid(3u, 3u, 3u, 3u, 3u, 3u, 3u, 3u, UINT32_MAX, 4u,
                                             WHC_MODEL_PLACEMENT_FLAGS_MASK));
    assert(whc_model_position_set_is_valid(3u, 3u, 3u, 3u, 3u, 3u, 3u, 3u, 2u, 1u, 2u, 2u, 3u, 3u,
                                           3u, 3u, 3u, 3u, 3u, WHC_MODEL_POSITION_FLAGS_MASK));
    assert(!whc_model_position_set_is_valid(3u, 3u, 3u, 3u, 3u, 3u, 3u, 3u, 2u, 1u, 2u, 2u, 3u, 3u,
                                            3u, 2u, 3u, 3u, 3u, WHC_MODEL_POSITION_FLAGS_MASK));
    assert(!whc_model_position_set_is_valid(3u, 3u, 3u, 3u, 3u, 3u, 3u, 3u, 2u, 1u, 2u, 2u, 3u, 3u,
                                            3u, 3u, 3u, 3u, 2u, WHC_MODEL_POSITION_FLAGS_MASK));
    assert(!whc_model_position_set_is_valid(3u, 3u, 3u, 3u, 3u, 3u, 3u, 3u, UINT32_MAX, 4u, 2u, 2u,
                                            3u, 3u, 3u, 3u, 3u, 3u, 3u,
                                            WHC_MODEL_POSITION_FLAGS_MASK));
    assert(whc_spatial_facts_are_valid(3u, 3u, 1u, 3u, 2u, 5u, 1u, WHC_SPATIAL_FACTS_FLAGS_MASK));
    assert(whc_spatial_facts_are_valid(7u, 7u, 2u, 6u, 0u, 5u, 0u, WHC_SPATIAL_FACTS_FLAGS_MASK));
    assert(!whc_spatial_facts_are_valid(7u, 6u, 2u, 6u, 0u, 5u, 0u, WHC_SPATIAL_FACTS_FLAGS_MASK));
    assert(!whc_spatial_facts_are_valid(7u, 7u, 1u, 6u, 0u, 5u, 0u, WHC_SPATIAL_FACTS_FLAGS_MASK));
    assert(whc_endpoint_clearance_facts_are_valid(3u, 3u, 5u, 5u, 0u, 0u,
                                                  WHC_ENDPOINT_CLEARANCE_FLAGS_MASK));
    assert(whc_endpoint_clearance_facts_are_valid(3u, 2u, 5u, 5u, 1u, 10u, 2u));
    assert(!whc_endpoint_clearance_facts_are_valid(3u, 2u, 5u, 5u, 2u, 0u, 2u));
    assert(!whc_endpoint_clearance_facts_are_valid(3u, 3u, 5u, 5u, 0u, 0u, 2u));
    assert(whc_terrain_clearance_facts_are_valid(3u, 3u, 12u, 12u, 12u, 6u, 6u, 0u,
                                                 WHC_TERRAIN_CLEARANCE_FLAGS_MASK));
    assert(whc_terrain_clearance_facts_are_valid(3u, 2u, 12u, 10u, 11u, 6u, 4u, 2u, 0u));
    assert(!whc_terrain_clearance_facts_are_valid(3u, 3u, 12u, 12u, 12u, 6u, 5u, 0u,
                                                  WHC_TERRAIN_CLEARANCE_FLAGS_MASK));
    assert(whc_oath_of_moment_attack_state_is_valid(0u, 0u, 0u, 0u, 0u, 0u));
    assert(whc_oath_of_moment_attack_state_is_valid(1u, 1u, 1u, 1u, 1u, 1u));
    assert(whc_oath_of_moment_attack_state_is_valid(1u, 1u, 1u, 1u, 0u, 0u));
    assert(!whc_oath_of_moment_attack_state_is_valid(0u, 1u, 1u, 1u, 1u, 1u));
    assert(whc_reanimation_protocols_transition_is_valid(1u, 1u, 1u, 1u, 3u, 3u, 1u, 3u, 3u, 2u, 1u,
                                                         2u, 0u));
    assert(whc_reanimation_protocols_transition_is_valid(1u, 1u, 1u, 1u, 3u, 2u, 2u, 3u, 3u, 2u, 0u,
                                                         3u, 2u));
    assert(!whc_reanimation_protocols_transition_is_valid(1u, 1u, 0u, 1u, 3u, 2u, 2u, 3u, 3u, 2u,
                                                          0u, 3u, 2u));
    assert(whc_shadow_in_the_warp_test_is_valid(1u, 1u, 1u, 1u, 1u, 0u, 0u, 0u, 2u, 8u,
                                                7u, 0u, 1u, 1u));
    assert(whc_shadow_in_the_warp_test_is_valid(1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 3u, 8u,
                                                7u, 1u, 0u, 1u));
    assert(!whc_shadow_in_the_warp_test_is_valid(1u, 1u, 1u, 0u, 1u, 0u, 0u, 0u, 2u, 8u,
                                                 7u, 0u, 1u, 1u));
    assert(whc_objective_control_facts_are_valid(2u, 2u, 4u, 1u, 1u, 0u,
                                                 WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK));
    assert(whc_objective_control_facts_are_valid(2u, 2u, 4u, 2u, 0u, 1u,
                                                 WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK));
    assert(whc_objective_control_facts_are_valid(2u, 2u, 0u, 2u, 0u, 1u,
                                                 WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK));
    assert(!whc_objective_control_facts_are_valid(2u, 2u, 0u, 0u, 0u, 0u,
                                                  WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK));
    assert(!whc_objective_control_facts_are_valid(2u, 2u, 4u, 2u, 1u, 0u,
                                                  WHC_OBJECTIVE_CONTROL_FACTS_FLAGS_MASK));
    assert(whc_visibility_facts_are_valid(6u, 6u, 2u, 3u, 1u, 2u, 3u, 1u, 1u, 1u,
                                          WHC_VISIBILITY_FACTS_FLAGS_MASK));
    assert(!whc_visibility_facts_are_valid(6u, 5u, 2u, 3u, 1u, 2u, 3u, 1u, 1u, 1u,
                                           WHC_VISIBILITY_FACTS_FLAGS_MASK));
    assert(!whc_visibility_facts_are_valid(6u, 6u, 2u, 3u, 1u, 1u, 3u, 1u, 1u, 1u,
                                           WHC_VISIBILITY_FACTS_FLAGS_MASK));

    return 0;
}
