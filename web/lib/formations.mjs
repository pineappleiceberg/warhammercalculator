import { attachmentFormationReport } from "./attachments.mjs";
import {
  defensiveEquipmentBounds,
  defensiveEquipmentDefaultCount,
  defensiveEquipmentEligibleForModel,
  defensiveEquipmentSelectionKey,
} from "./defensive-equipment.mjs";
import { catalogueModelComposition } from "./catalogue-models.mjs";
import { groupWeaponProfiles } from "./loadout.mjs";
import {
  combatPresetSourceEquipmentActive,
  sourceEquipmentCombatPresetIds,
} from "./combat-presets.mjs";

export const MAX_DAMAGE_ALLOCATION_SEGMENTS = 16;

export function catalogueModelSegments(unit, modelCount, loadoutSubjectCounts = {}) {
  const composition = catalogueModelComposition(unit, modelCount, loadoutSubjectCounts);
  return {
    exact: composition.exact,
    segments: (unit?.models ?? [])
      .map((model, index) => ({ model, modelCount: composition.counts[index] ?? 0 }))
      .filter((segment) => segment.modelCount > 0),
  };
}

export function bodyguardJoinerOptions(catalogue, bodyguard) {
  if (!bodyguard) return [];
  return (catalogue?.units ?? []).filter((unit) =>
    (unit.bodyguardJoinOptions ?? []).some((option) => option.bodyguardId === bodyguard.id),
  );
}

function modelRoleOrder(role) {
  if (role === "bodyguard") return 0;
  if (role === "joined") return 1;
  if (role === "leader") return 2;
  return 0;
}

export function savedFormationGroups(catalogue, armyList) {
  const units = armyList?.units ?? [];
  const report = attachmentFormationReport(catalogue, armyList);
  const parents = new Map(units.map((unit) => [unit.id, unit.id]));
  const find = (id) => {
    const parent = parents.get(id);
    if (!parent || parent === id) return parent;
    const root = find(parent);
    parents.set(id, root);
    return root;
  };
  const unite = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot && rightRoot && leftRoot !== rightRoot) parents.set(leftRoot, rightRoot);
  };
  for (const attachment of report.attachments) {
    unite(attachment.leaderUnit.id, attachment.bodyguardUnit.id);
  }
  for (const join of report.joins) unite(join.joinerUnit.id, join.bodyguardUnit.id);

  const bodyguardIds = new Set([
    ...report.attachments.map((entry) => entry.bodyguardUnit.id),
    ...report.joins.map((entry) => entry.bodyguardUnit.id),
  ]);
  const leaderIds = new Set(report.attachments.map((entry) => entry.leaderUnit.id));
  const joinerIds = new Set(report.joins.map((entry) => entry.joinerUnit.id));
  const groups = new Map();
  for (const unit of units) {
    const key = find(unit.id) ?? unit.id;
    const group = groups.get(key) ?? [];
    group.push(unit);
    groups.set(key, group);
  }
  const catalogueUnits = new Map((catalogue?.units ?? []).map((unit) => [unit.id, unit]));
  const result = [];
  for (const members of groups.values()) {
    const root = members.find((unit) => bodyguardIds.has(unit.id)) ?? members[0];
    const components = members
      .map((unit) => ({
        unit,
        catalogueUnit: catalogueUnits.get(unit.unitId),
        role: leaderIds.has(unit.id)
          ? "leader"
          : joinerIds.has(unit.id)
            ? "joined"
            : members.length > 1
              ? "bodyguard"
              : "standalone",
      }))
      .sort(
        (left, right) =>
          modelRoleOrder(left.role) - modelRoleOrder(right.role) ||
          units.indexOf(left.unit) - units.indexOf(right.unit),
      );
    result.push({
      id: root.id,
      root,
      components,
      name: components.map((component) => component.unit.name).join(" + "),
      modelCount: components.reduce((total, component) => total + component.unit.modelCount, 0),
      attached: components.some((component) => report.attachedUnitIds.has(component.unit.id)),
    });
  }
  return result.sort((left, right) => units.indexOf(left.root) - units.indexOf(right.root));
}

export function savedFormationForUnit(catalogue, armyList, savedUnitId) {
  return savedFormationGroups(catalogue, armyList).find((group) =>
    group.components.some((component) => component.unit.id === savedUnitId),
  );
}

