/**
 * Gemini Web auto-capture: open a visible Camoufox window pointed at
 * gemini.google.com, let the user log in, then extract the 6 required
 * cookies + the SNlM0e XSRF token without the user touching DevTools.
 *
 * Sessions are kept in memory (per Node process). The flow is:
 *   1. POST /auto-capture/start  → returns sessionId, opens visible window
 *   2. GET  /auto-capture/:id/poll → "pending" while user is logging in,
 *                                    "ready" once cookies are captured,
 *                                    "error" on failure or timeout
 *   3. (browser is closed automatically once cookies are captured or aborted)
 *
 * Sessions auto-expire after 5 minutes of idleness.
 */

import { randomUUID } from "node:crypto";
import { DEFAULT_AUTOMATION_BROWSER, normalizeAutomationBrowser } from "@/shared/constants/automationBrowsers";
import { createAutomationBrowserLauncher } from "./automationBrowserLauncher.js";

const REQUIRED_COOKIES = ["SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-1PSID"];
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 min
const POLL_INTERVAL_MS = 1500;

const sessions = new Map(); // sessionId -> { state, browser, context, page, result, error, expiresAt }

function makeExpiredCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions.entries()) {
      if (s.expiresAt && s.expiresAt < now) {
        cleanupSession(id, "Session expired").catch(() => null);
      }
    }
  }, 30_000).unref?.();
}
let cleanupStarted = false;
function ensureCleanupRunning() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  makeExpiredCleanup();
}

async function cleanupSession(sessionId, reason) {
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.delete(sessionId);
  try { await s.page?.close().catch(() => null); } catch {}
  try { await s.context?.close().catch(() => null); } catch {}
  try { await s.browser?.close().catch(() => null); } catch {}
  if (reason && s.state === "pending") {
    s.state = "error";
    s.error = reason;
  }
}

function formatCookieString(cookies) {
  return cookies
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function tryExtractXsrfToken(page) {
  try {
    const html = await page.content();
    const m = html.match(/"SNlM0e":"([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function waitForLoggedIn(page, timeoutMs = SESSION_TTL_MS) {
  // Login completes when:
  //  - The user is on https://gemini.google.com/* (not /sign-in or /ServiceLogin)
  //  - AND all 6 required cookies are present in the context
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let url = "";
    try { url = page.url(); } catch {}
    const onGemini = /^https:\/\/gemini\.google\.com\//i.test(url);
    const onSignIn = /accounts\.google\.com|\/ServiceLogin|\/signin/i.test(url);
    if (onGemini && !onSignIn) {
      const ctx = page.context();
      const cookies = await ctx.cookies(["https://gemini.google.com", "https://google.com"]);
      const seen = new Set(cookies.map((c) => c.name));
      const missing = REQUIRED_COOKIES.filter((k) => !seen.has(k));
      if (missing.length === 0) return { cookies };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for Gemini login. Did you finish signing in?");
}

/**
 * Start a new auto-capture session.
 * @param {object} params
 * @param {string} [params.browser] - automation browser id (defaults to user setting)
 * @returns {Promise<{ sessionId: string }>}
 */
export async function startGeminiWebAutoCapture({ browser } = {}) {
  ensureCleanupRunning();
  const sessionId = randomUUID();
  const normalizedBrowser = normalizeAutomationBrowser(browser || DEFAULT_AUTOMATION_BROWSER);
  const launcher = createAutomationBrowserLauncher(normalizedBrowser, { headless: false });

  let browserInstance;
  try {
    browserInstance = await launcher();
  } catch (err) {
    throw new Error(`Failed to launch automation browser (${normalizedBrowser}): ${err?.message || err}`);
  }

  const context = await browserInstance.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const session = {
    state: "pending",
    browser: browserInstance,
    context,
    page,
    result: null,
    error: null,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(sessionId, session);

  // Navigate to Gemini sign-in. If user is already signed in elsewhere on the
  // host machine they'll land directly on the app.
  page.goto("https://gemini.google.com/app", { waitUntil: "load", timeout: 60_000 })
    .catch(() => null);

  // Background watcher: poll for login completion, then extract + cleanup.
  (async () => {
    try {
      const { cookies } = await waitForLoggedIn(page);
      const xsrfToken = await tryExtractXsrfToken(page);
      const filtered = cookies.filter((c) => REQUIRED_COOKIES.includes(c.name) || c.name.startsWith("__Secure-"));
      const cookieString = formatCookieString(filtered);

      // Surface result then close the browser politely (small delay so the
      // user sees a "connected" Gemini page before it disappears).
      session.result = { cookieString, xsrfToken: xsrfToken || null, capturedAt: Date.now() };
      session.state = "ready";
      setTimeout(() => cleanupSession(sessionId, null).catch(() => null), 800);
    } catch (err) {
      session.state = "error";
      session.error = err?.message || String(err);
      cleanupSession(sessionId, null).catch(() => null);
    }
  })();

  return { sessionId };
}

/**
 * Poll the state of an in-flight session.
 * @param {string} sessionId
 * @returns {{ state: "pending"|"ready"|"error"|"unknown", result?: object, error?: string }}
 */
export function pollGeminiWebAutoCapture(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return { state: "unknown" };
  if (s.state === "ready") {
    const out = { state: "ready", result: s.result };
    // Allow client to drain once
    sessions.delete(sessionId);
    return out;
  }
  if (s.state === "error") {
    const out = { state: "error", error: s.error };
    sessions.delete(sessionId);
    return out;
  }
  // Refresh expiry while client is actively polling
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  return { state: "pending" };
}

/**
 * Cancel an in-flight session (closes the browser).
 */
export async function cancelGeminiWebAutoCapture(sessionId) {
  await cleanupSession(sessionId, "Cancelled by user");
}

// Test-only export
export const _internal = { sessions, REQUIRED_COOKIES, formatCookieString };
