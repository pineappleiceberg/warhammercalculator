#include "warhammercalculator/calculator.h"

#include <assert.h>
#include <stdint.h>

/*@ terminates \true;
    ensures \result == 0;
*/
int main(void) {
    uint8_t save = 2u;

    /*@ loop invariant 2 <= save && save <= 8;
        loop assigns save;
        loop variant 8 - save;
    */
    while (save <= 7u) {
        uint8_t invulnerable = 0u;

        /*@ loop invariant 0 <= invulnerable && invulnerable <= 7;
            loop assigns invulnerable;
            loop variant 7 - invulnerable;
        */
        while (invulnerable <= 6u) {
            uint16_t ap = 0u;

            if (invulnerable == 1u) {
                invulnerable = 2u;
            }

            /*@ loop invariant 0 <= ap && ap <= 13;
                loop assigns ap;
                loop variant 13 - ap;
            */
            while (ap <= 12u) {
                uint8_t threshold = saves_on(save, invulnerable, ap);
                uint8_t covered = saves_on_with_cover(save, invulnerable, ap);

                assert(threshold >= 2u && threshold <= 7u);
                assert(covered >= 2u && covered <= threshold);
                if (invulnerable != 0u) {
                    assert(threshold <= invulnerable);
                }
                ap++;
            }

            invulnerable++;
        }

        save++;
    }

    assert(saves_on(2u, 0u, 4u) == 6u);
    assert(saves_on_with_cover(2u, 0u, 4u) == 5u);
    return 0;
}
