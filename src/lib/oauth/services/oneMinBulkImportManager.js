import {
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
} from "./kiroBulkImportManager.js";

const ONE_MIN_PROVIDER_ID = "1min-ai";
const ONE_MIN_LABEL = "1min AI";
const ONE_MIN_APP_URL = "https://app.1min.ai/";
const ONE_MIN_API_URL = "https://app.1min.ai/api";
const ONE_MIN_API_KEY_PATTERN = /\b[a-f0-9]{64}\b/i;
const ONE_MIN_NEW_API_KEY_SELECTORS = [
  "button:has-text('New API Key')",
  "[role='button']:has-text('New API Key')",
  "button:has(span:text-is('New API Key'))",
  "span:text-is('New API Key')",
  "text=New API Key",
];
const ONE_MIN_BULK_IMPORT_DEFAULT_CONCURRENCY = 1;
const ONE_MIN_BULK_IMPORT_MAX_CONCURRENCY = 1;
const ONE_MIN_BULK_IMPORT_MIN_CONCURRENCY = 1;
const ONE_MIN_AUTH_TIMEOUT_MS = 90_000;
const ONE_MIN_AUTH_POLL_INTERVAL_MS = 2_000;
const ONE_MIN_LOGIN_TIMEOUT_MS = 60_000;

const ONE_MIN_CLOSE_MODAL_SELECTORS = [
  ".ant-tour-close",
  ".ant-tour button:has(svg[data-icon='close'])",
  ".ant-tour [aria-label='Close']",
  ".ant-tour [aria-label='close']",
];

const ONE_MIN_LOGIN_TRIGGER_SELECTORS = [
  "button.ant-btn.ant-btn-primary:has-text('Log In')",
  "button.ant-btn.ant-btn-primary:has-text('Login')",
  "button.ant-btn.ant-btn-primary:has-text('Sign In')",
  "button.ant-btn.ant-btn-primary:has-text('Masuk')",
  "button:has-text('Log In')",
  "button:has-text('Login')",
];

const ONE_MIN_GOOGLE_LOGIN_SELECTORS = [
  "button:has-text('Log in with Google')",
  "button:has-text('Sign in with Google')",
  "button:has-text('Continue with Google')",
  "button:has(svg):has-text('Google')",
  "[role='button']:has-text('Google')",
];

const ONE_MIN_EMAIL_SELECTORS = [
  "#login_email",
  "input[name='email']",
  "input[type='email']",
  "input[autocomplete='username']",
  "input[placeholder*='email' i]",
];

const ONE_MIN_PASSWORD_SELECTORS = [
  "#login_password",
  "input[name='password']",
  "input[type='password']",
  "input[autocomplete='current-password']",
  "input[placeholder*='password' i]",
];

const ONE_MIN_SUBMIT_SELECTORS = [
  "form button[type='submit']",
  ".ant-modal form button[type='submit']",
  "form .ant-btn.ant-btn-primary",
  ".ant-modal form .ant-btn.ant-btn-primary",
];

const ONE_MIN_INVALID_CREDENTIAL_MARKERS = [
  "invalid email or password",
  "incorrect password",
  "wrong password",
  "password is incorrect",
  "account or password error",
  "invalid credentials",
  "email or password",
];

const ONE_MIN_MANUAL_ASSIST_MARKERS = [
  "captcha",
  "verification code",
  "two-factor",
  "2fa",
  "otp",
  "verify",
  "unusual activity",
];

const GOOGLE_EMAIL_SELECTORS = [
  "input[type='email']",
  "input[autocomplete='username']",
  "#identifierId",
];

const GOOGLE_PASSWORD_SELECTORS = [
  "input[type='password']",
  "input[autocomplete='current-password']",
];

const GOOGLE_NEXT_SELECTORS = [
  "#identifierNext button",
  "#passwordNext button",
  "button:has-text('Next')",
  "button:has-text('Berikutnya')",
  "div[role='button']:has-text('Next')",
  "div[role='button']:has-text('Berikutnya')",
];

