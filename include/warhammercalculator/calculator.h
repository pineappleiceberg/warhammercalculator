#ifndef WARHAMMERCALCULATOR_CALCULATOR_H
#define WARHAMMERCALCULATOR_CALCULATOR_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define NAME_LENGTH 128u
#define MAX_DISTRIBUTION_RESULT 1024u
#define MAX_PROFILE_RULES 8u
#define MAX_DAMAGE_TRANSFORMS 4u
#define MAX_TARGET_SEGMENTS 16u
#define MAX_VOLLEY_WEAPONS 32u
#define MAX_EXACT_DEFERRED_STATES 2047u
#define MAX_CHARACTERISTIC_ROLL_COMBINATIONS 4096u

#define PROBABILITY_SCALE (UINT32_C(1) << 31)

struct fraction {
    uint64_t numerator;
    uint64_t denominator;
};

struct dice_value {
    uint16_t dice_count;
    uint16_t dice_sides;
    uint16_t modifier;
};

struct distribution {
    uint64_t ways[MAX_DISTRIBUTION_RESULT + 1u];
    uint32_t minimum;
    uint32_t maximum;
    uint64_t total_ways;
};

struct probability_distribution {
    uint32_t mass[MAX_DISTRIBUTION_RESULT + 1u];
    uint32_t minimum;
    uint32_t maximum;
    uint64_t total_mass;
};

struct distribution_summary {
    uint32_t minimum;
    uint32_t first_quartile;
    uint32_t median;
    uint32_t third_quartile;
    uint32_t maximum;
    struct fraction mean;
};

struct exact_complexity {
    uint32_t estimated_state_upper_bound;
    uint32_t state_limit;
    uint32_t maximum_attack_events;
    uint32_t target_capacity;
    bool uses_deferred_states;
    bool exact_guaranteed_by_bound;
};

enum characteristic_roll_flags {
    CHARACTERISTIC_ROLL_ATTACKS = UINT8_C(1) << 0,
    CHARACTERISTIC_ROLL_STRENGTH = UINT8_C(1) << 1,
    CHARACTERISTIC_ROLL_DAMAGE = UINT8_C(1) << 2
};

struct attack_plan;
struct weapon_profile;
struct target_profile;

union rule_payload {
    uint64_t u64[2];
    uint32_t u32[4];
    uint16_t u16[8];
    uint8_t u8[16];
};

typedef bool (*attack_rule_compile_function)(struct attack_plan *plan,
                                             const struct weapon_profile *weapon,
                                             const struct target_profile *target,
                                             const union rule_payload *payload);

typedef bool (*damage_transform_function)(uint32_t *damage, const union rule_payload *payload);

struct rule_entry {
    attack_rule_compile_function compile;
    union rule_payload payload;
};

struct rule_set {
    struct rule_entry entries[MAX_PROFILE_RULES];
    uint8_t count;
};

struct damage_transform_entry {
    damage_transform_function apply;
    union rule_payload payload;
};

enum attack_plan_flags {
    ATTACK_PLAN_LETHAL_HITS = UINT32_C(1) << 0,
    ATTACK_PLAN_CRITICAL_WOUNDS_BYPASS_SAVE = UINT32_C(1) << 1,
    ATTACK_PLAN_REROLL_FAILED_HITS = UINT32_C(1) << 2,
    ATTACK_PLAN_REROLL_FAILED_WOUNDS = UINT32_C(1) << 3,
    ATTACK_PLAN_REROLL_FAILED_SAVES = UINT32_C(1) << 4,
    ATTACK_PLAN_AUTO_HITS = UINT32_C(1) << 5
};

struct attack_plan {
    uint8_t hits_on;
    uint8_t wounds_on;
    uint8_t saves_on;
    uint8_t critical_hits_on;
    uint8_t critical_wounds_on;
    uint8_t feel_no_pain_on;
    uint8_t hit_auto_fails_through;

    uint8_t hit_reroll_mask;
    uint8_t wound_reroll_mask;
    uint8_t save_reroll_mask;

    int16_t hit_modifier;
    int16_t wound_modifier;

    int32_t damage_modifier;
    uint16_t damage_divisor;
    uint16_t damage_multiplier;
    uint16_t damage_floor;
    struct dice_value sustained_hits;
    uint32_t flags;

    struct damage_transform_entry damage_transforms[MAX_DAMAGE_TRANSFORMS];
    uint8_t damage_transform_count;
};

struct weapon_profile {
    char name[NAME_LENGTH];
    struct dice_value attacks;
    uint16_t attacks_replacement;
    uint16_t attacks_multiplier;
    struct dice_value attacks_addition;
    int16_t attacks_modifier;
    uint16_t weapon_count;
    uint8_t hits_on;
    uint16_t strength;
    uint16_t strength_replacement;
    uint16_t strength_multiplier;
    int16_t strength_modifier;
    uint16_t ap;
    struct dice_value damage;
    uint16_t damage_replacement;
    bool damage_replacement_active;
    uint16_t damage_multiplier;
    int16_t damage_modifier;
    struct dice_value characteristic_modifier_roll;
    uint8_t characteristic_modifier_roll_flags;
    uint16_t characteristic_modifier_roll_group;
    uint8_t critical_hits_on;
    int8_t hit_modifier;
    int8_t wound_modifier;
    uint8_t hit_reroll_mask;
    uint8_t wound_reroll_mask;
    struct rule_set rules;
};