export function savedFormationModelSegments(formation) {
  const segments = [];
  const ambiguousComponents = [];
  for (const component of formation?.components ?? []) {
    const models = catalogueModelSegments(
      component.catalogueUnit,
      component.unit.modelCount,
      component.unit.loadoutSubjectCounts,
    );
    if (models.segments.length === 0) continue;
    const composition = models;
    if (!composition.exact) ambiguousComponents.push(component.unit.name);
    for (const { model, modelCount } of models.segments) {
      segments.push({
        id: `${component.unit.id}:${model.id}`,
        savedUnitId: component.unit.id,
        unitName: component.unit.name,
        role: component.role,
        model,
        modelCount,
      });
    }
  }
  return { segments, ambiguousComponents };
}

export function savedUnitCombatPresetIds(savedUnit, catalogueUnit) {
  const sourceContext = {
    choiceSelections: savedUnit?.choiceSelections,
    modelCount: savedUnit?.modelCount,
    loadoutSubjectCounts: savedUnit?.loadoutSubjectCounts,
    unit: catalogueUnit,
  };
  const presets = new Map(
    (catalogueUnit?.combatPresets ?? []).map((preset) => [preset.id, preset]),
  );
  return [
    ...(savedUnit?.combatPresetIds ?? []).filter((id) => {
      const preset = presets.get(id);
      if (!preset?.sourceEquipmentChoiceExact) return true;
      if (preset.sourceEquipmentAutoEnable ?? true) return false;
      return combatPresetSourceEquipmentActive(preset, sourceContext);
    }),
    ...sourceEquipmentCombatPresetIds(catalogueUnit, sourceContext),
  ];
}

export function savedFormationCombatPresetIds(formation) {
  return [
    ...new Set(
      (formation?.components ?? []).flatMap((component) =>
        savedUnitCombatPresetIds(component.unit, component.catalogueUnit),
      ),
    ),
  ];
}

export function savedFormationCombatPresetSourceUnitIds(formation) {
  const sources = {};
  const ambiguous = new Set();
  for (const component of formation?.components ?? []) {
    for (const preset of component.catalogueUnit?.combatPresets ?? []) {
      if (sources[preset.id] && sources[preset.id] !== component.unit.id) {
        delete sources[preset.id];
        ambiguous.add(preset.id);
      } else if (!ambiguous.has(preset.id)) {
        sources[preset.id] = component.unit.id;
      }
    }
  }
  return sources;
}

export function savedUnitDefensiveEquipmentDefaults(savedUnit, catalogueUnit) {
  const stored = savedUnit?.defensiveEquipmentCounts;
  const defaults = {};
  const modelSegments = catalogueModelSegments(
    catalogueUnit,
    savedUnit?.modelCount ?? 0,
    savedUnit?.loadoutSubjectCounts,
  ).segments;
  for (const option of catalogueUnit?.defensiveEquipment ?? []) {
    const sourceDefault = defensiveEquipmentDefaultCount(option, savedUnit);
    if (option.scope === "unit") {
      const key = defensiveEquipmentSelectionKey(savedUnit.id, null, option.id);
      if ((stored?.[key] ?? (stored === undefined ? sourceDefault : 0)) > 0) defaults[key] = 1;
      continue;
    }
    const legacyKeys = new Set(
      modelSegments
        .filter((segment) => defensiveEquipmentEligibleForModel(option, segment.model.id))
        .map((segment) => segment.model.sourceModelId)
        .filter((modelId) => modelId !== undefined)
        .map((modelId) => defensiveEquipmentSelectionKey(savedUnit.id, modelId, option.id)),
    );
    let remainingDefault =
      stored === undefined
        ? sourceDefault
        : [...legacyKeys].reduce((total, key) => total + (stored[key] ?? 0), 0);
    for (const segment of modelSegments) {
      if (!defensiveEquipmentEligibleForModel(option, segment.model.id)) continue;
      const key = defensiveEquipmentSelectionKey(savedUnit.id, segment.model.id, option.id);
      const count = Math.min(segment.modelCount, stored?.[key] ?? remainingDefault);
      if (count > 0) defaults[key] = count;
      if (stored?.[key] === undefined) remainingDefault -= count;
    }
  }
  return defaults;
}

