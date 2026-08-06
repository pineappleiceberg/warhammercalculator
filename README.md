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
121 KiB on a typical 64-bit build. Allocate it once and reuse it:

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
Deterministically generated property tests also exercise 5,000 dice profiles,
10,000 damage allocations, and 300 bounded combat profiles on every native
test run. They check normalized probability mass, ordered quantiles, allocation
bounds, AP monotonicity, and defensive-rule monotonicity.

Clang builds can additionally run the libFuzzer harness under AddressSanitizer
and UndefinedBehaviorSanitizer:

```sh
CC=clang cmake -S . -B build/fuzz -G Ninja \
  -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON -DWHC_BUILD_FUZZER=ON
cmake --build build/fuzz --target warhammercalculator_fuzz
ctest --test-dir build/fuzz -R warhammercalculator_fuzz_smoke --output-on-failure
```

CI runs a reproducible, bounded 2,000-input fuzz campaign. The API suite independently
generates valid combat profiles to check result invariants and sends malformed
typed fields through the calculation, volley, and seeded-simulation routes.
Explicit `null` profile fields are rejected rather than silently replaced by
defaults; omitted fields continue to use the documented defaults.

The generated profile catalogue also preserves named unit-composition models
and source-backed default-loadout formulas. Unit editors therefore start mixed
units with the correct weapon totals for their selected size while keeping
every total editable for casualties, unusual rules, and custom play states.

## Formal verification

The C API and internal helpers have ACSL contracts. Frama-C 31 with Alt-Ergo
proves the save/AP/cover model, damage-allocation bounds, dice validity,
attack-plan invariants, and actual Q31 probability-mass conservation. Eva
checks the formal runtime harness for undefined behavior, while E-ACSL executes
instrumented contracts and deliberate invalid-plan and corrupted-distribution
checks. Public probability summaries reject distributions whose bins do not
sum to the declared mass or contain mass outside their stated support.

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
Ordered volley tests additionally cover mixed target profiles, existing wounds,
weapon-order-dependent casualties, per-profile cumulative means, and ordinary
damage that cannot spill between models. The same ordered target state drives
the cryptographically random full-volley resolver and its API. Unit vs Unit can
also repeat the complete ordered volley from a user-visible 32-bit seed. Its
versioned `xoshiro128ss-v1` stream produces replayable phase statistics,
including damage variance, quartiles, zero-damage and unit-destruction chances,
mean roll-stage counts, and a complete applied-damage histogram. Live rolls
continue to use the system cryptographic random source. The equivalent API is
`POST /api/v1/volley/simulate`, with `profiles`, `targets`, `seed`, `trials`,
and optional `initialWoundsLost` fields.
Indirect Fire applies its hit modifier and cover normally, forces unmodified Hit
rolls of 1–3 to fail before critical-hit processing, and rejects Torrent attacks
when no target model is visible.

Army lists remain authoritative in D1 when the hosted API is available and keep
a validated device copy for offline use and the static GitHub Pages build. Newer
offline edits synchronize on reconnect, while deletion tombstones prevent removed
lists from reappearing. The list screen can export and import a versioned JSON
backup that includes the profile-source timestamp. Imports preserve list IDs and
update matching records. Unfinished list drafts and Play Mode selections,
overrides, and attack history recover automatically on the current device.

The checked profile-data suite also verifies conservative structured wargear
constraints. Fixed limits, per-model allowances, and rules such as "for every 5
models" are exposed to the web editor and API with their original source text.
Total equipped counts remain independent and editable; option-selected counts
produce warnings that can be acknowledged for casualties or narrative rules.
Shared source allowances are represented as choice pools, and compound
alternatives retain every tracked weapon in the bundle. Unit editors, saved
lists, and `POST /api/v1/validate-loadout` accept per-alternative selections,
derive the resulting weapon counts, and flag a combined pool only once.
Published starting equipment now pre-fills those editable counts and scales
when every model carries a weapon. Structured replacement choices subtract the
old equipment before adding the selected alternative. Alternate profiles are
grouped by their shared weapon name even when the export assigns their modes
different source-line identifiers.

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
- Ordered volleys support up to 32 weapon profiles and 16 consecutive target
  profile segments. The caller chooses both orders, and existing wounds,
  casualties, defensive characteristics, and lost overkill carry through the
  sequence.

## 10th edition profile database

The generated SQLite database at `data/warhammer_10e.sqlite` contains attacker,
weapon, and target profiles sourced from Wahapedia's structured 10th-edition
exports. See `data/README.md` for the schema overview and rebuild command.
