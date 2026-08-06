#include "warhammercalculator/calculator.h"

/*@ assigns \nothing;
    ensures \result == 6;
*/
uint8_t whc_prove_ap4_against_save2(void) {
    uint8_t result = saves_on(2u, 0u, 4u);

    /*@ assert result == 6; */
    return result;
}

/*@ requires 2 <= save && save <= 7;
    requires invulnerable_save == 0 || (2 <= invulnerable_save && invulnerable_save <= 6);
    requires ap < UINT16_MAX;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_ap_monotonic(uint8_t save, uint8_t invulnerable_save, uint16_t ap) {
    uint8_t lower_ap = saves_on(save, invulnerable_save, ap);
    uint8_t higher_ap = saves_on(save, invulnerable_save, (uint16_t)(ap + 1u));

    /*@ assert lower_ap <= higher_ap; */
    return lower_ap <= higher_ap;
}

/*@ requires 2 <= save && save <= 7;
    requires 2 <= invulnerable_save && invulnerable_save <= 6;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_invulnerable_save_caps_ap(uint8_t save, uint8_t invulnerable_save, uint16_t ap) {
    uint8_t threshold = saves_on(save, invulnerable_save, ap);

    /*@ assert threshold <= invulnerable_save; */
    return threshold <= invulnerable_save;
}

/*@ requires 2 <= save && save <= 3;
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_cover_does_not_improve_good_save_against_ap0(uint8_t save) {
    uint8_t without_cover = saves_on(save, 0u, 0u);
    uint8_t with_cover = saves_on_with_cover(save, 0u, 0u);

    /*@ assert without_cover == with_cover; */
    return without_cover == with_cover;
}

/*@ requires 2 <= save && save <= 7;
    requires invulnerable_save == 0 || (2 <= invulnerable_save && invulnerable_save <= 6);
    assigns \nothing;
    ensures \result;
*/
bool whc_prove_cover_never_worsens_save(uint8_t save, uint8_t invulnerable_save, uint16_t ap) {
    uint8_t without_cover = saves_on(save, invulnerable_save, ap);
    uint8_t with_cover = saves_on_with_cover(save, invulnerable_save, ap);

    /*@ assert with_cover <= without_cover; */
    return with_cover <= without_cover;
}
