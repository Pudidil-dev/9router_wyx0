import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
} from "./kiroBulkImportManager.js";
import { runGoogleAccountAutomation } from "./kiroGoogleAutomation.js";

const QODER_PROVIDER_ID = "qoder";
const QODER_LABEL = "Qoder";
const QODER_POLL_TIMEOUT_MS = 5 * 60_000;
const QODER_POLL_INTERVAL_MS = 2_000;
const QODER_MAX_TRANSIENT_POLL_ERRORS = 6;

function wait(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const cleanup = () => signal?.removeEventListener?.("abort", abort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      cleanup();
      resolve();
    };
    signal?.addEventListener?.("abort", abort, { once: true });
  });
}

async function defaultSaveQoderConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const { assertProviderEnabled } = await import("@/lib/providerDisabled");
  await assertProviderEnabled(QODER_PROVIDER_ID);
  const providerSpecificData = {
    ...(tokens.providerSpecificData || {}),
    loginEmail: email,
    automation: "gsuite-bulk",
  };

  const connection = await createProviderConnection({
    provider: QODER_PROVIDER_ID,
    authType: "oauth",
    name: tokens.displayName || email || undefined,
    displayName: tokens.displayName || undefined,
    email: tokens.email || email || undefined,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null,
    providerSpecificData,
    testStatus: "active",
  });

  return { connection };
}

async function defaultRequestDeviceCode(providerId) {
  const { requestDeviceCode } = await import("../providers.js");
  return requestDeviceCode(providerId);
}

async function defaultPollForToken(providerId, deviceCode, codeVerifier, extraData) {
  const { pollForToken } = await import("../providers.js");
  return pollForToken(providerId, deviceCode, codeVerifier, extraData);
}

function createQoderPollPromise({
  deviceCode,
  codeVerifier,
  extraData,
  pollToken,
  onStep,
  signal,
  timeoutMs = QODER_POLL_TIMEOUT_MS,
  pollIntervalMs = QODER_POLL_INTERVAL_MS,
  maxTransientErrors = QODER_MAX_TRANSIENT_POLL_ERRORS,
}) {
  return (async () => {
    const startedAt = Date.now();
    let lastStepAt = 0;
    let transientErrors = 0;

    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) {
        throw new Error("Qoder OAuth polling cancelled");
      }

      if (Date.now() - lastStepAt > pollIntervalMs - 100) {
        onStep?.("polling_qoder_token", "Waiting for Qoder device token");
        lastStepAt = Date.now();
      }

      const result = await pollToken(QODER_PROVIDER_ID, deviceCode, codeVerifier, extraData);
      if (result.success) {
        return { tokens: result.tokens };
      }

      if (!result.pending && result.error !== "authorization_pending" && result.error !== "slow_down") {
        if (result.error === "poll_failed" && transientErrors < maxTransientErrors) {
          transientErrors += 1;
          onStep?.(
            "qoder_poll_retry",
            `Qoder token poll failed temporarily (${transientErrors}/${maxTransientErrors}); retrying`
          );
          await wait(pollIntervalMs, signal);
          continue;
        }
        throw new Error(result.errorDescription || result.error || "Qoder OAuth polling failed");
      }

      await wait(pollIntervalMs, signal);
    }

    throw new Error("Timed out waiting for Qoder device token");
  })();
}

