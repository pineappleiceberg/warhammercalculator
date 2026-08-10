#include "warhammercalculator/battle_state.h"

#include <stddef.h>
#include <string.h>

_Static_assert(WHC_BATTLE_EVENT_FIELDS == 166u, "Battle event ABI changed");

/*@ assigns \nothing;
    ensures \result <==> wounds > 0 && starting_models > 0 &&
                            models_remaining <= starting_models && wounds_lost < wounds &&
                            (models_remaining > 0 || wounds_lost == 0);
*/
static bool whc_battle_health_is_valid(uint32_t wounds, uint32_t starting_models,
                                       uint32_t models_remaining, uint32_t wounds_lost) {
    return wounds > 0u && starting_models > 0u && models_remaining <= starting_models &&
           wounds_lost < wounds && (models_remaining > 0u || wounds_lost == 0u);
}

bool whc_replay_battle_health_events(const uint32_t *profiles, uint32_t segment_count,
                                     const uint32_t *events, uint32_t event_count,
                                     uint32_t *health) {
    uint32_t current[WHC_MAX_BATTLE_SEGMENTS * WHC_BATTLE_HEALTH_FIELDS];
    uint32_t next[WHC_MAX_BATTLE_SEGMENTS * WHC_BATTLE_HEALTH_FIELDS];
    uint16_t active_events[WHC_MAX_BATTLE_EVENTS];
    uint32_t active_count = 0u;

    if (profiles == NULL || health == NULL || segment_count == 0u ||
        segment_count > WHC_MAX_BATTLE_SEGMENTS || event_count > WHC_MAX_BATTLE_EVENTS ||
        (event_count > 0u && events == NULL)) {
        return false;
    }

    for (uint32_t segment = 0u; segment < segment_count; ++segment) {
        const uint32_t profile_offset = segment * WHC_BATTLE_PROFILE_FIELDS;
        const uint32_t health_offset = segment * WHC_BATTLE_HEALTH_FIELDS;
        const uint32_t wounds = profiles[profile_offset];
        const uint32_t starting_models = profiles[profile_offset + 1u];
        if (!whc_battle_health_is_valid(wounds, starting_models, starting_models, 0u)) {
            return false;
        }
        current[health_offset] = starting_models;
        current[health_offset + 1u] = 0u;
    }

    for (uint32_t event_index = 0u; event_index < event_count; ++event_index) {
        const uint32_t event_offset = event_index * WHC_BATTLE_EVENT_FIELDS;
        const uint32_t version = events[event_offset];
        const uint32_t kind = events[event_offset + 1u];
        const uint32_t allocation_count = events[event_offset + 2u];
        const uint32_t reverts_event_index = events[event_offset + 3u];
        const uint32_t expected_damage = events[event_offset + 4u];
        const uint32_t expected_destroyed = events[event_offset + 5u];

        if (version != WHC_BATTLE_STATE_VERSION) {
            return false;
        }

        memcpy(next, current, segment_count * WHC_BATTLE_HEALTH_FIELDS * sizeof(uint32_t));
        if (kind == WHC_BATTLE_EVENT_ATTACK) {
            bool seen[WHC_MAX_BATTLE_SEGMENTS] = {false};
            uint64_t damage = 0u;
            uint64_t destroyed = 0u;

            if (allocation_count == 0u || allocation_count > segment_count) {
                return false;
            }
            for (uint32_t allocation = 0u; allocation < allocation_count; ++allocation) {
                const uint32_t allocation_offset =
                    event_offset + WHC_BATTLE_EVENT_HEADER_FIELDS +
                    allocation * WHC_BATTLE_ALLOCATION_FIELDS;
                const uint32_t segment = events[allocation_offset];
                const uint32_t before_models = events[allocation_offset + 1u];
                const uint32_t before_wounds = events[allocation_offset + 2u];
                const uint32_t after_models = events[allocation_offset + 3u];
                const uint32_t after_wounds = events[allocation_offset + 4u];
                uint32_t profile_offset;
                uint32_t health_offset;
                uint32_t wounds;

                if (segment >= segment_count || seen[segment]) {
                    return false;
                }
                seen[segment] = true;
                profile_offset = segment * WHC_BATTLE_PROFILE_FIELDS;
                health_offset = segment * WHC_BATTLE_HEALTH_FIELDS;
                wounds = profiles[profile_offset];
                if (current[health_offset] != before_models ||
                    current[health_offset + 1u] != before_wounds ||
                    !whc_battle_health_is_valid(wounds, profiles[profile_offset + 1u], after_models,
                                                after_wounds) ||
                    after_models > before_models ||
                    (after_models == before_models && after_wounds < before_wounds)) {
                    return false;
                }
                damage += (uint64_t)(before_models - after_models) * wounds + after_wounds -
                          before_wounds;
                destroyed += before_models - after_models;
                next[health_offset] = after_models;
                next[health_offset + 1u] = after_wounds;
            }
            if (damage != expected_damage || destroyed != expected_destroyed) {
                return false;
            }
            uint32_t wounded_segments = 0u;
            for (uint32_t segment = 0u; segment < segment_count; ++segment) {
                if (next[segment * WHC_BATTLE_HEALTH_FIELDS + 1u] > 0u) {
                    ++wounded_segments;
                }
            }
            if (wounded_segments > 1u) {
                return false;
            }
            active_events[active_count++] = (uint16_t)event_index;
        } else if (kind == WHC_BATTLE_EVENT_REVERT) {
            if (allocation_count != 0u || expected_damage != 0u || expected_destroyed != 0u ||
                active_count == 0u || reverts_event_index != active_events[active_count - 1u]) {
                return false;
            }
            const uint32_t reverted_offset = reverts_event_index * WHC_BATTLE_EVENT_FIELDS;
            const uint32_t reverted_allocations = events[reverted_offset + 2u];
            if (events[reverted_offset + 1u] != WHC_BATTLE_EVENT_ATTACK) {
                return false;
            }
            for (uint32_t allocation = 0u; allocation < reverted_allocations; ++allocation) {
                const uint32_t allocation_offset =
                    reverted_offset + WHC_BATTLE_EVENT_HEADER_FIELDS +
                    allocation * WHC_BATTLE_ALLOCATION_FIELDS;
                const uint32_t segment = events[allocation_offset];
                const uint32_t health_offset = segment * WHC_BATTLE_HEALTH_FIELDS;
                if (current[health_offset] != events[allocation_offset + 3u] ||
                    current[health_offset + 1u] != events[allocation_offset + 4u]) {
                    return false;
                }
                next[health_offset] = events[allocation_offset + 1u];
                next[health_offset + 1u] = events[allocation_offset + 2u];
            }
            --active_count;
        } else {
            return false;
        }
        memcpy(current, next, segment_count * WHC_BATTLE_HEALTH_FIELDS * sizeof(uint32_t));
    }

    memcpy(health, current, segment_count * WHC_BATTLE_HEALTH_FIELDS * sizeof(uint32_t));
    return true;
}