export function reconcileSavedUnitDefensiveEquipmentChoices(
  savedUnit,
  catalogueUnit,
  nextChoiceSelections,
) {
  if (savedUnit?.defensiveEquipmentCounts === undefined) return undefined;
  const previousEffective = savedUnitDefensiveEquipmentDefaults(savedUnit, catalogueUnit);
  const nextCounts = { ...savedUnit.defensiveEquipmentCounts };
  const modelSegments = catalogueModelSegments(
    catalogueUnit,
    savedUnit.modelCount,
    savedUnit.loadoutSubjectCounts,
  ).segments;
  for (const option of catalogueUnit?.defensiveEquipment ?? []) {
    if (!option.choiceCoverageExact || !(option.choiceLinks ?? []).length) continue;
    const previousExpected = defensiveEquipmentDefaultCount(option, savedUnit);
    const nextExpected = defensiveEquipmentDefaultCount(option, {
      ...savedUnit,
      choiceSelections: nextChoiceSelections,
    });
    if (previousExpected === nextExpected) continue;
    const optionKeys = Object.keys(previousEffective).filter(
      (key) => key.startsWith(`${savedUnit.id}::`) && key.endsWith(`::${option.id}`),
    );
    const actual = optionKeys.reduce((total, key) => total + previousEffective[key], 0);
    if (actual !== previousExpected) continue;
    for (const key of Object.keys(nextCounts)) {
      if (key.startsWith(`${savedUnit.id}::`) && key.endsWith(`::${option.id}`)) {
        delete nextCounts[key];
      }
    }
    if (option.scope === "unit") {
      if (nextExpected > 0) {
        nextCounts[defensiveEquipmentSelectionKey(savedUnit.id, null, option.id)] = 1;
      }
      continue;
    }
    let remaining = nextExpected;
    for (const segment of modelSegments) {
      if (!defensiveEquipmentEligibleForModel(option, segment.model.id)) continue;
      const count = Math.min(remaining, segment.modelCount);
      if (count > 0) {
        nextCounts[defensiveEquipmentSelectionKey(savedUnit.id, segment.model.id, option.id)] =
          count;
      }
      remaining -= count;
    }
  }
  return nextCounts;
}

export function savedUnitDefensiveEquipmentWarnings(savedUnit, catalogueUnit) {
  if (!savedUnit || !catalogueUnit) return [];
  const effective =
    savedUnit.defensiveEquipmentCounts === undefined
      ? savedUnitDefensiveEquipmentDefaults(savedUnit, catalogueUnit)
      : savedUnit.defensiveEquipmentCounts;
  const segments = catalogueModelSegments(
    catalogueUnit,
    savedUnit.modelCount,
    savedUnit.loadoutSubjectCounts,
  ).segments;
  const knownKeys = new Set();
  const warnings = [];
  for (const option of catalogueUnit.defensiveEquipment ?? []) {
    let count = 0;
    let eligibleModelCount = 0;
    if (option.scope === "unit") {
      const key = defensiveEquipmentSelectionKey(savedUnit.id, null, option.id);
      knownKeys.add(key);
      count = effective[key] ?? 0;
      eligibleModelCount = savedUnit.modelCount;
    } else {
      const legacyKeys = new Set();
      for (const segment of segments) {
        if (!defensiveEquipmentEligibleForModel(option, segment.model.id)) continue;
        const key = defensiveEquipmentSelectionKey(savedUnit.id, segment.model.id, option.id);
        knownKeys.add(key);
        count += effective[key] ?? 0;
        eligibleModelCount += segment.modelCount;
        if (segment.model.sourceModelId !== undefined) {
          legacyKeys.add(
            defensiveEquipmentSelectionKey(savedUnit.id, segment.model.sourceModelId, option.id),
          );
        }
      }
      for (const key of legacyKeys) {
        knownKeys.add(key);
        count += effective[key] ?? 0;
      }
    }
    const { minimum, maximum } = defensiveEquipmentBounds(option, savedUnit, eligibleModelCount);
    let message = null;
    const expected = defensiveEquipmentDefaultCount(option, savedUnit);
    if (option.choiceCoverageExact && count !== expected) {
      message = `${option.name}: ${count} equipped does not match the ${expected} selected by its source option choices`;
    } else if (count < minimum) {
      message = `${option.name}: ${count} equipped is below the required source minimum of ${minimum}`;
    } else if (count > maximum) {
      message = `${option.name}: ${count} equipped exceeds the source maximum of ${maximum} for ${savedUnit.modelCount} models`;
    }
    if (message) {
      warnings.push({
        key: option.id,
        optionId: option.id,
        message,
        source: option.limitSource,
        exact: option.limitExact,
        reason: savedUnit.defensiveEquipmentOverrides?.[option.id] ?? null,
      });
    }
  }
  for (const [key, value] of Object.entries(savedUnit.defensiveEquipmentCounts ?? {})) {
    if (!key.startsWith(`${savedUnit.id}::`) || value <= 0 || knownKeys.has(key)) continue;
    const warningKey = `unknown:${key}`;
    warnings.push({
      key: warningKey,
      optionId: null,
      message: `Unknown or ineligible defensive-equipment selection: ${key}`,
      source: null,
      exact: true,
      reason: savedUnit.defensiveEquipmentOverrides?.[warningKey] ?? null,
    });
  }
  return warnings;
}

