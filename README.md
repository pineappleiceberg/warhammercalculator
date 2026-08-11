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

Published fixed-Attacks abilities whose eligibility depends on a phase, chosen
target, or prior battlefield event are exposed as opt-in situational presets.
Their complete source condition remains visible, their effect is restricted to
the named weapon, and the active value is still editable. Compound replacements
such as Payback Time carry their Sustained Hits change with the Attacks value,
while mutually exclusive modes such as Moment Shackle cannot be selected
together.

Phase-bounded presets are also restricted to the compatible attack type.
Shooting-phase effects cannot alter melee attacks, and Fight-phase effects
cannot alter ranged attacks. Abilities available in both phases, or whose
effect explicitly lasts beyond the phase in which it was activated, remain
available to either attack type.

Unambiguous rules triggered by the attacking unit making a Charge move are
automatic when the editable `attackerCharged` state is enabled and inert when it
is disabled. The same state activates the +1 Wound benefit of a catalogue
weapon with the Lance ability, including Lance granted by a selected source
rule. An explicit `lanceActive` profile value remains an editable override.
Rules that also allow being charged, combine a charge with an alternative
condition, or change how exclusive modes are selected remain
explicit choices until every branch can be represented exactly.

Unambiguous rules triggered by the attacker Remaining Stationary use the
editable `attackerRemainedStationary` state. The same state activates the +1 Hit
benefit of a catalogue weapon with the Heavy ability. Rules that also require an
Order, a particular model in the unit, or another independent condition remain
explicit choices. A granted Heavy ability does not provide its bonus unless the
attacker also remained stationary.

Simple rules whose complete condition is that their source model is leading a
unit use the editable `attackerAttached` or `targetAttached` state. These rules
become automatic only for the matching attacking or defending side. Leader
rules with casualty thresholds, Waaagh!, distance, named-model, objective,
choice, or other independent conditions remain explicit choices.

Orks units use separately editable `attackerWaaaghActive` and
`targetWaaaghActive` state to represent whether that particular unit is gaining
the benefits of Waaagh!, including a Nob with Waaagh! Banner when appropriate.
The universal rule is split by scope: +1 Strength and Attacks applies only to
melee weapons, while the 5+ invulnerable save applies against every attack.
Direct Waaagh-dependent rules for Gorkanaut, Morkanaut, Meganobz, Warboss, Nob
with Waaagh! Banner, and Warboss in Mega Armour are also automatic. Ghazghkull's
range-dependent aura and compound leader rule remain explicit because Waaagh!
state alone does not satisfy their other conditions.

Oath of Moment uses two separately editable matchup states. Set
`targetOathOfMoment` when the defender is the selected Oath target; this enables
the Hit re-roll on compatible Adeptus Astartes datasheets. Set
`attackerOathWoundBonusEligible` only when the attacker is using a Codex: Space
Marines Detachment and the army contains none of the excluded chapter keywords.
The conditional +1 Wound bonus requires both states, so it can no longer be
accidentally bundled with the universal Hit re-roll.

Direct rules whose complete condition is that the source or target is within
range of any objective marker use the editable `attackerOnObjective` and
`targetOnObjective` states. Baseline re-rolls remain automatic off an objective,
while the stronger objective re-roll activates only in range. The separate
`attackerObjectiveOwner` and `targetObjectiveOwner` states record whether the
attacker, target, or neither player controls that marker; `unknown` is the safe
default. Exact rules for an objective the source controls or does not control
use this ownership without guessing. Four directional selected-marker facts
record whether either unit is at the objective selected by the attacker or by
the target. This activates Archon’s Will, Priority Objective Identified, and
Seeker of the Unfound exactly; Archon’s Will also requires its source unit not
to be Battle-shocked. Conditions that combine a marker with an aura, token, or
alternative condition remain explicit choices. Objective
Control characteristic text that does not
condition the combat effect no longer makes Black Rage or Voice of Experience
manual.

Published Attacks modifiers that scale by a count use explicit editable state
instead of an assumed average. `attackerUnitModels` records the total models in
the attacking unit, while `nearbyEnemyModels` records enemy models inside the
specific ability's stated range. A value of `0` means unknown and contributes
no count-based bonus. The current source snapshot applies this exactly to
Wurrboy's Eyez of Mork and Gabriel Seth's Blood Reaver, including their
five-model rounding boundaries and weapon scope.
`embarkedModels` records all models inside an attacking transport, while
`embarkedWracksModels` records only the Wracks subset and cannot exceed the
total. These inputs resolve On Da Hunt for the Hunta Rig with its +6 cap and
Visions of Butchery for the Raider without treating non-Wracks passengers as
Wracks.