struct target_profile {
    char name[NAME_LENGTH];
    uint16_t toughness;
    uint8_t save;
    uint8_t invulnerable_save;
    uint8_t feel_no_pain;
    uint16_t wounds;
    uint16_t reduction;
    uint16_t damage_divisor;
    uint16_t first_failed_save_damage_replacement;
    bool first_failed_save_damage_replacement_active;
    uint16_t allocated_attack_damage_replacement;
    uint16_t allocated_attack_damage_replacement_uses;
    uint16_t allocated_attack_damage_replacement_skip;
    struct rule_set rules;
};

struct target_unit_layout {
    uint16_t wounds_per_model[MAX_TARGET_SEGMENTS];
    uint16_t model_counts[MAX_TARGET_SEGMENTS];
    uint16_t segment_count;
    uint16_t initial_wounds_lost;
};

struct calculator_workspace {
    struct distribution exact_a;
    struct distribution exact_b;

    struct probability_distribution probability_a;
    struct probability_distribution probability_b;
    struct probability_distribution probability_c;
    struct probability_distribution probability_d;
    struct probability_distribution probability_e;
    struct probability_distribution probability_f;
    struct probability_distribution target_attacks[MAX_TARGET_SEGMENTS];
    struct probability_distribution target_first_failed_save_attacks[MAX_TARGET_SEGMENTS];
    struct probability_distribution target_allocated_replacement_attacks[MAX_TARGET_SEGMENTS];

    uint64_t convolution_accumulator[MAX_DISTRIBUTION_RESULT + 1u];
    uint64_t mixture_accumulator[MAX_DISTRIBUTION_RESULT + 1u];
    uint32_t peak_sparse_states;
};

