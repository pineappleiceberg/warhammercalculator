cmake_minimum_required(VERSION 3.21)

project(
    warhammercalculator
    VERSION 0.1.0
    DESCRIPTION "Warhammer expected damage calculator"
    LANGUAGES C
)

include(CTest)

option(WHC_BUILD_FUZZER "Build the Clang libFuzzer harness" OFF)
option(WHC_BUILD_BENCHMARKS "Build deterministic large-volley benchmarks" OFF)
set(WHC_BENCHMARK_MAX_MS 250 CACHE STRING "Maximum milliseconds per benchmark iteration")

add_library(warhammercalculator STATIC
    src/battle_state.c
    src/calculator.c
    src/complexity.c
    src/web_api.c
)

add_library(warhammercalculator::warhammercalculator ALIAS warhammercalculator)

target_include_directories(warhammercalculator
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
)

target_compile_features(warhammercalculator PUBLIC c_std_17)

if(MSVC)
    target_compile_options(warhammercalculator PRIVATE /W4)
else()
    target_compile_options(warhammercalculator PRIVATE
        -Wall
        -Wextra
        -Wpedantic
        -Wconversion
        -Wshadow
    )
endif()

add_executable(warhammercalculator_app src/main.c)
target_link_libraries(warhammercalculator_app PRIVATE warhammercalculator::warhammercalculator)

if(EMSCRIPTEN)
    set_target_properties(warhammercalculator_app PROPERTIES
        OUTPUT_NAME "calculator"
        SUFFIX ".js"
    )

    target_link_options(warhammercalculator_app PRIVATE
        "SHELL:-s WASM=1"
        "SHELL:-s ALLOW_MEMORY_GROWTH=1"
        "SHELL:-s ASSERTIONS=1"
        "SHELL:-s MODULARIZE=1"
        "SHELL:-s EXPORT_ES6=1"
        "SHELL:-s EXPORT_NAME=createWarhammerCalculator"
        "SHELL:-s ENVIRONMENT=web,node"
        "SHELL:-s MINIFY_HTML=0"
        "SHELL:-s EXPORTED_FUNCTIONS=['_main','_malloc','_free','_whc_calculate_summary','_whc_calculate_summary_with_characteristic_roll','_whc_calculate_ordered_volley_summary','_whc_estimate_ordered_volley_complexity','_whc_replay_battle_health_events','_whc_ranged_target_eligibility_is_valid','_whc_ranged_geometry_resolution_is_valid','_whc_convex_silhouette_is_valid','_whc_simple_terrain_surface_is_valid','_whc_weapon_inventory_declaration_is_valid','_whc_weapon_bearer_declaration_is_valid','_whc_charge_resolution_is_valid','_whc_fight_move_is_valid','_whc_heroic_intervention_is_valid','_whc_fire_overwatch_is_valid','_whc_hazardous_resolution_is_valid','_whc_go_to_ground_is_valid','_whc_counter_offensive_is_valid','_whc_smokescreen_is_valid','_whc_rapid_ingress_is_valid','_whc_rule_coverage_is_permitted','_whc_ranged_declaration_is_valid','_whc_transport_load_is_valid','_whc_transport_deployment_chain_is_valid','_whc_initial_deployment_is_valid','_whc_table_geometry_is_valid','_whc_terrain_footprint_set_is_valid','_whc_model_placement_set_is_valid','_whc_model_position_set_is_valid','_whc_spatial_facts_are_valid','_whc_endpoint_clearance_facts_are_valid','_whc_terrain_clearance_facts_are_valid','_whc_mission_tracker_facts_are_valid','_whc_waaagh_state_is_valid','_whc_grim_resolve_model_objective_control_is_valid','_whc_objective_control_facts_are_valid','_whc_visibility_facts_are_valid','_whc_start_battle_clock','_whc_next_battle_clock','_calculate_attack_damage_distribution','_calculate_attack_applied_damage_distribution','_calculate_ordered_volley_applied_damage_distribution','_estimate_ordered_volley_complexity','_calculate_attack_expected_damage','_calculate_attack_damage_summary','_calculate_attack_applied_damage_summary','_probability_distribution_is_normalized','_attack_plan_is_valid','_dice_value_is_valid','_allocate_damage_to_unit','_allocate_damage_to_target_unit','_target_unit_capacity','_attack_roll_succeeds','_modified_roll_threshold','_rule_set_clear','_rule_add_lethal_hits','_rule_add_devastating_wounds','_rule_add_twin_linked','_rule_add_reroll_failed_hits','_rule_add_reroll_failed_wounds','_rule_add_wounds_on','_rule_add_critical_wounds_on','_rule_add_hit_reroll_mask','_rule_add_wound_reroll_mask','_rule_add_hit_auto_fails_through','_wounds_on','_saves_on','_saves_on_with_cover']"
        "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue']"
    )
endif()

