function normalizedName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
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
