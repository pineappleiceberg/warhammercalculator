export function leaderAttachmentEligibility(leader, bodyguard) {
  if (!leader) return { eligible: false, reason: "Leader profile not found" };
  if (!bodyguard) return { eligible: false, reason: "Bodyguard profile not found" };
  if (leader.id === bodyguard.id) {
    return { eligible: false, reason: `${leader.name} cannot be attached to itself` };
  }
  if (!Array.isArray(leader.leaderBodyguardIds) || leader.leaderBodyguardIds.length === 0) {
    return {
      eligible: false,
      reason: `${leader.name} has no published Leader attachment options`,
    };
  }
  if (!leader.leaderBodyguardIds.includes(bodyguard.id)) {
    return { eligible: false, reason: `${leader.name} cannot lead ${bodyguard.name}` };
  }
  return { eligible: true, reason: "" };
}

export function attachmentFormationReport(catalogue, armyList) {
  const catalogueUnits = new Map((catalogue?.units ?? []).map((unit) => [unit.id, unit]));
  const savedUnits = new Map((armyList?.units ?? []).map((unit) => [unit.id, unit]));
  const errors = [];
  const invalidUnitIds = new Set();
  const attachedUnitIds = new Set();
  const attachments = [];

  for (const leaderUnit of armyList?.units ?? []) {
    if (!leaderUnit.attachedToId) continue;
    const bodyguardUnit = savedUnits.get(leaderUnit.attachedToId);
    if (!bodyguardUnit) {
      errors.push(`${leaderUnit.name} references an attached unit that is not in this list`);
      invalidUnitIds.add(leaderUnit.id);
      continue;
    }
    if (bodyguardUnit.id === leaderUnit.id) {
      errors.push(`${leaderUnit.name} cannot be attached to itself`);
      invalidUnitIds.add(leaderUnit.id);
      continue;
    }

    const seen = new Set([leaderUnit.id]);
    let nextAttachedId = leaderUnit.attachedToId;
    let cyclic = false;
    while (nextAttachedId) {
      if (seen.has(nextAttachedId)) {
        errors.push(`${leaderUnit.name} is part of a circular attachment`);
        invalidUnitIds.add(leaderUnit.id);
        invalidUnitIds.add(bodyguardUnit.id);
        cyclic = true;
        break;
      }
      seen.add(nextAttachedId);
      nextAttachedId = savedUnits.get(nextAttachedId)?.attachedToId;
    }
    if (cyclic) continue;

    const leader = catalogueUnits.get(leaderUnit.unitId);
    const bodyguard = catalogueUnits.get(bodyguardUnit.unitId);
    const eligibility = leaderAttachmentEligibility(leader, bodyguard);
    if (!eligibility.eligible) {
      errors.push(eligibility.reason);
      invalidUnitIds.add(leaderUnit.id);
      continue;
    }

    attachments.push({ leaderUnit, leader, bodyguardUnit, bodyguard });
    attachedUnitIds.add(leaderUnit.id);
    attachedUnitIds.add(bodyguardUnit.id);
  }

  return { attachments, errors, invalidUnitIds, attachedUnitIds };
}
