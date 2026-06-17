import { PROVIDERS } from "./providers.js";
import REGISTRY from "../providers/registry/index.js";
// PROVIDER_MODELS now built from providers/registry (transport + models co-located)
import { PROVIDER_MODELS } from "../providers/index.js";
import { modelQuotaFamily, modelStrip, modelTargetFormat } from "../providers/models/schema.js";
import { CODEX_REVIEW_SUFFIX } from "../providers/models/helpers.js";

export { PROVIDER_MODELS };


// Helper functions
function getProviderModelList(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || PROVIDER_MODELS[PROVIDER_ID_TO_ALIAS[aliasOrId]] || [];
}

function findProviderModel(aliasOrId, modelId) {
  const models = getProviderModelList(aliasOrId);
  return models.find(m => m.id === modelId || m.aliases?.includes?.(modelId)) || null;
}

export function getProviderModels(aliasOrId) {
  return getProviderModelList(aliasOrId);
}

export function getDefaultModel(aliasOrId) {
  return getProviderModelList(aliasOrId)?.[0]?.id || null;
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  return !!findProviderModel(aliasOrId, modelId);
}

export function findModelName(aliasOrId, modelId) {
  return findProviderModel(aliasOrId, modelId)?.name || modelId;
}

export function getModelTargetFormat(aliasOrId, modelId) {
  return modelTargetFormat(findProviderModel(aliasOrId, modelId));
}

export function getModelType(aliasOrId, modelId) {
  const found = findProviderModel(aliasOrId, modelId);
  return found?.kind || found?.type || null;
}

export function getModelUpstreamId(aliasOrId, modelId) {
  const found = findProviderModel(aliasOrId, modelId);
  if (found?.upstreamModelId) return found.upstreamModelId;
  if (found && found.id !== modelId) return found.id;
  if (aliasOrId === "cx" && typeof modelId === "string" && modelId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return modelId.slice(0, -CODEX_REVIEW_SUFFIX.length);
  }
  return modelId;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  return modelQuotaFamily(findProviderModel(aliasOrId, modelId));
}

// OAuth short aliases — derived from registry `alias` (single source). everything else: alias = id.
// vertex/vertex-partner keep alias=id (kept via the `|| id` fallback in consumers).
export const OAUTH_ALIASES = Object.fromEntries(
  REGISTRY.filter(r => r.alias && r.alias !== r.id).map(r => [r.id, r.alias])
);

// Derived from PROVIDERS — no need to maintain manually
export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  Object.keys(PROVIDERS).map(id => [id, OAUTH_ALIASES[id] || id])
);

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

// Get strip list for a model entry (explicit opt-in only)
// Returns array of content types to strip, e.g. ["image", "audio"]
export function getModelStrip(alias, modelId) {
  return modelStrip(PROVIDER_MODELS[alias]?.find(m => m.id === modelId));
}