/*@
  logic integer whc_min(integer left, integer right) = left < right ? left : right;
  logic integer whc_max(integer left, integer right) = left > right ? left : right;
  logic integer whc_capped_roll_modifier(integer modifier) =
      modifier > 1 ? 1 : modifier < -1 ? -1 : modifier;
  logic integer whc_modified_roll_threshold(integer succeeds_on, integer modifier) =
      whc_max(2, whc_min(6, succeeds_on - whc_capped_roll_modifier(modifier)));
  logic integer whc_clamp_save(integer value) = value > 7 ? 7 : value;
  logic integer whc_armour_save(integer save, integer ap) = save + ap;
  logic integer whc_wound_threshold(integer strength, integer toughness) =
      strength >= 2 * toughness ? 2
      : strength > toughness ? 3
      : strength == toughness ? 4
      : toughness >= 2 * strength ? 6
      : 5;
  logic integer whc_save_threshold(integer save, integer invulnerable_save, integer ap) =
      whc_clamp_save(invulnerable_save != 0
                         ? whc_min(whc_armour_save(save, ap), invulnerable_save)
                         : whc_armour_save(save, ap));
  logic integer whc_cover_armour_save(integer save, integer ap) =
      save + ap - ((ap != 0 || save > 3) && save + ap > 2 ? 1 : 0);
  logic integer whc_cover_save_threshold(integer save, integer invulnerable_save, integer ap) =
      whc_clamp_save(invulnerable_save != 0
                         ? whc_min(whc_cover_armour_save(save, ap), invulnerable_save)
                         : whc_cover_armour_save(save, ap));

  predicate whc_valid_fraction{L}(struct fraction *value) =
      \valid_read(value) && value->denominator != 0;

  predicate whc_bounded_distribution{L}(struct distribution *distribution) =
      \valid_read(distribution) &&
      distribution->minimum <= distribution->maximum &&
      distribution->maximum <= MAX_DISTRIBUTION_RESULT;

  predicate whc_normalized_probability_distribution{L}(
      struct probability_distribution *distribution) =
      \valid_read(distribution) &&
      distribution->minimum <= distribution->maximum &&
      distribution->maximum <= MAX_DISTRIBUTION_RESULT &&
      distribution->total_mass == PROBABILITY_SCALE;

  axiomatic WhcProbabilityMass {
    logic integer whc_probability_mass_sum{L}(
        struct probability_distribution *distribution, integer count)
        reads distribution->mass[0 .. count - 1];

    axiom whc_probability_mass_sum_zero{L}:
        \forall struct probability_distribution *distribution;
            whc_probability_mass_sum(distribution, 0) == 0;

    axiom whc_probability_mass_sum_step{L}:
        \forall struct probability_distribution *distribution, integer count;
            \valid_read(distribution) &&
            0 <= count <= MAX_DISTRIBUTION_RESULT ==>
                whc_probability_mass_sum(distribution, count + 1) ==
                    whc_probability_mass_sum(distribution, count) +
                        distribution->mass[count];
  }

  predicate whc_conserved_probability_distribution{L}(
      struct probability_distribution *distribution) =
      whc_normalized_probability_distribution(distribution) &&
      whc_probability_mass_sum(distribution, MAX_DISTRIBUTION_RESULT + 1) ==
          PROBABILITY_SCALE &&
      (\forall integer index; 0 <= index <= MAX_DISTRIBUTION_RESULT ==>
          (index < distribution->minimum || index > distribution->maximum) ==>
              distribution->mass[index] == 0);

  predicate whc_valid_rule_set{L}(struct rule_set *rules) =
      \valid_read(rules) && rules->count <= MAX_PROFILE_RULES;

  predicate whc_valid_dice_value(struct dice_value dice) =
      (dice.dice_count == 0
           ? dice.dice_sides == 0 && dice.modifier <= MAX_DISTRIBUTION_RESULT
           : dice.dice_sides > 0 &&
                 dice.modifier + dice.dice_count * dice.dice_sides <=
                     MAX_DISTRIBUTION_RESULT);

  predicate whc_valid_weapon_profile{L}(struct weapon_profile *weapon) =
      \valid_read(weapon) && whc_valid_dice_value(weapon->attacks) &&
      whc_valid_dice_value(weapon->attacks_addition) &&
      whc_valid_dice_value(weapon->damage) &&
      whc_valid_dice_value(weapon->characteristic_modifier_roll) &&
      (weapon->characteristic_modifier_roll_flags & ~0x7) == 0 &&
      (weapon->characteristic_modifier_roll_flags == 0
           ? weapon->characteristic_modifier_roll.dice_count == 0 &&
                 weapon->characteristic_modifier_roll.dice_sides == 0 &&
                 weapon->characteristic_modifier_roll.modifier == 0 &&
                 weapon->characteristic_modifier_roll_group == 0
           : weapon->characteristic_modifier_roll.dice_count > 0) &&
      2 <= weapon->hits_on && weapon->hits_on <= 6 && weapon->strength > 0 &&
      (weapon->hit_reroll_mask & 0x81) == 0 &&
      (weapon->wound_reroll_mask & 0x81) == 0 &&
      whc_valid_rule_set(&weapon->rules);

  predicate whc_valid_target_profile{L}(struct target_profile *target) =
      \valid_read(target) && target->toughness > 0 &&
      2 <= target->save && target->save <= 7 &&
      (target->invulnerable_save == 0 ||
       (2 <= target->invulnerable_save && target->invulnerable_save <= 6)) &&
      (target->feel_no_pain == 0 ||
       (2 <= target->feel_no_pain && target->feel_no_pain <= 6)) &&
      whc_valid_rule_set(&target->rules);

  logic integer whc_target_capacity{L}(struct target_unit_layout *layout) =
      (layout->segment_count > 0 ? layout->wounds_per_model[0] * layout->model_counts[0] : 0) +
      (layout->segment_count > 1 ? layout->wounds_per_model[1] * layout->model_counts[1] : 0) +
      (layout->segment_count > 2 ? layout->wounds_per_model[2] * layout->model_counts[2] : 0) +
      (layout->segment_count > 3 ? layout->wounds_per_model[3] * layout->model_counts[3] : 0) +
      (layout->segment_count > 4 ? layout->wounds_per_model[4] * layout->model_counts[4] : 0) +
      (layout->segment_count > 5 ? layout->wounds_per_model[5] * layout->model_counts[5] : 0) +
      (layout->segment_count > 6 ? layout->wounds_per_model[6] * layout->model_counts[6] : 0) +
      (layout->segment_count > 7 ? layout->wounds_per_model[7] * layout->model_counts[7] : 0) +
      (layout->segment_count > 8 ? layout->wounds_per_model[8] * layout->model_counts[8] : 0) +
      (layout->segment_count > 9 ? layout->wounds_per_model[9] * layout->model_counts[9] : 0) +
      (layout->segment_count > 10 ? layout->wounds_per_model[10] * layout->model_counts[10] : 0) +
      (layout->segment_count > 11 ? layout->wounds_per_model[11] * layout->model_counts[11] : 0) +
      (layout->segment_count > 12 ? layout->wounds_per_model[12] * layout->model_counts[12] : 0) +
      (layout->segment_count > 13 ? layout->wounds_per_model[13] * layout->model_counts[13] : 0) +
      (layout->segment_count > 14 ? layout->wounds_per_model[14] * layout->model_counts[14] : 0) +
      (layout->segment_count > 15 ? layout->wounds_per_model[15] * layout->model_counts[15] : 0);

  predicate whc_valid_target_unit_layout{L}(struct target_unit_layout *layout) =
      \valid_read(layout) && 1 <= layout->segment_count &&
      layout->segment_count <= MAX_TARGET_SEGMENTS &&
      layout->wounds_per_model[0] > 0 && layout->model_counts[0] > 0 &&
      (layout->segment_count <= 1 ||
       (layout->wounds_per_model[1] > 0 && layout->model_counts[1] > 0)) &&
      (layout->segment_count <= 2 ||
       (layout->wounds_per_model[2] > 0 && layout->model_counts[2] > 0)) &&
      (layout->segment_count <= 3 ||
       (layout->wounds_per_model[3] > 0 && layout->model_counts[3] > 0)) &&
      (layout->segment_count <= 4 ||
       (layout->wounds_per_model[4] > 0 && layout->model_counts[4] > 0)) &&
      (layout->segment_count <= 5 ||
       (layout->wounds_per_model[5] > 0 && layout->model_counts[5] > 0)) &&
      (layout->segment_count <= 6 ||
       (layout->wounds_per_model[6] > 0 && layout->model_counts[6] > 0)) &&
      (layout->segment_count <= 7 ||
       (layout->wounds_per_model[7] > 0 && layout->model_counts[7] > 0)) &&
      (layout->segment_count <= 8 ||
       (layout->wounds_per_model[8] > 0 && layout->model_counts[8] > 0)) &&
      (layout->segment_count <= 9 ||
       (layout->wounds_per_model[9] > 0 && layout->model_counts[9] > 0)) &&
      (layout->segment_count <= 10 ||
       (layout->wounds_per_model[10] > 0 && layout->model_counts[10] > 0)) &&
      (layout->segment_count <= 11 ||
       (layout->wounds_per_model[11] > 0 && layout->model_counts[11] > 0)) &&
      (layout->segment_count <= 12 ||
       (layout->wounds_per_model[12] > 0 && layout->model_counts[12] > 0)) &&
      (layout->segment_count <= 13 ||
       (layout->wounds_per_model[13] > 0 && layout->model_counts[13] > 0)) &&
      (layout->segment_count <= 14 ||
       (layout->wounds_per_model[14] > 0 && layout->model_counts[14] > 0)) &&
      (layout->segment_count <= 15 ||
       (layout->wounds_per_model[15] > 0 && layout->model_counts[15] > 0)) &&
      layout->initial_wounds_lost < layout->wounds_per_model[0] &&
      whc_target_capacity(layout) <= MAX_DISTRIBUTION_RESULT;

  predicate whc_valid_attack_thresholds{L}(struct attack_plan *plan) =
      \valid_read(plan) && 2 <= plan->hits_on && plan->hits_on <= 6 &&
      2 <= plan->wounds_on && plan->wounds_on <= 6 &&
      2 <= plan->saves_on && plan->saves_on <= 7 &&
      2 <= plan->critical_hits_on && plan->critical_hits_on <= 6 &&
      2 <= plan->critical_wounds_on && plan->critical_wounds_on <= 6 &&
      (plan->feel_no_pain_on == 0 ||
       (2 <= plan->feel_no_pain_on && plan->feel_no_pain_on <= 6)) &&
      plan->hit_auto_fails_through <= 6;

  predicate whc_valid_attack_rerolls{L}(struct attack_plan *plan) =
      \valid_read(plan) &&
      (plan->hit_reroll_mask & 0x81) == 0 &&
      (plan->wound_reroll_mask & 0x81) == 0 &&
      (plan->save_reroll_mask & 0x81) == 0;

  predicate whc_valid_attack_damage_values{L}(struct attack_plan *plan) =
      \valid_read(plan) && whc_valid_dice_value(plan->sustained_hits) &&
      plan->damage_divisor > 0 && plan->damage_multiplier > 0 && plan->damage_floor <= 1 &&
      (plan->flags & ~0x3f) == 0 &&
      plan->damage_transform_count <= MAX_DAMAGE_TRANSFORMS;

  predicate whc_valid_attack_transforms{L}(struct attack_plan *plan) =
      \valid_read(plan) && plan->damage_transform_count <= MAX_DAMAGE_TRANSFORMS &&
      (\forall integer index; 0 <= index < plan->damage_transform_count ==>
          plan->damage_transforms[index].apply != \null);

  predicate whc_valid_attack_damage{L}(struct attack_plan *plan) =
      whc_valid_attack_damage_values(plan) && whc_valid_attack_transforms(plan);

  predicate whc_valid_attack_plan{L}(struct attack_plan *plan) =
      whc_valid_attack_thresholds(plan) && whc_valid_attack_rerolls(plan) &&
      whc_valid_attack_damage(plan);
*/

