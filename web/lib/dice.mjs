export function parseDice(value) {
  const normalized = value.replace(/\s/g, "");
  const fixed = /^\d+$/.exec(normalized);
  if (fixed) return { count: 0, sides: 0, modifier: Number(fixed[0]) };
  const dice = /^(\d*)D(\d+)([+-]\d+)?$/i.exec(normalized);
  if (!dice) return null;
  return {
    count: dice[1] ? Number(dice[1]) : 1,
    sides: Number(dice[2]),
    modifier: Math.max(0, Number(dice[3] ?? 0)),
  };
}

export function abilityDiceValue(ability) {
  return parseDice(ability?.value ?? "") ?? { count: 0, sides: 0, modifier: 0 };
}
