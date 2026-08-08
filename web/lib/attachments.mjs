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

function keywordSet(unit) {
  return new Set((unit?.transportKeywords ?? []).map((keyword) => keyword.toLowerCase()));
}

function exceptionAllowsCompanion(leader, companion) {
  const rule = leader?.leaderAttachmentException;
  if (!rule) return false;
  if (rule.forbidSameDatasheet && leader.id === companion.id) return false;
  const companionKeywords = keywordSet(companion);
  if (
    rule.forbiddenCompanionKeyword &&
    companionKeywords.has(rule.forbiddenCompanionKeyword.toLowerCase())
  ) {
    return false;
  }
  return (
    rule.anyExistingLeader ||
    rule.existingLeaderKeywords.some((keyword) => companionKeywords.has(keyword.toLowerCase()))
  );
}

function bodyguardMaximumOverride(bodyguard, leaders, modelCount) {
  const rule = bodyguard?.bodyguardLeaderRule;
  if (!rule?.maximumLeaders) return null;
  if (
    rule.maximumRequiredStartingStrength !== null &&
    modelCount !== rule.maximumRequiredStartingStrength
  ) {
    return null;
  }
  if (
    rule.maximumRequiredLeaderKeyword &&
    !leaders.some((leader) =>
      keywordSet(leader).has(rule.maximumRequiredLeaderKeyword.toLowerCase()),
    )
  ) {
    return null;
  }
  if (
    rule.leadersMustBeDistinct &&
    new Set(leaders.map((leader) => leader.id)).size !== leaders.length
  ) {
    return null;
  }
  return rule.maximumLeaders;
}

export function leaderFormationEligibility(
  bodyguard,
  leaders,
  modelCount = 1,
  { requireMinimum = true } = {},
) {
  if (!bodyguard)
    return { eligible: false, reason: "Bodyguard profile not found", maximumLeaders: 0 };
  for (const leader of leaders) {
    const pair = leaderAttachmentEligibility(leader, bodyguard);
    if (!pair.eligible) return { ...pair, maximumLeaders: 1 };
  }
  if (leaders.length > 2) {
    return {
      eligible: false,
      reason: `${bodyguard.name} cannot have more than two Leaders attached`,
      maximumLeaders: 2,
    };
  }

  let maximumLeaders = 1;
  if (leaders.length === 2) {
    const override = bodyguardMaximumOverride(bodyguard, leaders, modelCount);
    const exception =
      exceptionAllowsCompanion(leaders[0], leaders[1]) ||
      exceptionAllowsCompanion(leaders[1], leaders[0]);
    if (override === null && !exception) {
      return {
        eligible: false,
        reason: `${bodyguard.name} cannot have ${leaders[0].name} and ${leaders[1].name} attached together`,
        maximumLeaders: 1,
      };
    }
    maximumLeaders = 2;
  } else {
    maximumLeaders = bodyguardMaximumOverride(bodyguard, leaders, modelCount) ?? 1;
  }

  const bodyguardRule = bodyguard.bodyguardLeaderRule;
  if (requireMinimum && bodyguardRule?.minimumLeaders > 0) {
    const matching = leaders.filter((leader) => {
      const keywords = keywordSet(leader);
      return bodyguardRule.minimumLeaderKeywords.some((keyword) =>
        keywords.has(keyword.toLowerCase()),
      );
    });
    if (leaders.length < bodyguardRule.minimumLeaders || matching.length === 0) {
      return {
        eligible: false,
        reason: `${bodyguard.name} requires an attached ${bodyguardRule.minimumLeaderKeywords.join(" or ")}`,
        maximumLeaders,
      };
    }
  }

  return { eligible: true, reason: "", maximumLeaders };
}

export function attachmentFormationReport(catalogue, armyList) {
  const catalogueUnits = new Map((catalogue?.units ?? []).map((unit) => [unit.id, unit]));
  const savedUnits = new Map((armyList?.units ?? []).map((unit) => [unit.id, unit]));
  const errors = [];
  const invalidUnitIds = new Set();
  const attachedUnitIds = new Set();
  let attachments = [];

  for (const savedUnit of armyList?.units ?? []) {
    const profile = catalogueUnits.get(savedUnit.unitId);
    if (profile?.leaderAttachmentException?.mandatoryAttachment && !savedUnit.attachedToId) {
      errors.push(`${savedUnit.name} must be attached to an eligible Bodyguard unit`);
      invalidUnitIds.add(savedUnit.id);
    }
  }

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
  }

  const attachmentsByBodyguard = new Map();
  for (const attachment of attachments) {
    const values = attachmentsByBodyguard.get(attachment.bodyguardUnit.id) ?? [];
    values.push(attachment);
    attachmentsByBodyguard.set(attachment.bodyguardUnit.id, values);
  }
  for (const bodyguardUnit of armyList?.units ?? []) {
    const bodyguard = catalogueUnits.get(bodyguardUnit.unitId);
    const group = attachmentsByBodyguard.get(bodyguardUnit.id) ?? [];
    if (group.length === 0 && !bodyguard?.bodyguardLeaderRule?.minimumLeaders) continue;
    const eligibility = leaderFormationEligibility(
      bodyguard,
      group.map((attachment) => attachment.leader),
      bodyguardUnit.modelCount,
    );
    if (!eligibility.eligible) {
      errors.push(eligibility.reason);
      invalidUnitIds.add(bodyguardUnit.id);
      for (const attachment of group) invalidUnitIds.add(attachment.leaderUnit.id);
    }
  }
  attachments = attachments.filter(
    (attachment) =>
      !invalidUnitIds.has(attachment.leaderUnit.id) &&
      !invalidUnitIds.has(attachment.bodyguardUnit.id),
  );
  for (const attachment of attachments) {
    attachedUnitIds.add(attachment.leaderUnit.id);
    attachedUnitIds.add(attachment.bodyguardUnit.id);
  }

  return { attachments, errors, invalidUnitIds, attachedUnitIds, attachmentsByBodyguard };
}