if(WHC_BUILD_BENCHMARKS)
    add_executable(warhammercalculator_benchmark benchmarks/benchmark_volley.c)
    target_link_libraries(warhammercalculator_benchmark
        PRIVATE warhammercalculator::warhammercalculator
    )
    if(EMSCRIPTEN)
        set_target_properties(warhammercalculator_benchmark PROPERTIES SUFFIX ".js")
        target_link_options(warhammercalculator_benchmark PRIVATE
            "SHELL:-s ENVIRONMENT=node"
            "SHELL:-s SINGLE_FILE=1"
            "SHELL:-s EXIT_RUNTIME=1"
        )
    endif()
    if(BUILD_TESTING)
        add_test(NAME warhammercalculator_benchmark_smoke
            COMMAND warhammercalculator_benchmark 1 ${WHC_BENCHMARK_MAX_MS}
        )
        set_tests_properties(warhammercalculator_benchmark_smoke PROPERTIES TIMEOUT 30)
    endif()
endif()

if(BUILD_TESTING)
    add_executable(warhammercalculator_tests tests/test_calculator.c)
    target_link_libraries(warhammercalculator_tests PRIVATE warhammercalculator::warhammercalculator)
    add_test(NAME warhammercalculator_tests COMMAND warhammercalculator_tests)

    add_executable(warhammercalculator_property_tests tests/test_properties.c)
    target_link_libraries(warhammercalculator_property_tests
        PRIVATE warhammercalculator::warhammercalculator
    )
    if(NOT MSVC)
        target_link_libraries(warhammercalculator_property_tests PRIVATE m)
    endif()
    add_test(NAME warhammercalculator_property_tests COMMAND warhammercalculator_property_tests)

    add_executable(warhammercalculator_contract_checks formal/runtime_checks.c)
    target_link_libraries(warhammercalculator_contract_checks
        PRIVATE warhammercalculator::warhammercalculator
    )
    add_test(NAME warhammercalculator_contract_checks COMMAND warhammercalculator_contract_checks)

    foreach(test_target
            warhammercalculator_tests
            warhammercalculator_property_tests
            warhammercalculator_contract_checks)
        if(MSVC)
            target_compile_options(${test_target} PRIVATE /UNDEBUG)
        else()
            target_compile_options(${test_target} PRIVATE -UNDEBUG)
        endif()
    endforeach()
endif()

if(WHC_BUILD_FUZZER)
    if(NOT CMAKE_C_COMPILER_ID MATCHES "Clang")
        message(FATAL_ERROR "WHC_BUILD_FUZZER requires Clang with libFuzzer support")
    endif()
    add_executable(warhammercalculator_fuzz
        tests/fuzz_calculator.c
        src/battle_state.c
        src/calculator.c
        src/complexity.c
        src/web_api.c
    )
    target_include_directories(warhammercalculator_fuzz PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
    target_compile_features(warhammercalculator_fuzz PRIVATE c_std_17)
    target_compile_options(warhammercalculator_fuzz PRIVATE
        -Wall
        -Wextra
        -Wpedantic
        -Wconversion
        -Wshadow
        -fno-omit-frame-pointer
        -fsanitize=fuzzer,address,undefined
    )
    target_link_options(warhammercalculator_fuzz PRIVATE
        -fno-omit-frame-pointer
        -fsanitize=fuzzer,address,undefined
    )
    if(BUILD_TESTING)
        add_test(NAME warhammercalculator_fuzz_smoke
            COMMAND warhammercalculator_fuzz -runs=2000 -max_len=128 -timeout=20 -seed=1
        )
        set_tests_properties(warhammercalculator_fuzz_smoke PROPERTIES
            TIMEOUT 300
            ENVIRONMENT "ASAN_OPTIONS=abort_on_error=1"
        )
    endif()
endif()

if(UNIX)
    find_program(FRAMA_C_EXECUTABLE frama-c)
    find_program(E_ACSL_GCC_EXECUTABLE e-acsl-gcc.sh)

    if(FRAMA_C_EXECUTABLE)
        add_custom_target(formal-parse
            COMMAND ${CMAKE_COMMAND} -E env FRAMA_C=${FRAMA_C_EXECUTABLE}
                    bash ${CMAKE_CURRENT_SOURCE_DIR}/scripts/run_formal.sh parse
            WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        )
        add_custom_target(formal-wp
            COMMAND ${CMAKE_COMMAND} -E env FRAMA_C=${FRAMA_C_EXECUTABLE}
                    bash ${CMAKE_CURRENT_SOURCE_DIR}/scripts/run_formal.sh wp
            WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        )
        add_custom_target(formal-eva
            COMMAND ${CMAKE_COMMAND} -E env FRAMA_C=${FRAMA_C_EXECUTABLE}
                    bash ${CMAKE_CURRENT_SOURCE_DIR}/scripts/run_formal.sh eva
            WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        )
    endif()

    if(FRAMA_C_EXECUTABLE AND E_ACSL_GCC_EXECUTABLE)
        add_custom_target(formal-e-acsl
            COMMAND ${CMAKE_COMMAND} -E env FRAMA_C=${FRAMA_C_EXECUTABLE}
                    E_ACSL_GCC=${E_ACSL_GCC_EXECUTABLE}
                    bash ${CMAKE_CURRENT_SOURCE_DIR}/scripts/run_formal.sh e-acsl
            WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        )
    endif()
endif()
