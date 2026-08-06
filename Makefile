CC ?= gcc
CFLAGS ?= -std=c17 -O2 -Wall -Wextra -Wpedantic -Wconversion -Wshadow
CPPFLAGS ?= -Iinclude

all: test_calculator test_properties

test_calculator: src/calculator.c src/web_api.c include/warhammercalculator/calculator.h include/warhammercalculator/web_api.h tests/test_calculator.c
	$(CC) $(CPPFLAGS) $(CFLAGS) src/calculator.c src/web_api.c tests/test_calculator.c -o $@

test_properties: src/calculator.c include/warhammercalculator/calculator.h tests/test_properties.c
	$(CC) $(CPPFLAGS) $(CFLAGS) src/calculator.c tests/test_properties.c -o $@

test: test_calculator test_properties
	./test_calculator
	./test_properties

clean:
	rm -f test_calculator test_properties test_calculator_san calculator.o

.PHONY: all test clean
