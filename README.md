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
rule_add_reroll_failed_wounds(&weapon.rules);
rule_add_hit_modifier(&weapon.rules, 1);
rule_add_wound_modifier(&weapon.rules, -1);
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

`weapon.hit_reroll_mask` and `weapon.wound_reroll_mask` select specific
unmodified D6 faces, while the convenience functions above select all failed
rolls. Hit and Wound modifiers accumulate, then each roll's final modifier is
capped to +1 or -1. Re-rolls use the unmodified face and the modifier is applied
afterward, matching the official 10th-edition [Core Rules](https://assets.warhammer-community.com/warhammer40000_core%26key_corerules_eng_24.09-5xfayxjekm.pdf)
and [Rules Commentary](https://assets.warhammer-community.com/warhammer40000_core%26key_corerulesupdate%26commentary_eng_24.09-lyrhcoyn9s.pdf).

Fixed Attacks, Strength, and Damage replacements are applied before additive
modifiers. A rule that explicitly changes Damage to 0 uses the commentary's
exception to the normal minimum of 1; later modifiers still apply, so Melta 2
changes that final Damage from 0 to 2.

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

Large exact volleys have deterministic native and WebAssembly benchmarks. They
exercise 80 allocated attacks, the supported maximum of 32 ordered weapons
against 16 mixed target segments, a rules-sensitive Devastating Wounds-last
volley, and a prefix-bound regression. Enable them with
`-DWHC_BUILD_BENCHMARKS=ON` or run `make benchmark`. The executable emits JSON;
CI stores both runtime reports and applies deliberately hardware-tolerant
regression limits. Every case records its conservative bound, observed peak
sparse-state count, and hard limit. The four-case corpus covers dense attacks,
the maximum mixed volley shape, deferred Devastating Wounds, and a weapon-order
case that proves the prefix-aware bound avoids a former false warning.

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
For the 88 published loadout clauses whose quantities depend on a specialist or
conditional model rather than total unit size, the list and Unit vs Unit editors
show the exact source subject and equipment text. Entering the matching model
count derives its 207 tracked weapon quantities, while those totals remain
editable. Saved lists, JSON backups, and the loadout-validation API preserve the
composition counts.

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
modified Hit/Wound, armour, AP, invulnerable-save, and cover thresholds over
their supported small domains. The
[shared rules interaction corpus](tests/RULE_INTERACTION_CORPUS.md) supplies
hand-derived exact fractions for unmodified criticals, re-rolls, modifier caps,
Lethal plus Sustained Hits, save bypasses, Feel No Pain, Indirect Fire, and
non-spilling Devastating Wounds. Native C, WebAssembly, and the exact API must
match every fraction, while deterministic seeded simulations must converge on
the corresponding applied means. The suite also checks expected-damage
monotonicity for AP, armour, Feel No Pain, invulnerable saves, and cover.
Profile selection applies Anti abilities
only when the selected target has the matching datasheet keyword. Damage
allocation is exhaustively compared between C and JavaScript across model
wound counts, unit sizes, prior damage states, and incoming damage values.
Ordered volley tests additionally cover mixed target profiles, existing wounds,
weapon-order-dependent casualties, per-profile cumulative means, and ordinary
damage that cannot spill between models. Devastating Wounds packets are retained
with their originating weapon but allocated only after every ordinary attack
from the attacking unit, including when Lethal Hits and Sustained Hits interact.
The same ordered target state drives
the cryptographically random full-volley resolver and its API. Unit vs Unit can
also repeat the complete ordered volley from a user-visible 32-bit seed. Its
versioned `xoshiro128ss-v1` stream produces replayable phase statistics,
including damage variance, quartiles, zero-damage and unit-destruction chances,
mean roll-stage counts, and a complete applied-damage histogram. Live rolls
continue to use the system cryptographic random source. The equivalent API is
`POST /api/v1/volley/simulate`, with `profiles`, `targets`, `seed`, `trials`,
and optional `initialWoundsLost` fields.
Before starting an exact ordered volley, Unit vs Unit asks the C/WebAssembly
engine for a conservative state upper bound. Ordinary volleys use the standard
damage distribution. Volleys that defer Devastating Wounds use a prefix-aware
bound: only packet dimensions already reachable at each weapon stage are
multiplied together. They compare that bound with the 2,047-state sparse budget;
a bound above that budget is a warning, not a rejection, because unreachable
combinations can make the real state set much smaller. Successful exact results
also report the observed peak sparse-state count. The user can try exact
calculation or run the existing reproducible seeded simulation. API clients can
make the same preflight request with `POST /api/v1/volley/complexity`; an exact
calculation that actually exhausts the budget returns HTTP 422 with code
`EXACT_STATE_LIMIT` and names the simulation endpoint.
Model vs Model, Unit vs Unit, and Play Mode expose unit abilities imported with
their published source text. Strictly unconditional, whole-model/unit defenses
load as native editable target values; conditional abilities remain explicit
choices and are never silently enabled. Exact target-keyword conditions are
machine-readable: automatic rules activate only when the selected target has
the required datasheet keyword and the effect is scoped to the selected weapon.
For example, Psychic Assassin changes Animus speculum to 6 Attacks against a
PSYKER target without affecting Life-draining touch or non-PSYKER targets.
Saved lists can mark battle- or turn-long conditions as Play Mode defaults, and
Play Mode keeps changes in its local recovery state. Offensive modifiers,
re-rolls, weapon-keyword grants, AP changes, Critical Hit/Wound thresholds, and
direct signed Attacks, Strength, and Damage changes plus fixed Attacks,
Strength, and Damage replacements come from the correctly classified source;
replacement Save targets, invulnerable saves, unrestricted
Feel No Pain thresholds, and per-attack damage reduction come from the target
unit. Unit vs Unit applies those defenses to every ordered target segment and
asks ranged and melee weapons to be resolved separately only when a scoped
defense produces incompatible target values. Melee/ranged scope is respected
per weapon. Bearer-only, subset-model, friendly-aura, affected-model,
attack-type-limited, conflicting, random, multiplicative, limited-use
single-attack, and other context-dependent replacement characteristic changes
are omitted until they can be represented exactly. Ambiguous subjects are not imported,
mutually exclusive modes cannot be combined, and the resulting profile remains
editable. Fixed weapon replacements can be restricted to an exact named weapon,
are applied before additive modifiers, and remain separate from the printed
value. Damage 0 replacements remain distinguishable from an inactive
replacement. The native engine applies the minimum of 1 independently to each
weapon before combining their attacks.
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
On narrow screens, Play Mode groups the attacker and target into guided steps,
collapses optional overrides, and keeps the resolve action above the device safe
area. Selects and action controls use touch-sized targets. Battle status and the
latest result are polite live regions, and focus moves to each resolved result
so keyboard and screen-reader users receive the roll without searching the page.

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

## Static agent interface

The `/agent/` page is a versioned, parameter-driven interface for browser-capable
AI agents and automation. It runs entirely in the browser against the same
C/WebAssembly engine and profile catalogue as the interactive calculator, so it
does not require an API server, Worker, database connection, or secret.

A catalogue matchup can use exact catalogue IDs or unambiguous names:

```text
/agent/?attacker=Doom%20Scythe&weapon=Heavy%20death%20ray&target=Brutalis%20Dreadnought
```

A direct profile supplies `attacks`, `hit`, `strength`, `ap`, `damage`,
`toughness`, `save`, and `wounds`:

```text
/agent/?attacks=4&hit=3&strength=12&ap=3&damage=D6%2B1&toughness=10&save=2&invuln=4&wounds=12
```

`attacks`, `damage`, `sustainedHits`, and `rapidFire` accept a number or dice
expression such as `D6+2`. Optional parameters include `weaponCount`, `model`,
`models`, `invuln`, `fnp`, `reduction`, `criticalHits`, `criticalWounds`,
`melta`, `attacksReplacement`, `attacksModifier`, `strengthReplacement`,
`strengthModifier`, `damageReplacement`, `damageModifier`, Hit/Wound
modifiers and re-roll modes, repeated `attackerPreset` or
`targetPreset` values, and individual rule flags. The `rules` parameter accepts
comma-separated `torrent`, `blast`, `heavy`, `lance`, `cover`, `ignores-cover`,
`indirect`, `lethal-hits`, `devastating-wounds`, `twin-linked`, and
`half-range` values. AP is a nonnegative magnitude, so AP -4 is passed as
`ap=4`.

Automation should wait for `[data-agent-status="ready"]`, then read the JSON in
`#warhammer-agent-result` or `window.__WARHAMMER_CALC_RESULT__`. Invalid,
unknown, duplicate, missing, or ambiguous parameters produce
`data-agent-status="error"` and a readable error object. `format=json` can be
included to make the intended output contract explicit. The returned schema is
currently version 1 and includes the normalized editable input, source IDs,
damage quartiles, decimal expectations, deterministic engine fractions, and
target capacity. Catalogue results also identify automatically applied
source-backed presets. This remains a static webpage: a plain HTTP client receives
HTML, while an agent with a browser runtime receives the computed result.

## Deployment health and API diagnostics

The hosted API exposes `GET /api/v1/health`. It independently loads the pinned
profile catalogue, instantiates the C/WebAssembly calculator, and queries list
storage. A healthy response is HTTP 200 with `status: "ok"`; a dependency
failure is HTTP 503 with `status: "degraded"` and a stable failure code for each
failed check. Failed catalogue and calculator loads are evicted from the worker
cache so a recovered dependency can be retried without restarting the service.

API errors include a stable `code`, `retryable` flag, and `X-Request-ID` response
header. In particular, list-database failures return 503
`LIST_STORAGE_UNAVAILABLE` instead of being misreported as invalid requests.

The deployment checker validates the homepage marker, profile-data schema and
source timestamp, WebAssembly magic bytes, and—on the hosted API—the health
contract and its dependency results:

```sh
node web/scripts/check-deployment.mjs https://example.com/ --surface=api
node web/scripts/check-deployment.mjs https://example.com/path/ --surface=static
```

It emits a versioned JSON report and distinguishes DNS, TLS, connection,
timeout, HTTP, HTML, catalogue, WebAssembly, and dependency failures. GitHub
Pages runs the check after each deployment and every six hours, retaining the
report as a workflow artifact.

Every imported CSV is pinned in `data/profile-source-lock.json` by published
update timestamp, SHA-256, and row count. A normal database rebuild refuses
changed upstream inputs, preventing an unnoticed profile update from reaching
the calculator. CI also checks that the committed SQLite database and browser
catalogue match the same pin. The scheduled profile-freshness workflow compares
that pin with the current exports each day; when an update appears it uploads a
JSON report identifying changed files and semantic database tables for review
and regression testing before the new source can be explicitly accepted.

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
- Deferred Devastating Wounds exact evaluation uses at most 2,047 live sparse
  states. Its preflight number is a conservative upper bound and can therefore
  recommend simulation for a volley that exact evaluation still solves.

## 10th edition profile database

The generated SQLite database at `data/warhammer_10e.sqlite` contains attacker,
weapon, and target profiles sourced from Wahapedia's structured 10th-edition
exports. See `data/README.md` for the schema overview and rebuild command.
