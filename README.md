# Warhammer fixed-memory damage calculator core

[Use the hosted calculator](https://amrishhallberg.com/warhammercalculator/)

This implementation is C17, performs no dynamic allocation, and keeps all
large scratch storage in a caller-owned `struct calculator_workspace`.

## Authorship and AI disclosure

The base C calculator code is written and owned by the repository owner. The
website and supporting project scaffolding were generated and refined with AI
assistance. This is an unofficial fan-made utility and is not affiliated with
or endorsed by Games Workshop.

## Why there are two distribution types

`struct distribution` stores exact integer outcome counts. It is ideal for
small dice expressions such as `2D6+3`, but repeated attack probabilities make
exact denominators grow exponentially and eventually overflow `uint64_t`.

`struct probability_distribution` stores Q31 fixed-point probability mass:

```text
0.0  -> 0
1.0  -> 2^31
```

The full combat distribution uses Q31 integers, not `float` or `double`.
Quartiles therefore remain fixed-memory and fast. The public
`calculate_attack_expected_damage()` function separately calculates the mean
as an exact reduced fraction.

## Fixed memory

With `MAX_DISTRIBUTION_RESULT == 1024`, the calculator workspace is about
49 KiB on a typical 64-bit build. Allocate it once and reuse it:

```c
static struct calculator_workspace workspace;
```

Do not put a new workspace inside a deeply recursive function.

## Basic usage

```c
#include "warhammercalculator/calculator.h"

#include <stdio.h>
#include <string.h>

int main(void)
{
    struct weapon_profile weapon = {0};
    struct target_profile target = {0};
    struct calculator_workspace workspace;
    struct distribution_summary summary;

    strcpy(weapon.name, "Example weapon");
    weapon.attacks = (struct dice_value){ .modifier = 4 };
    weapon.hits_on = 3;
    weapon.strength = 8;
    weapon.ap = 2;
    weapon.damage = (struct dice_value){
        .dice_count = 1,
        .dice_sides = 6,
        .modifier = 1
    };
    weapon.critical_hits_on = 6;

    strcpy(target.name, "Example target");
    target.toughness = 8;
    target.save = 3;
    target.invulnerable_save = 5;
    target.feel_no_pain = 0;
    target.wounds = 12;
    target.reduction = 0;

    rule_add_lethal_hits(&weapon.rules);
    rule_add_twin_linked(&weapon.rules);

    if (!calculate_attack_damage_summary(
            &weapon,
            &target,
            &workspace,
            &summary)) {
        return 1;
    }

    printf("min: %u\n", summary.minimum);
    printf("Q1: %u\n", summary.first_quartile);
    printf("median: %u\n", summary.median);
    printf("Q3: %u\n", summary.third_quartile);
    printf("max: %u\n", summary.maximum);
    printf("mean: %llu/%llu\n",
        (unsigned long long)summary.mean.numerator,
        (unsigned long long)summary.mean.denominator);

    return 0;
}
```

## Built-in rules

The current convenience functions are:

```c
rule_add_lethal_hits(&weapon.rules);
rule_add_devastating_wounds(&weapon.rules);
rule_add_twin_linked(&weapon.rules);
rule_add_reroll_failed_hits(&weapon.rules);
rule_add_sustained_hits(&weapon.rules, 1);
rule_add_sustained_hits_dice(
    &weapon.rules,
    (struct dice_value){ .dice_count = 1, .dice_sides = 3 }
);
rule_add_torrent(&weapon.rules);
rule_add_wound_bonus(&weapon.rules, 1);
rule_add_cover(&target.rules);
rule_add_wounds_on(&weapon.rules, 4);
rule_add_critical_wounds_on(&weapon.rules, 4);
```

The devastating-wounds convenience rule currently compiles to "critical
wounds bypass the save." Edition-specific wording can be isolated by changing
that one rule compiler rather than rewriting the probability engine.

## Why the rules are fast

A rule callback is not invoked for every hit, wound, or save path. Each rule is
called once by `attack_plan_build()`. It modifies a compact `struct
attack_plan` containing thresholds, bit flags, and reroll face masks. The hot
loops use only that compiled plan.

This gives the extensibility of plugins without putting a function-pointer
call into every innermost dice loop.

## Adding a custom compile-time rule

A plugin receives a fixed-size payload and changes the attack plan once:

```c
static bool compile_damage_floor(
    struct attack_plan *plan,
    const struct weapon_profile *weapon,
    const struct target_profile *target,
    const union rule_payload *payload
) {
    (void)weapon;
    (void)target;

    if (plan == NULL || payload == NULL) {
        return false;
    }

    plan->damage_floor = payload->u16[0];
    return true;
}
```

Register it without allocating memory:

```c
union rule_payload payload = {0};
payload.u16[0] = 0;

rule_set_add(&weapon.rules, compile_damage_floor, payload);
```

For a rule that transforms each possible damage result, a compiler can call
`attack_plan_add_damage_transform()`. Those transforms run once per distinct
damage outcome, not once per complete hit/wound/save path.

## Build and test with CMake

```sh
cmake --preset native-debug
cmake --build --preset native-debug
ctest --preset native-debug
```

The supplied Makefile is also supported:

```sh
make test
```

The included tests cover exact dice distributions, quartiles, ordinary attack
resolution, random attacks/damage, Feel No Pain, and several compiled rules.

## Formal verification

The C API and internal helpers have ACSL contracts. Frama-C 31 with Alt-Ergo
proves the save/AP/cover model and its relational properties, Eva checks the
formal runtime harness for undefined behavior, and E-ACSL executes instrumented
contracts across bounded save profiles.

With Frama-C, Alt-Ergo, E-ACSL, and `jq` available:

```sh
bash scripts/run_formal.sh all
```

Individual CMake targets are also available when the tools are found:

```sh
cmake --build build --target formal-parse
cmake --build build --target formal-wp
cmake --build build --target formal-eva
cmake --build build --target formal-e-acsl
```

The web test suite exhaustively compares the JavaScript and WebAssembly wound,
armour, AP, invulnerable-save, and cover thresholds over their supported small
domains. It also checks expected-damage monotonicity for AP, armour, Feel No
Pain, invulnerable saves, and cover. Profile selection applies Anti abilities
only when the selected target has the matching datasheet keyword. Damage
allocation is exhaustively compared between C and JavaScript across model
wound counts, unit sizes, prior damage states, and incoming damage values.
Indirect Fire applies its hit modifier and cover normally, forces unmodified Hit
rolls of 1–3 to fail before critical-hit processing, and rejects Torrent attacks
when no target model is visible.

The checked profile-data suite also verifies conservative structured wargear
constraints. Fixed limits, per-model allowances, and rules such as "for every 5
models" are exposed to the web editor and API with their original source text.
Total equipped counts remain independent and editable; option-selected counts
produce warnings that can be acknowledged for casualties or narrative rules.

## WebAssembly build

Activate an Emscripten SDK environment, then run:

```sh
emcmake cmake -S . -B build/wasm -G Ninja -DBUILD_TESTING=OFF
cmake --build build/wasm
```

This produces `calculator.js` and `calculator.wasm` in `build/wasm/`.

## Current boundaries

- AP is stored as a nonnegative magnitude.
- One reroll is modeled; rerolled dice are not rerolled again.
- Total damage outcomes above `MAX_DISTRIBUTION_RESULT` are rejected rather
  than silently truncated.
- Damage reduction uses a default floor of 1 for positive damage. A custom rule
  can change the floor.
- The original damage distribution reports uncapped potential damage. The
  applied-damage distribution separately allocates each attack to one model,
  loses ordinary excess damage, and caps results at the target unit's wounds.
- Applied-damage means are derived from the Q31 probability distribution;
  uncapped expected damage remains an exact reduced fraction.
- Target units currently use one wound characteristic for every model. Mixed
  profiles and sequential allocation across several weapon profiles require a
  caller to choose the attack order.

## 10th edition profile database

The generated SQLite database at `data/warhammer_10e.sqlite` contains attacker,
weapon, and target profiles sourced from Wahapedia's structured 10th-edition
exports. See `data/README.md` for the schema overview and rebuild command.