export function savedFormationDefensiveEquipmentDefaults(formation) {
  return Object.assign(
    {},
    ...(formation?.components ?? []).map((component) =>
      savedUnitDefensiveEquipmentDefaults(component.unit, component.catalogueUnit),
    ),
  );
}

export function savedFormationTargetSequence(
  formation,
  firstSegmentId = "",
  defensiveEquipmentCounts = {},
) {
  const composition = savedFormationModelSegments(formation);
  const effectiveEquipmentCounts = Object.assign(
    {},
    ...(formation?.components ?? []).map((component) =>
      savedUnitDefensiveEquipmentDefaults(
        { ...component.unit, defensiveEquipmentCounts },
        component.catalogueUnit,
      ),
    ),
  );
  const unitEquipmentIds = (formation?.components ?? []).flatMap((component) =>
    (component.catalogueUnit?.defensiveEquipment ?? [])
      .filter(
        (option) =>
          option.scope === "unit" &&
          (effectiveEquipmentCounts[
            defensiveEquipmentSelectionKey(component.unit.id, null, option.id)
          ] ?? 0) > 0,
      )
      .map((option) => option.id),
  );
  const segments = [];
  for (const segment of composition.segments) {
    const component = (formation?.components ?? []).find(
      (candidate) => candidate.unit.id === segment.savedUnitId,
    );
    const bearerSelections = (component?.catalogueUnit?.defensiveEquipment ?? [])
      .filter(
        (option) =>
          option.scope === "bearer" && defensiveEquipmentEligibleForModel(option, segment.model.id),
      )
      .map((option) => ({
        option,
        count:
          effectiveEquipmentCounts[
            defensiveEquipmentSelectionKey(segment.savedUnitId, segment.model.id, option.id)
          ] ?? 0,
      }))
      .filter((selection) => selection.count > 0);
    if (bearerSelections.length > 1) {
      composition.ambiguousComponents.push(
        `${segment.unitName} has overlapping bearer equipment selections`,
      );
    }
    const bearer = bearerSelections[0];
    const equippedCount = Math.min(segment.modelCount, bearer?.count ?? 0);
    if (equippedCount > 0) {
      segments.push({
        ...segment,
        id: `${segment.id}:equipment:${bearer.option.id}`,
        modelCount: equippedCount,
        defensiveEquipmentIds: [...unitEquipmentIds, bearer.option.id],
      });
    }
    if (segment.modelCount > equippedCount) {
      segments.push({
        ...segment,
        id: equippedCount > 0 ? `${segment.id}:unequipped` : segment.id,
        modelCount: segment.modelCount - equippedCount,
        defensiveEquipmentIds: [...unitEquipmentIds],
      });
    }
  }
  const hasProtectedLeader = segments.some((segment) => segment.role !== "leader");
  const allocationOptions = segments.filter(
    (segment) => !hasProtectedLeader || segment.role !== "leader",
  );
  const first =
    allocationOptions.find((segment) => segment.id === firstSegmentId) ??
    allocationOptions.find((segment) => {
      if (segment.model.sourceModelId === undefined) return false;
      const legacyBase = `${segment.savedUnitId}:${segment.model.sourceModelId}`;
      if (firstSegmentId === legacyBase) return true;
      return (
        firstSegmentId.startsWith(`${legacyBase}:`) &&
        segment.id.endsWith(firstSegmentId.slice(legacyBase.length))
      );
    }) ??
    allocationOptions[0];
  const orderedSegments = first
    ? [first, ...segments.filter((segment) => segment.id !== first.id)]
    : [];
  return {
    ...composition,
    allocationOptions,
    first,
    orderedSegments,
    targets: orderedSegments.map((segment) => ({
      keywords: segment.model.keywords,
      toughness: segment.model.t ?? 8,
      save: segment.model.save ?? 7,
      invulnerable: segment.model.invuln ?? 0,
      feelNoPain: segment.model.feelNoPain ?? 0,
      wounds: segment.model.wounds ?? 1,
      reduction: segment.model.reduction ?? 0,
      damageDivisor: segment.model.damageDivisor ?? 1,
      firstFailedSaveDamageReplacement: null,
      allocatedAttackDamageReplacement: 0,
      allocatedAttackDamageReplacementUses: 0,
      allocatedAttackDamageReplacementSkip: 0,
      modelCount: segment.modelCount,
      defensiveEquipmentIds: segment.defensiveEquipmentIds,
    })),
  };
}

