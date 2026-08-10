#ifndef WARHAMMERCALCULATOR_BATTLE_STATE_H
#define WARHAMMERCALCULATOR_BATTLE_STATE_H

#include <stdbool.h>
#include <stdint.h>

#define WHC_BATTLE_EVENT_VERSION 1u
#define WHC_BATTLE_STATE_VERSION WHC_BATTLE_EVENT_VERSION
#define WHC_MAX_BATTLE_SEGMENTS 32u
#define WHC_MAX_BATTLE_EVENTS 10000u
#define WHC_BATTLE_PROFILE_FIELDS 2u
#define WHC_BATTLE_EVENT_HEADER_FIELDS 6u
#define WHC_BATTLE_ALLOCATION_FIELDS 5u
#define WHC_BATTLE_EVENT_FIELDS \
    (WHC_BATTLE_EVENT_HEADER_FIELDS + WHC_MAX_BATTLE_SEGMENTS * WHC_BATTLE_ALLOCATION_FIELDS)
#define WHC_BATTLE_HEALTH_FIELDS 2u

enum whc_battle_event_kind {
    WHC_BATTLE_EVENT_ATTACK = 1u,
    WHC_BATTLE_EVENT_REVERT = 2u
};

/*@ requires 1 <= segment_count && segment_count <= WHC_MAX_BATTLE_SEGMENTS;
    requires event_count <= WHC_MAX_BATTLE_EVENTS;
    requires \valid_read(profiles + (0 .. segment_count * WHC_BATTLE_PROFILE_FIELDS - 1));
    requires \forall integer index; 0 <= index < segment_count ==>
                profiles[index * WHC_BATTLE_PROFILE_FIELDS] > 0 &&
                profiles[index * WHC_BATTLE_PROFILE_FIELDS + 1] > 0;
    requires event_count == 0 ||
             \valid_read(events + (0 .. event_count * WHC_BATTLE_EVENT_FIELDS - 1));
    requires \valid(health + (0 .. segment_count * WHC_BATTLE_HEALTH_FIELDS - 1));
    requires \separated(profiles + (0 .. segment_count * WHC_BATTLE_PROFILE_FIELDS - 1),
                        health + (0 .. segment_count * WHC_BATTLE_HEALTH_FIELDS - 1));
    requires event_count == 0 ||
             \separated(events + (0 .. event_count * WHC_BATTLE_EVENT_FIELDS - 1),
                        health + (0 .. segment_count * WHC_BATTLE_HEALTH_FIELDS - 1));
    assigns health[0 .. segment_count * WHC_BATTLE_HEALTH_FIELDS - 1];
    ensures !\result ==> \forall integer index;
                0 <= index < segment_count * WHC_BATTLE_HEALTH_FIELDS ==>
                    health[index] == \old(health[index]);
    ensures \result ==> \forall integer index; 0 <= index < segment_count ==>
                health[index * WHC_BATTLE_HEALTH_FIELDS] <=
                    profiles[index * WHC_BATTLE_PROFILE_FIELDS + 1] &&
                health[index * WHC_BATTLE_HEALTH_FIELDS + 1] <
                    profiles[index * WHC_BATTLE_PROFILE_FIELDS] &&
                (health[index * WHC_BATTLE_HEALTH_FIELDS] > 0 ||
                 health[index * WHC_BATTLE_HEALTH_FIELDS + 1] == 0);
    ensures \result && event_count == 0 ==> \forall integer index;
                0 <= index < segment_count ==>
                    health[index * WHC_BATTLE_HEALTH_FIELDS] ==
                        profiles[index * WHC_BATTLE_PROFILE_FIELDS + 1] &&
                    health[index * WHC_BATTLE_HEALTH_FIELDS + 1] == 0;
    ensures event_count == 0 ==> \result;
*/
bool whc_replay_battle_health_events(const uint32_t *profiles, uint32_t segment_count,
                                     const uint32_t *events, uint32_t event_count,
                                     uint32_t *health);

#endif
