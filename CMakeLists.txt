cmake_minimum_required(VERSION 3.21)

project(
    warhammercalculator
    VERSION 0.1.0
    DESCRIPTION "Warhammer expected damage calculator"
    LANGUAGES C
)

include(CTest)

add_library(warhammercalculator STATIC
    src/calculator.c
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
        "SHELL:-s EXPORTED_FUNCTIONS=['_main','_malloc','_free','_whc_calculate_summary','_calculate_attack_damage_distribution','_calculate_attack_expected_damage','_calculate_attack_damage_summary','_rule_set_clear','_rule_add_lethal_hits','_rule_add_devastating_wounds','_rule_add_twin_linked','_rule_add_reroll_failed_hits','_rule_add_wounds_on','_rule_add_critical_wounds_on','_rule_add_hit_reroll_mask','_rule_add_wound_reroll_mask','_wounds_on','_saves_on']"
        "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue']"
    )
endif()

if(BUILD_TESTING)
    add_executable(warhammercalculator_tests tests/test_calculator.c)
    target_link_libraries(warhammercalculator_tests PRIVATE warhammercalculator::warhammercalculator)
    add_test(NAME warhammercalculator_tests COMMAND warhammercalculator_tests)
endif()