function battleModelInstances(segments) {
  return segments.flatMap((segment) =>
    Array.from({ length: segment.modelCount }, (_, index) => ({
      id: `${segment.id}:model:${index + 1}`,
      baseSegmentId: segment.id,
      savedUnitId: segment.savedUnitId,
      unitName: segment.unitName,
      modelName: segment.model.name,
      keywords: segment.model.keywords ?? [],
      ordinal: index + 1,
    })),
  );
}

function defaultWeaponBearerModelIds(group, modelInstances) {
  const candidates = modelInstances.filter(
    (model) => model.savedUnitId === group.sourceSavedUnitId,
  );
  if (candidates.length === 1) {
    return {
      bearerModelIds: Array.from({ length: group.count }, () => candidates[0].id),
      bearerAssignmentsReviewed: true,
      bearerAssignmentSource: "single_model",
    };
  }
  if (group.count === candidates.length) {
    return {
      bearerModelIds: candidates.map((model) => model.id),
      bearerAssignmentsReviewed: true,
      bearerAssignmentSource: "one_per_model",
    };
  }
  return {
    bearerModelIds: Array.from(
      { length: group.count },
      (_, index) => candidates[index % candidates.length]?.id ?? "",
    ),
    bearerAssignmentsReviewed: false,
    bearerAssignmentSource: "setup_required",
  };
}

function modelWeaponSignature(modelId, weaponInventory) {
  return weaponInventory.flatMap((group) => {
    const count = group.bearerModelIds.filter((candidate) => candidate === modelId).length;
    return count > 0 ? [{ groupId: group.groupId, name: group.name, count }] : [];
  });
}

export function battleSegmentsForWeaponBearers(modelInstances, weaponInventory, baseSegments) {
  const baseById = new Map(baseSegments.map((segment) => [segment.id, segment]));
  const grouped = new Map();
  for (const model of modelInstances) {
    const weaponCopies = modelWeaponSignature(model.id, weaponInventory);
    const signature = JSON.stringify(weaponCopies.map(({ groupId, count }) => [groupId, count]));
    const key = `${model.baseSegmentId}\u0000${signature}`;
    const entry = grouped.get(key) ?? { model, weaponCopies, modelIds: [] };
    entry.modelIds.push(model.id);
    grouped.set(key, entry);
  }
  const perBaseIndex = new Map();
  return [...grouped.values()].map(({ model, weaponCopies, modelIds }) => {
    const base = baseById.get(model.baseSegmentId);
    if (!base) throw new Error("Weapon bearer references an unknown model segment");
    const index = (perBaseIndex.get(base.id) ?? 0) + 1;
    perBaseIndex.set(base.id, index);
    return {
      id: `${base.id}:loadout:${index}`,
      baseSegmentId: base.id,
      savedUnitId: base.savedUnitId,
      unitName: base.unitName,
      modelName: base.model.name,
      role: base.role,
      keywords: base.model.keywords ?? [],
      wounds: base.model.wounds ?? 1,
      objectiveControl: base.model.objectiveControl,
      feelNoPain: base.model.feelNoPain ?? 0,
      startingModels: modelIds.length,
      modelIds,
      weaponCopies,
    };
  });
}