/*@ assigns \nothing;
    ensures (\result == 0) <==> (a == 0 && b == 0);
    ensures a != 0 ==> \result <= a;
    ensures b != 0 ==> \result <= b;
    ensures \result != 0 ==> a % \result == 0 && b % \result == 0;
*/
uint64_t greatest_common_divisor(uint64_t a, uint64_t b);
/*@ requires \valid(value);
    assigns *value;
    ensures \result ==> value->denominator != 0;
*/
bool fraction_reduce(struct fraction *value);
/*@ requires \valid(result);
    assigns *result;
    ensures \result ==> result->denominator != 0;
*/
bool fraction_multiply(struct fraction left, struct fraction right, struct fraction *result);
/*@ requires \valid(result);
    assigns *result;
    ensures \result ==> result->denominator != 0;
*/
bool fraction_add(struct fraction left, struct fraction right, struct fraction *result);

/*@ assigns \nothing;
    ensures \result <==> whc_valid_dice_value(dice);
*/
bool dice_value_is_valid(struct dice_value dice);
/*@ requires \valid_read(distribution);
    assigns \nothing;
*/
bool distribution_is_valid(const struct distribution *distribution);
/*@ requires \valid(distribution);
    assigns *distribution;
    ensures distribution->minimum == 0 && distribution->maximum == 0;
    ensures distribution->total_ways == 0;
*/
void distribution_clear(struct distribution *distribution);
/*@ requires \valid(distribution);
    assigns *distribution;
    ensures \result ==> distribution->total_ways >= \old(distribution->total_ways);
*/
bool distribution_add_outcome(struct distribution *distribution, uint32_t outcome, uint64_t ways);
/*@ requires \valid(distribution);
    assigns *distribution;
    ensures \result ==> distribution->minimum <= distribution->maximum;
    ensures \result ==> distribution->maximum <= MAX_DISTRIBUTION_RESULT;
*/
bool distribution_reduce_weights(struct distribution *distribution);
/*@ requires \valid(result);
    assigns *result;
    ensures \result ==> result->minimum <= result->maximum;
    ensures \result ==> result->maximum <= MAX_DISTRIBUTION_RESULT;
*/
bool distribution_from_constant(uint32_t value, struct distribution *result);
/*@ requires \valid(result);
    assigns *result;
    ensures \result ==> result->minimum <= result->maximum;
    ensures \result ==> result->maximum <= MAX_DISTRIBUTION_RESULT;
*/
bool distribution_from_die(uint16_t sides, struct distribution *result);
/*@ requires \valid(result);
    assigns *result;
    ensures \result ==> result->minimum <= result->maximum;
    ensures \result ==> result->maximum <= MAX_DISTRIBUTION_RESULT;
*/
bool distribution_from_dice_value(struct dice_value dice, struct distribution *result);
/*@ requires \valid(result);
    assigns *result;
    ensures \result ==> whc_bounded_distribution(result);
    ensures \result ==> result->minimum >= minimum;
*/
bool distribution_from_modified_dice_value(struct dice_value dice, int32_t modifier,
                                           uint32_t minimum, struct distribution *result);
