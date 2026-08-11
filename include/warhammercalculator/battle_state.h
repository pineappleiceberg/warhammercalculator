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
#define WHC_BATTLE_CLOCK_FIELDS 8u
#define WHC_BATTLE_PLAYER_NONE 2u

enum whc_battle_clock_status {
    WHC_BATTLE_CLOCK_SETUP = 0u,
    WHC_BATTLE_CLOCK_ACTIVE = 1u,
    WHC_BATTLE_CLOCK_COMPLETE = 2u
};

enum whc_battle_phase {
    WHC_BATTLE_PHASE_SETUP = 0u,
    WHC_BATTLE_PHASE_COMMAND = 1u,
    WHC_BATTLE_PHASE_MOVEMENT = 2u,
    WHC_BATTLE_PHASE_SHOOTING = 3u,
    WHC_BATTLE_PHASE_CHARGE = 4u,
    WHC_BATTLE_PHASE_FIGHT = 5u,
    WHC_BATTLE_PHASE_COMPLETE = 6u
};

enum whc_battle_event_kind {
    WHC_BATTLE_EVENT_ATTACK = 1u,
    WHC_BATTLE_EVENT_REVERT = 2u,
    WHC_BATTLE_EVENT_TRANSPORT_DAMAGE = 3u
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

/*@ requires first_player_index <= 1;
    requires \valid(clock + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1));
    assigns clock[0 .. WHC_BATTLE_CLOCK_FIELDS - 1];
    ensures \result;
    ensures clock[0] == WHC_BATTLE_CLOCK_ACTIVE;
    ensures clock[1] == 1 && clock[2] == 1;
    ensures clock[3] == WHC_BATTLE_PHASE_COMMAND && clock[4] == 0;
    ensures clock[5] == first_player_index && clock[6] == first_player_index &&
            clock[7] == first_player_index;
*/
bool whc_start_battle_clock(uint32_t first_player_index, uint32_t *clock);

/*@ requires \valid_read(current + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1));
    requires \valid(next + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1));
    requires \separated(current + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1),
                        next + (0 .. WHC_BATTLE_CLOCK_FIELDS - 1));
    assigns next[0 .. WHC_BATTLE_CLOCK_FIELDS - 1];
    ensures !\result ==> \forall integer index; 0 <= index < WHC_BATTLE_CLOCK_FIELDS ==>
                next[index] == \old(next[index]);
    ensures \result ==> next[0] == WHC_BATTLE_CLOCK_ACTIVE ||
                         next[0] == WHC_BATTLE_CLOCK_COMPLETE;
    ensures \result ==> 1 <= next[1] && next[1] <= 5;
    ensures \result ==> 1 <= next[2] && next[2] <= 2;
    ensures \result ==> next[5] <= 1;
    ensures \result ==> next[0] == WHC_BATTLE_CLOCK_COMPLETE || next[7] <= 1;
*/
bool whc_next_battle_clock(const uint32_t *current, uint32_t *next);

#endif
