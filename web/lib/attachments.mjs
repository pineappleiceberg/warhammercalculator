function valueSet(values) {
  return values instanceof Set ? values : new Set(values ?? []);
}

export function savedUnitLoadout(savedUnit) {
  return {
    equippedWeaponGroupIds: new Set(
      (savedUnit?.weapons ?? [])
        .filter((weapon) => weapon.count > 0)
        .map((weapon) => weapon.groupId ?? String(weapon.weaponId)),
    ),
    choiceSelectionIds: new Set(
      Object.entries(savedUnit?.choiceSelections ?? {})
        .filter(([, count]) => count > 0)
        .map(([id]) => id),
    ),
  };
}

export function leaderAttachmentEligibility(leader, bodyguard, loadout = {}) {
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
  const condition = (leader.leaderAttachmentConditions ?? []).find(
    (entry) => entry.bodyguardId === bodyguard.id,
  );
  if (condition) {
    const equippedWeaponGroupIds = valueSet(loadout.equippedWeaponGroupIds);
    const choiceSelectionIds = valueSet(loadout.choiceSelectionIds);
    const equipped = condition.requiredWeaponGroupId
      ? equippedWeaponGroupIds.has(condition.requiredWeaponGroupId)
      : choiceSelectionIds.has(condition.requiredChoiceAlternativeId);
    if (!equipped) {
      return {
        eligible: false,
        reason: `${leader.name} requires ${condition.requiredEquipment} to lead ${bodyguard.name}`,
        condition,
      };
    }
  }
  return { eligible: true, reason: "" };
}

export function bodyguardJoinEligibility(
  joiner,
  bodyguard,
  { isAttached = false, existingSameJoiners = 0 } = {},
) {
  if (!joiner) return { eligible: false, reason: "Joining unit profile not found" };
  if (!bodyguard) return { eligible: false, reason: "Bodyguard profile not found" };
  if (joiner.id === bodyguard.id) {
    return { eligible: false, reason: `${joiner.name} cannot join itself` };
  }
  const rule = (joiner.bodyguardJoinOptions ?? []).find(
    (entry) => entry.bodyguardId === bodyguard.id,
  );
  if (!rule) return { eligible: false, reason: `${joiner.name} cannot join ${bodyguard.name}` };
  if (rule.requiresUnattached && isAttached) {
    return {
      eligible: false,
      reason: `${joiner.name} cannot join another unit while it is an Attached unit`,
      rule,
    };
  }
  if (existingSameJoiners >= rule.maximumSameJoiner) {
    return {
      eligible: false,
      reason: `${bodyguard.name} cannot have more than ${rule.maximumSameJoiner} ${joiner.name} unit joined to it`,
      rule,
    };
  }
  return { eligible: true, reason: "", rule };
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
  { requireMinimum = true, leaderLoadouts = [] } = {},
) {
  if (!bodyguard)
    return { eligible: false, reason: "Bodyguard profile not found", maximumLeaders: 0 };
  for (const [index, leader] of leaders.entries()) {
    const pair = leaderAttachmentEligibility(leader, bodyguard, leaderLoadouts[index]);
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
  const joinedUnitIds = new Set();
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
    const eligibility = leaderAttachmentEligibility(
      leader,
      bodyguard,
      savedUnitLoadout(leaderUnit),
    );
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
      { leaderLoadouts: group.map((attachment) => savedUnitLoadout(attachment.leaderUnit)) },
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

  let joins = [];
  for (const joinerUnit of armyList?.units ?? []) {
    if (!joinerUnit.joinedToId) continue;
    const bodyguardUnit = savedUnits.get(joinerUnit.joinedToId);
    if (!bodyguardUnit) {
      errors.push(`${joinerUnit.name} references a joined unit that is not in this list`);
      invalidUnitIds.add(joinerUnit.id);
      continue;
    }
    if (bodyguardUnit.id === joinerUnit.id) {
      errors.push(`${joinerUnit.name} cannot join itself`);
      invalidUnitIds.add(joinerUnit.id);
      continue;
    }
    const seen = new Set([joinerUnit.id]);
    let nextJoinedId = joinerUnit.joinedToId;
    let cyclic = false;
    while (nextJoinedId) {
      if (seen.has(nextJoinedId)) {
        errors.push(`${joinerUnit.name} is part of a circular Bodyguard join`);
        invalidUnitIds.add(joinerUnit.id);
        invalidUnitIds.add(bodyguardUnit.id);
        cyclic = true;
        break;
      }
      seen.add(nextJoinedId);
      nextJoinedId = savedUnits.get(nextJoinedId)?.joinedToId;
    }
    if (cyclic) continue;
    const joiner = catalogueUnits.get(joinerUnit.unitId);
    const bodyguard = catalogueUnits.get(bodyguardUnit.unitId);
    const eligibility = bodyguardJoinEligibility(joiner, bodyguard);
    if (!eligibility.eligible) {
      errors.push(eligibility.reason);
      invalidUnitIds.add(joinerUnit.id);
      continue;
    }
    if (eligibility.rule.requiresUnattached && attachedUnitIds.has(joinerUnit.id)) {
      errors.push(`${joinerUnit.name} cannot join another unit while it is an Attached unit`);
      invalidUnitIds.add(joinerUnit.id);
      continue;
    }
    joins.push({ joinerUnit, joiner, bodyguardUnit, bodyguard, rule: eligibility.rule });
  }
  const joinsByBodyguardAndDatasheet = new Map();
  for (const join of joins) {
    const key = `${join.bodyguardUnit.id}:${join.joiner.id}`;
    const values = joinsByBodyguardAndDatasheet.get(key) ?? [];
    values.push(join);
    joinsByBodyguardAndDatasheet.set(key, values);
  }
  for (const values of joinsByBodyguardAndDatasheet.values()) {
    if (values.length <= values[0].rule.maximumSameJoiner) continue;
    errors.push(
      `${values[0].bodyguardUnit.name} cannot have more than ${values[0].rule.maximumSameJoiner} ${values[0].joiner.name} unit joined to it`,
    );
    invalidUnitIds.add(values[0].bodyguardUnit.id);
    for (const join of values) invalidUnitIds.add(join.joinerUnit.id);
  }
  joins = joins.filter(
    (join) => !invalidUnitIds.has(join.joinerUnit.id) && !invalidUnitIds.has(join.bodyguardUnit.id),
  );
  const startingStrengthByBodyguard = new Map();
  for (const join of joins) {
    joinedUnitIds.add(join.joinerUnit.id);
    joinedUnitIds.add(join.bodyguardUnit.id);
    if (join.rule.increasesStartingStrength) {
      startingStrengthByBodyguard.set(
        join.bodyguardUnit.id,
        (startingStrengthByBodyguard.get(join.bodyguardUnit.id) ?? join.bodyguardUnit.modelCount) +
          join.joinerUnit.modelCount,
      );
    }
    if (attachedUnitIds.has(join.bodyguardUnit.id)) attachedUnitIds.add(join.joinerUnit.id);
  }

  return {
    attachments,
    joins,
    errors,
    invalidUnitIds,
    attachedUnitIds,
    joinedUnitIds,
    attachmentsByBodyguard,
    startingStrengthByBodyguard,
  };
}