/*@ requires \valid_read(left) && \valid_read(right) && \valid(result);
    assigns *result;
    ensures \result ==> result->minimum <= result->maximum;
    ensures \result ==> result->maximum <= MAX_DISTRIBUTION_RESULT;
*/
bool distribution_convolve(const struct distribution *left, const struct distribution *right,
                           struct distribution *result);
/*@ requires \valid_read(source) && \valid(result);
    assigns *result;
    ensures \result ==> result->minimum <= result->maximum;
    ensures \result ==> result->maximum <= MAX_DISTRIBUTION_RESULT;
*/
bool distribution_shift(const struct distribution *source, uint32_t amount,
                        struct distribution *result);
/*@ requires \valid_read(distribution);
    assigns \nothing;
    ensures \result <= MAX_DISTRIBUTION_RESULT;
*/
uint32_t distribution_minimum(const struct distribution *distribution);
/*@ requires \valid_read(distribution);
    assigns \nothing;
    ensures \result <= MAX_DISTRIBUTION_RESULT;
*/
uint32_t distribution_maximum(const struct distribution *distribution);
/*@ requires \valid_read(distribution) && \valid(result);
    assigns *result;
    ensures \result ==> result->denominator != 0;
*/
bool distribution_mean(const struct distribution *distribution, struct fraction *result);
/*@ requires \valid_read(distribution) && \valid(result);
    assigns *result;
    ensures \result ==> *result <= MAX_DISTRIBUTION_RESULT;
*/
bool distribution_quantile(const struct distribution *distribution, uint64_t quantile_numerator,
                           uint64_t quantile_denominator, uint32_t *result);
/*@ requires \valid_read(distribution) && \valid(summary);
    assigns *summary;
    ensures \result ==> summary->minimum <= summary->first_quartile;
    ensures \result ==> summary->first_quartile <= summary->median;
    ensures \result ==> summary->median <= summary->third_quartile;
    ensures \result ==> summary->third_quartile <= summary->maximum;
*/
bool distribution_summarize(const struct distribution *distribution,
                            struct distribution_summary *summary);

/*@ requires \valid(distribution);
    assigns *distribution;
    ensures distribution->minimum == 0 && distribution->maximum == 0;
    ensures distribution->total_mass == 0;
*/
void probability_distribution_clear(struct probability_distribution *distribution);
#ifndef WHC_E_ACSL
/*@ requires \valid_read(distribution);
    assigns \nothing;
    ensures \result ==> whc_conserved_probability_distribution(distribution);
*/
#else
/*@ requires \valid_read(distribution);
    assigns \nothing;
    ensures \result ==> whc_normalized_probability_distribution(distribution);
*/
#endif
bool probability_distribution_is_normalized(const struct probability_distribution *distribution);
/*@ requires \valid_read(source) && \valid(result);
    assigns *result;
    ensures \result ==> whc_normalized_probability_distribution(result);
*/
bool probability_distribution_from_exact(const struct distribution *source,
                                         struct probability_distribution *result);
