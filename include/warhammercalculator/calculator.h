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

uint64_t greatest_common_divisor(uint64_t a, uint64_t b);
bool fraction_reduce(struct fraction *value);
bool fraction_multiply(struct fraction left, struct fraction right, struct fraction *result);
bool fraction_add(struct fraction left, struct fraction right, struct fraction *result);

bool dice_value_is_valid(struct dice_value dice);
bool distribution_is_valid(const struct distribution *distribution);
void distribution_clear(struct distribution *distribution);
bool distribution_add_outcome(struct distribution *distribution, uint32_t outcome, uint64_t ways);
bool distribution_reduce_weights(struct distribution *distribution);
bool distribution_from_constant(uint32_t value, struct distribution *result);
bool distribution_from_die(uint16_t sides, struct distribution *result);
bool distribution_from_dice_value(struct dice_value dice, struct distribution *result);
bool distribution_convolve(const struct distribution *left, const struct distribution *right,
                           struct distribution *result);
bool distribution_shift(const struct distribution *source, uint32_t amount,
                        struct distribution *result);
uint32_t distribution_minimum(const struct distribution *distribution);
uint32_t distribution_maximum(const struct distribution *distribution);
bool distribution_mean(const struct distribution *distribution, struct fraction *result);
bool distribution_quantile(const struct distribution *distribution, uint64_t quantile_numerator,
                           uint64_t quantile_denominator, uint32_t *result);
bool distribution_summarize(const struct distribution *distribution,
                            struct distribution_summary *summary);

void probability_distribution_clear(struct probability_distribution *distribution);
bool probability_distribution_from_exact(const struct distribution *source,
                                         struct probability_distribution *result);
bool probability_distribution_mean(const struct probability_distribution *distribution,
                                   struct fraction *result);
bool probability_distribution_quantile(const struct probability_distribution *distribution,
                                       uint64_t quantile_numerator, uint64_t quantile_denominator,
                                       uint32_t *result);
bool probability_distribution_summarize(const struct probability_distribution *distribution,
                                        struct distribution_summary *summary);

void rule_set_clear(struct rule_set *rules);
bool rule_set_add(struct rule_set *rules, attack_rule_compile_function compile,
                  union rule_payload payload);
bool rule_add_lethal_hits(struct rule_set *rules);
bool rule_add_devastating_wounds(struct rule_set *rules);
bool rule_add_twin_linked(struct rule_set *rules);
bool rule_add_reroll_failed_hits(struct rule_set *rules);
bool rule_add_wounds_on(struct rule_set *rules, uint8_t target);
bool rule_add_critical_wounds_on(struct rule_set *rules, uint8_t target);
bool rule_add_hit_reroll_mask(struct rule_set *rules, uint8_t face_mask);
bool rule_add_wound_reroll_mask(struct rule_set *rules, uint8_t face_mask);
bool rule_add_sustained_hits(struct rule_set *rules, uint8_t additional_hits);
bool rule_add_torrent(struct rule_set *rules);
bool rule_add_wound_bonus(struct rule_set *rules, uint8_t bonus);
bool rule_add_cover(struct rule_set *rules);

bool attack_plan_add_damage_transform(struct attack_plan *plan, damage_transform_function transform,
                                      union rule_payload payload);
bool attack_plan_build(const struct weapon_profile *weapon, const struct target_profile *target,
                       struct attack_plan *plan);

uint8_t wounds_on(uint16_t strength, uint16_t toughness);
uint8_t saves_on(uint8_t save, uint8_t invulnerable_save, uint16_t ap);

bool calculate_attack_damage_distribution(const struct weapon_profile *weapon,
                                          const struct target_profile *target,
                                          struct calculator_workspace *workspace,
                                          struct probability_distribution *result);

bool calculate_attack_expected_damage(const struct weapon_profile *weapon,
                                      const struct target_profile *target,
                                      struct calculator_workspace *workspace,
                                      struct fraction *result);

bool calculate_attack_damage_summary(const struct weapon_profile *weapon,
                                     const struct target_profile *target,
                                     struct calculator_workspace *workspace,
                                     struct distribution_summary *summary);

#endif