const GOOGLE_APPROVE_SELECTORS = [
  "button:has-text('Continue')",
  "button:has-text('Allow')",
  "button:has-text('Izinkan')",
  "button:has-text('Lanjutkan')",
  "div[role='button']:has-text('Continue')",
  "div[role='button']:has-text('Allow')",
  "div[role='button']:has-text('Izinkan')",
  "div[role='button']:has-text('Lanjutkan')",
];

const GOOGLE_INVALID_CREDENTIAL_MARKERS = [
  "wrong password",
  "incorrect password",
  "couldn't find your google account",
  "couldn’t find your google account",
  "enter a valid email",
  "couldn’t sign you in",
  "couldn't sign you in",
];

const GOOGLE_MANUAL_ASSIST_MARKERS = [
  "2-step verification",
  "verify it’s you",
  "verify it's you",
  "check your phone",
  "recovery email",
  "captcha",
  "unusual activity detected",
];

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

async function defaultSaveOneMinConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const normalizedEmail = tokens.email || email || undefined;
  const hasApiKey = Boolean(tokens.apiKey);
  const providerSpecificData = {
    ...(tokens.providerSpecificData || {}),
    loginEmail: normalizedEmail,
    automation: "gsuite-bulk",
  };

  const connectionPayload = {
    provider: ONE_MIN_PROVIDER_ID,
    authType: hasApiKey ? "apikey" : "oauth",
    name: normalizedEmail,
    email: normalizedEmail,
    providerSpecificData,
    testStatus: "active",
  };

  if (hasApiKey) {
    connectionPayload.apiKey = tokens.apiKey;
    if (tokens.accessToken) connectionPayload.accessToken = tokens.accessToken;
  } else {
    connectionPayload.accessToken = tokens.accessToken;
  }

  const connection = await createProviderConnection(connectionPayload);

  return { connection };
}