Firing Deck transports expose their published model limit. Model vs Model and
Unit vs Unit can select an explicit passenger datasheet, one ranged weapon, and
the number of embarked models using it; Play Mode selects the passenger from
the attacking saved list only after that saved unit has been assigned to the
specific transport in Army Lists. Published Transport faction/unit keywords,
explicit exclusions, Wounds thresholds, fixed per-model space costs, aggregate
capacity, Wounds-based shared-capacity costs, special passenger model ceilings,
and equipped killkannon/kannon/supa-kannon capacity changes are validated. The
five Mastodons and the Orca Dropship charge Dreadnought, Helbrute, or Battlesuit
passengers space equal to their Wounds while enforcing their aggregate two- or
six-model allowance. Sokar-pattern Stormbirds charge a transported Rhino and
all of its passengers a fixed 25 spaces; the Thunderhawk Transporter permits up
to two non-Aircraft, non-Titanic Adeptus Astartes Vehicles in an independent
allowance and does not
double-count models embarked within them. Nested Transport assignments retain
and validate each inner Transport's own capacity. The Orion Assault Dropship
allows one of its three named Contemptor Dreadnoughts in an independent pool
and automatically reduces its Infantry capacity from 12 to 6 while that pool
is occupied. The Falcon, Firestorm,
Vampire Raider, and Wave Serpent apply their
published Ynnari exclusions without rejecting the named Yvraine, Visarch, and
Asuryani exceptions; Jump Pack exclusions remain independent. Independent
capacity pools are tracked separately for Storm Eagles,
Stormravens, the Ghost Ark, and the Harridan, so a Dreadnought or Character slot
does not consume the Infantry or named-unit allowance. Mutually exclusive modes
are tracked separately for Dreadclaws, Kharybdis Assault Claws, Tyrannocytes,
and the Valkyrie Sky Talon; Army Lists rejects formations that mix their primary
and alternative passengers. Tyrannocyte Monsters also enforce their published
12-Wound ceiling. Army Lists preserves which bodyguard unit a Character began the
battle attached to and limits that menu to the 1,902 published Leader-to-
Bodyguard datasheet pairs. Imported or stale illegal links remain visible for
editing but fail the roster rules check. Play Mode derives Attached-unit state
from valid saved links while keeping its quick override editable. Leader
formations enforce the global two-Character ceiling from the official Rules
Commentary, 51 normalized Leader exception clauses, the Boyz and Kroot
starting-strength conditions, the Company Heroes minimum-Leader rule, and five
mandatory-attachment rules. The menu filters prospective combinations while
preserving stale invalid links for repair. Captain attachments to Bladeguard
Veteran and Hellblaster Squads require the saved relic shield or plasma pistol
loadout respectively. Warlock Conclaves and Warlock Skyrunners use their
separate published Bodyguard-join relationship: Army Lists enforces their
targets, one-copy limit, unattached condition, increased Starting Strength,
inherited Attached state, and complete-unit Transport movement. Play Mode groups
each valid saved Bodyguard, joined Warlock unit, and attached Leader into one
selection while retaining their separate Army List records. It exposes every
component's saved weapons and abilities, derives exact source model counts,
lets the target controller select the first legal allocation profile, carries
damage through the remaining mixed profiles in roster order, and prevents
Leader allocation while Bodyguard or joined models remain. Tacticus Characters can use the published Rhino, Razorback,
and Terrax exception only when linked to a non-Tacticus unit, and both saved
units must embark in the same transport. Conditional clauses that are not fully
normalized remain unavailable instead of being guessed. Melee and One Shot weapons are excluded, a passenger
unit that has already shot is rejected, and Heavy Weapons Squad-style weapons
consume two Firing Deck model slots. The selected weapon keeps its own profile
and weapon abilities, but the transport is the bearer: transport combat rules
apply and passenger unit rules do not transfer. Counts remain editable within
the published Firing Deck limit.

Direct attack clauses that require a Battle-shocked target, or require the
attacker not to be Battle-shocked, use the editable `targetBattleShocked` and
`attackerBattleShocked` states. The source-backed rule activates only in the
matching state. Aura range, leadership, objective, observer, and mixed-clause
Battle-shock rules remain explicit choices rather than being partially
automated.

Direct attack clauses that require the target to be Below Half-strength, or not
Below Half-strength, use an editable three-state target value: full strength,
below Starting Strength, or Below Half-strength. This distinction keeps a
not-Below-Half-strength rule active in both of its valid states. Leader, aura,
named-weapon-only, phase-preamble, and multi-threshold strength clauses remain
explicit choices until their complete eligibility can be represented.