/*@ requires \valid_read(distribution) && \valid(result);
    assigns *result;
    ensures \result ==> result->denominator != 0;
*/
bool probability_distribution_mean(const struct probability_distribution *distribution,
                                   struct fraction *result);
/*@ requires \valid_read(distribution) && \valid(result);
    assigns *result;
    ensures \result ==> *result <= MAX_DISTRIBUTION_RESULT;
*/
bool probability_distribution_quantile(const struct probability_distribution *distribution,
                                       uint64_t quantile_numerator, uint64_t quantile_denominator,
                                       uint32_t *result);
/*@ requires \valid_read(distribution) && \valid(summary);
    assigns *summary;
    ensures \result ==> summary->minimum <= summary->first_quartile;
    ensures \result ==> summary->first_quartile <= summary->median;
    ensures \result ==> summary->median <= summary->third_quartile;
    ensures \result ==> summary->third_quartile <= summary->maximum;
*/
bool probability_distribution_summarize(const struct probability_distribution *distribution,
                                        struct distribution_summary *summary);

/*@ requires \valid(rules);
    assigns *rules;
    ensures rules->count == 0;
*/
void rule_set_clear(struct rule_set *rules);
/*@ requires \valid(rules);
    requires rules->count <= MAX_PROFILE_RULES;
    assigns *rules;
    ensures \result ==> rules->count == \old(rules->count) + 1;
    ensures !\result ==> rules->count == \old(rules->count);
*/
bool rule_set_add(struct rule_set *rules, attack_rule_compile_function compile,
                  union rule_payload payload);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_lethal_hits(struct rule_set *rules);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_devastating_wounds(struct rule_set *rules);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_twin_linked(struct rule_set *rules);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_reroll_failed_hits(struct rule_set *rules);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_reroll_failed_wounds(struct rule_set *rules);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_wounds_on(struct rule_set *rules, uint8_t target);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_critical_wounds_on(struct rule_set *rules, uint8_t target);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_hit_reroll_mask(struct rule_set *rules, uint8_t face_mask);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_wound_reroll_mask(struct rule_set *rules, uint8_t face_mask);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_hit_auto_fails_through(struct rule_set *rules, uint8_t face);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_sustained_hits(struct rule_set *rules, uint8_t additional_hits);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_sustained_hits_dice(struct rule_set *rules, struct dice_value additional_hits);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_torrent(struct rule_set *rules);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_hit_modifier(struct rule_set *rules, int8_t modifier);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_wound_modifier(struct rule_set *rules, int8_t modifier);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_wound_bonus(struct rule_set *rules, uint8_t bonus);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_cover(struct rule_set *rules);

#ifndef WHC_E_ACSL
/*@ requires \valid_read(plan);
    assigns \nothing;
    ensures \result ==> whc_valid_attack_thresholds(plan);
    ensures \result ==> whc_valid_attack_rerolls(plan);
    ensures \result ==> whc_valid_dice_value(plan->sustained_hits);
    ensures \result ==> plan->damage_divisor > 0 && plan->damage_floor <= 1;
    ensures \result ==> (plan->flags & ~0x3f) == 0;
    ensures \result ==> plan->damage_transform_count <= MAX_DAMAGE_TRANSFORMS;
    ensures \result ==> (\forall integer index;
        0 <= index < plan->damage_transform_count ==>
            plan->damage_transforms[index].apply != \null);
*/
#else
/*@ requires \valid_read(plan);
    assigns \nothing;
    ensures \result ==> whc_valid_attack_thresholds(plan);
    ensures \result ==> whc_valid_attack_rerolls(plan);
    ensures \result ==> whc_valid_dice_value(plan->sustained_hits);
    ensures \result ==> plan->damage_divisor > 0 && plan->damage_floor <= 1;
    ensures \result ==> (plan->flags & ~0x3f) == 0;
    ensures \result ==> plan->damage_transform_count <= MAX_DAMAGE_TRANSFORMS;
*/
#endif
bool attack_plan_is_valid(const struct attack_plan *plan);
/*@ requires \valid(plan);
    assigns *plan;
    ensures \result ==> plan->damage_transform_count == \old(plan->damage_transform_count) + 1;
*/
bool attack_plan_add_damage_transform(struct attack_plan *plan, damage_transform_function transform,
                                      union rule_payload payload);
/*@ requires \valid_read(source) && \valid(result);
    assigns *result;
    ensures \result ==> result->characteristic_modifier_roll_flags == 0;
    ensures \result ==> result->characteristic_modifier_roll.dice_count == 0;
    ensures \result ==> result->characteristic_modifier_roll.dice_sides == 0;
    ensures \result ==> result->characteristic_modifier_roll.modifier == 0;
    ensures \result ==> result->characteristic_modifier_roll_group == 0;
*/
bool weapon_profile_resolve_characteristic_roll(const struct weapon_profile *source,
                                                uint16_t outcome, struct weapon_profile *result);