async function readOneMinAuthStateFromPage(page) {
  if (typeof page?.evaluate !== "function") {
    throw new Error("1min AI browser session is missing page.evaluate()");
  }

  return page.evaluate(async () => {
    const parseMaybeJson = (value) => {
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };

    const collectCandidatePayloads = (rawValue) => {
      const payloads = [];
      const seen = new Set();

      const visit = (value, depth = 0) => {
        const parsed = parseMaybeJson(value);
        if (!parsed || typeof parsed !== "object" || seen.has(parsed) || depth > 8) return;
        seen.add(parsed);
        payloads.push(parsed);

        if (Array.isArray(parsed)) {
          for (const item of parsed) visit(item, depth + 1);
          return;
        }

        for (const [key, child] of Object.entries(parsed)) {
          const lowered = key.toLowerCase();
          if (
            lowered.includes("auth")
            || lowered.includes("user")
            || lowered.includes("team")
            || lowered.includes("token")
            || lowered.includes("session")
            || lowered.includes("persist")
            || lowered === "state"
          ) {
            visit(child, depth + 1);
          }
        }
      };

      visit(rawValue);
      return payloads;
    };

    const readNested = (target, paths) => {
      for (const path of paths) {
        let current = target;
        for (const part of path) {
          current = current && typeof current === "object" ? current[part] : undefined;
        }
        if (current !== undefined && current !== null && current !== "") return current;
      }
      return undefined;
    };

    const findFirstTeam = (currentUser) => {
      const teams = Array.isArray(currentUser?.teams) ? currentUser.teams : [];
      return teams.find((entry) => entry?.team?.uuid || entry?.team?.id || entry?.teamId || entry?.uuid || entry?.id) || null;
    };

    const findFirstObject = (target, predicate, depth = 0, seen = new Set()) => {
      if (!target || typeof target !== "object" || seen.has(target) || depth > 8) return null;
      seen.add(target);
      if (predicate(target)) return target;
      const values = Array.isArray(target) ? target : Object.values(target);
      for (const value of values) {
        const found = findFirstObject(value, predicate, depth + 1, seen);
        if (found) return found;
      }
      return null;
    };

    const findFirstValue = (target, predicate, depth = 0, seen = new Set()) => {
      if (!target || typeof target !== "object" || seen.has(target) || depth > 8) return undefined;
      seen.add(target);
      for (const [key, value] of Object.entries(target)) {
        if (predicate(key, value)) return value;
        if (value && typeof value === "object") {
          const found = findFirstValue(value, predicate, depth + 1, seen);
          if (found !== undefined && found !== null && found !== "") return found;
        }
      }
      return undefined;
    };

    const extractAuthState = (candidate) => {
      if (!candidate || typeof candidate !== "object") return null;

      const auth = candidate.authentication && typeof candidate.authentication === "object"
        ? candidate.authentication
        : candidate;
      const currentUser = (auth.currentUser && typeof auth.currentUser === "object" ? auth.currentUser : null)
        || (candidate.currentUser && typeof candidate.currentUser === "object" ? candidate.currentUser : null)
        || findFirstObject(candidate, (value) => Boolean(value.email && (value.uuid || value.id || value.token || value.teams)));
      const fallbackTeam = findFirstTeam(currentUser)
        || findFirstObject(candidate, (value) => Boolean(value.team?.uuid || value.team?.id || value.uuid || value.id || value.teamId));
      const currentTeamId = readNested(auth, [
        ["currentTeamId"],
        ["currentTeam", "uuid"],
        ["currentTeam", "id"],
        ["teamId"],
        ["team", "uuid"],
        ["team", "id"],
      ]) || readNested(candidate, [
        ["currentTeamId"],
        ["currentTeam", "uuid"],
        ["currentTeam", "id"],
        ["teamId"],
        ["team", "uuid"],
        ["team", "id"],
      ]);
      const resolvedTeamId = currentTeamId
        || fallbackTeam?.team?.uuid
        || fallbackTeam?.team?.id
        || fallbackTeam?.teamId
        || fallbackTeam?.uuid
        || fallbackTeam?.id
        || "";
      const token = readNested(auth, [
        ["currentUser", "token"],
        ["token"],
        ["accessToken"],
        ["authToken"],
        ["sessionToken"],
      ]) || readNested(candidate, [
        ["currentUser", "token"],
        ["token"],
        ["accessToken"],
        ["authToken"],
        ["sessionToken"],
      ]) || findFirstValue(candidate, (key, value) => {
        const lowered = key.toLowerCase();
        return typeof value === "string" && value.length > 20 && (lowered === "token" || lowered.endsWith("token"));
      });

      if (!resolvedTeamId || !currentUser) return null;

      const teams = Array.isArray(currentUser.teams) ? currentUser.teams : [];
      const matchingTeam = teams.find((entry) => entry?.team?.uuid === resolvedTeamId || entry?.team?.id === resolvedTeamId || entry?.teamId === resolvedTeamId || entry?.uuid === resolvedTeamId || entry?.id === resolvedTeamId) || fallbackTeam || null;

      return {
        currentTeamId: String(resolvedTeamId),
        token: token ? String(token) : "",
        currentUser: {
          email: currentUser.email || "",
          uuid: currentUser.uuid || currentUser.id || "",
        },
        currentTeam: matchingTeam?.team
          ? {
              uuid: matchingTeam.team.uuid || matchingTeam.team.id || resolvedTeamId,
              name: matchingTeam.team.name || "",
            }
          : null,
      };
    };

    const readLocalStorageState = () => {
      const candidates = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key) continue;
        candidates.push(window.localStorage.getItem(key));
      }
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (!key) continue;
        candidates.push(window.sessionStorage.getItem(key));
      }

      for (const value of candidates) {
        for (const payload of collectCandidatePayloads(value)) {
          const authState = extractAuthState(payload);
          if (authState) return authState;
        }
      }

      return null;
    };

    const openDatabase = (name) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`Failed to open IndexedDB ${name}`));
    });

    const readFromStore = (db, storeName, key) => new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });

    const readAllFromStore = (db, storeName) => new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        if (typeof store.getAll === "function") {
          const request = store.getAll();
          request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
          request.onerror = () => resolve([]);
          return;
        }
        const values = [];
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(values);
            return;
          }
          values.push(cursor.value);
          cursor.continue();
        };
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });

    const readIndexedDbState = async () => {
      const dbNames = new Set(["ai"]);
      if (typeof indexedDB.databases === "function") {
        try {
          const databases = await indexedDB.databases();
          for (const entry of databases || []) {
            if (entry?.name) dbNames.add(entry.name);
          }
        } catch {
          // Ignore environments that do not support database enumeration.
        }
      }

      for (const dbName of dbNames) {
        let db = null;
        try {
          db = await openDatabase(dbName);
        } catch {
          db = null;
        }
        if (!db) continue;

        try {
          const storeNames = Array.from(db.objectStoreNames || []);
          for (const storeName of storeNames) {
            const rawValues = [
              await readFromStore(db, storeName, "persist:root"),
              await readFromStore(db, storeName, "root"),
              ...(await readAllFromStore(db, storeName)),
            ];
            for (const rawValue of rawValues) {
              for (const payload of collectCandidatePayloads(rawValue)) {
                const authState = extractAuthState(payload);
                if (authState) {
                  db.close?.();
                  return authState;
                }
              }
            }
          }
        } finally {
          db.close?.();
        }
      }

      return null;
    };

    return readLocalStorageState() || await readIndexedDbState();
  });
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;

    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;

    const enabled = await locator.isEnabled().catch(() => true);
    if (!enabled) continue;

    const clicked = await locator.click({ timeout: 5_000 }).then(() => true).catch(() => false);
    if (clicked) return true;
  }

  return false;
}