Optional rules used when an attack is allocated have an explicit deterministic
policy: skip the configured number of allocated attacks, then spend one use per
attack before its Hit roll. A use is spent even if that attack misses, and any
hits generated by that attack, including Sustained Hits and deferred
Devastating Wounds, inherit its Damage replacement. The policy continues across
an ordered multi-weapon volley.

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
Unit vs Unit also recognizes the published exceptional Warlock joins for
Guardian Defenders, Storm Guardians, and Windriders. Each joined component has
its own editable model count and structured loadout, while its weapons and
abilities resolve as part of one formation. Defending formations retain their
exact mixed-model profiles in the editable damage-allocation order.
Model vs Model, Unit vs Unit, and Play Mode expose unit abilities imported with
their published source text. Strictly unconditional, whole-model/unit defenses
load as native editable target values; conditional abilities remain explicit
choices and are never silently enabled. Exact target- and attack-keyword
conditions are machine-readable: automatic rules activate only when the
selected target and attacking weapon meet their published requirements.
For example, Psychic Assassin changes Animus speculum to 6 Attacks against a
PSYKER target without affecting Life-draining touch or non-PSYKER targets.
Psychic-only Feel No Pain rules likewise apply only to weapons carrying the
Psychic ability. Unit vs Unit rejects a mixed Psychic/non-Psychic volley when
one shared target profile cannot represent both defenses exactly.
Exact charge-triggered rules likewise activate automatically only when the
attacker's editable charge state is enabled.
Saved lists can mark battle- or turn-long conditions as Play Mode defaults, and
Play Mode keeps changes in its local recovery state. Offensive modifiers,
re-rolls, weapon-keyword grants, AP changes, Critical Hit/Wound thresholds, and
direct signed Attacks, Strength, and Damage changes plus fixed Attacks,
Strength, and Damage replacements come from the correctly classified source;
replacement Save targets, invulnerable saves, unrestricted
Feel No Pain thresholds, and per-attack damage reduction come from the target
unit. Unconditional rules that halve incoming Damage are imported as editable
Damage divisors. Mandatory rules that change the Damage characteristic to 0
the first time that unit fails a saving throw are imported as situational,
editable target effects. The exact engine consumes the effect only after an
actual failed save, preserves it when Devastating Wounds bypass a save, and
carries the state across every weapon and ordered target allocation. The exact
engine also imports once-per-battle, once-per-turn, once-per-battle-round, and
twice-per-battle allocation-time Damage replacements as situational target
effects. Their replacement value, remaining uses, and number of attacks to skip
remain editable; the source preset starts with all published uses and skips
zero attacks. The exact and simulated engines spend a use at allocation time,
even if the attack later misses. The exact
engine follows the official characteristic sequence:
replacement, division, multiplication, addition/subtraction, rounding up, then
the applicable minimum. Unit vs Unit applies those defenses to every ordered target segment and
asks ranged and melee weapons to be resolved separately only when a scoped
defense produces incompatible target values. Melee/ranged scope is respected
per weapon. Model vs Model exposes normalized defensive equipment as explicit
choices and includes those choices in shared matchup URLs. Unit vs Unit uses
exact bearer counts to split equipped and unequipped models into independently
reorderable target segments while applying unit-scoped equipment across the
whole formation. Play Mode keeps
whole-unit equipment separate from editable bearer counts; equipped and
unequipped models become distinct ordered allocation profiles, so a shield on
one model never protects the rest of its unit. Equipment choices recover with
the current battle, and attack-keyword conditions are applied per weapon. Army
Lists can also save these choices as defaults: selecting that target in Play
Mode starts from the saved whole-unit and bearer counts, while later battle
changes remain local and editable.
Published default defensive equipment is derived from normalized loadout text,
and bearer controls are limited to eligible model profiles. Optional and
conditional choices remain off until selected or their structured loadout
subject is present; users can still save explicit overrides for casualties and
narrative rules.
Source option choices now carry per-alternative weapon replacements and explicit
defensive-equipment changes. Selecting an Aquila or Decimus shield therefore
removes the heavy thunder hammer, adds the power weapon, and equips the shield
as one operation; Lychguard and Wraithblade swaps behave the same way. Mixed
choices no longer assume every alternative replaces the same weapons, so an
Assault Sergeant loses its pistol and chainsword for twin lightning claws but
keeps both when merely adding a shield. Default equipment removal is linked in
the opposite direction for choices such as paired Wolf Guard Headtaker weapons
and the Einhyr teleport crest. Thirty-two of the 44 multi-model defensive
equipment options have complete choice coverage; their derived counts remain
editable, but a divergent saved roster requires the existing casualty or
narrative acknowledgement. Crisis Battlesuits and all three T’au Commanders
expose both their weapon-replacement and duplicate-capable equipment pools.
Starred items share their published no-duplicate limit across both paths, and
Crisis suits enforce the published three-ranged-weapons-per-model limit.
Single-model defensive presets and named combat wargear use the same
source-choice relationship. Schema 77 links 123 published alternatives to 32
combat presets, all with complete equipment-choice coverage. Selecting an Impulsor shield dome, Ogryn
brute shield, Lieutenant storm shield, or Commander shield generator activates
its defense without a second ability toggle. Replacing a default weavefield crest
or scattershield removes the defense, while always-equipped gear such as
Karanak’s Collar of Khorne starts active. Army Lists carries the derived state
into Play Mode, Unit vs Unit reconciles target source choices immediately, and
the loadout API returns preset IDs, equipment counts, and unavailable activated
rules. Rods of Office and Panspectral Scanners apply unit-wide, while Reaver
Grav-talons and Wulfen Death Totems split bearer attacks from the rest of a
mixed unit. Grav-talons replace AP with 2 as well as granting their published
weapon ability. Survey Augurs are supporting-unit effects, and Oversight Drones
remain manual once-per-battle activations that are unavailable unless their
source equipment is selected. Canoness, Hernkyn, and Vespid prerequisites fail
closed instead of granting an effect from an illegal loadout. Battle-local
ability controls remain editable after initialization. Keeper shining aegises, the Lokhust
Lord’s nanoscarab amulet, the Wazbom force field, and Wolf Guard Pack Leader
storm shields follow their equipment-only alternatives. Exact two-different-
weapon pools also enforce item uniqueness and their published Pistol pairing
rule instead of accepting an illegal pair silently. Mixed twin-lightning-claw
branches consume both published choice slots instead of being flattened into
the two-distinct-weapons list, and their common starting weapons are removed
only once. The Wolf Guard Pack Leader in Terminator Armour also enforces the
complete two-ranged-weapon rule: exactly one cyclone missile launcher paired
with either its storm bolter or a combi-weapon, including the cross-option
storm-bolter replacement.
Schema 73 stores published legal starting sizes independently from editable
current model counts. Inclusive compositions such as 10–20 models remain one
range, while source alternatives such as exactly 5 or 10 models remain two
distinct ranges. Army Lists labels its model count as the current battlefield
count, shows the published starting choices, and reports intermediate values as
possible casualties instead of silently accepting them as legal roster starts.
The catalogue and loadout API expose the same normalized ranges, including
source text, so browser and agent callers apply the same distinction.
Uniform grouped statlines are split into source-composition-backed catalogue
models when that distinction is required for an exact bearer limit. Command
Squad shields therefore distinguish the Champion and Company Veterans from the
Apothecary and Ancient, while Company Veterans on Bikes excludes its Sergeant.
The same exact split covers Assault Sergeants, Voidreaver Felarchs, the Hesyr,
the Theyn, Navis Armsmen, Infiltrators, Kabalite Agents, and the Veteran Biker
Sergeant. Deathwatch shield and Mortifier sarcophagus eligibility is exact
without a split because their source rules allow any model in the grouped
profile.
Corsair Voidscarred and Spectrus Kill Team specialist counters also drive exact
source-composition profiles: Channeller Stones belong only to the Soul Weaver,
Mistshield only to the Voidscarred Felarch, and Helix Gauntlet only to a
marksman-carbine Infiltrator. Changing a specialist count reconciles the
remaining base models and their source weapon totals; an impossible mix is
reported instead of being approximated.
The remaining named grouped statlines use source-backed catalogue count
formulas. Both Kill Team Cassius datasheets expose all eleven named models and
map Psychic Hood only to Jensus Natorian. Aquila and Decimus Kill Teams expose
their Sergeant, Gravis Veterans, and four Deathwatch Veteran loadouts at the
published five- and ten-model sizes; Astartes Shield applies only to the heavy
thunder hammer Veteran. Wardens of Ultramar exposes all six named models, with
Refractor Field only on Gaius Silva and Storm Shield only on Veteran Sergeant
Metaurus. This also makes Gravis and specialist weapon defaults scale from
their actual model counts instead of the whole Kill Team size. All 44 imported
defensive-equipment options now have exact bearer identity and exact count
limits.
Published named counts initialize automatically but remain editable together;
weapon totals remain independently editable for casualties and custom rules.
The derived models retain their original statline provenance, and saved counts
using the former grouped model ID are distributed deterministically onto the
new eligible segments. Old model matchup links, static agent URLs, and Play
Mode recovery IDs resolve through the same source-profile alias; uniform
derived targets do not newly require an agent `model` parameter.
Fixed, every-model, and per-unit-size source limits are checked before an Army
List can be saved. Removing required equipment, exceeding a bearer limit, or
retaining an unknown selection requires an explicit battlefield-casualty or
narrative/house-rule acknowledgement, which is preserved in device backups and
the hosted list API. Play Mode shows the same source warning without blocking
battle-local adjustments.
Conflicting bearer assignments and ambiguous model compositions fail closed.
Other subset-model rules, friendly-aura, affected-model,
unrepresented attack-type conditions, conflicting, random, subset-model multiplicative,
and other context-dependent replacement
characteristic changes are omitted until they can be represented exactly.
Ambiguous subjects are not imported, mutually exclusive modes cannot be
combined, and the resulting profile remains editable. Fixed weapon
replacements can be restricted to an exact named weapon,
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
update matching records. Optional defensive-equipment defaults remain compatible
with older version-1 backups and synchronize with the rest of each saved unit.
Unfinished list drafts and Play Mode selections, overrides, limited ability
uses, and battle state recover automatically on the current device. Play Mode
creates battle-state version 15 as soon as both lists are selected. Every
formation from both saved roster revisions receives a stable player-and-saved-unit
identity before combat, so attackers and targets never appear implicitly on
their first attack. A later roster edit fails closed instead of mixing a changed
list into existing wounds or casualties. Version-1 and version-2 logs migrate by preserving
their registrations, attack IDs, allocations, and health while adding every
missing roster formation ahead of combat events. Preserved attacks remain
explicitly legacy-untimed instead of being assigned invented phases. Defensive-
equipment allocation remains battle-local and editable during setup, then its
exact bearer identities freeze when the battle starts.
Version 6 records every formation's starting location before models are
deployed. Strategic Reserves are capped per player at 25% of the configured
battle size, cannot contain a Fortification, and cannot arrive in round one.
Battlefield formations deploy one at a time in alternating player order;
Reserves can arrive only for the active player in the Reinforcements step and
are recorded as having made a Normal move. Formations outside the battlefield
cannot move, charge, activate, attack, or be targeted, and any that remain there
when the battle ends are reported as destroyed. Physical deployment-zone,
board-edge, enemy-distance, Deep Strike, and source-rule eligibility facts stay
fail-closed behind explicit reason-bearing player confirmations until table
geometry is executable. The official Core Rules source identity, retrieval date,
content hash, and relevant pages are pinned in
`data/battle-rule-sources.json`.
Version 7 locks each legal saved Transport assignment to its exact battle
formation and records starting occupancy during Declare Battle Formations.
Assigned passengers can embark only after a Normal, Advance, or Fall Back move
ends wholly within a player-confirmed 3 inches, cannot re-embark after
disembarking in the same phase, and can disembark only if they started that
Movement phase embarked. Transport movement determines the passenger's
remaining movement and charge eligibility. Firing Deck choices require current
replayed occupancy rather than a list-time assignment alone. Destroying an
occupied Transport creates a mandatory immediate resolution that blocks every
other transition. The player must confirm that any Deadly Demise effects were
resolved first (or do not apply), choose the first casualty profile in a mixed
unit, and confirm normal or Emergency Disembarkation placement. Unplaceable
models, per-model D6 rolls, applicable Feel No Pain rolls, casualties,
Battle-shock, and movement/charge restrictions are recorded and replayed. A
wounded model remains the mandatory first allocation. Real rolls use
rejection-sampled browser CSPRNG values. Version-1 through version-6 logs migrate
with explicit provenance and assume no unrecorded occupancy.
Version 8 makes ranged target eligibility an executable replay fact. The
browser catalogue preserves each weapon's published Range, while Guided Play
records the effective Range, closest-point measured distance to one thousandth
of an inch, model/unit visibility and full visibility, direct or Indirect Fire
state, the number of eligible selected weapon copies, and whether the source was
a manual, UWB, camera, or imported measurement. A player must review every fact
and explain both the tabletop check and any override of the published Range.
Each ranged attack references the exact fact, formation pair, weapon, battle
clock, firing mode, and declared weapon count; replay rejects unknown ranges,
zero distances, out-of-range targets, invalid non-visible attacks, stale facts,
and excessive weapon counts. The replay API exposes these facts and independently
cross-checks their eligibility through the formally specified C/WebAssembly
predicate. Version-1 through version-7 logs migrate with an explicit boundary
for attacks that predate structured measurements. Editable attack profiles are
preserved, but catalogue-mode agent URLs now fail closed when a positive
distance exceeds the selected weapon's published Range.
Version 9 freezes every saved formation's equipped weapon groups, profile IDs,
published Range, Assault and Indirect Fire abilities, copy counts, and source
saved-unit bearer identity. Each new attack references that immutable source.
Replay rejects invented profiles, changed weapon facts, abilities absent from
the locked profile, a source whose models are all destroyed, and declarations
that reuse copies already fired in the current phase. Mutually exclusive
profiles consume the same group allowance, while reverting the latest attack
restores its copies. An embarked Firing Deck source must remain a passenger of
the attacking Transport. Guided Play disables exhausted groups and reports the
number of locked copies still available. The declaration predicate is shared
and differentially tested across JavaScript, native C, WebAssembly, and the
worker API. Version-1 through version-8 histories migrate with an explicit
boundary instead of inventing weapon provenance for preserved attacks.
Version 10 assigns every equipped weapon copy to a stable model instance.
Groups with an optional or otherwise ambiguous bearer must be reviewed during
setup before the battle can start. Exact battle segments combine models only
when their profile and complete weapon loadout are identical, so allocating a
casualty to a loadout removes the copies carried by that model group. Guided
Play labels loadouts in the allocation menu and disables declarations beyond
the surviving bearer count. Setup-only defensive-equipment corrections retain
reviewed weapon assignments. The replay API reports exact or legacy tracking
and the event-time surviving copy count, while a separately contracted native
predicate is proved and differentially checked through WebAssembly. Histories
from version 9 and earlier preserve aggregate bearer behavior behind explicit
migration provenance rather than inventing model identities. Exact loadout
splitting fails closed if it would exceed the native 16-segment damage
allocation limit.
Version 11 makes the charge roll and reviewed movement executable replay facts.
Each new attempt stores both D6, a bounded modifier, effective Charge distance,
every target's phase-start distance and final Engagement Range state, the
longest model move, and explicit confirmations for phase-start eligibility,
starting outside Engagement Range, coherency, avoiding non-target Engagement
Range, moving each model closer to a target, and maximizing base contact where
possible. Successful charges fail closed when any required movement fact is
missing or the longest move exceeds the effective distance. Failed charges
record zero movement and require an explanation. Browser rolls use
rejection-sampled CSPRNG values; physical dice and rules modifiers remain
editable, and any non-canonical effective distance requires a reason. The
native predicate is ACSL-specified, proved, exported to WebAssembly, and
differentially checked by JavaScript and the replay API. Version-10 and older
charge attempts retain their historical confirmation model behind an explicit
migration boundary.
Version 12 makes each Fight activation's Pile In and Consolidation executable
replay facts. A new activation records one reviewed Pile In before any melee
attack and one reviewed Consolidation after all eligible melee attacks are
complete. Each movement records its longest model move, stationary base-contact
models, unit coherency, and the exact legal destination branch: Engagement Range,
the closest objective after an impossible enemy destination, or no movement after
both destinations are impossible. Enemy destinations require every moved model
to finish closer to its closest enemy and maximize base contact where possible;
objective destinations require the corresponding closest-objective facts. Every
non-enemy outcome and zero-attack completion is explicitly explained. Replay
rejects movement over 3 inches, missing or reordered stages, unknown objectives,
attacks before Pile In or after Consolidation, and activation completion before
both stages. Guided Play exposes the sequence without making profiles immutable.
The ACSL-specified native predicate is proved, exported to WebAssembly, and
differentially cross-checked by JavaScript and the replay API. Version-11 and
older Fight activations retain their historical behavior behind an explicit
migration boundary.
Version 13 makes Heroic Intervention an executable immediate reaction after
each successful enemy Charge move. Replay opens one responder window and blocks
all unrelated events and clock advancement until that player resolves or
declines it. A resolution records the triggering charge, intervening formation,
sole target, both D6, modifiers, effective distance, a reviewed starting
distance no greater than 6 inches, the canonical Charge movement facts, and an
audited Command Point deduction. The standard cost is 1CP; different costs,
additional same-phase uses, and otherwise ineligible Battle-shocked or Aircraft
formations require an explicit source-rule reason. Non-Walker Vehicles are
rejected. A successful intervention remains eligible to fight later that turn
but never receives Charge Bonus. Guided Play exposes the complete decision,
secure roll, physical-table confirmations, failure path, and pass path. The
replay API returns pending, resolved, and declined reactions and independently
cross-checks the ACSL-specified C/WebAssembly predicate. Version-12 and older
histories retain their prior behavior behind an explicit migration boundary.
Version 14 makes Fire Overwatch an executable immediate reaction in the
opponent's Movement and Charge phases. Replay opens a responder window just
after an enemy formation is set up, starts or ends a Normal, Advance, or Fall
Back move, or declares a charge, and blocks the interrupted action until the
window is resolved or declined. Resolution requires a living non-Titanic
formation with a surviving ranged weapon, the visible triggering formation
within 24 inches, reviewed normal Shooting eligibility, and confirmation that
Shooting-phase-only rules and Firing Deck are excluded. The standard cost is
1CP and use is limited to once per turn; nonstandard costs, additional uses,
and Battle-shock exceptions require source-rule reasons. The activation can
target only the triggering formation, forces Hit rolls and Critical Hits to an
unmodified 6 while preserving rules such as Torrent, re-rolls, Sustained Hits,
and Lethal Hits, and records every attack against the interrupted action.
Guided Play exposes the decision and physical-table review, while the replay
API independently checks the reviewed reaction against an ACSL-specified
C/WebAssembly predicate. Version-13 and older histories retain an explicit
migration boundary.
Version 15 makes Hazardous self-damage canonical. Each locked weapon profile
records whether it is Hazardous and each exact model segment records its model
keywords. Once a unit has resolved all of its attacks, replay requires one D6
test for every Hazardous weapon copy that selected targets. Failed tests resolve
one at a time and enforce the published selection order: a wounded equipped
model first, otherwise an equipped non-Character, otherwise an equipped
Character. This eligibility includes every model carrying a Hazardous weapon,
not only bearers of the weapons used for those attacks. The selected model
suffers three mortal wounds; applicable Feel No
Pain rolls use the browser CSPRNG, and excess Hazardous damage never spills to
another model. Fire Overwatch tests taken in the opponent's Charge phase are
recorded immediately after shooting, but their mortal wounds are blocked from
allocation until after the triggering unit's Charge move resolves. Hazardous
damage and Heroic Intervention can then be resolved in either order, preserving
the active player's Core Rules sequencing choice.
JavaScript replay, native C health replay, WebAssembly, and the worker API share
the same allocation outcome, while an ACSL contract specifies and proves the
failed-test damage predicate. Version-14 and older histories retain an explicit
Hazardous migration boundary.
The guided timeline records battle round, first or second player turn, active
and priority player, phase, and step. It covers Command, Movement, Shooting,
Charge, and Fight through five rounds. Pending bounded choices stop both attacks
and clock advancement until resolved, and recorded effects expire exactly at
their step, phase, turn, round, or battle boundary. Version 5 records each
formation's Remain Stationary, Normal Move, Advance, or Fall Back outcome, each
charge attempt and target, and explicit player-confirmed exceptions for rules or
physical-table facts that are not executable yet. Shooting and Fight attacks
must belong to an open formation activation. A formation can complete only one
activation in that phase, the clock cannot advance during an activation,
Advanced formations are restricted to Assault weapons unless an exception is
recorded, and ranged/melee weapon types are enforced by phase. Fight priority
begins with the non-active player in each selection step, alternates after
completed activations, and can be explicitly passed when that player has no
eligible formation.
Target legality remains fail closed. Charges and Fight attacks retain explicit
player confirmation for current table and Engagement Range facts; ranged
attacks use the structured version-8 measurement and version-9 inventory above. A confirmation never
grants a rules exception; exceptions use a separate reason-bearing override
until the corresponding rule is executable.
Battle-state version 4 adds mission setup and replayed game accounting. Mission
setup records the mission name, objective-marker count, starting Command Points,
and the amount both players gain at the start of every Command phase. Play Mode
tracks each player's Command Points and Victory Points, categorizes primary,
secondary, correction, and other scoring events, and records objective control
as controlled, contested, or uncontrolled. Battle-shock is attached to the exact
saved formation and clears automatically at the start of that formation owner's
next Command phase. Named custom resources can be uncapped or given an enforced
maximum for faction and detachment currencies. Every change is an integrity-
checked event with its prior and resulting value; replay rejects negative,
over-cap, mistimed, or tampered totals.
Play Mode stores resolved attacks in a versioned append-only event log. Mixed-profile
wounds, casualties, destroyed formations, and defensive-equipment bearer
identity carry into later attacks, including after swapping which list is
attacking. Undo appends a compensating event instead of deleting history.
Validated JSON battle exports and imports preserve the rules snapshot and fail
closed when the referenced saved lists or loaded catalogue do not match.
The same version-1 flat event ABI for formation-health replay runs in native C
and WebAssembly for version-1 through version-7 JSON battle envelopes.
It validates attack transitions, damage and casualty totals, the one-wounded-model
invariant, and last-in-first-out compensating undo without modifying its output
when an event stream is invalid. `POST /api/v1/battle/replay` accepts
`{ "battleState": ..., "formationId": ... }`, validates the canonical JSON log,
replays the selected formation through Wasm, cross-checks the result against the
web replay, independently cross-checks every guided clock transition through
the C/WebAssembly clock, and returns per-segment health, active attack IDs, the
current clock, pending-choice IDs, active effects, mission, per-player resources,
objective control, Battle-shocked formation IDs, categorized scoring history,
movement and charge outcomes, canonical Pile In and Consolidation facts for each
Fight activation, current/completed activation state, deployment
declarations and order, battlefield/off-battlefield identities, Reserve
arrivals, Reserves destroyed at battle end, current Transport occupancy,
disembarkations, mandatory destroyed-Transport state, and recorded passenger
rolls and casualties. The
portable ABI supports the same 32 formation segments and 10,000-event bound as
the saved web schema.
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
derive the resulting weapon and equipment-item counts, and flag a combined
pool only once. Shared item identities enforce cross-pool duplicate limits,
while source-backed weapon-type limits validate the final editable loadout.
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
`melta`, `distance` (in inches; `0` means unknown), `charged`, `stationary`,
`unitModels`, `nearbyEnemyModels`, `embarkedModels` (alias `passengers`),
`embarkedWracksModels` (alias `wrackPassengers`),
`passenger`, `attached`, `firingDeckModels`, and `passengerAlreadyShot`,
`attackerAttached`, `targetAttached`,
`waaaghActive` (alias for `attackerWaaaghActive`), `targetWaaaghActive`,
`oathTarget` (alias for `targetOathOfMoment`),
`oathWoundBonus` (alias for `attackerOathWoundBonusEligible`),
`attackerBattleShocked`, `targetBattleShocked` (booleans),
`attackerOnAttackerSelectedObjective`, `targetOnAttackerSelectedObjective`,
`attackerOnTargetSelectedObjective`, `targetOnTargetSelectedObjective`,
`closestTarget` (alias for `targetClosestEligible`),
`sourceDistance` (attacker-side ability source to selected target),
`targetSourceDistance` (target-side ability source to attacker),
`sourceVisible` (alias for `attackerSourceCanSeeTarget`),
`targetSourceVisible` (alias for `targetSourceCanSeeAttacker`),
`targetStrength` (`full`, `below-starting`, or `below-half`), `damageDivisor`,
`attacksReplacement`, `attacksMultiplier`, `attacksModifier`,
`strengthReplacement`, `strengthMultiplier`, `strengthModifier`, `damageReplacement`,
`damageMultiplier`, `damageModifier`, `firstFailedSaveDamageReplacement`,
`allocatedAttackDamageReplacement`, `allocatedAttackDamageReplacementUses`,
`allocatedAttackDamageReplacementSkip`, Hit/Wound
modifiers and re-roll modes, repeated `attackerPreset` or
`targetPreset` values, and individual rule flags. The `rules` parameter accepts
comma-separated `torrent`, `blast`, `heavy`, `lance`, `cover`, `ignores-cover`,
`indirect`, `lethal-hits`, `devastating-wounds`, `twin-linked`, and
`half-range` values. AP is a nonnegative magnitude, so AP -4 is passed as
`ap=4`. `indirect` is only the explicit Indirect Fire penalty override; it is
not used as line-of-sight state for selected-target abilities.

