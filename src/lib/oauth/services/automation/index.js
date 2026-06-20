/**
 * Automation Base Exports
 *
 * Shared utilities and base classes for all provider automation managers.
 */

export {
  BaseBulkImportManager,
  AUTOMATION_CONTEXT_OPTIONS,
  AUTOMATION_STEALTH_INIT_SCRIPT,
  createFreshContext,

  // Job lifecycle
  ACTIVE_JOB_STATUSES,
  TERMINAL_ACCOUNT_STATUSES,
  buildLookupResponse,
  isRecentTerminalJob,

  // Account management
  parseBulkAccounts,
  sanitizeAccount,
  sanitizeJob,
  buildSummary,
  hasUnfinishedAccounts,

  // Utilities
  clampConcurrency,
  nowIso,
  createLogEntry,

  // Constants
  DEFAULT_CONCURRENCY,
  MIN_CONCURRENCY,
  MAX_CONCURRENCY,
  MAX_ACCOUNT_LOG_ENTRIES,
  MAX_JOB_ACTIVITY_ENTRIES,
  PREVIEW_CAPTURE_INTERVAL_MS,
  RECENT_TERMINAL_JOB_WINDOW_MS,

  // File persistence
  ensureDir,
  readJsonFile,
  writeJsonFile,
  getJobFile,
  readPersistedLatestJobId,
  writePersistedLatestJobId,
  buildPersistedSnapshot,
} from './baseBulkImportManager.js';
