/**
 * KiroBulkImportManager — Kiro-specific bulk import automation.
 *
 * Handles: Google OAuth + PKCE flow → callback capture → social exchange → save connection.
 * Kiro uses a callback-based OAuth flow (not device code like Qoder).
 */
import { randomUUID } from "crypto";
import { KiroService } from "./kiro.js";
import { createKiroCallbackMonitor, runKiroGoogleAutomation } from "./automation/googleOAuth.js";
import {
  BaseBulkImportManager,
  createFreshContext,
  parseBulkAccounts,
  buildLookupResponse,
  nowIso,
  clampConcurrency,
  DEFAULT_CONCURRENCY,
  MIN_CONCURRENCY,
  MAX_CONCURRENCY,
} from "./automation/baseBulkImportManager.js";

const KIRO_PROVIDER_ID = "kiro";
const KIRO_LABEL = "Kiro";

export const KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY = DEFAULT_CONCURRENCY;
export const KIRO_BULK_IMPORT_MIN_CONCURRENCY = MIN_CONCURRENCY;
export const KIRO_BULK_IMPORT_MAX_CONCURRENCY = MAX_CONCURRENCY;

async function defaultSocialExchange(args) {
  const { exchangeAndSaveKiroSocialConnection } = await import("./kiroConnections.js");
  return exchangeAndSaveKiroSocialConnection(args);
}

export async function closeKiroContextAfterCallback(callbackPromise, context) {
  try {
    await callbackPromise;
    await context.close().catch(() => null);
    return true;
  } catch {
    return false;
  }
}

export class KiroBulkImportManager extends BaseBulkImportManager {
  constructor({
    browserLauncher,
    googleAutomation = runKiroGoogleAutomation,
    socialExchange = defaultSocialExchange,
    kiroServiceFactory = () => new KiroService(),
    storageName = "kiro-bulk-import",
  } = {}) {
    super({
      storageName,
      providerLabel: KIRO_LABEL,
      browserLauncher,
      browserPerAccount: true,
      defaultConcurrency: KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
    });

    this.googleAutomation = googleAutomation;
    this.socialExchange = socialExchange;
    this.kiroServiceFactory = kiroServiceFactory;
  }

  startJob({ accounts, parsedAccounts, concurrency, browser } = {}) {
    let normalizedAccounts = parsedAccounts;

    if (!Array.isArray(normalizedAccounts)) {
      const { parsed, invalidLines } = parseKiroBulkAccounts(accounts);
      if (invalidLines.length > 0) {
        const error = "Invalid account format. Use one account per line: gmail@example.com|password";
        throw Object.assign(new Error(error), { error, invalidLines });
      }
      normalizedAccounts = parsed;
    }

    return super.startJob({
      parsedAccounts: normalizedAccounts,
      concurrency,
      browser,
    });
  }

  async runManualFollowup(job, account, workerId, context, callbackPromise, codeVerifier) {
    const followupPromise = (async () => {
      try {
        const callback = await callbackPromise;
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        this.setAccountStep(account, "exchanging_tokens", "Exchanging Kiro callback for OAuth tokens");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.socialExchange({
          code: callback.code,
          codeVerifier,
          provider: "google",
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Kiro connection saved successfully",
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
            error: error.message || "Manual assist flow failed during token exchange.",
            step: "exchange_failed",
            message: error.message || "Manual assist flow failed during token exchange.",
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

  async processAccount(job, account, workerId, browser) {
    if (job.cancelRequested || !browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const kiroService = this.kiroServiceFactory();
    const socialAuth = kiroService.createSocialAuthorization("google");
    let context = null;
    let page = null;
    let callbackPromise = null;

    try {
      ({ context, page } = await createFreshContext(browser));
      callbackPromise = createKiroCallbackMonitor(context, page);
      void closeKiroContextAfterCallback(callbackPromise, context);
      account.runtimeSession = { context, page };

      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} is preparing a browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      const automationResult = await this.googleAutomation({
        page,
        authUrl: socialAuth.authUrl,
        email: account.email,
        password: account.password,
        callbackPromise,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (job.cancelRequested || account.status === "cancelled") {
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      if (automationResult.status === "success") {
        this.setAccountStep(account, "exchanging_tokens", "Exchanging Kiro callback for OAuth tokens");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.socialExchange({
          code: automationResult.code,
          codeVerifier: socialAuth.codeVerifier,
          provider: "google",
        });
        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Kiro connection saved successfully",
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
        await this.runManualFollowup(
          job,
          account,
          workerId,
          context,
          callbackPromise,
          socialAuth.codeVerifier
        );
        return;
      }

      const terminalStatus = automationResult.status || "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "Kiro Google automation failed.",
        step: terminalStatus,
        message: automationResult.error || "Kiro Google automation failed.",
      });
      account.runtimeSession = null;
      await context?.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected Kiro bulk import failure.",
        step: "failed",
        message: error.message || "Unexpected Kiro bulk import failure.",
      });
      account.runtimeSession = null;
      await context?.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }
}

export function parseKiroBulkAccounts(accounts = []) {
  return parseBulkAccounts(accounts, KIRO_LABEL);
}

function getSingletonStore() {
  if (!globalThis.__kiroBulkImportSingleton) {
    globalThis.__kiroBulkImportSingleton = {
      manager: new KiroBulkImportManager(),
    };
  }
  return globalThis.__kiroBulkImportSingleton;
}

export function getKiroBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
};

export const __test__ = {
  clampConcurrency,
  parseKiroBulkAccounts,
};