Model vs Model, Unit vs Unit, and Play Mode expose the same target distance,
directional ability-source distance and visibility,
attacker charge and stationary states, attacker/target Battle-shock state, and
target unit-strength, Attached-unit, Waaagh!, Oath of Moment, and objective-marker
position states. A catalogue agent request can
pass `charged=true` to activate every compatible, unambiguous charge-triggered
source rule without an `attackerPreset` parameter and activate Lance for
compatible catalogue weapons.

Attacker-side cross-unit abilities use `support=<unit>`, one or more
`supportPreset=<ability>` values, and `supportDistance=<inches>`. Defender-side
support independently uses `targetSupport=<unit>`, `targetSupportPreset=<ability>`,
and `targetSupportDistance=<inches>`. Each support unit must share the supported
unit's faction, and only abilities classified as supporting-unit effects for
that side can be used there. Observer effects additionally require
`guided=true&spotted=true`, which prevents an Observer ability from being
treated as the Observer's own attack bonus. A support distance of `0` is unknown
and leaves range-gated rules inactive.
Play Mode spends and recovers limited self-unit and supporting-unit uses per
saved unit instance; keep an activated ability on while resolving each weapon
it affects. Exhausted abilities cannot be reactivated unless the editable
remaining-use control is corrected. Recovery version 2 migrates version-1
support-use state and charges an already-active legacy self-unit ability once,
so an interrupted battle cannot gain a free reuse during upgrade. Saved-list
defaults never activate a limited ability without spending it. Agent URLs are
stateless and do not spend uses, but their result source reports
`usesPerBattle` for selected limited presets.
`unitModels`, `nearbyEnemyModels`, `embarkedModels`, and
`embarkedWracksModels` activate exact model-count-scaled Attacks bonuses at
their published rounding boundaries; `0` means unknown. Embarked Wracks must
be a subset of all embarked models.
For a catalogue Firing Deck request, keep `attacker` set to the transport, set
`passenger` to the embarked datasheet, and select that passenger's weapon. For
example:

