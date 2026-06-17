import { getProviderConnections } from "@/models";
import { AI_PROVIDERS } from "@/shared/constants/providers";

export function isProviderSystemDisabled(providerId) {
  return AI_PROVIDERS[providerId]?.systemDisabled === true;
}

export function isProviderDisabledFromConnections(connections = []) {
  return connections.length > 0 && connections.every((connection) => connection.isActive === false);
}

export async function isProviderDisabled(providerId) {
  if (isProviderSystemDisabled(providerId)) return true;
  const connections = await getProviderConnections({ provider: providerId });
  return isProviderDisabledFromConnections(connections);
}

export function getProviderDisabledMessage(providerId) {
  if (isProviderSystemDisabled(providerId)) {
    return `${AI_PROVIDERS[providerId]?.name || providerId} is permanently disabled by the system because the upstream rejects this integration with code 11140: request illegal.`;
  }
  return `${providerId} is disabled. Re-enable it from the Providers tab to use this feature.`;
}

export async function assertProviderEnabled(providerId) {
  if (await isProviderDisabled(providerId)) {
    const error = new Error(getProviderDisabledMessage(providerId));
    error.status = 409;
    throw error;
  }
}
