// HTTP status codes
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Re-export error config (backward compat)
export { ERROR_TYPES, DEFAULT_ERROR_MESSAGES, BACKOFF_CONFIG, COOLDOWN_MS } from "./errorConfig.js";

// Cache TTLs (seconds)
export const CACHE_TTL = {
  userInfo: 300,    // 5 minutes
  modelAlias: 3600  // 1 hour
};

// Memory management config
export const MEMORY_CONFIG = {
  sessionTtlMs: 2 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
  dnsCacheTtlMs: 5 * 60 * 1000,
  proxyDispatchersMaxSize: 20,
};

// Stream stall timeout: abort if no chunk received within this duration
export const STREAM_STALL_TIMEOUT_MS = 60 * 1000;

// Fetch connect timeout: abort if upstream doesn't return response headers within this duration.
// Used as a safety net for the connect+upload+first-byte phase. Larger payloads
// (long context, pasted images) routed through proxies need more headroom — this
// is now treated as the upper bound on time-to-first-byte, not a per-phase timer.
export const FETCH_CONNECT_TIMEOUT_MS = 180 * 1000; // 3 minutes

// Hard upper bound on the entire request including upload (independent of TTFB).
// Aborts if the request hasn't even produced a Response object after this duration.
export const FETCH_REQUEST_TIMEOUT_MS = 300 * 1000; // 5 minutes

// Default token limits
export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

// Retry config for 429 responses (legacy - kept for backward compatibility)
export const RETRY_CONFIG = {
  maxAttempts: 2,
  delayMs: 2000
};

// Default retry config by status code: { attempts, delayMs, backoff?, jitter?, maxDelayMs? }
// Backward compat: if value is a number, treated as attempts with RETRY_CONFIG.delayMs
//   - backoff: "fixed" (default) | "exponential"
//   - jitter:  when true, adds random([0, delay/2]) to each delay
//   - maxDelayMs: hard cap on computed delay (default 30s)
export const DEFAULT_RETRY_CONFIG = {
  429: { attempts: 0, delayMs: 0 },
  502: { attempts: 4, delayMs: 2000, backoff: "exponential", jitter: true, maxDelayMs: 30000 },
  503: { attempts: 4, delayMs: 2000, backoff: "exponential", jitter: true, maxDelayMs: 30000 },
  504: { attempts: 3, delayMs: 3000, backoff: "exponential", jitter: true, maxDelayMs: 30000 }
};

// Normalize a retry entry to { attempts, delayMs, backoff, jitter, maxDelayMs }
export function resolveRetryEntry(entry) {
  if (entry == null) return { attempts: 0, delayMs: RETRY_CONFIG.delayMs, backoff: "fixed", jitter: false, maxDelayMs: 30000 };
  if (typeof entry === "number") return { attempts: entry, delayMs: RETRY_CONFIG.delayMs, backoff: "fixed", jitter: false, maxDelayMs: 30000 };
  return {
    attempts: entry.attempts || 0,
    delayMs: entry.delayMs != null ? entry.delayMs : RETRY_CONFIG.delayMs,
    backoff: entry.backoff || "fixed",
    jitter: entry.jitter === true,
    maxDelayMs: entry.maxDelayMs != null ? entry.maxDelayMs : 30000
  };
}

// Compute the actual delay for a given attempt (1-indexed) using the resolved retry entry
export function computeRetryDelay(resolvedEntry, attemptNumber) {
  const { delayMs, backoff, jitter, maxDelayMs } = resolvedEntry;
  let computed = delayMs;
  if (backoff === "exponential") {
    // attempt 1 → delayMs, 2 → 2x, 3 → 4x, 4 → 8x ...
    computed = delayMs * Math.pow(2, Math.max(0, attemptNumber - 1));
  }
  if (jitter) {
    computed += Math.random() * (computed / 2);
  }
  return Math.min(Math.round(computed), maxDelayMs || 30000);
}

// Requests containing these texts will bypass provider
export const SKIP_PATTERNS = [
  "Please write a 5-10 word title for the following conversation:"
];
