CC ?= gcc
CFLAGS ?= -std=c17 -O2 -Wall -Wextra -Wpedantic -Wconversion -Wshadow
CPPFLAGS ?= -Iinclude

all: test_calculator

test_calculator: src/calculator.c include/warhammercalculator/calculator.h tests/test_calculator.c
	$(CC) $(CPPFLAGS) $(CFLAGS) src/calculator.c tests/test_calculator.c -o $@

test: test_calculator
	./test_calculator

clean:
	rm -f test_calculator test_calculator_san calculator.o

.PHONY: all test clean