async function getFirstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;

    const visible = await locator.isVisible().catch(() => false);
    const enabled = await locator.isEnabled().catch(() => true);
    if (visible && enabled) return locator;
  }

  return null;
}

function getPageFrames(page) {
  try {
    return typeof page.frames === "function" ? page.frames().filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function getFirstVisibleLocatorInSurfaces(surfaces, selectors) {
  for (const surface of surfaces) {
    const locator = await getFirstVisibleLocator(surface, selectors);
    if (locator) return { surface, locator };
  }
  return null;
}

async function clickFirstVisibleInSurfaces(surfaces, selectors) {
  for (const surface of surfaces) {
    const clicked = await clickFirstVisible(surface, selectors);
    if (clicked) return { surface };
  }
  return null;
}

async function readPageText(page) {
  return page.evaluate(() => document.body?.innerText || "").catch(() => "");
}

function includesAny(text, markers) {
  const lowered = String(text || "").toLowerCase();
  return markers.some((marker) => lowered.includes(marker));
}

async function getOpenContextPages(page) {
  try {
    const context = page.context?.();
    if (!context || typeof context.pages !== "function") return [page];
    const pages = context.pages().filter(Boolean);
    return pages.length ? pages : [page];
  } catch {
    return [page];
  }
}

async function getGoogleAuthPage(page) {
  const pages = await getOpenContextPages(page);
  for (const candidate of pages) {
    if (isGoogleAuthPage(candidate)) return candidate;
  }
  return page;
}

async function readPagesText(page) {
  const pages = await getOpenContextPages(page);
  const texts = await Promise.all(pages.map((candidate) => readPageText(candidate)));
  return texts.join("\n");
}
async function getAutomationSurfaces(page) {
  const pages = await getOpenContextPages(page);
  const surfaces = [];
  for (const candidate of pages) {
    surfaces.push(candidate, ...getPageFrames(candidate));
  }
  return surfaces.length ? surfaces : [page];
}

async function describeAutomationPages(page) {
  const pages = await getOpenContextPages(page);
  const parts = [];
  for (const candidate of pages) {
    let title = "";
    try {
      title = typeof candidate.title === "function" ? await candidate.title() : "";
    } catch {
      title = "";
    }
    let url = "";
    try {
      url = typeof candidate.url === "function" ? candidate.url() : "";
    } catch {
      url = "";
    }
    parts.push(`${title || "untitled"} ${url || "about:blank"}`.trim());
  }
  return parts.join(" | ");
}

function isGoogleAuthPage(page) {
  try {
    const url = new URL(page.url?.() || "");
    return url.hostname === "accounts.google.com" || url.hostname.endsWith(".accounts.google.com");
  } catch {
    return false;
  }
}

async function dismissOneMinIntroModal(page, reportStep) {
  const loginFormVisible = await getFirstVisibleLocator(page, ONE_MIN_EMAIL_SELECTORS);
  if (loginFormVisible) return false;
  const googleLoginVisible = await getFirstVisibleLocator(page, ONE_MIN_GOOGLE_LOGIN_SELECTORS);
  if (googleLoginVisible) return false;

  const dismissed = await clickFirstVisible(page, ONE_MIN_CLOSE_MODAL_SELECTORS);
  if (dismissed) {
    reportStep("closing_1min_intro_modal", "Closing 1min AI intro modal");
    await page.waitForTimeout(600);
  }
  return dismissed;
}

async function runOneMinAccountAutomation({
  page,
  authUrl = ONE_MIN_APP_URL,
  email,
  password,
  successPromise,
  shortTimeoutMs = ONE_MIN_LOGIN_TIMEOUT_MS,
  onStep,
}) {
  const reportStep = (step, message) => onStep?.(step, message);

  reportStep("opening_1min_login", "Opening 1min AI login page");
  await page.goto(authUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2_000);

  await dismissOneMinIntroModal(page, reportStep);

  reportStep("opening_1min_login_form", "Opening 1min AI login form");
  await clickFirstVisible(page, ONE_MIN_LOGIN_TRIGGER_SELECTORS);
  await page.waitForTimeout(1_000);

  reportStep("selecting_1min_google_login", "Selecting 1min AI Google login");
  const context = page.context?.();
  const popupPromise = context && typeof context.waitForEvent === "function"
    ? context.waitForEvent("page", { timeout: 8_000 }).catch(() => null)
    : Promise.resolve(null);
  const clickedGoogle = await clickFirstVisible(page, ONE_MIN_GOOGLE_LOGIN_SELECTORS);
  if (!clickedGoogle) {
    return {
      status: "needs_manual",
      error: "Manual assist required because the 1min AI Google login button was not found.",
    };
  }
  const popupPage = await popupPromise;
  if (popupPage) {
    await popupPage.waitForLoadState?.("domcontentloaded", { timeout: 15_000 }).catch(() => null);
    await popupPage.bringToFront?.().catch(() => null);
  }
  await page.waitForTimeout(1_500);

  const waitUntil = Date.now() + shortTimeoutMs;
  while (Date.now() < waitUntil) {
    const successResult = await Promise.race([
      successPromise.then((result) => ({ kind: "success", result })).catch((error) => ({ kind: "success_error", error })),
      wait(1_000).then(() => null),
    ]);

    if (successResult?.kind === "success") {
      reportStep("1min_session_ready", "1min AI browser session ready");
      return {
        status: "success",
        ...successResult.result,
      };
    }

    if (successResult?.kind === "success_error") {
      return {
        status: "failed_timeout",
        error: successResult.error?.message || "Timed out waiting for 1min AI session",
      };
    }

    const surfaces = await getAutomationSurfaces(page);
    const googlePage = await getGoogleAuthPage(page);
    const authSurfaces = isGoogleAuthPage(googlePage)
      ? [googlePage, ...getPageFrames(googlePage), ...surfaces.filter((surface) => surface !== googlePage)]
      : surfaces;
    const googleEmailInput = await getFirstVisibleLocatorInSurfaces(authSurfaces, GOOGLE_EMAIL_SELECTORS);
    if (googleEmailInput) {
      reportStep("entering_google_email", "Entering Google email");
      await googlePage.bringToFront?.().catch(() => null);
      await googleEmailInput.locator.fill(email, { timeout: 10_000 });
      reportStep("submitting_google_email", "Submitting Google email");
      await clickFirstVisibleInSurfaces(authSurfaces, GOOGLE_NEXT_SELECTORS);
      await googlePage.waitForTimeout?.(1_000).catch(() => null);
      continue;
    }

    const googlePasswordInput = await getFirstVisibleLocatorInSurfaces(authSurfaces, GOOGLE_PASSWORD_SELECTORS);
    if (googlePasswordInput) {
      reportStep("entering_google_password", "Entering Google password");
      await googlePage.bringToFront?.().catch(() => null);
      await googlePasswordInput.locator.fill(password, { timeout: 10_000 });
      reportStep("submitting_google_password", "Submitting Google password");
      await clickFirstVisibleInSurfaces(authSurfaces, GOOGLE_NEXT_SELECTORS);
      await googlePage.waitForTimeout?.(1_000).catch(() => null);
      continue;
    }

    if (isGoogleAuthPage(googlePage)) {
      await googlePage.bringToFront?.().catch(() => null);
      const approved = await clickFirstVisibleInSurfaces(authSurfaces, GOOGLE_APPROVE_SELECTORS);
      if (approved) {
        reportStep("approving_google_consent", "Approving Google consent");
        await googlePage.waitForTimeout?.(1_000).catch(() => null);
        continue;
      }
    }

    const pageText = await readPagesText(page);
    if (includesAny(pageText, [...ONE_MIN_INVALID_CREDENTIAL_MARKERS, ...GOOGLE_INVALID_CREDENTIAL_MARKERS])) {
      return {
        status: "failed_invalid_credentials",
        error: "1min AI or Google rejected the supplied email or password.",
      };
    }

    if (includesAny(pageText, [...ONE_MIN_MANUAL_ASSIST_MARKERS, ...GOOGLE_MANUAL_ASSIST_MARKERS])) {
      return {
        status: "needs_manual",
        error: "Manual assist required in the 1min AI browser session.",
      };
    }

    const pageState = await describeAutomationPages(page);
    reportStep("waiting_for_1min_login", `Waiting for 1min AI login to finish (${pageState || "no open pages"})`);
    await page.waitForTimeout(800);
  }

  return {
    status: "needs_manual",
    error: "Manual assist required because the 1min AI login flow did not complete automatically.",
  };
}

function createOneMinSessionReadyPromise({
  page,
  signal,
  timeoutMs = ONE_MIN_AUTH_TIMEOUT_MS,
  pollIntervalMs = ONE_MIN_AUTH_POLL_INTERVAL_MS,
  onStep,
}) {
  return (async () => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) {
        throw new Error("1min AI session polling cancelled");
      }

      onStep?.("waiting_for_1min_session", "Waiting for 1min AI browser session");
      const authState = await readOneMinAuthStateFromPage(page).catch(() => null);
      if (authState?.currentTeamId) {
        return { authState };
      }

      await wait(pollIntervalMs, signal);
    }

    throw new Error("Timed out waiting for 1min AI browser session");
  })();
}

