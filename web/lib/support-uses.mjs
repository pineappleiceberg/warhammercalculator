const MAX_SUPPORT_UNITS = 200;
const MAX_PRESETS_PER_UNIT = 100;
const MAX_USES_PER_PRESET = 1_000;

function record(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !value || value.length > 200) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function normalizeSupportUses(value = {}) {
  const source = record(value, "Support uses must be an object");
  const units = Object.entries(source);
  if (units.length > MAX_SUPPORT_UNITS) throw new Error("Too many support units");
  const normalized = {};
  for (const [unitId, presetValues] of units) {
    identifier(unitId, "Support unit id");
    const presets = Object.entries(record(presetValues, "Support preset uses must be an object"));
    if (presets.length > MAX_PRESETS_PER_UNIT) throw new Error("Too many support presets");
    const normalizedPresets = {};
    for (const [presetId, spent] of presets) {
      identifier(presetId, "Support preset id");
      if (!Number.isSafeInteger(spent) || spent < 0 || spent > MAX_USES_PER_PRESET) {
        throw new Error("Support use count is invalid");
      }
      if (spent > 0) normalizedPresets[presetId] = spent;
    }
    if (Object.keys(normalizedPresets).length) normalized[unitId] = normalizedPresets;
  }
  return normalized;
}

export function supportUsesRemaining(uses, unitId, presetId, usesPerBattle) {
  if (!Number.isSafeInteger(usesPerBattle) || usesPerBattle <= 0) return null;
  const spent = normalizeSupportUses(uses)[unitId]?.[presetId] ?? 0;
  return Math.max(0, usesPerBattle - spent);
}

export function spendSupportUse(uses, unitId, presetId, usesPerBattle) {
  identifier(unitId, "Support unit id");
  identifier(presetId, "Support preset id");
  if (!Number.isSafeInteger(usesPerBattle) || usesPerBattle <= 0) {
    throw new Error("Uses per battle is invalid");
  }
  const normalized = normalizeSupportUses(uses);
  const spent = normalized[unitId]?.[presetId] ?? 0;
  if (spent >= usesPerBattle) throw new Error("This support ability has no uses remaining");
  return {
    ...normalized,
    [unitId]: { ...normalized[unitId], [presetId]: spent + 1 },
  };
}

export function setSupportUsesRemaining(uses, unitId, presetId, usesPerBattle, remaining) {
  identifier(unitId, "Support unit id");
  identifier(presetId, "Support preset id");
  if (
    !Number.isSafeInteger(usesPerBattle) ||
    usesPerBattle <= 0 ||
    !Number.isSafeInteger(remaining) ||
    remaining < 0 ||
    remaining > usesPerBattle
  ) {
    throw new Error("Remaining support uses is invalid");
  }
  const normalized = normalizeSupportUses(uses);
  const nextUnit = { ...normalized[unitId] };
  const spent = usesPerBattle - remaining;
  if (spent) nextUnit[presetId] = spent;
  else delete nextUnit[presetId];
  if (Object.keys(nextUnit).length) return { ...normalized, [unitId]: nextUnit };
  const next = { ...normalized };
  delete next[unitId];
  return next;
}

export function commitSupportPresetSelection(presets, currentIds, nextIds, unitId, uses) {
  const added = nextIds.filter((id) => !currentIds.includes(id));
  if (added.length > 1) throw new Error("Only one support ability can be activated at a time");
  if (!added.length) return { selectedIds: nextIds, uses: normalizeSupportUses(uses) };
  const preset = presets.find((candidate) => candidate.id === added[0]);
  if (!preset) throw new Error("Unknown support ability");
  return {
    selectedIds: nextIds,
    uses: preset.usesPerBattle
      ? spendSupportUse(uses, unitId, preset.id, preset.usesPerBattle)
      : normalizeSupportUses(uses),
  };
}
