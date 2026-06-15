const EXHAUSTED_RE = /\b(quota|credit|credits|limit|usage|payment|billing)\b.*\b(exhausted|exceeded|used up|insufficient|limit reached)|\b(exhausted|insufficient credits|payment required|quota exceeded)\b/i;
const RATE_LIMIT_RE = /\b(rate limit|too many requests|throttl|slow down|retry later)\b/i;
const BAN_RE = /\b(banned|blocked|suspended|disabled|terminated|abuse|fraud)\b/i;
const AUTH_RE = /\b(unauthorized|invalid api key|invalid token|forbidden|permission denied|authentication)\b/i;
const NETWORK_RE = /\b(timeout|etimedout|econnreset|econnrefused|network|fetch failed|socket|dns)\b/i;

export const ACCOUNT_STATUSES = {
  ACTIVE: "active",
  RATE_LIMITED: "rate_limited",
  EXHAUSTED: "exhausted",
  BANNED: "banned",
  DISABLED: "disabled",
  ERROR: "error",
};

export const ERROR_CATEGORIES = {
  AUTH_ERROR: "auth_error",
  RATE_LIMIT: "rate_limit",
  QUOTA_EXHAUSTED: "quota_exhausted",
  EXHAUSTED: "exhausted",
  ACCOUNT_BANNED: "account_banned",
  SERVER_ERROR: "server_error",
  NETWORK_ERROR: "network_error",
  INVALID_REQUEST: "invalid_request",
  UNKNOWN: "unknown_error",
};

export function classifyProviderError(status = 0, body = "", headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body || "");
  const retryAfter = Number(headers?.["retry-after"] || headers?.["Retry-After"] || 0) || null;

  if (status === 429) {
    const exhausted = EXHAUSTED_RE.test(text);
    return {
      category: exhausted ? ERROR_CATEGORIES.QUOTA_EXHAUSTED : ERROR_CATEGORIES.RATE_LIMIT,
      status,
      retryAfter,
      message: text || "Rate limit exceeded",
      shouldRetry: !exhausted,
      shouldRotate: true,
      shouldDisable: exhausted,
    };
  }

  if (status === 401 || status === 403) {
    const banned = BAN_RE.test(text);
    return {
      category: banned ? ERROR_CATEGORIES.ACCOUNT_BANNED : ERROR_CATEGORIES.AUTH_ERROR,
      status,
      retryAfter,
      message: text || (status === 401 ? "Unauthorized" : "Forbidden"),
      shouldRetry: false,
      shouldRotate: true,
      shouldDisable: true,
    };
  }

  if (status === 402 || EXHAUSTED_RE.test(text)) {
    return {
      category: ERROR_CATEGORIES.EXHAUSTED,
      status,
      retryAfter,
      message: text || "Credits exhausted",
      shouldRetry: false,
      shouldRotate: true,
      shouldDisable: true,
    };
  }

  if (status >= 500) {
    return {
      category: ERROR_CATEGORIES.SERVER_ERROR,
      status,
      retryAfter,
      message: text || `HTTP ${status}`,
      shouldRetry: true,
      shouldRotate: false,
      shouldDisable: false,
    };
  }

  if (status === 400) {
    return {
      category: ERROR_CATEGORIES.INVALID_REQUEST,
      status,
      retryAfter,
      message: text || "Invalid request",
      shouldRetry: false,
      shouldRotate: false,
      shouldDisable: false,
    };
  }

  if (BAN_RE.test(text)) return classifyProviderError(403, text, headers);
  if (AUTH_RE.test(text)) return classifyProviderError(401, text, headers);
  if (RATE_LIMIT_RE.test(text)) return classifyProviderError(429, text, headers);
  if (NETWORK_RE.test(text)) {
    return {
      category: ERROR_CATEGORIES.NETWORK_ERROR,
      status,
      retryAfter,
      message: text || "Network error",
      shouldRetry: true,
      shouldRotate: false,
      shouldDisable: false,
    };
  }

  return {
    category: ERROR_CATEGORIES.UNKNOWN,
    status,
    retryAfter,
    message: text || `HTTP ${status || "unknown"}`,
    shouldRetry: true,
    shouldRotate: true,
    shouldDisable: false,
  };
}

export function statusFromClassification(classified) {
  switch (classified?.category) {
    case ERROR_CATEGORIES.RATE_LIMIT:
      return ACCOUNT_STATUSES.RATE_LIMITED;
    case ERROR_CATEGORIES.EXHAUSTED:
    case ERROR_CATEGORIES.QUOTA_EXHAUSTED:
      return ACCOUNT_STATUSES.EXHAUSTED;
    case ERROR_CATEGORIES.ACCOUNT_BANNED:
    case ERROR_CATEGORIES.AUTH_ERROR:
      return ACCOUNT_STATUSES.BANNED;
    case ERROR_CATEGORIES.SERVER_ERROR:
    case ERROR_CATEGORIES.NETWORK_ERROR:
      return ACCOUNT_STATUSES.ERROR;
    default:
      return ACCOUNT_STATUSES.ERROR;
  }
}

export function calculateBackoffUntil({ retryAfter = null, backoffLevel = 0, category = ERROR_CATEGORIES.UNKNOWN } = {}) {
  if (retryAfter) return new Date(Date.now() + retryAfter * 1000).toISOString();
  const baseMs = category === ERROR_CATEGORIES.RATE_LIMIT ? 5000 : category === ERROR_CATEGORIES.SERVER_ERROR ? 2000 : 1000;
  const level = Math.max(0, Math.min(Number(backoffLevel) || 0, 8));
  const jitter = 0.9 + Math.random() * 0.2;
  const delay = Math.min(baseMs * Math.pow(2, level) * jitter, 5 * 60 * 1000);
  return new Date(Date.now() + delay).toISOString();
}

export function buildAutomationMetadataOnSuccess(existing = {}, usage = null) {
  const now = new Date().toISOString();
  const next = {
    ...existing,
    automationStatus: ACCOUNT_STATUSES.ACTIVE,
    automationErrorCategory: null,
    automationLastError: null,
    automationBackoffUntil: null,
    automationBackoffLevel: 0,
    automationLastSuccessAt: now,
  };

  if (usage && typeof usage === "object") {
    const total = usage.total_tokens ?? usage.totalTokens ?? null;
    if (total != null) next.automationLastUsageTokens = total;
  }

  return next;
}

export function buildAutomationMetadataOnError(existing = {}, classified) {
  const level = (Number(existing.automationBackoffLevel) || 0) + 1;
  return {
    ...existing,
    automationStatus: statusFromClassification(classified),
    automationErrorCategory: classified?.category || ERROR_CATEGORIES.UNKNOWN,
    automationLastError: classified?.message || "Unknown provider error",
    automationLastErrorAt: new Date().toISOString(),
    automationBackoffLevel: classified?.shouldDisable ? existing.automationBackoffLevel || 0 : level,
    automationBackoffUntil: classified?.shouldDisable ? null : calculateBackoffUntil({
      retryAfter: classified?.retryAfter,
      backoffLevel: level,
      category: classified?.category,
    }),
  };
}

export function isCreditExhausted(providerSpecificData = {}) {
  const used = Number(providerSpecificData.creditUsed ?? providerSpecificData.automationCreditUsed ?? 0);
  const limit = Number(providerSpecificData.creditLimit ?? providerSpecificData.automationCreditLimit ?? 0);
  if (!limit) return false;
  return used / limit >= 0.95;
}