function extractOneMinApiKeysFromText(text) {
  return Array.from(new Set(String(text || "").match(new RegExp(ONE_MIN_API_KEY_PATTERN.source, "gi")) || []));
}

async function readOneMinApiPageKeys(page) {
  const text = await readPageText(page);
  return extractOneMinApiKeysFromText(text);
}

async function waitForOneMinApiKey(page, previousKeys = [], timeoutMs = 30_000) {
  const previous = new Set(previousKeys.map((key) => key.toLowerCase()));
  const startedAt = Date.now();
  let lastKeys = [];
  while (Date.now() - startedAt < timeoutMs) {
    lastKeys = await readOneMinApiPageKeys(page).catch(() => []);
    const created = lastKeys.find((key) => !previous.has(key.toLowerCase()));
    if (created) return created;
    if (!previous.size && lastKeys[0]) return lastKeys[0];
    await page.waitForTimeout(700);
  }
  throw new Error(`1min AI API key was not visible after creation. Visible keys: ${lastKeys.length}`);
}

async function createOneMinApiKeyViaPage(page) {
  await page.goto(ONE_MIN_API_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1_500);

  const existingKeys = await readOneMinApiPageKeys(page).catch(() => []);
  const clicked = await clickFirstVisible(page, ONE_MIN_NEW_API_KEY_SELECTORS);
  if (!clicked) {
    const pageText = await readPageText(page).catch(() => "");
    throw new Error(`1min AI New API Key button was not found on ${ONE_MIN_API_URL}: ${pageText.slice(0, 180)}`);
  }

  await page.waitForTimeout(1_500);
  return waitForOneMinApiKey(page, existingKeys);
}