```text
/agent/?attacker=Trukk&passenger=Boyz&weapon=Shoota&firingDeckModels=6&target=Intercessor%20Squad
```

The result identifies the transport as bearer and reports the slots consumed.
Use `attached=<bodyguard datasheet>` when the passenger relies on a published
attachment exception, such as a Tacticus Character in a Rhino; omitting it or
choosing a Tacticus bodyguard keeps that passenger illegal.
`weaponCount`, when supplied, must equal `firingDeckModels` so a structural
limit cannot be bypassed through a profile override.
`stationary=true` likewise activates exact stationary rules and the Heavy bonus
for compatible catalogue weapons.
`attackerAttached=true` and `targetAttached=true` likewise activate compatible,
unambiguous leader rules on the corresponding side of the matchup.
`waaaghActive=true` and `targetWaaaghActive=true` activate the universal and
direct Waaagh-dependent rules for the corresponding Orks unit without requiring
manual profile arithmetic.
`oathTarget=true` activates the Oath Hit re-roll; `oathWoundBonus=true` adds the
Codex +1 Wound effect only when the target is also marked.
`attackerObjective=true` and `targetObjective=true` activate exact rules that
require the corresponding unit to be within range of any objective marker.
Use `attackerObjectiveOwner` and `targetObjectiveOwner` with `attacker`,
`target`, `uncontrolled`, or `unknown` to resolve objective-control conditions;
the aliases `attackerObjectiveControl` and `targetObjectiveControl` are also
accepted. Ownership-dependent rules remain inactive when ownership is unknown.
Selected-marker relationships use `attackerOnAttackerSelectedObjective`,
`targetOnAttackerSelectedObjective`, `attackerOnTargetSelectedObjective`, and
`targetOnTargetSelectedObjective`. The shorter aliases
`attackerOnOwnSelectedObjective` and `targetOnOwnSelectedObjective` are accepted
for the two same-side facts.
Likewise, `targetBattleShocked=true` or `attackerBattleShocked=true` resolves
compatible exact source rules before later numeric overrides are applied.
`targetStrength=below-half` and the other two strength values likewise resolve
compatible exact target-strength rules before numeric overrides.
`closestTarget=true` activates source-exact closest-eligible-target rules. The
safe default is false; compound closest-or-other-condition rules remain manual
until every branch is represented.
Distance-gated source abilities apply only when the value is known and within
their published limit; `0` deliberately means unknown and leaves them inactive.

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

