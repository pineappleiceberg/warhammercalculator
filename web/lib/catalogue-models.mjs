function normalizedName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function catalogueModelComposition(unit, modelCount, loadoutSubjectCounts = {}) {
  const composition = unit?.compositionModels ?? [];
  const models = unit?.models ?? [];
  if (models.length === 0) return { counts: [], exact: false };
  if (models.length === 1) return { counts: [modelCount], exact: true };
  if (composition.length !== models.length) return { counts: [modelCount], exact: false };

  const controlledSubjects = new Map();
  for (const entry of composition) {
    if (!entry.loadoutSubjectId || !entry.controlsComposition) continue;
    controlledSubjects.set(
      entry.loadoutSubjectId,
      Math.max(0, Math.floor(loadoutSubjectCounts[entry.loadoutSubjectId] ?? 0)),
    );
  }
  const solutions = [];
  const current = new Array(composition.length).fill(0);
  const visit = (index, remaining) => {
    if (solutions.length > 1) return;
    if (index === composition.length) {
      if (remaining !== 0) return;
      for (const [subjectId, expected] of controlledSubjects) {
        const actual = composition.reduce(
          (total, entry, compositionIndex) =>
            total + (entry.loadoutSubjectId === subjectId ? current[compositionIndex] : 0),
          0,
        );
        if (actual !== expected) return;
      }
      solutions.push([...current]);
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

export function catalogueModelCandidates(models, value) {
  const token = String(value ?? "");
  if (!token) return [];
  const direct = models.filter((model) => String(model.id) === token);
  if (direct.length) return direct;
  const legacy = models.filter((model) => String(model.sourceModelId) === token);
  if (legacy.length) return legacy;
  const name = normalizedName(token);
  return models.filter((model) => normalizedName(model.name) === name);
}

export function catalogueModelsRequireSelection(models) {
  if (models.length <= 1) return false;
  const sourceModelId = models[0]?.sourceModelId;
  return (
    sourceModelId === undefined || models.some((model) => model.sourceModelId !== sourceModelId)
  );
}
