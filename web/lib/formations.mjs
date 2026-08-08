import { attachmentFormationReport } from "./attachments.mjs";
import {
  defensiveEquipmentDefaultCount,
  defensiveEquipmentEligibleForModel,
  defensiveEquipmentSelectionKey,
} from "./defensive-equipment.mjs";

function uniqueCompositionCounts(unit, modelCount) {
  const composition = unit?.compositionModels ?? [];
  const models = unit?.models ?? [];
  if (models.length === 1) return { counts: [modelCount], exact: true };
  if (composition.length !== models.length) return { counts: [modelCount], exact: false };

  const solutions = [];
  const current = new Array(composition.length).fill(0);
  const visit = (index, remaining) => {
    if (solutions.length > 1) return;
    if (index === composition.length) {
      if (remaining === 0) solutions.push([...current]);
      return;
    }
    const entry = composition[index];
    const laterMinimum = composition
      .slice(index + 1)
      .reduce((total, candidate) => total + candidate.min, 0);
    const laterMaximum = composition
      .slice(index + 1)
      .reduce((total, candidate) => total + candidate.max, 0);
    const minimum = Math.max(entry.min, remaining - laterMaximum);
    const maximum = Math.min(entry.max, remaining - laterMinimum);
    for (let count = minimum; count <= maximum; count += 1) {
      current[index] = count;
      visit(index + 1, remaining - count);
      if (solutions.length > 1) return;
    }
  };
  visit(0, modelCount);
  return solutions.length === 1
    ? { counts: solutions[0], exact: true }
    : { counts: [modelCount, ...new Array(models.length - 1).fill(0)], exact: false };
}

export function catalogueModelSegments(unit, modelCount) {
  const composition = uniqueCompositionCounts(unit, modelCount);
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
    const models = catalogueModelSegments(component.catalogueUnit, component.unit.modelCount);
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

export function savedUnitDefensiveEquipmentDefaults(savedUnit, catalogueUnit) {
  const stored = savedUnit?.defensiveEquipmentCounts;
  const defaults = {};
  const modelSegments = catalogueModelSegments(catalogueUnit, savedUnit?.modelCount ?? 0).segments;
  for (const option of catalogueUnit?.defensiveEquipment ?? []) {
    const sourceDefault = defensiveEquipmentDefaultCount(option, savedUnit);
    if (option.scope === "unit") {
      const key = defensiveEquipmentSelectionKey(savedUnit.id, null, option.id);
      if ((stored?.[key] ?? (stored === undefined ? sourceDefault : 0)) > 0) defaults[key] = 1;
      continue;
    }
    let remainingDefault = sourceDefault;
    for (const segment of modelSegments) {
      if (!defensiveEquipmentEligibleForModel(option, segment.model.id)) continue;
      const key = defensiveEquipmentSelectionKey(savedUnit.id, segment.model.id, option.id);
      const count = Math.min(
        segment.modelCount,
        stored?.[key] ?? (stored === undefined ? remainingDefault : 0),
      );
      if (count > 0) defaults[key] = count;
      remainingDefault -= count;
    }
  }
  return defaults;
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
  const unitEquipmentIds = (formation?.components ?? []).flatMap((component) =>
    (component.catalogueUnit?.defensiveEquipment ?? [])
      .filter(
        (option) =>
          option.scope === "unit" &&
          (defensiveEquipmentCounts[
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
          defensiveEquipmentCounts[
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
    allocationOptions.find((segment) => segment.id === firstSegmentId) ?? allocationOptions[0];
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
