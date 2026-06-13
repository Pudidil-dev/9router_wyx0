import { classifyConnectionStatus } from "./connectionStatus.js";

const ISSUE_STATUS_KEYS = new Set([
  "connection_error",
  "auth_error",
  "quota_exhausted",
  "rate_limited",
  "banned",
  "cooldown",
]);

function hasActiveDate(value) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function hasActiveModelLock(connection = {}) {
  return Object.entries(connection).some(([key, value]) => (
    key.startsWith("modelLock_") && hasActiveDate(value)
  ));
}

export function getEffectiveConnectionStatus(connection = {}) {
  if (connection.testStatus === "unavailable" && !hasActiveModelLock(connection)) {
    return "active";
  }
  return connection.testStatus;
}

export function isConnectionIssue(connection = {}) {
  if (connection.isActive === false) return false;

  const effectiveStatus = getEffectiveConnectionStatus(connection);
  if (effectiveStatus === "active" || effectiveStatus === "success") {
    return false;
  }

  const classifiedStatus = classifyConnectionStatus(connection);
  if (ISSUE_STATUS_KEYS.has(classifiedStatus.key)) {
    return true;
  }

  if (classifiedStatus.key !== "unknown") {
    return false;
  }

  return Boolean(
    connection.lastError
    || connection.error
    || connection.errorCode
    || connection.statusCode
    || connection.lastErrorType
    || connection.errorType
  );
}

export function summarizeProviderConnections(connections = []) {
  const total = connections.length;
  const allDisabled = total > 0 && connections.every((connection) => connection.isActive === false);

  let connected = 0;
  let issue = 0;

  for (const connection of connections) {
    if (connection.isActive === false) continue;

    const effectiveStatus = getEffectiveConnectionStatus(connection);
    if (effectiveStatus === "active" || effectiveStatus === "success") {
      connected += 1;
      continue;
    }

    if (isConnectionIssue(connection)) {
      issue += 1;
    }
  }

  return {
    total,
    allDisabled,
    connected,
    issue,
    added: Math.max(0, total - connected - issue),
  };
}

export function getProviderConnectionsForSummary(allConnections = [], providerId, authType = null) {
  const providerConnections = allConnections.filter((connection) => connection.provider === providerId);
  if (!authType) return providerConnections;

  const exactMatches = providerConnections.filter((connection) => connection.authType === authType);
  if (exactMatches.length > 0 || providerConnections.length === 0) {
    return exactMatches;
  }

  // Forks may store a provider under a different authType than the overview section expects.
  // When that happens, prefer showing the real saved connections instead of a fake "No connections".
  return providerConnections;
}