async function defaultCreateOneMinWebSessionTokens({ page, tokens = {}, email, onStep }) {
  onStep?.("reading_1min_session", "Reading 1min AI browser session");
  const authState = await readOneMinAuthStateFromPage(page);
  if (!authState?.currentTeamId) {
    throw new Error("Could not determine 1min AI team ID from the logged-in browser session");
  }
  if (!authState?.token) {
    throw new Error("Could not determine 1min AI web session token from the logged-in browser session");
  }

  onStep?.("creating_1min_api_key", "Creating 1min AI API key");
  const apiKey = await createOneMinApiKeyViaPage(page);

  return {
    ...tokens,
    email: authState.currentUser?.email || email || "",
    accessToken: authState.token,
    apiKey,
    providerSpecificData: {
      ...(tokens.providerSpecificData || {}),
      authKind: "api_key",
      tokenSource: "browser_storage",
      apiKeySource: "app_api_page",
      apiKeyCreatedAt: new Date().toISOString(),
      sessionCapturedAt: new Date().toISOString(),
      teamId: authState.currentTeamId,
      ...(authState.currentTeam?.name ? { teamName: authState.currentTeam.name } : {}),
      ...(authState.currentUser?.uuid ? { oneMinUserId: authState.currentUser.uuid } : {}),
    },
  };
}

