#ifndef WARHAMMERCALCULATOR_CALCULATOR_H
#define WARHAMMERCALCULATOR_CALCULATOR_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define NAME_LENGTH 128u
#define MAX_DISTRIBUTION_RESULT 1024u
#define MAX_PROFILE_RULES 8u
#define MAX_DAMAGE_TRANSFORMS 4u

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

    uint8_t hit_reroll_mask;
    uint8_t wound_reroll_mask;
    uint8_t save_reroll_mask;

    uint16_t damage_reduction;
    uint16_t damage_floor;
    uint8_t sustained_hits;
    uint32_t flags;

    struct damage_transform_entry damage_transforms[MAX_DAMAGE_TRANSFORMS];
    uint8_t damage_transform_count;
};

struct weapon_profile {
    char name[NAME_LENGTH];
    struct dice_value attacks;
    uint8_t hits_on;
    uint16_t strength;
    uint16_t ap;
    struct dice_value damage;
    uint8_t critical_hits_on;
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
    struct rule_set rules;
};

struct calculator_workspace {
    struct distribution exact_a;
    struct distribution exact_b;

    struct probability_distribution probability_a;
    struct probability_distribution probability_b;
    struct probability_distribution probability_c;
    struct probability_distribution probability_d;

    uint64_t convolution_accumulator[MAX_DISTRIBUTION_RESULT + 1u];
    uint64_t mixture_accumulator[MAX_DISTRIBUTION_RESULT + 1u];
};

/*@
  logic integer whc_min(integer left, integer right) = left < right ? left : right;
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
      whc_valid_dice_value(weapon->damage) &&
      2 <= weapon->hits_on && weapon->hits_on <= 6 && weapon->strength > 0 &&
      whc_valid_rule_set(&weapon->rules);

  predicate whc_valid_target_profile{L}(struct target_profile *target) =
      \valid_read(target) && target->toughness > 0 &&
      2 <= target->save && target->save <= 7 &&
      (target->invulnerable_save == 0 ||
       (2 <= target->invulnerable_save && target->invulnerable_save <= 6)) &&
      (target->feel_no_pain == 0 ||
       (2 <= target->feel_no_pain && target->feel_no_pain <= 6)) &&
      whc_valid_rule_set(&target->rules);

  predicate whc_valid_attack_plan{L}(struct attack_plan *plan) =
      \valid_read(plan) && 2 <= plan->hits_on && plan->hits_on <= 6 &&
      2 <= plan->wounds_on && plan->wounds_on <= 6 &&
      2 <= plan->saves_on && plan->saves_on <= 7 &&
      plan->damage_transform_count <= MAX_DAMAGE_TRANSFORMS;
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

/*@ assigns \nothing; */
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
bool rule_add_wounds_on(struct rule_set *rules, uint8_t target);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_critical_wounds_on(struct rule_set *rules, uint8_t target);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_hit_reroll_mask(struct rule_set *rules, uint8_t face_mask);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_wound_reroll_mask(struct rule_set *rules, uint8_t face_mask);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_sustained_hits(struct rule_set *rules, uint8_t additional_hits);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_torrent(struct rule_set *rules);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_wound_bonus(struct rule_set *rules, uint8_t bonus);
/*@ requires \valid(rules); assigns *rules; */
bool rule_add_cover(struct rule_set *rules);

/*@ requires \valid(plan);
    assigns *plan;
    ensures \result ==> plan->damage_transform_count == \old(plan->damage_transform_count) + 1;
*/
bool attack_plan_add_damage_transform(struct attack_plan *plan, damage_transform_function transform,
                                      union rule_payload payload);
/*@ requires \valid_read(weapon) && \valid_read(target) && \valid(plan);
    assigns *plan;
    ensures \result ==> (2 <= plan->hits_on && plan->hits_on <= 6);
    ensures \result ==> (2 <= plan->wounds_on && plan->wounds_on <= 6);
    ensures \result ==> (2 <= plan->saves_on && plan->saves_on <= 7);
*/
bool attack_plan_build(const struct weapon_profile *weapon, const struct target_profile *target,
                       struct attack_plan *plan);

/*@ requires strength > 0 && toughness > 0;
    assigns \nothing;
    ensures 2 <= \result && \result <= 6;
    ensures \result == whc_wound_threshold(strength, toughness);
*/
uint8_t wounds_on(uint16_t strength, uint16_t toughness);
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
