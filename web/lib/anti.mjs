export function antiWoundThreshold(abilities, targetKeywords) {
  const keywords = new Set(targetKeywords.map((keyword) => keyword.trim().toLowerCase()));
  let threshold = 0;

  for (const ability of abilities) {
    if (!ability.name.startsWith("anti-") || !keywords.has(ability.name.slice(5))) continue;
    const value = Number(String(ability.value ?? "").replace("+", ""));
    if (Number.isInteger(value) && value >= 2 && value <= 6) {
      threshold = threshold === 0 ? value : Math.min(threshold, value);
    }
  }

  return threshold;
}
