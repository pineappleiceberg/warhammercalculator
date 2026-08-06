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