#ifndef WHC_E_ACSL
/*@ requires \valid_read(weapon) && \valid_read(target) && \valid(plan);
    assigns *plan;
    ensures \result ==> whc_valid_attack_thresholds(plan);
    ensures \result ==> whc_valid_attack_rerolls(plan);
    ensures \result ==> whc_valid_dice_value(plan->sustained_hits);
    ensures \result ==> plan->damage_divisor > 0 && plan->damage_floor <= 1;
    ensures \result ==> (plan->flags & ~0x3f) == 0;
    ensures \result ==> plan->damage_transform_count <= MAX_DAMAGE_TRANSFORMS;
    ensures \result ==> (\forall integer index;
        0 <= index < plan->damage_transform_count ==>
            plan->damage_transforms[index].apply != \null);
*/
#else
/*@ requires \valid_read(weapon) && \valid_read(target) && \valid(plan);
    assigns *plan;
    ensures \result ==> whc_valid_attack_thresholds(plan);
    ensures \result ==> whc_valid_attack_rerolls(plan);
    ensures \result ==> whc_valid_dice_value(plan->sustained_hits);
    ensures \result ==> plan->damage_divisor > 0 && plan->damage_floor <= 1;
    ensures \result ==> (plan->flags & ~0x3f) == 0;
    ensures \result ==> plan->damage_transform_count <= MAX_DAMAGE_TRANSFORMS;
*/
#endif
bool attack_plan_build(const struct weapon_profile *weapon, const struct target_profile *target,
                       struct attack_plan *plan);

/*@ requires strength > 0 && toughness > 0;
    assigns \nothing;
    ensures 2 <= \result && \result <= 6;
    ensures \result == whc_wound_threshold(strength, toughness);
*/
uint8_t wounds_on(uint16_t strength, uint16_t toughness);
/*@ requires 2 <= succeeds_on && succeeds_on <= 6;
    assigns \nothing;
    ensures 2 <= \result && \result <= 6;
    ensures modifier > 0 ==> \result <= succeeds_on;
    ensures modifier < 0 ==> \result >= succeeds_on;
    ensures modifier == 0 ==> \result == succeeds_on;
    ensures \result == whc_modified_roll_threshold(succeeds_on, modifier);
*/
uint8_t modified_roll_threshold(uint8_t succeeds_on, int16_t modifier);
/*@ requires 2 <= save && save <= 7;
    requires invulnerable_save == 0 || (2 <= invulnerable_save && invulnerable_save <= 6);
    assigns \nothing;
    ensures 2 <= \result && \result <= 7;
    ensures \result == whc_save_threshold(save, invulnerable_save, ap);
    ensures invulnerable_save != 0 ==> \result <= invulnerable_save;
*/
uint8_t saves_on(uint8_t save, uint8_t invulnerable_save, uint16_t ap);
/*@ requires 2 <= save && save <= 7;
    requires invulnerable_save == 0 || (2 <= invulnerable_save && invulnerable_save <= 6);
    assigns \nothing;
    ensures 2 <= \result && \result <= 7;
    ensures \result == whc_cover_save_threshold(save, invulnerable_save, ap);
    ensures invulnerable_save != 0 ==> \result <= invulnerable_save;
*/
uint8_t saves_on_with_cover(uint8_t save, uint8_t invulnerable_save, uint16_t ap);

/*@ requires face <= 6;
    requires succeeds_on <= 7;
    requires critical_on <= 6;
    requires auto_fails_through <= 6;
    assigns \nothing;
    ensures face <= auto_fails_through ==> !\result;
    ensures face > auto_fails_through ==>
        (\result <==> ((critical_on >= 2 && face >= critical_on) ||
                       (succeeds_on <= 6 && face >= succeeds_on)));
*/
bool attack_roll_succeeds(uint8_t face, uint8_t succeeds_on, uint8_t critical_on,
                          uint8_t auto_fails_through);

/*@ requires wounds_per_model > 0 && model_count > 0;
    requires applied_damage <= (uint64_t)wounds_per_model * model_count;
    assigns \nothing;
    ensures \result >= applied_damage;
    ensures \result <= applied_damage + incoming_damage;
    ensures \result <= applied_damage + wounds_per_model;
    ensures \result <= (uint64_t)wounds_per_model * model_count;
*/
uint32_t allocate_damage_to_unit(uint32_t applied_damage, uint32_t incoming_damage,
                                 uint16_t wounds_per_model, uint16_t model_count);

/*@ requires whc_valid_target_unit_layout(layout);
    assigns \nothing;
    ensures \result == whc_target_capacity(layout);
*/
uint32_t target_unit_capacity(const struct target_unit_layout *layout);

/*@ requires whc_valid_target_unit_layout(layout);
    requires applied_damage <= whc_target_capacity(layout);
    assigns \nothing;
    ensures \result >= applied_damage;
    ensures \result <= applied_damage + incoming_damage;
    ensures \result <= whc_target_capacity(layout);
*/
uint32_t allocate_damage_to_target_unit(const struct target_unit_layout *layout,
                                        uint32_t applied_damage, uint32_t incoming_damage);