`GET /api/v1/firing-deck?unit={transportId}&passenger={passengerId}&attached={attachedUnitId}` discovers
that legally compatible passenger's eligible ranged weapons and slot cost.
`GET /api/v1/leader?unit={leaderId}&bodyguard={bodyguardId}` lists the Leader's
published Bodyguard options and, when `bodyguard` is supplied, returns exact
pair eligibility and a readable reason. Optional repeated `leaderWeapon` and
`leaderChoice` parameters resolve equipment-gated pairs. The same `leaderBodyguardIds` are
included in catalogue and loadout discovery responses.
`GET /api/v1/leader-formation?bodyguard={bodyguardId}&leader={leaderId}&leader={leaderId}&models={count}`
checks a complete formation, including the global two-Leader ceiling,
datasheet-specific exceptions, starting-strength conditions, minimum-Leader
requirements, and duplicate restrictions. Its response includes the normalized
rules and pinned official Rules Commentary source identity.
`GET /api/v1/bodyguard-join?unit={joiningUnitId}&bodyguard={bodyguardId}&models={count}&bodyguardModels={count}&attached={true|false}&existingSameJoiners={count}`
discovers exceptional non-Leader joins, checks the exact pair, and returns the
combined Starting Strength and source rule. Optional formation-state parameters
enforce the not-Attached and one-copy restrictions.
`GET /api/v1/transport?unit={transportId}&passenger={passengerId}&attached={attachedUnitId}&models={count}`
returns the exact source clause, eligibility, per-model cost, total spaces, and
whether the selection fits in its matched independent pool; the response lists
every pool or mode, its kind, Wounds ceiling, and required keywords, plus all
special allowances, whether they consume primary capacity, their model ceiling,
and any conditional primary-capacity limit. `attached` is optional except when a published
attachment exception is required. `POST
/api/v1/validate-firing-deck` validates one or more explicit passenger/model/
weapon selections, the aggregate Firing Deck limit, phase eligibility, and
returns the transport bearer ID before clients build exact or simulated volley
profiles.

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
