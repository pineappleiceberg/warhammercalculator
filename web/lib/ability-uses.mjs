const MAX_UNITS = 200;
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

export function normalizeAbilityUses(value = {}) {
  const source = record(value, "Ability uses must be an object");
  const units = Object.entries(source);
  if (units.length > MAX_UNITS) throw new Error("Too many ability source units");
  const normalized = {};
  for (const [unitId, presetValues] of units) {
    identifier(unitId, "Ability source unit id");
    const presets = Object.entries(record(presetValues, "Ability preset uses must be an object"));
    if (presets.length > MAX_PRESETS_PER_UNIT) throw new Error("Too many ability presets");
    const normalizedPresets = {};
    for (const [presetId, spent] of presets) {
      identifier(presetId, "Ability preset id");
      if (!Number.isSafeInteger(spent) || spent < 0 || spent > MAX_USES_PER_PRESET) {
        throw new Error("Ability use count is invalid");
      }
      if (spent > 0) normalizedPresets[presetId] = spent;
    }
    if (Object.keys(normalizedPresets).length) normalized[unitId] = normalizedPresets;
  }
  return normalized;
}

export function abilityUsesRemaining(uses, unitId, presetId, usesPerBattle) {
  if (!Number.isSafeInteger(usesPerBattle) || usesPerBattle <= 0) return null;
  const spent = normalizeAbilityUses(uses)[unitId]?.[presetId] ?? 0;
  return Math.max(0, usesPerBattle - spent);
}

export function spendAbilityUse(uses, unitId, presetId, usesPerBattle) {
  identifier(unitId, "Ability source unit id");
  identifier(presetId, "Ability preset id");
  if (!Number.isSafeInteger(usesPerBattle) || usesPerBattle <= 0) {
    throw new Error("Uses per battle is invalid");
  }
  const normalized = normalizeAbilityUses(uses);
  const spent = normalized[unitId]?.[presetId] ?? 0;
  if (spent >= usesPerBattle) throw new Error("This ability has no uses remaining");
  return {
    ...normalized,
    [unitId]: { ...normalized[unitId], [presetId]: spent + 1 },
  };
}

export function setAbilityUsesRemaining(uses, unitId, presetId, usesPerBattle, remaining) {
  identifier(unitId, "Ability source unit id");
  identifier(presetId, "Ability preset id");
  if (
    !Number.isSafeInteger(usesPerBattle) ||
    usesPerBattle <= 0 ||
    !Number.isSafeInteger(remaining) ||
    remaining < 0 ||
    remaining > usesPerBattle
  ) {
    throw new Error("Remaining ability uses is invalid");
  }
  const normalized = normalizeAbilityUses(uses);
  const nextUnit = { ...normalized[unitId] };
  const spent = usesPerBattle - remaining;
  if (spent) nextUnit[presetId] = spent;
  else delete nextUnit[presetId];
  if (Object.keys(nextUnit).length) return { ...normalized, [unitId]: nextUnit };
  const next = { ...normalized };
  delete next[unitId];
  return next;
}

export function commitAbilityPresetSelection(presets, currentIds, nextIds, sourceUnitIds, uses) {
  const added = nextIds.filter((id) => !currentIds.includes(id));
  if (added.length > 1) throw new Error("Only one ability can be activated at a time");
  if (!added.length) return { selectedIds: nextIds, uses: normalizeAbilityUses(uses) };
  const preset = presets.find((candidate) => candidate.id === added[0]);
  if (!preset) throw new Error("Unknown ability");
  if (!preset.usesPerBattle) {
    return { selectedIds: nextIds, uses: normalizeAbilityUses(uses) };
  }
  const unitId = sourceUnitIds[preset.id];
  if (!unitId) throw new Error("The limited ability source unit is ambiguous");
  return {
    selectedIds: nextIds,
    uses: spendAbilityUse(uses, unitId, preset.id, preset.usesPerBattle),
  };
}

export function withoutLimitedAbilityPresetIds(presets, ids) {
  const limited = new Set(
    presets.filter((preset) => preset.usesPerBattle).map((preset) => preset.id),
  );
  return ids.filter((id) => !limited.has(id));
}

export function reconcileActiveLimitedAbilityUses(selections, uses) {
  let next = normalizeAbilityUses(uses);
  for (const selection of selections) {
    const selected = new Set(selection.selectedIds);
    for (const preset of selection.presets) {
      if (!preset.usesPerBattle || !selected.has(preset.id)) continue;
      const unitId = selection.sourceUnitIds[preset.id];
      if (!unitId || (next[unitId]?.[preset.id] ?? 0) > 0) continue;
      next = spendAbilityUse(next, unitId, preset.id, preset.usesPerBattle);
    }
  }
  return next;
}