export class OneMinBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher,
    googleAutomation,
    oneMinAutomation = googleAutomation || runOneMinAccountAutomation,
    saveConnection = defaultSaveOneMinConnection,
    createWebSessionTokens,
    createApiKeyTokens,
  } = {}) {
    super({
      browserLauncher,
      googleAutomation: oneMinAutomation,
      storageName: "1min-ai-bulk-import",
    });
    this.oneMinAutomation = oneMinAutomation;
    this.saveConnection = saveConnection;
    this.createWebSessionTokens = createWebSessionTokens || createApiKeyTokens || defaultCreateOneMinWebSessionTokens;
  }

  async startJob({ accounts, concurrency }) {
    return super.startJob({
      accounts,
      concurrency: ONE_MIN_BULK_IMPORT_DEFAULT_CONCURRENCY,
    });
  }

  async capturePreview(job) {
    const previewAccount = job.accounts.find((account) => account.status === "running" && account.runtimeSession?.page)
      || job.accounts.find((account) => account.status === "needs_manual" && account.manualSession?.page);

    if (!previewAccount) return null;

    const basePage = previewAccount.runtimeSession?.page || previewAccount.manualSession?.page;
    const previewPage = await getGoogleAuthPage(basePage);

    try {
      await previewPage.bringToFront?.().catch(() => null);
      const screenshot = await previewPage.screenshot({
        type: "jpeg",
        quality: 70,
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });

      return {
        email: previewAccount.email,
        workerId: previewAccount.workerId || null,
        status: previewAccount.status,
        step: previewAccount.currentStep || null,
        updatedAt: previewAccount.updatedAt || new Date().toISOString(),
        imageData: `data:image/jpeg;base64,${screenshot.toString("base64")}`,
      };
    } catch {
      return {
        email: previewAccount.email,
        workerId: previewAccount.workerId || null,
        status: previewAccount.status,
        step: previewAccount.currentStep || null,
        updatedAt: previewAccount.updatedAt || new Date().toISOString(),
        imageData: null,
      };
    }
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

        const webSessionTokens = await this.createWebSessionTokens({
          page: account.manualSession?.page,
          tokens: result.tokens || {},
          email: account.email,
          onStep: (step, message) => {
            this.setAccountStep(account, step, message);
            void this.persistJobSnapshot(job, { forcePreview: false });
          },
        });

        this.setAccountStep(account, "saving_connection", "Saving 1min AI web session connection");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.saveConnection({
          tokens: webSessionTokens,
          email: account.email,
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "1min AI web session connection saved successfully",
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
            error: error.message || "Manual assist flow failed after 1min AI login.",
            step: "exchange_failed",
            message: error.message || "Manual assist flow failed after 1min AI login.",
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

    const { context, page } = await createFreshContext(job.browser);
    account.runtimeSession = { context, page };
    const sessionController = new AbortController();

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} is preparing a browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      const successPromise = createOneMinSessionReadyPromise({
        page,
        signal: sessionController.signal,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      const automationResult = await this.oneMinAutomation({
        page,
        authUrl: ONE_MIN_APP_URL,
        email: account.email,
        password: account.password,
        successPromise,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        const webSessionTokens = await this.createWebSessionTokens({
          page,
          tokens: automationResult.tokens || {},
          email: account.email,
          onStep: (step, message) => {
            this.setAccountStep(account, step, message);
            void this.persistJobSnapshot(job, { forcePreview: false });
          },
        });

        this.setAccountStep(account, "saving_connection", "Saving 1min AI web session connection");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.saveConnection({
          tokens: webSessionTokens,
          email: account.email,
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "1min AI web session connection saved successfully",
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

      sessionController.abort();
      this.finalizeAccount(account, automationResult.status || "failed", {
        error: automationResult.error || "1min AI Google automation failed.",
        step: automationResult.status || "failed",
        message: automationResult.error || "1min AI Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      sessionController.abort();
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", {
          error: "Job cancelled",
          step: "cancelled",
          message: "Job cancelled while 1min AI automation was running",
        });
      } else {
        this.finalizeAccount(account, "failed", {
          error: error.message || "Unexpected 1min AI bulk import failure.",
          step: "failed",
          message: error.message || "Unexpected 1min AI bulk import failure.",
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
  if (!globalThis.__oneMinBulkImportSingleton) {
    globalThis.__oneMinBulkImportSingleton = {
      manager: new OneMinBulkImportManager(),
    };
  }
  return globalThis.__oneMinBulkImportSingleton;
}

export function getOneMinBulkImportManager() {
  return getSingletonStore().manager;
}

const __testables = {
  readOneMinAuthStateFromPage,
};

export {
  buildLookupResponse,
  ONE_MIN_BULK_IMPORT_DEFAULT_CONCURRENCY,
  ONE_MIN_BULK_IMPORT_MAX_CONCURRENCY,
  ONE_MIN_BULK_IMPORT_MIN_CONCURRENCY,
  parseKiroBulkAccounts as parseOneMinBulkAccounts,
  runOneMinAccountAutomation,
  __testables,
};
