import type { FetchedModel } from "@/lib/api/model-fetch";

export function hasExactGpt54Model(model: FetchedModel): boolean {
  return model.id.trim().toLowerCase() === "gpt-5.4";
}

export function isGoogleLikeModel(model: FetchedModel): boolean {
  const id = model.id.toLowerCase();
  const owner = (model.ownedBy || "").toLowerCase();
  return (
    owner.includes("google") ||
    owner.includes("antigravity") ||
    id.includes("google") ||
    id.includes("gemini") ||
    id.includes("gemma")
  );
}

export function pickReplyTestModel(
  fetchedModels: FetchedModel[],
  configuredModel: string,
): string | undefined {
  if (fetchedModels.length === 0) {
    return undefined;
  }

  if (fetchedModels.some(hasExactGpt54Model)) {
    return undefined;
  }

  return fetchedModels.find(isGoogleLikeModel)?.id || configuredModel;
}

export function shouldApplyToGemini(
  testedModel: string,
  fetchedModels: FetchedModel[],
): boolean {
  const matchedModel = fetchedModels.find((model) => model.id === testedModel);
  return matchedModel ? isGoogleLikeModel(matchedModel) : false;
}
