# Rules interaction corpus

`rules_interaction_cases.inc` is the shared native C, WebAssembly, API, and
simulation regression corpus for Warhammer 40,000 10th-edition attack
interactions. Its expected values are reduced exact fractions derived from the
September 2024 English Core Rules and Core Rules Updates/Rules Commentary:

- [Core Rules](https://assets.warhammer-community.com/warhammer40000_core%26key_corerules_eng_24.09-5xfayxjekm.pdf)
- [Core Rules Updates and Rules Commentary](https://assets.warhammer-community.com/warhammer40000_core%26key_corerulesupdate%26commentary_eng_24.09-lyrhcoyn9s.pdf)

The corpus fixes these interpretations:

- Critical Hits and Critical Wounds use the unmodified die and always succeed,
  except where Indirect Fire explicitly makes unmodified Hit rolls of 1-3 fail.
- Re-rolls occur before modifiers. Hit and Wound modifiers accumulate and their
  final modifier is capped at +1 or -1.
- Lethal Hits automatically wounds only the original Critical Hit. Additional
  hits from Sustained Hits make Wound rolls normally.
- Devastating Wounds bypasses armour and invulnerable saves, but does not bypass
  Feel No Pain. Excess damage from one Devastating Wounds attack is lost when
  its allocated model is destroyed.
- Attacks with Devastating Wounds are allocated only after every ordinary attack
  made by the attacking unit has been allocated and resolved.

Each `WHC_RULE_CASE` stores, in order, its name; Attacks, Hit threshold,
Strength, AP, Damage, and Critical Hit threshold; target Toughness, save,
invulnerable save, Feel No Pain, Wounds, and model count; packed rule flags,
Critical Wound threshold, Sustained Hits value, Hit modifier, and Wound
modifier; then the exact potential and applied mean fractions.

| Case | Locked interaction | Potential | Applied |
| --- | --- | ---: | ---: |
| `baseline` | Ordinary attack sequence | 8/3 | 8/3 |
| `modifier_does_not_expand_critical_hit` | A +1 does not turn a modified result into a Critical Hit | 1/4 | 1/4 |
| `critical_hit_succeeds_through_penalty` | An unmodified Critical Hit succeeds despite a penalty | 5/6 | 5/6 |
| `negative_modifier_preserves_sustained_critical` | A penalty does not suppress Sustained Hits on an unmodified critical | 5/12 | 5/12 |
| `reroll_lethal_devastating_modifiers` | Re-roll 1s, both modifiers, Lethal Hits, and Devastating Wounds | 49/72 | 49/72 |
| `sustained_hits_are_not_lethal` | Sustained additional hits do not inherit Lethal Hits | 10/9 | 10/9 |
| `wound_ones_devastating_negative_modifier` | Wound re-roll 1s and a penalty preserve unmodified criticals | 49/108 | 49/108 |
| `full_wound_reroll_critical_bypass` | Failed Wound re-rolls, a bonus, and a 5+ critical bypass | 28/27 | 28/27 |
| `devastating_only_bypasses_on_critical_wound` | Only the critical branch bypasses an invulnerable save | 2/3 | 2/3 |
| `devastating_respects_feel_no_pain` | Feel No Pain applies after Devastating Wounds | 4/9 | 4/9 |
| `indirect_low_critical_faces_fail` | Indirect Fire's unmodified 1-3 failure overrides a broad critical range | 1/2 | 1/2 |
| `critical_wound_succeeds_through_penalty` | A Critical Wound succeeds despite a Wound penalty | 1/2 | 1/2 |
| `devastating_damage_does_not_spill` | Devastating damage is lost when its allocated model is destroyed | 5/2 | 5/3 |

The exact fractions are independently reviewable from D6 face counts. For
example, `sustained_hits_are_not_lethal` has a 4/9 Critical Hit chance and a 4/9
normal Hit chance after failed Hit re-rolls. Sustained Hits 2 adds 8/9 ordinary
hits, producing `4/9 + (4/9 + 8/9) × 1/2 = 10/9` wounds. In
`reroll_lethal_devastating_modifiers`, re-rolling Hit rolls of 1 gives a 7/36
Lethal Hit chance and a 7/9 ordinary Hit chance. The former fails a 2+ save on
1/6; the latter has a 1/4 chance to inflict damage after its modified Wound roll
and Devastating Wounds branches, so Damage 3 yields
`3 × (7/216 + 7/36) = 49/72`.

The ordered-volley regressions supplement the row corpus because their expected
value depends on interactions between weapon profiles. A D2 Devastating attack
listed before an ordinary D3 attack into two 3-wound models produces a mean of
`25/36 × 5 + 5/36 × 2 + 5/36 × 3 = 25/6`; reversing the listed profiles gives
the same final distribution because the D2 packet still resolves last. A second
case combines a 2+ Critical Hit, Lethal Hits, Sustained Hits 1, and 2+ Critical
Wounds. The original Lethal hit remains ordinary, the additional hit rolls to
wound and is deferred on a critical, and the hand-derived applied mean is
`875/216`.