/*@ requires \valid_read(weapon);
    requires \valid_read(targets + (0 .. layout->segment_count - 1));
    requires whc_valid_target_unit_layout(layout);
    requires \valid_read(current) && \valid(workspace) && \valid(result);
    assigns *workspace, *result;
    ensures \result ==> whc_normalized_probability_distribution(result);
*/
bool advance_weapon_applied_damage_distribution(const struct weapon_profile *weapon,
                                                const struct target_profile *targets,
                                                const struct target_unit_layout *layout,
                                                const struct probability_distribution *current,
                                                struct calculator_workspace *workspace,
                                                struct probability_distribution *result);

/*@ requires 1 <= weapon_count && weapon_count <= MAX_VOLLEY_WEAPONS;
    requires \valid_read(weapons + (0 .. weapon_count - 1));
    requires whc_valid_target_unit_layout(layout);
    requires \valid_read(targets + (0 .. weapon_count * layout->segment_count - 1));
    requires \valid(result);
    assigns *result;
    ensures \result ==> result->state_limit == MAX_EXACT_DEFERRED_STATES;
    ensures \result ==> result->target_capacity == whc_target_capacity(layout);
    ensures \result ==> result->estimated_state_upper_bound >= 1;
    ensures \result ==> result->exact_guaranteed_by_bound ==>
        result->estimated_state_upper_bound <= result->state_limit;
*/
bool estimate_ordered_volley_complexity(const struct weapon_profile *weapons,
                                        const struct target_profile *targets, uint16_t weapon_count,
                                        const struct target_unit_layout *layout,
                                        struct exact_complexity *result);

/*@ requires 1 <= weapon_count && weapon_count <= MAX_VOLLEY_WEAPONS;
    requires \valid_read(weapons + (0 .. weapon_count - 1));
    requires whc_valid_target_unit_layout(layout);
    requires \valid_read(targets + (0 .. weapon_count * layout->segment_count - 1));
    requires \valid(workspace) && \valid(result);
    requires \valid(cumulative_means + (0 .. weapon_count - 1));
    assigns *workspace, *result, cumulative_means[0 .. weapon_count - 1];
    ensures \result ==> whc_normalized_probability_distribution(result);
    ensures \result ==> (\forall integer index; 0 <= index < weapon_count ==>
        cumulative_means[index].denominator != 0);
*/
bool calculate_ordered_volley_applied_damage_distribution(const struct weapon_profile *weapons,
                                                          const struct target_profile *targets,
                                                          uint16_t weapon_count,
                                                          const struct target_unit_layout *layout,
                                                          struct calculator_workspace *workspace,
                                                          struct probability_distribution *result,
                                                          struct fraction *cumulative_means);

/*@ requires \valid_read(weapon) && \valid_read(target);
    requires \valid(workspace) && \valid(result);
    assigns *workspace, *result;
    ensures \result ==> whc_normalized_probability_distribution(result);
*/
bool calculate_attack_damage_distribution(const struct weapon_profile *weapon,
                                          const struct target_profile *target,
                                          struct calculator_workspace *workspace,
                                          struct probability_distribution *result);

/*@ requires \valid_read(weapon) && \valid_read(target);
    requires target_models > 0;
    requires \valid(workspace) && \valid(result);
    assigns *workspace, *result;
    ensures \result ==> whc_normalized_probability_distribution(result);
*/
bool calculate_attack_applied_damage_distribution(const struct weapon_profile *weapon,
                                                  const struct target_profile *target,
                                                  uint16_t target_models,
                                                  struct calculator_workspace *workspace,
                                                  struct probability_distribution *result);

/*@ requires \valid_read(weapon) && \valid_read(target);
    requires \valid(workspace) && \valid(result);
    assigns *workspace, *result;
    ensures \result ==> result->denominator != 0;
*/
bool calculate_attack_expected_damage(const struct weapon_profile *weapon,
                                      const struct target_profile *target,
                                      struct calculator_workspace *workspace,
                                      struct fraction *result);

/*@ requires \valid_read(weapon) && \valid_read(target);
    requires \valid(workspace) && \valid(summary);
    requires \separated(workspace, summary, weapon, target);
    assigns *workspace, *summary;
    ensures \result ==> summary->minimum <= summary->first_quartile;
    ensures \result ==> summary->first_quartile <= summary->median;
    ensures \result ==> summary->median <= summary->third_quartile;
    ensures \result ==> summary->third_quartile <= summary->maximum;
*/
bool calculate_attack_damage_summary(const struct weapon_profile *weapon,
                                     const struct target_profile *target,
                                     struct calculator_workspace *workspace,
                                     struct distribution_summary *summary);

/*@ requires \valid_read(weapon) && \valid_read(target);
    requires target_models > 0;
    requires \valid(workspace) && \valid(summary);
    requires \separated(workspace, summary, weapon, target);
    assigns *workspace, *summary;
    ensures \result ==> summary->minimum <= summary->first_quartile;
    ensures \result ==> summary->first_quartile <= summary->median;
    ensures \result ==> summary->median <= summary->third_quartile;
    ensures \result ==> summary->third_quartile <= summary->maximum;
*/
bool calculate_attack_applied_damage_summary(const struct weapon_profile *weapon,
                                             const struct target_profile *target,
                                             uint16_t target_models,
                                             struct calculator_workspace *workspace,
                                             struct distribution_summary *summary);

#endif
