function normalized(value) {
  return String(value)
    .normalize("NFKC")
    .replaceAll("’", "'")
    .replaceAll("‑", "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function keywordSet(unit) {
  return new Set(
    [
      ...(unit?.transportKeywords ?? []),
      ...(unit?.models ?? []).flatMap((model) => model.keywords ?? []),
      unit?.name ?? "",
    ].map(normalized),
  );
}

function matchesKeywords(keywords, required) {
  return required.every((keyword) => keywords.has(normalized(keyword)));
}

function maximumWounds(unit) {
  return Math.max(0, ...(unit?.models ?? []).map((model) => Number(model.wounds) || 0));
}

export function transportCapacity(transport, armyUnit) {
  if (!transport?.transport) return 0;
  const equipment = new Set(
    (armyUnit?.weapons ?? [])
      .filter((weapon) => weapon.count > 0)
      .map((weapon) => normalized(weapon.name)),
  );
  return transport.transport.capacityModifiers.reduce(
    (capacity, modifier) =>
      equipment.has(normalized(modifier.equipment)) ? modifier.capacity : capacity,
    transport.transport.capacity,
  );
}

export function transportCapacityPools(transport, armyUnit) {
  if (!transport?.transport) return [];
  return [
    {
      position: 0,
      kind: "primary",
      capacity: transportCapacity(transport, armyUnit),
      maximumWounds: null,
      allowedKeywords: transport.transport.allowedKeywords,
      label: "primary",
    },
    ...(transport.transport.additionalPools ?? []).map((pool) => ({
      ...pool,
      kind: "additional",
      maximumWounds: null,
      label: pool.allowedKeywords.map((group) => group.join(" + ")).join(" or "),
    })),
    ...(transport.transport.alternativePools ?? []).map((pool) => ({
      ...pool,
      kind: "alternative",
      label: pool.allowedKeywords.map((group) => group.join(" + ")).join(" or "),
    })),
  ];
}

export function transportPassengerEligibility(transport, passenger, context = {}) {
  if (!transport?.transport) {
    return { eligible: false, reason: `${transport?.name ?? "Selected unit"} is not a Transport` };
  }
  if (!transport.transport.exactRules) {
    return {
      eligible: false,
      reason: `${transport.name} has a conditional Transport rule that needs manual resolution`,
    };
  }
  if (!passenger) return { eligible: false, reason: "Passenger profile was not found" };
  if (context.attachedUnit?.id === passenger.id) {
    return { eligible: false, reason: "A passenger cannot be attached to itself" };
  }
  if (context.attachedUnit && context.attachedUnit.factionId !== passenger.factionId) {
    return { eligible: false, reason: "Passenger and attached unit must have the same faction" };
  }
  if (transport.id === passenger.id) {
    return { eligible: false, reason: "A Transport cannot embark itself" };
  }
  const keywords = keywordSet(passenger);
  const wounds = maximumWounds(passenger);
  const pools = transportCapacityPools(transport);
  const keywordPool = pools.find(
    (pool) =>
      pool.allowedKeywords.length === 0 ||
      pool.allowedKeywords.some((group) => matchesKeywords(keywords, group)),
  );
  if (!keywordPool) {
    return {
      eligible: false,
      reason: `${passenger.name} does not have the required Transport keywords`,
    };
  }
  const matchingPool = pools.find(
    (pool) =>
      (pool.allowedKeywords.length === 0 ||
        pool.allowedKeywords.some((group) => matchesKeywords(keywords, group))) &&
      (pool.maximumWounds === null || wounds <= Number(pool.maximumWounds)),
  );
  if (!matchingPool) {
    return {
      eligible: false,
      reason: `${passenger.name} exceeds the ${keywordPool.maximumWounds} Wounds limit for ${transport.name}`,
    };
  }
  for (const exclusion of transport.transport.excluded) {
    const keywordMatch = matchesKeywords(keywords, exclusion.keywords);
    const woundsMatch =
      exclusion.minimumWounds === null || wounds >= Number(exclusion.minimumWounds);
    const characterMatch = !exclusion.nonCharacter || !keywords.has("character");
    const exception = exclusion.attachmentException;
    const attachedKeywords = context.attachedUnit ? keywordSet(context.attachedUnit) : null;
    const attachmentExceptionSatisfied =
      exception &&
      attachedKeywords &&
      keywords.has(normalized(exception.requiredPassengerKeyword)) &&
      !attachedKeywords.has(normalized(exception.forbiddenAttachedKeyword));
    const keywordExceptionSatisfied = (exclusion.keywordExceptions ?? []).some((group) =>
      matchesKeywords(keywords, group),
    );
    if (
      keywordMatch &&
      woundsMatch &&
      characterMatch &&
      !attachmentExceptionSatisfied &&
      !keywordExceptionSatisfied
    ) {
      return {
        eligible: false,
        reason: `${passenger.name} matches a published exclusion for ${transport.name}`,
      };
    }
  }
  const modelCost = Math.max(
    Number(passenger.firingDeckModelCost) || 1,
    1,
    ...transport.transport.modelCosts
      .filter(
        (rule) =>
          matchesKeywords(keywords, rule.keywords) &&
          (rule.minimumWounds === null || wounds >= Number(rule.minimumWounds)),
      )
      .map((rule) => Number(rule.cost) || 1),
  );
  return {
    eligible: true,
    reason: "",
    modelCost,
    poolPosition: matchingPool.position,
    poolKind: matchingPool.kind,
    poolCapacity: matchingPool.capacity,
    poolMaximumWounds: matchingPool.maximumWounds,
    poolLabel: matchingPool.label,
  };
}

export function transportPassengerAttachmentOptions(catalogue, transport, passenger) {
  if (transportPassengerEligibility(transport, passenger).eligible) return [];
  return (catalogue?.units ?? []).filter(
    (attachedUnit) =>
      attachedUnit.id !== passenger?.id &&
      attachedUnit.factionId === passenger?.factionId &&
      transportPassengerEligibility(transport, passenger, { attachedUnit }).eligible,
  );
}

export function transportPassengerCanEmbark(catalogue, transport, passenger) {
  return (
    transportPassengerEligibility(transport, passenger).eligible ||
    transportPassengerAttachmentOptions(catalogue, transport, passenger).length > 0
  );
}

export function transportAssignmentReport(catalogue, armyList) {
  const catalogueUnits = new Map((catalogue?.units ?? []).map((unit) => [unit.id, unit]));
  const savedUnits = new Map((armyList?.units ?? []).map((unit) => [unit.id, unit]));
  const assignments = [];
  const errors = [];
  const slotsByTransport = new Map();
  const poolSlotsByTransport = new Map();
  const invalidFormationUnits = new Set();
  for (const unit of armyList?.units ?? []) {
    if (!unit.attachedToId) continue;
    const attachedUnit = savedUnits.get(unit.attachedToId);
    if (!attachedUnit) {
      errors.push(`${unit.name} references an attached unit that is not in this list`);
      invalidFormationUnits.add(unit.id);
      continue;
    }
    if (attachedUnit.id === unit.id) {
      errors.push(`${unit.name} cannot be attached to itself`);
      invalidFormationUnits.add(unit.id);
      continue;
    }
    const seen = new Set([unit.id]);
    let nextAttachedId = unit.attachedToId;
    while (nextAttachedId) {
      if (seen.has(nextAttachedId)) {
        errors.push(`${unit.name} is part of a circular attachment`);
        invalidFormationUnits.add(unit.id);
        break;
      }
      seen.add(nextAttachedId);
      nextAttachedId = savedUnits.get(nextAttachedId)?.attachedToId;
    }
    if (
      unit.transportId !== attachedUnit.transportId &&
      (unit.transportId || attachedUnit.transportId)
    ) {
      errors.push(`${unit.name} and ${attachedUnit.name} must embark in the same Transport`);
      invalidFormationUnits.add(unit.id);
      invalidFormationUnits.add(attachedUnit.id);
    }
  }
  for (const passengerUnit of armyList?.units ?? []) {
    if (!passengerUnit.transportId) continue;
    if (invalidFormationUnits.has(passengerUnit.id)) continue;
    const seen = new Set([passengerUnit.id]);
    let nextTransportId = passengerUnit.transportId;
    let cyclic = false;
    while (nextTransportId) {
      if (seen.has(nextTransportId)) {
        errors.push(`${passengerUnit.name} is part of a circular Transport assignment`);
        cyclic = true;
        break;
      }
      seen.add(nextTransportId);
      nextTransportId = savedUnits.get(nextTransportId)?.transportId;
    }
    if (cyclic) continue;
    const transportUnit = savedUnits.get(passengerUnit.transportId);
    if (!transportUnit) {
      errors.push(`${passengerUnit.name} references a Transport that is not in this list`);
      continue;
    }
    if (transportUnit.id === passengerUnit.id) {
      errors.push(`${passengerUnit.name} cannot embark within itself`);
      continue;
    }
    const transport = catalogueUnits.get(transportUnit.unitId);
    const passenger = catalogueUnits.get(passengerUnit.unitId);
    const attachedUnit = savedUnits.get(passengerUnit.attachedToId);
    const attached = catalogueUnits.get(attachedUnit?.unitId);
    const eligibility = transportPassengerEligibility(transport, passenger, {
      attachedUnit: attached,
    });
    if (!eligibility.eligible) {
      errors.push(eligibility.reason);
      continue;
    }
    const slots = passengerUnit.modelCount * eligibility.modelCost;
    const assignment = {
      passengerUnit,
      passenger,
      transportUnit,
      transport,
      modelCost: eligibility.modelCost,
      poolPosition: eligibility.poolPosition,
      poolKind: eligibility.poolKind,
      poolCapacity: eligibility.poolCapacity,
      poolLabel: eligibility.poolLabel,
      slots,
    };
    assignments.push(assignment);
    slotsByTransport.set(transportUnit.id, (slotsByTransport.get(transportUnit.id) ?? 0) + slots);
    const poolKey =
      eligibility.poolKind === "alternative"
        ? `${transportUnit.id}:alternative:${eligibility.poolPosition}`
        : `${transportUnit.id}:${eligibility.poolPosition}`;
    poolSlotsByTransport.set(poolKey, (poolSlotsByTransport.get(poolKey) ?? 0) + slots);
  }
  const incompleteAttachments = new Set();
  const assignedUnitIds = new Set(assignments.map((assignment) => assignment.passengerUnit.id));
  for (const unit of armyList?.units ?? []) {
    if (!unit.attachedToId || !unit.transportId) continue;
    if (!assignedUnitIds.has(unit.id) || !assignedUnitIds.has(unit.attachedToId)) {
      errors.push(`${unit.name}'s attached unit cannot embark as a complete unit`);
      incompleteAttachments.add(unit.id);
      incompleteAttachments.add(unit.attachedToId);
    }
  }
  const completeAssignments = assignments.filter(
    (assignment) => !incompleteAttachments.has(assignment.passengerUnit.id),
  );
  slotsByTransport.clear();
  poolSlotsByTransport.clear();
  for (const assignment of completeAssignments) {
    slotsByTransport.set(
      assignment.transportUnit.id,
      (slotsByTransport.get(assignment.transportUnit.id) ?? 0) + assignment.slots,
    );
    const poolKey =
      assignment.poolKind === "alternative"
        ? `${assignment.transportUnit.id}:alternative:${assignment.poolPosition}`
        : `${assignment.transportUnit.id}:${assignment.poolPosition}`;
    poolSlotsByTransport.set(poolKey, (poolSlotsByTransport.get(poolKey) ?? 0) + assignment.slots);
  }
  const overCapacity = new Set();
  const mixedModes = new Set();
  const modesByTransport = new Map();
  for (const assignment of completeAssignments) {
    const mode =
      assignment.poolKind === "alternative" ? `alternative:${assignment.poolPosition}` : "primary";
    if (!modesByTransport.has(assignment.transportUnit.id)) {
      modesByTransport.set(assignment.transportUnit.id, new Set());
    }
    modesByTransport.get(assignment.transportUnit.id).add(mode);
  }
  for (const [transportId, modes] of modesByTransport) {
    if (modes.size <= 1) continue;
    const transportUnit = savedUnits.get(transportId);
    errors.push(`${transportUnit.name} mixes mutually exclusive Transport modes`);
    mixedModes.add(transportId);
  }
  for (const transportUnit of armyList?.units ?? []) {
    const transport = catalogueUnits.get(transportUnit.unitId);
    if (!transport?.transport) continue;
    for (const pool of transportCapacityPools(transport, transportUnit)) {
      const poolKey =
        pool.kind === "alternative"
          ? `${transportUnit.id}:alternative:${pool.position}`
          : `${transportUnit.id}:${pool.position}`;
      const used = poolSlotsByTransport.get(poolKey) ?? 0;
      if (used > pool.capacity) {
        errors.push(
          `${transportUnit.name} uses ${used} of ${pool.capacity} Transport spaces in its ${pool.label} ${pool.kind === "alternative" ? "mode" : "pool"}`,
        );
        overCapacity.add(transportUnit.id);
      }
    }
  }
  return {
    assignments: completeAssignments.filter(
      (assignment) =>
        !overCapacity.has(assignment.transportUnit.id) &&
        !mixedModes.has(assignment.transportUnit.id),
    ),
    errors,
    slotsByTransport,
    poolSlotsByTransport,
  };
}
