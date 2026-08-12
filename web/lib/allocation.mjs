export function allocateDamageToUnit(appliedDamage, incomingDamage, woundsPerModel, modelCount) {
  if (
    ![appliedDamage, incomingDamage, woundsPerModel, modelCount].every(Number.isSafeInteger) ||
    appliedDamage < 0 ||
    incomingDamage < 0 ||
    woundsPerModel < 1 ||
    modelCount < 1
  ) {
    throw new Error("Invalid unit damage allocation");
  }

  const capacity = woundsPerModel * modelCount;
  const before = Math.min(appliedDamage, capacity);
  const woundsOnCurrent = before === capacity ? 0 : before % woundsPerModel;
  const remainingOnCurrent = before === capacity ? 0 : woundsPerModel - woundsOnCurrent;
  const appliedThisAttack = Math.min(incomingDamage, remainingOnCurrent);
  const applied = before + appliedThisAttack;
  const modelsDestroyed = Math.floor(applied / woundsPerModel);
  const woundsRemaining = applied >= capacity ? 0 : woundsPerModel - (applied % woundsPerModel);

  return {
    applied,
    appliedThisAttack,
    wasted: incomingDamage - appliedThisAttack,
    modelsDestroyed,
    woundsRemaining,
  };
}

function validTargetSequence(targets) {
  return (
    Array.isArray(targets) &&
    targets.length > 0 &&
    targets.length <= 64 &&
    targets.every(
      (target) =>
        target !== null &&
        typeof target === "object" &&
        Number.isSafeInteger(target.wounds) &&
        Number.isSafeInteger(target.modelCount) &&
        target.wounds >= 1 &&
        target.modelCount >= 1,
    )
  );
}

export function targetSequenceCapacity(targets) {
  if (!validTargetSequence(targets)) throw new Error("Invalid target sequence");
  const capacity = targets.reduce((total, target) => total + target.wounds * target.modelCount, 0);
  if (!Number.isSafeInteger(capacity)) throw new Error("Target sequence is too large");
  return capacity;
}

export function targetSequencePosition(appliedDamage, targets) {
  const capacity = targetSequenceCapacity(targets);
  if (!Number.isSafeInteger(appliedDamage) || appliedDamage < 0 || appliedDamage >= capacity) {
    return null;
  }
  let offset = 0;
  let modelsDestroyed = 0;
  for (let segmentIndex = 0; segmentIndex < targets.length; segmentIndex += 1) {
    const target = targets[segmentIndex];
    const segmentCapacity = target.wounds * target.modelCount;
    if (appliedDamage < offset + segmentCapacity) {
      const damageInSegment = appliedDamage - offset;
      const woundsLost = damageInSegment % target.wounds;
      return {
        segmentIndex,
        modelsDestroyed: modelsDestroyed + Math.floor(damageInSegment / target.wounds),
        woundsRemaining: target.wounds - woundsLost,
      };
    }
    offset += segmentCapacity;
    modelsDestroyed += target.modelCount;
  }
  return null;
}

export function targetSequenceState(appliedDamage, targets) {
  const capacity = targetSequenceCapacity(targets);
  if (!Number.isSafeInteger(appliedDamage) || appliedDamage < 0 || appliedDamage > capacity) {
    throw new Error("Invalid target sequence damage state");
  }
  let remainingDamage = appliedDamage;
  return targets.map((target, segmentIndex) => {
    const segmentCapacity = target.wounds * target.modelCount;
    const damage = Math.min(remainingDamage, segmentCapacity);
    const modelsDestroyed = Math.floor(damage / target.wounds);
    const modelsRemaining = target.modelCount - modelsDestroyed;
    const woundsLost = modelsRemaining > 0 ? damage % target.wounds : 0;
    remainingDamage -= damage;
    return {
      segmentIndex,
      modelsDestroyed,
      modelsRemaining,
      woundsLost,
    };
  });
}

export function allocateDamageToSequence(appliedDamage, incomingDamage, targets) {
  const capacity = targetSequenceCapacity(targets);
  if (
    !Number.isSafeInteger(appliedDamage) ||
    !Number.isSafeInteger(incomingDamage) ||
    appliedDamage < 0 ||
    incomingDamage < 0
  ) {
    throw new Error("Invalid target sequence damage allocation");
  }
  const before = Math.min(appliedDamage, capacity);
  const position = targetSequencePosition(before, targets);
  const appliedThisAttack = position ? Math.min(incomingDamage, position.woundsRemaining) : 0;
  const applied = before + appliedThisAttack;
  const after = targetSequencePosition(applied, targets);
  return {
    applied,
    appliedThisAttack,
    wasted: incomingDamage - appliedThisAttack,
    modelsDestroyed: after
      ? after.modelsDestroyed
      : targets.reduce((total, target) => total + target.modelCount, 0),
    woundsRemaining: after?.woundsRemaining ?? 0,
    segmentIndex: after?.segmentIndex ?? targets.length,
  };
}