export class QoderBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher,
    googleAutomation = runGoogleAccountAutomation,
    requestDeviceCodeFn = defaultRequestDeviceCode,
    pollToken = defaultPollForToken,
    saveConnection = defaultSaveQoderConnection,
    pollIntervalMs = QODER_POLL_INTERVAL_MS,
  } = {}) {
    super({
      browserLauncher,
      googleAutomation,
      storageName: "qoder-bulk-import",
    });
    this.requestDeviceCode = requestDeviceCodeFn;
    this.pollToken = pollToken;
    this.saveConnection = saveConnection;
    this.pollIntervalMs = pollIntervalMs;
  }

  async runManualFollowup(job, account, workerId, context, successPromise) {
    const followupPromise = (async () => {
      try {
        const result = await successPromise;
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        this.setAccountStep(account, "saving_connection", "Saving Qoder connection");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.saveConnection({
          tokens: result.tokens || {},
          email: account.email,
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Qoder connection saved successfully",
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
      } catch (error) {
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
        } else {
          this.finalizeAccount(account, "failed_exchange", {
            error: error.message || "Manual assist flow failed during token polling.",
            step: "exchange_failed",
            message: error.message || "Manual assist flow failed during token polling.",
          });
        }
        await this.persistJobSnapshot(job, { forcePreview: true });
      } finally {
        account.manualSession = null;
        account.runtimeSession = null;
        await context.close().catch(() => null);
        job.manualFollowups.delete(followupPromise);
        await this.persistJobSnapshot(job, { forcePreview: true });
      }
    })();

    job.manualFollowups.add(followupPromise);
  }

  async processAccount(job, account, workerId) {
    if (job.cancelRequested || !job.browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const { context, page } = await createFreshContext(job.browser, { browserChoice: job.browserChoice });
    account.runtimeSession = { context, page };
    let pollController = null;

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} is preparing a browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      this.setAccountStep(account, "requesting_qoder_state", "Requesting Qoder device login state");
      const deviceData = await this.requestDeviceCode(QODER_PROVIDER_ID);
      const authUrl = deviceData.verification_uri_complete || deviceData.verification_uri;
      if (!authUrl || !deviceData.device_code || !deviceData.codeVerifier) {
        throw new Error("Qoder did not return a valid device login URL");
      }

      pollController = new AbortController();
      const successPromise = createQoderPollPromise({
        deviceCode: deviceData.device_code,
        codeVerifier: deviceData.codeVerifier,
        extraData: {
          _qoderNonce: deviceData._qoderNonce,
          _qoderMachineId: deviceData._qoderMachineId,
          _qoderVerifier: deviceData.codeVerifier,
        },
        pollToken: this.pollToken,
        signal: pollController.signal,
        pollIntervalMs: this.pollIntervalMs,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      const automationResult = await this.googleAutomation({
        page,
        authUrl,
        email: account.email,
        password: account.password,
        successPromise,
        serviceLabel: QODER_LABEL,
        openingStep: "opening_qoder_oauth",
        openingMessage: "Opening Qoder device login page",
        successStep: "qoder_token_received",
        successMessage: "Qoder device token received",
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        this.setAccountStep(account, "saving_connection", "Saving Qoder connection");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.saveConnection({
          tokens: automationResult.tokens || {},
          email: account.email,
        });
        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Qoder connection saved successfully",
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      if (automationResult.status === "needs_manual") {
        account.manualSession = {
          context,
          page,
          opened: false,
          openedAt: null,
        };
        this.setAccountStep(account, "awaiting_manual", "Waiting for manual completion in the browser session");
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult.error,
          step: "awaiting_manual",
          message: automationResult.error,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
        await this.runManualFollowup(job, account, workerId, context, successPromise);
        return;
      }

      pollController.abort();
      this.finalizeAccount(account, automationResult.status || "failed", {
        error: automationResult.error || "Qoder Google automation failed.",
        step: automationResult.status || "failed",
        message: automationResult.error || "Qoder Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      pollController?.abort();
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", {
          error: "Job cancelled",
          step: "cancelled",
          message: "Job cancelled while Qoder automation was running",
        });
      } else {
        this.finalizeAccount(account, "failed", {
          error: error.message || "Unexpected Qoder bulk import failure.",
          step: "failed",
          message: error.message || "Unexpected Qoder bulk import failure.",
        });
      }
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__qoderBulkImportSingleton) {
    globalThis.__qoderBulkImportSingleton = {
      manager: new QoderBulkImportManager(),
    };
  }
  return globalThis.__qoderBulkImportSingleton;
}

export function getQoderBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY as QODER_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY as QODER_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY as QODER_BULK_IMPORT_MIN_CONCURRENCY,
  parseKiroBulkAccounts as parseQoderBulkAccounts,
};