export function battleTargetSequence(targetSequence, battleFormation, firstSegmentId = "") {
  if (!battleFormation || battleFormation.weaponBearerTracking !== "exact") return targetSequence;
  if (battleFormation.segments.length > MAX_DAMAGE_ALLOCATION_SEGMENTS) {
    throw new Error(
      `Exact weapon bearer assignments exceed the ${MAX_DAMAGE_ALLOCATION_SEGMENTS}-segment damage allocation limit`,
    );
  }
  const sourceById = new Map(
    targetSequence.orderedSegments.map((segment, index) => [
      segment.id,
      { segment, target: targetSequence.targets[index] },
    ]),
  );
  const expanded = battleFormation.segments.map((registration) => {
    const source = sourceById.get(registration.baseSegmentId);
    if (!source) throw new Error("Battle weapon bearer composition changed after setup");
    return {
      segment: {
        ...source.segment,
        id: registration.id,
        baseSegmentId: registration.baseSegmentId,
        modelCount: registration.startingModels,
        weaponCopies: registration.weaponCopies,
      },
      target: { ...source.target, modelCount: registration.startingModels },
    };
  });
  const hasProtectedLeader = expanded.some(({ segment }) => segment.role !== "leader");
  const allocationOptions = expanded
    .filter(({ segment }) => !hasProtectedLeader || segment.role !== "leader")
    .map(({ segment }) => segment);
  const requested = allocationOptions.find((segment) => segment.id === firstSegmentId);
  const baseFirst = allocationOptions.find(
    (segment) => segment.baseSegmentId === targetSequence.first?.id,
  );
  const first = requested ?? baseFirst ?? allocationOptions[0];
  const ordered = first
    ? [
        expanded.find(({ segment }) => segment.id === first.id),
        ...expanded.filter(({ segment }) => segment.id !== first.id),
      ]
    : [];
  return {
    ...targetSequence,
    segments: expanded.map(({ segment }) => segment),
    allocationOptions,
    first,
    orderedSegments: ordered.map(({ segment }) => segment),
    targets: ordered.map(({ target }) => target),
  };
}

