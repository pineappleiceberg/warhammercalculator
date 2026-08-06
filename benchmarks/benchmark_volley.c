#include "warhammercalculator/web_api.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

struct benchmark_case {
    const char *name;
    struct whc_web_weapon_input weapons[MAX_VOLLEY_WEAPONS];
    struct whc_web_target_input targets[MAX_TARGET_SEGMENTS];
    uint16_t weapon_count;
    uint16_t target_count;
};

static double milliseconds(clock_t start, clock_t finish) {
    return (double)(finish - start) * 1000.0 / (double)CLOCKS_PER_SEC;
}

static void set_weapon(struct whc_web_weapon_input *weapon, uint32_t attacks, uint32_t weapon_count,
                       uint32_t damage, uint32_t rule_flags) {
    memset(weapon, 0, sizeof(*weapon));
    weapon->attack_modifier = attacks;
    weapon->weapon_count = weapon_count;
    weapon->hits_on = 3u;
    weapon->strength = 8u;
    weapon->ap = 2u;
    weapon->damage_modifier = damage;
    weapon->critical_hits_on = 6u;
    weapon->critical_wounds_on = 6u;
    weapon->rule_flags = rule_flags;
}

static void dense_case(struct benchmark_case *benchmark) {
    memset(benchmark, 0, sizeof(*benchmark));
    benchmark->name = "dense_80_attacks";
    benchmark->weapon_count = 1u;
    benchmark->target_count = 1u;
    set_weapon(&benchmark->weapons[0], 80u, 1u, 3u, WHC_RULE_LETHAL_HITS | WHC_RULE_TWIN_LINKED);
    benchmark->targets[0] = (struct whc_web_target_input){
        .toughness = 10u,
        .save = 3u,
        .invulnerable_save = 5u,
        .feel_no_pain = 5u,
        .wounds = 3u,
        .model_count = 100u,
    };
}

static void mixed_case(struct benchmark_case *benchmark) {
    uint16_t index = 0u;
    memset(benchmark, 0, sizeof(*benchmark));
    benchmark->name = "mixed_32_weapon_16_target";
    benchmark->weapon_count = MAX_VOLLEY_WEAPONS;
    benchmark->target_count = MAX_TARGET_SEGMENTS;
    while (index < benchmark->weapon_count) {
        uint32_t flags = (index % 2u == 0u ? WHC_RULE_TWIN_LINKED : 0u) |
                         (index % 3u == 0u ? WHC_RULE_LETHAL_HITS : 0u) |
                         (index % 5u == 0u ? WHC_RULE_DEVASTATING_WOUNDS : 0u);
        set_weapon(&benchmark->weapons[index], 4u + index % 3u, 1u, 2u + index % 2u, flags);
        index++;
    }
    index = 0u;
    while (index < benchmark->target_count) {
        benchmark->targets[index] = (struct whc_web_target_input){
            .toughness = 6u + index % 7u,
            .save = 2u + index % 3u,
            .invulnerable_save = index % 2u == 0u ? 5u : 0u,
            .feel_no_pain = index % 4u == 0u ? 6u : 0u,
            .wounds = 2u + index % 4u,
            .damage_reduction = index % 5u == 0u ? 1u : 0u,
            .model_count = 2u,
        };
        index++;
    }
}

static bool run_case(const struct benchmark_case *benchmark, uint32_t iterations, double maximum_ms,
                     double *elapsed_ms, uint64_t *checksum) {
    struct whc_web_applied_summary summary;
    struct whc_web_mean means[MAX_VOLLEY_WEAPONS];
    clock_t start = clock();
    uint32_t iteration = 0u;

    while (iteration < iterations) {
        if (!whc_calculate_ordered_volley_summary(benchmark->weapons, benchmark->weapon_count,
                                                  benchmark->targets, benchmark->target_count, 0u,
                                                  &summary, means)) {
            return false;
        }
        *checksum += summary.mean_numerator_low;
        *checksum += summary.mean_numerator_high;
        *checksum += summary.mean_denominator_low;
        *checksum += summary.maximum;
        iteration++;
    }
    *elapsed_ms = milliseconds(start, clock());
    return *elapsed_ms <= maximum_ms * iterations;
}

int main(int argc, char **argv) {
    struct benchmark_case cases[2];
    uint32_t iterations = 5u;
    double maximum_ms = 10000.0;
    uint16_t index = 0u;
    uint64_t checksum = 0u;
    bool checksum_matches = false;

    if (argc > 1) {
        unsigned long parsed = strtoul(argv[1], NULL, 10);
        if (parsed == 0ul || parsed > UINT32_MAX) {
            return 2;
        }
        iterations = (uint32_t)parsed;
    }
    if (argc > 2) {
        maximum_ms = strtod(argv[2], NULL);
        if (maximum_ms <= 0.0) {
            return 2;
        }
    }

    dense_case(&cases[0]);
    mixed_case(&cases[1]);
    printf("{\"schemaVersion\":1,\"iterations\":%" PRIu32 ",\"cases\":[", iterations);
    while (index < 2u) {
        double elapsed_ms = 0.0;
        bool passed = run_case(&cases[index], iterations, maximum_ms, &elapsed_ms, &checksum);
        printf("%s{\"name\":\"%s\",\"totalMs\":%.3f,\"millisecondsPerIteration\":%.3f,"
               "\"withinLimit\":%s}",
               index == 0u ? "" : ",", cases[index].name, elapsed_ms, elapsed_ms / iterations,
               passed ? "true" : "false");
        if (!passed) {
            printf("],\"checksum\":%" PRIu64 "}\n", checksum);
            return 1;
        }
        index++;
    }
    checksum_matches = checksum == UINT64_C(9789938449) * iterations;
    printf("],\"checksum\":%" PRIu64 ",\"checksumMatches\":%s}\n", checksum,
           checksum_matches ? "true" : "false");
    return checksum_matches ? 0 : 1;
}