export function savedFormationBattleRegistration(
  formation,
  playerId,
  id,
  targetSequence,
  defensiveEquipmentCounts = {},
  assignedTransportFormationId = "",
  transportOptions = [],
) {
  const segments = targetSequence?.orderedSegments ?? [];
  if (!formation || segments.length < 1) throw new Error("Formation has no exact model segments");
  const modelInstances = battleModelInstances(segments);
  const weaponInventory = formation.components
    .flatMap((component) => {
      const groups = groupWeaponProfiles(component.catalogueUnit?.weapons ?? []);
      return (component.unit.weapons ?? []).flatMap((savedWeapon) => {
        if (!Number.isSafeInteger(savedWeapon.count) || savedWeapon.count < 1) return [];
        const group = groups.find(
          (candidate) =>
            candidate.id === savedWeapon.groupId ||
            candidate.profiles.some((profile) => profile.id === savedWeapon.weaponId),
        );
        if (!group) {
          throw new Error(`${component.unit.name} has an equipped weapon absent from its source`);
        }
        return [
          {
            sourceSavedUnitId: component.unit.id,
            groupId: group.id,
            name: group.name,
            count: savedWeapon.count,
            profiles: group.profiles.map((profile) => {
              const abilities = new Set(
                (profile.abilities ?? []).map((ability) => ability.name.toLowerCase()),
              );
              return {
                weaponId: String(profile.id),
                name: profile.name,
                type: profile.type,
                publishedRangeThousandths:
                  Number.isFinite(profile.range) && profile.range > 0
                    ? Math.round(profile.range * 1000)
                    : 0,
                hasAssault: abilities.has("assault"),
                hasIndirect: abilities.has("indirect fire"),
                hasHazardous: abilities.has("hazardous"),
              };
            }),
          },
        ];
      });
    })
    .map((group) => ({
      ...group,
      ...defaultWeaponBearerModelIds(group, modelInstances),
    }));
  const battleSegments = battleSegmentsForWeaponBearers(modelInstances, weaponInventory, segments);
  if (battleSegments.length > MAX_DAMAGE_ALLOCATION_SEGMENTS) {
    throw new Error(
      `Exact weapon bearer assignments exceed the ${MAX_DAMAGE_ALLOCATION_SEGMENTS}-segment damage allocation limit`,
    );
  }
  const formationKeywords = [
    ...new Set(
      formation.components.flatMap((component) =>
        (component.catalogueUnit?.models ?? []).flatMap((model) => model.keywords ?? []),
      ),
    ),
  ];
  const normalizedFormationKeywords = new Set(
    formationKeywords.map((keyword) => keyword.toLowerCase()),
  );
  const hasWaaaghAbility = formation.components.some((component) =>
    (component.catalogueUnit?.combatPresets ?? []).some(
      (preset) => preset.requiresWaaaghActive === true,
    ),
  );
  const hasOathOfMomentAbility = formation.components.some((component) =>
    (component.catalogueUnit?.combatPresets ?? []).some(
      (preset) => preset.requiresOathTarget === true,
    ),
  );
  const reanimationProtocolSavedUnitIds = formation.components
    .filter((component) => (component.catalogueUnit?.factionAbilityIds ?? []).includes("000008369"))
    .map((component) => component.unit.id);
  return {
    id,
    playerId,
    sourceFormationId: formation.id,
    name: formation.name,
    assignedTransportFormationId,
    transportOptions,
    keywords: formationKeywords,
    hasWaaaghAbility,
    hasOathOfMomentAbility,
    reanimationProtocolSavedUnitIds,
    deploymentTraits: {
      dedicatedTransport: normalizedFormationKeywords.has("dedicated transport"),
      aircraft: normalizedFormationKeywords.has("aircraft"),
      hover: formation.components.some((component) => Boolean(component.catalogueUnit?.hasHover)),
    },
    defensiveEquipmentCounts: { ...defensiveEquipmentCounts },
    weaponBearerTracking: "exact",
    modelInstances,
    weaponInventory,
    segments: battleSegments,
  };
}

export function applyBattleHealthToTargetSequence(targetSequence, health) {
  if (!health) return { ...targetSequence, initialWoundsLost: 0, destroyed: false };
  const entries = targetSequence.orderedSegments.map((segment, index) => {
    const current = health[segment.id];
    if (!current) {
      throw new Error("Target equipment or composition changed after battle damage was recorded");
    }
    return {
      segment,
      target: targetSequence.targets[index],
      health: current,
    };
  });
  if (
    Object.keys(health).some(
      (segmentId) => !entries.some(({ segment }) => segment.id === segmentId),
    )
  ) {
    throw new Error("Target equipment or composition changed after battle damage was recorded");
  }
  const live = entries.filter(({ health: current }) => current.modelsRemaining > 0);
  const wounded = live.filter(({ health: current }) => current.woundsLost > 0);
  if (wounded.length > 1) throw new Error("Battle state contains more than one wounded model");
  const ordered = wounded.length
    ? [wounded[0], ...live.filter((entry) => entry !== wounded[0])]
    : live;
  const hasProtectedLeader = ordered.some(({ segment }) => segment.role !== "leader");
  const allocationOptions = ordered
    .filter(
      ({ segment }) =>
        (wounded.length === 0 || segment.id === wounded[0].segment.id) &&
        (!hasProtectedLeader || segment.role !== "leader"),
    )
    .map(({ segment, health: current }) => ({ ...segment, modelCount: current.modelsRemaining }));
  return {
    ...targetSequence,
    segments: ordered.map(({ segment, health: current }) => ({
      ...segment,
      modelCount: current.modelsRemaining,
    })),
    allocationOptions,
    first: ordered[0]
      ? { ...ordered[0].segment, modelCount: ordered[0].health.modelsRemaining }
      : undefined,
    orderedSegments: ordered.map(({ segment, health: current }) => ({
      ...segment,
      modelCount: current.modelsRemaining,
    })),
    targets: ordered.map(({ target, health: current }) => ({
      ...target,
      modelCount: current.modelsRemaining,
    })),
    initialWoundsLost: ordered[0]?.health.woundsLost ?? 0,
    destroyed: ordered.length === 0,
  };
}
