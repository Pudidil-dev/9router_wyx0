import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../dataDir.js";
import { createAutomationBrowserLauncher } from "./automationBrowserLauncher.js";
import { DEFAULT_AUTOMATION_BROWSER, normalizeAutomationBrowser } from "@/shared/constants/automationBrowsers";
import { createFreshContext } from "./automation/baseBulkImportManager.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import {
  buildCodeBuddyCnProviderMetadata,
  CODEBUDDY_CN_PROBE_URL,
} from "open-sse/services/codebuddyCn.js";
import {
  CN_DEFAULT_REGION,
  CN_FALLBACK_REGION,
} from "open-sse/executors/codebuddy-cn/config.js";
import { runCodeBuddyCnLifecycle } from "./codebuddyCnLifecycle.js";

const CODEBUDDY_CN_AUTOMATION_DIR = path.join(DATA_DIR, "codebuddy-cn-automation");
const CODEBUDDY_CN_META_FILE = path.join(CODEBUDDY_CN_AUTOMATION_DIR, "meta.json");
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_ACCOUNT_STATUSES = new Set(["success", "failed", "failed_timeout", "cancelled"]);
const MAX_ACCOUNT_LOG_ENTRIES = 40;
const MAX_JOB_ACTIVITY_ENTRIES = 80;
const RECENT_TERMINAL_JOB_WINDOW_MS = 30 * 60_000;
const DEFAULT_MANUAL_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_CONCURRENCY = 2;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 8;
const FIVE_SIM_BASE_URL = "https://5sim.net/v1/user";
const FIVE_SIM_DEFAULT_COUNTRY = "hongkong";
const FIVE_SIM_DEFAULT_OPERATOR = "virtual54";
const FIVE_SIM_DEFAULT_PRODUCT = "codebuddy";
const FIVE_SIM_POLL_INTERVAL_MS = 5_000;
const CODEBUDDY_CN_SMS_ENDPOINT = "https://www.codebuddy.cn/auth/realms/copilot/sms/authentication-code";
const CODEBUDDY_CN_LIFECYCLE_METADATA_KEYS = [
  "activationStatus",
  "activationMethod",
  "activationError",
  "gatewayAuthenticated",
  "gatewayBlocked",
  "gatewayProbation",
  "gatewayMessage",
  "codebuddyCnRegion",
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir = CODEBUDDY_CN_AUTOMATION_DIR) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function getJobFile(jobId, dir = CODEBUDDY_CN_AUTOMATION_DIR) {
  ensureDir(dir);
  return path.join(dir, `${jobId}.json`);
}

function readPersistedLatestJobId(metaFile = CODEBUDDY_CN_META_FILE) {
  return readJson(metaFile)?.latestJobId || null;
}

function writePersistedLatestJobId(jobId, metaFile = CODEBUDDY_CN_META_FILE) {
  writeJson(metaFile, {
    latestJobId: jobId || null,
    updatedAt: nowIso(),
  });
}

function clampConcurrency(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, parsed));
}

function createLogEntry(step, message, level = "info") {
  return {
    id: randomUUID(),
    at: nowIso(),
    step,
    message,
    level,
  };
}

function appendAccountLog(account, step, message, level = "info") {
  const entry = createLogEntry(step, message, level);
  account.currentStep = step;
  account.updatedAt = entry.at;
  account.logs = account.logs || [];
  account.logs.push(entry);
  if (account.logs.length > MAX_ACCOUNT_LOG_ENTRIES) {
    account.logs.splice(0, account.logs.length - MAX_ACCOUNT_LOG_ENTRIES);
  }
  return entry;
}

function buildSummary(accounts) {
  return {
    total: accounts.length,
    queued: accounts.filter((account) => account.status === "queued").length,
    running: accounts.filter((account) => account.status === "running").length,
    success: accounts.filter((account) => account.status === "success").length,
    failed: accounts.filter((account) => account.status === "failed" || account.status === "failed_timeout").length,
    needs_manual: accounts.filter((account) => account.status === "needs_manual").length,
    cancelled: accounts.filter((account) => account.status === "cancelled").length,
  };
}

function buildJobActivity(accounts) {
  return accounts
    .flatMap((account) => (account.logs || []).map((entry) => ({
      ...entry,
      label: account.label,
      line: account.line,
      workerId: account.workerId || null,
      status: account.status,
    })))
    .sort((left, right) => String(left.at).localeCompare(String(right.at)))
    .slice(-MAX_JOB_ACTIVITY_ENTRIES);
}

function sanitizeAccount(account) {
  return {
    line: account.line,
    label: account.label,
    status: account.status,
    error: account.error || null,
    workerId: account.workerId || null,
    currentStep: account.currentStep || null,
    updatedAt: account.updatedAt || null,
    connectionId: account.connectionId || null,
    logs: (account.logs || []).slice(-8),
    contactHint: account.contactHint || null,
    hasCredentials: Boolean(account.apiKey || account.accessToken || account.jwtToken),
  };
}

function sanitizeJob(job, extras = {}) {
  return {
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    concurrency: job.concurrency,
    browser: job.browserChoice || DEFAULT_AUTOMATION_BROWSER,
    options: { ...job.options },
    summary: buildSummary(job.accounts),
    accounts: job.accounts.map(sanitizeAccount),
    activity: buildJobActivity(job.accounts),
    error: job.error || null,
    preview: extras.preview || null,
  };
}

function buildPersistedSnapshot(job) {
  return sanitizeJob(job, { preview: job.lastPreview || null });
}

function normalizePersistedSnapshot(job) {
  if (!job) return null;
  if (ACTIVE_JOB_STATUSES.has(job.status)) return job;
  return {
    ...job,
    preview: null,
  };
}

function isRecentTerminalJob(job) {
  if (!job || ACTIVE_JOB_STATUSES.has(job.status)) return false;
  const finishedAtMs = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
  if (!Number.isFinite(finishedAtMs)) return false;
  return (Date.now() - finishedAtMs) <= RECENT_TERMINAL_JOB_WINDOW_MS;
}

export function buildLookupResponse(job, extras = {}) {
  if (!job) {
    return {
      found: false,
      stale: Boolean(extras.stale),
      recoverable: false,
      job: null,
    };
  }

  return {
    found: true,
    stale: false,
    recoverable: ACTIVE_JOB_STATUSES.has(job.status) || isRecentTerminalJob(job),
    job,
  };
}

function looksLikeEmail(value) {
  return typeof value === "string" && value.includes("@");
}

function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/[^\d+]/g, "");
  if (normalized.startsWith("+")) return normalized;
  if (/^\d+$/.test(normalized)) return `+${normalized}`;
  return raw;
}

function firstMeaningfulSmsText(sms = []) {
  if (!Array.isArray(sms)) return "";
  for (const item of sms) {
    const candidates = [
      item?.text,
      item?.code,
      item?.sms,
      item?.message,
    ];
    for (const candidate of candidates) {
      const text = String(candidate || "").trim();
      if (text) return text;
    }
  }
  return "";
}

function extractOtpCodeFromText(value) {
  const text = String(value || "");
  const match = text.match(/\b(\d{4,8})\b/);
  return match ? match[1] : "";
}

async function fiveSimRequest(apiKey, path, init = {}) {
  const response = await fetch(`${FIVE_SIM_BASE_URL}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(init.headers || {}),
    },
    body: init.body,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || text || `5sim request failed (${response.status})`);
  }

  return payload;
}

async function getFiveSimProfile(apiKey) {
  return await fiveSimRequest(apiKey, "/profile");
}

function getFiveSimOrderConfig(job, account) {
  return {
    country: String(account?.fiveSimCountry || job?.options?.fiveSimCountry || FIVE_SIM_DEFAULT_COUNTRY).trim() || FIVE_SIM_DEFAULT_COUNTRY,
    operator: String(account?.fiveSimOperator || job?.options?.fiveSimOperator || FIVE_SIM_DEFAULT_OPERATOR).trim() || FIVE_SIM_DEFAULT_OPERATOR,
    product: String(account?.fiveSimProduct || job?.options?.fiveSimProduct || FIVE_SIM_DEFAULT_PRODUCT).trim() || FIVE_SIM_DEFAULT_PRODUCT,
  };
}

async function orderFiveSimNumber(job, account) {
  const apiKey = String(job?.options?.fiveSimApiKey || "").trim();
  if (!apiKey) {
    throw new Error("5sim API key is required for automatic CodeBuddy CN registration");
  }

  const { country, operator, product } = getFiveSimOrderConfig(job, account);
  const query = new URLSearchParams();
  query.set("reuse", "0");
  query.set("voice", "0");
  const payload = await fiveSimRequest(apiKey, `/buy/activation/${encodeURIComponent(country)}/${encodeURIComponent(operator)}/${encodeURIComponent(product)}?${query.toString()}`);
  return {
    id: payload?.id,
    phone: normalizePhoneNumber(payload?.phone),
    operator: payload?.operator || operator,
    product: payload?.product || product,
    country: payload?.country || country,
    price: payload?.price ?? null,
    raw: payload,
  };
}

async function getFiveSimOrder(apiKey, orderId) {
  return await fiveSimRequest(apiKey, `/check/${encodeURIComponent(orderId)}`);
}

async function setFiveSimOrderStatus(apiKey, status, orderId) {
  return await fiveSimRequest(apiKey, `/${status}/${encodeURIComponent(orderId)}`);
}

async function waitForFiveSimOtp(job, orderId, onStep) {
  const apiKey = String(job?.options?.fiveSimApiKey || "").trim();
  const deadline = Date.now() + (job.options.smsTimeoutMs || DEFAULT_MANUAL_TIMEOUT_MS);

  while (Date.now() < deadline) {
    if (job.cancelRequested) throw new Error("Job cancelled");

    const order = await getFiveSimOrder(apiKey, orderId);
    const smsText = firstMeaningfulSmsText(order?.sms);
    const code = extractOtpCodeFromText(smsText);

    onStep?.(
      "waiting_for_5sim_otp",
      code
        ? "OTP received from 5sim"
        : `Waiting for OTP from 5sim (${String(order?.status || "pending").toLowerCase()})`
    );

    if (code) {
      await setFiveSimOrderStatus(apiKey, "finish", orderId).catch(() => null);
      return { code, order };
    }

    await wait(FIVE_SIM_POLL_INTERVAL_MS);
  }

  await setFiveSimOrderStatus(apiKey, "cancel", orderId).catch(() => null);
  throw new Error("Timed out waiting for 5sim OTP");
}

async function cancelFiveSimOrder(job, orderId) {
  const apiKey = String(job?.options?.fiveSimApiKey || "").trim();
  if (!apiKey || !orderId) return null;
  return await setFiveSimOrderStatus(apiKey, "cancel", orderId).catch(() => null);
}

function createCodeBuddyCnApiKeyName() {
  const suffix = Math.floor(Math.random() * 900000) + 100000;
  return `9router-cbcn-${Date.now().toString(36)}-${suffix}`;
}

async function codeBuddyCnRequestViaPage(page, method, url, body = null) {
  return await page.evaluate(
    async ({ url, method, body }) => {
      try {
        const headers = {
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        };
        const init = {
          method,
          credentials: "include",
          headers,
        };
        if (body !== null) {
          headers["Content-Type"] = "application/json";
          init.body = JSON.stringify(body);
        }
        const response = await fetch(url, init);
        const text = await response.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        return { status: response.status, text, json };
      } catch (error) {
        return { status: 0, text: String(error?.message || error), json: null };
      }
    },
    {
      url,
      method: String(method || "GET").toUpperCase(),
      body,
    }
  );
}

async function createCodeBuddyCnApiKeyViaPage(page) {
  const result = await codeBuddyCnRequestViaPage(page, "POST", CODEBUDDY_CN_PROBE_URL, {
    name: createCodeBuddyCnApiKeyName(),
    expire_in_days: -1,
  });

  if (result.status !== 200) {
    throw new Error(`CodeBuddy CN API key creation failed (${result.status}): ${String(result.text || "").slice(0, 180)}`);
  }

  const apiKey = String(
    result?.json?.data?.key
    || result?.json?.data?.api_key
    || result?.json?.data?.token
    || ""
  ).trim();

  if (!apiKey) {
    throw new Error("CodeBuddy CN API key response did not include data.key");
  }

  return apiKey;
}

async function clickButtonByText(page, patterns = []) {
  const lowered = patterns.map((pattern) => String(pattern).toLowerCase());
  return await page.evaluate((texts) => {
    const buttons = Array.from(document.querySelectorAll("button, a, [role='button'], div, span"));
    for (const button of buttons) {
      const text = String(button.textContent || "").trim().toLowerCase();
      if (!text) continue;
      if (!texts.some((pattern) => text.includes(pattern))) continue;
      button.click();
      return true;
    }
    return false;
  }, lowered).catch(() => false);
}

async function clickPrimaryCodeBuddyCnLoginButton(page) {
  // The login button is in .mobile-actions and may be outside viewport
  // Use force click via JS to bypass viewport checks
  try {
    const clicked = await page.evaluate(() => {
      const mobileBtn = document.querySelector('.mobile-actions .btn-login');
      if (mobileBtn) {
        mobileBtn.click();
        return true;
      }
      // Fallback: try any visible login button
      const buttons = Array.from(document.querySelectorAll('button.btn-login'));
      for (const btn of buttons) {
        if (btn.offsetParent !== null) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    if (clicked) {
      await wait(2_000);
      return true;
    }
  } catch {
    // Fall through to generic text heuristics below.
  }

  return await clickButtonByText(page, ["登录", "login", "sign in"]).catch(() => false);
}

async function selectCodeBuddyCnRegion(page) {
  if (!page?.locator) return { selected: false, region: null };

  const selector = page.locator("[data-testid='region-select'], select[name='region']");
  if (!await selector.count().catch(() => 0)) {
    return { selected: false, region: null };
  }

  let region = CN_DEFAULT_REGION;
  try {
    await selector.selectOption(CN_DEFAULT_REGION);
  } catch {
    region = CN_FALLBACK_REGION;
    await selector.selectOption(CN_FALLBACK_REGION);
  }

  const confirm = page.locator("button:has-text('确认'), button:has-text('确定'), button:has-text('Continue')");
  if (await confirm.count().catch(() => 0)) {
    await confirm.first().click().catch(() => null);
  }
  await page.waitForTimeout?.(2_000);
  return { selected: true, region };
}

function getCodeBuddyCnLoginFrame(page) {
  // The login iframe can have different URL patterns
  return page.frames().find((frame) => {
    const url = frame.url();
    return url.includes("https://www.codebuddy.cn/login") || 
           url.includes("/login?platform=website");
  }) || null;
}

function getCodeBuddyCnPhoneFrame(page) {
  // The phone input is in a nested iframe within the login iframe
  return page.frames().find((frame) => {
    const url = frame.url();
    return url.includes("/auth/realms/copilot/protocol/openid-connect/auth") ||
           url.includes("phone-iframe");
  }) || null;
}

async function waitForCodeBuddyCnLoginSurface(page, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const frame = getCodeBuddyCnLoginFrame(page);
    if (frame) return frame;
    await wait(250);
  }
  return null;
}

async function hasCodeBuddyCnAuthInputs(target) {
  return await target.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input"));
    return inputs.some((input) => {
      const hint = [
        input.type,
        input.name,
        input.id,
        input.placeholder,
        input.autocomplete,
        input.getAttribute("aria-label"),
      ].join(" ").toLowerCase();
      return /(phone|mobile|tel|手机|号码|otp|code|验证码|verif)/i.test(hint);
    });
  }).catch(() => false);
}

async function clickPhoneLoginInModal(page) {
  // Inside the login iframe, click the checkbox + "手机号" option
  const loginFrame = getCodeBuddyCnLoginFrame(page);
  if (!loginFrame) return false;

  try {
    // Step 1: Check the agreement checkbox
    await loginFrame.evaluate(() => {
      const checkbox = document.querySelector('.t-checkbox__former');
      if (checkbox) {
        checkbox.click();
        if (!checkbox.checked) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }).catch(() => null);
    await wait(500);

    // Step 2: Click "手机号" (phone number login option)
    const clicked = await loginFrame.evaluate(() => {
      // Try multiple strategies to find the phone option
      // Strategy 1: exact text match on leaf elements
      const allEls = Array.from(document.querySelectorAll('div, span, a, p, li'));
      for (const el of allEls) {
        if (el.children.length === 0 && (el.textContent || '').trim() === '手机号') {
          // Click the parent container which is usually the clickable element
          const target = el.closest('[class*="item"]') || el.closest('[class*="other"]') || el.parentElement || el;
          target.click();
          return true;
        }
      }
      // Strategy 2: find by class hints
      const phoneItems = document.querySelectorAll('[class*="phone"], [class*="mobile"]');
      for (const item of phoneItems) {
        const text = (item.textContent || '').trim();
        if (text === '手机号' || text.includes('手机号')) {
          item.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);

    if (clicked) {
      await wait(2_000);
      return true;
    }
  } catch {
    // Ignore errors
  }
  return false;
}

async function openCodeBuddyCnLoginUi(page) {
  // Step 1: Click the main login button on the page
  const loginClicked = await clickPrimaryCodeBuddyCnLoginButton(page);
  if (loginClicked) {
    await wait(2_000);
  }

  // Step 2: Wait for the login modal iframe to appear
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const loginFrame = await waitForCodeBuddyCnLoginSurface(page, 3_000);
    if (!loginFrame) {
      // If no login frame after first attempt, try navigating
      if (attempt === 0) {
        await page.goto("https://www.codebuddy.cn/home/", {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        }).catch(() => null);
        await wait(2_000);
        await clickPrimaryCodeBuddyCnLoginButton(page);
        await wait(2_000);
      }
      continue;
    }

    // Step 3: Check if the phone iframe (nested) already has inputs
    const phoneFrame = getCodeBuddyCnPhoneFrame(page);
    if (phoneFrame) {
      const phoneReady = await hasCodeBuddyCnAuthInputs(phoneFrame);
      if (phoneReady) return phoneFrame;
      // Wait for phone frame to fully load
      await phoneFrame.waitForLoadState?.("domcontentloaded", { timeout: 5_000 }).catch(() => null);
      await wait(1_000);
      const phoneReady2 = await hasCodeBuddyCnAuthInputs(phoneFrame);
      if (phoneReady2) return phoneFrame;
    }

    // Step 4: Click checkbox + "手机号" inside the login modal
    const phoneClicked = await clickPhoneLoginInModal(page);
    if (phoneClicked) {
      await wait(2_000);
    }

    // Step 5: Check again for the nested phone iframe
    const phoneFrame2 = getCodeBuddyCnPhoneFrame(page);
    if (phoneFrame2) {
      await phoneFrame2.waitForLoadState?.("domcontentloaded", { timeout: 5_000 }).catch(() => null);
      await wait(1_500);
      const phoneReady = await hasCodeBuddyCnAuthInputs(phoneFrame2);
      if (phoneReady) return phoneFrame2;
    }
  }

  return null;
}

async function fillPhoneInput(target, phoneNumber) {
  // The phone input is in a nested iframe with specific selectors
  return await target.evaluate((value) => {
    const normalized = String(value || "").replace(/[^\d]/g, "");
    
    // Strategy 1: Try the exact selector we found
    const phoneInput = document.querySelector('#phoneNumber') || 
                       document.querySelector('input.kc-phone-number-input') ||
                       document.querySelector('input[placeholder*="手机"]');
    
    if (phoneInput && phoneInput.type !== 'hidden') {
      phoneInput.focus();
      phoneInput.value = normalized;
      phoneInput.dispatchEvent(new Event("input", { bubbles: true }));
      phoneInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    
    // Strategy 2: Fallback to generic phone input detection
    const inputs = Array.from(document.querySelectorAll("input"));
    for (const input of inputs) {
      if (input.type === 'hidden') continue;
      const hint = [
        input.type,
        input.name,
        input.id,
        input.placeholder,
        input.autocomplete,
        input.getAttribute("aria-label"),
        input.className,
      ].join(" ").toLowerCase();
      if (/(phone|mobile|tel|手机|号码)/i.test(hint)) {
        input.focus();
        input.value = normalized;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }, phoneNumber).catch(() => false);
}

async function fillOtpInput(target, otpCode) {
  // The OTP input is in the nested iframe with specific selectors
  return await target.evaluate((value) => {
    const normalized = String(value || "").replace(/[^\d]/g, "");
    
    // Strategy 1: Try the exact selector we found
    const otpInput = document.querySelector('#code') || 
                     document.querySelector('input.pf-c-form-control') ||
                     document.querySelector('input[placeholder*="验证码"]');
    
    if (otpInput && otpInput.type !== 'hidden') {
      otpInput.focus();
      otpInput.value = normalized;
      otpInput.dispatchEvent(new Event("input", { bubbles: true }));
      otpInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    
    // Strategy 2: Fallback to generic OTP input detection
    const inputs = Array.from(document.querySelectorAll("input"));
    for (const input of inputs) {
      if (input.type === 'hidden') continue;
      const hint = [
        input.type,
        input.name,
        input.id,
        input.placeholder,
        input.autocomplete,
        input.getAttribute("aria-label"),
        input.className,
      ].join(" ").toLowerCase();
      if (/(otp|code|验证码|verif)/i.test(hint)) {
        input.focus();
        input.value = normalized;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }, otpCode).catch(() => false);
}

async function tryRequestOtpViaPage(page, phoneNumber) {
  const url = `${CODEBUDDY_CN_SMS_ENDPOINT}?phoneNumber=${encodeURIComponent(phoneNumber)}`;
  return await codeBuddyCnRequestViaPage(page, "GET", url).catch(() => ({ status: 0, text: "" }));
}

async function waitForBrowserCredentialsOrApiKey(job, page, onStep) {
  const deadline = Date.now() + (job.options.smsTimeoutMs || DEFAULT_MANUAL_TIMEOUT_MS);

  while (Date.now() < deadline) {
    if (job.cancelRequested) throw new Error("Job cancelled");

    const extracted = await extractCredentialsFromBrowser(page);
    if (extracted) return extracted;

    try {
      const apiKey = await createCodeBuddyCnApiKeyViaPage(page);
      if (apiKey) {
        return {
          apiKey,
          cookiesJson: JSON.stringify(await page.context().cookies().catch(() => [])),
        };
      }
    } catch {
      // The account may not be fully logged in yet; keep polling.
    }

    onStep?.("awaiting_browser_session", "Waiting for CodeBuddy CN session cookies or API key");
    await wait(job.options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for CodeBuddy CN session after OTP submission");
}

async function runFiveSimRegistrationFlow(job, account, page, onStep) {
  const profile = await getFiveSimProfile(job.options.fiveSimApiKey).catch(() => null);
  if (profile?.balance !== undefined) {
    onStep("checking_5sim_balance", `5sim balance: ${profile.balance}`);
  }

  onStep("ordering_5sim_number", "Getting number from 5sim");
  const order = await orderFiveSimNumber(job, account);
  account.phone = order.phone;
  account.contactHint = order.phone;
  account.providerSpecificData = {
    ...(account.providerSpecificData || {}),
    fiveSimOrderId: order.id,
    fiveSimCountry: order.country,
    fiveSimOperator: order.operator,
    fiveSimProduct: order.product,
    fiveSimPrice: order.price,
  };
  onStep("got_5sim_number", `Got number: ${order.phone} (#${order.id}${order.price !== null ? `, $${order.price}` : ""})`);

  onStep("opening_sms_login", "Opening CodeBuddy CN SMS login form");
  const loginSurface = await openCodeBuddyCnLoginUi(page);
  if (!loginSurface) {
    throw new Error("Could not open the CodeBuddy CN SMS login form automatically");
  }

  const phoneFilled = await fillPhoneInput(loginSurface, order.phone);
  if (!phoneFilled) {
    throw new Error("Could not locate the CodeBuddy CN phone number input");
  }

  onStep("requesting_otp", `Requesting OTP for ${order.phone}`);
  const requestResult = await tryRequestOtpViaPage(page, order.phone);
  if (!requestResult || (requestResult.status !== 200 && requestResult.status !== 204)) {
    // Try clicking the send OTP button in the nested iframe
    const clicked = await loginSurface.evaluate(() => {
      // Strategy 1: Exact selector for the send button
      const sendBtn = document.querySelector('.code-btn') || 
                      document.querySelector('input.code-btn') ||
                      document.querySelector('button.code-btn');
      if (sendBtn) {
        sendBtn.click();
        return true;
      }
      
      // Strategy 2: Find by text content
      const buttons = Array.from(document.querySelectorAll('button, input[type="button"], a'));
      for (const btn of buttons) {
        const text = (btn.textContent || btn.value || '').trim().toLowerCase();
        if (/(send|get|获取|发送|验证码)/i.test(text)) {
          btn.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    
    if (!clicked) {
      // Fallback: try clicking on main page (old behavior)
      const clickedMain = await clickButtonByText(page, ["send code", "send otp", "get code", "获取验证码", "发送验证码", "sms"]);
      if (!clickedMain) {
        throw new Error("Could not trigger the CodeBuddy CN OTP request button");
      }
    }
  }

  const otp = await waitForFiveSimOtp(job, order.id, onStep);

  onStep("submitting_otp", "Submitting the OTP received from 5sim");
  const otpFilled = await fillOtpInput(loginSurface, otp.code);
  if (!otpFilled) {
    throw new Error("Found OTP from 5sim but could not locate a CodeBuddy CN OTP input");
  }

  await clickButtonByText(loginSurface, ["login", "sign in", "verify", "submit", "确认", "登录", "继续", "continue"]).catch(() => false);

  const credentials = await waitForBrowserCredentialsOrApiKey(job, page, onStep);
  await setFiveSimOrderStatus(job.options.fiveSimApiKey, "finish", order.id).catch(() => null);
  return credentials;
}

function normalizeCredentialObject(raw = {}, line = 1) {
  const email = String(raw.email || "").trim();
  const phone = String(raw.phone || "").trim();
  const emailOrPhone = String(raw.emailOrPhone || raw.email_or_phone || "").trim();
  const label = String(raw.label || raw.name || email || phone || emailOrPhone || `Account ${line}`).trim();
  const contactHint = email || phone || emailOrPhone || "";
  const accessToken = String(raw.accessToken || raw.access_token || "").trim();
  const jwtToken = String(raw.jwtToken || raw.jwt_token || raw.idToken || raw.id_token || "").trim();
  const apiKey = String(raw.apiKey || raw.api_key || "").trim();
  const refreshToken = String(raw.refreshToken || raw.refresh_token || "").trim();
  const cookiesJson = typeof raw.cookiesJson === "string"
    ? raw.cookiesJson
    : typeof raw.cookies_json === "string"
      ? raw.cookies_json
      : "";
  const fiveSimCountry = String(raw.fiveSimCountry || raw.fivesimCountry || raw.five_sim_country || "").trim();
  const fiveSimOperator = String(raw.fiveSimOperator || raw.fivesimOperator || raw.five_sim_operator || "").trim();
  const fiveSimProduct = String(raw.fiveSimProduct || raw.fivesimProduct || raw.five_sim_product || "").trim();

  const hasCredentials = Boolean(accessToken || jwtToken || apiKey);
  const derivedEmail = looksLikeEmail(contactHint) ? contactHint : "";

  return {
    line,
    label,
    email: email || derivedEmail || "",
    phone,
    contactHint,
    accessToken,
    jwtToken,
    apiKey,
    refreshToken,
    cookiesJson,
    fiveSimCountry,
    fiveSimOperator,
    fiveSimProduct,
    hasCredentials,
  };
}

export function parseCodeBuddyCnAutomationAccounts(accounts = [], count = 0) {
  const input = Array.isArray(accounts) ? accounts : [];
  const parsed = [];
  const invalidLines = [];

  input.forEach((entry, index) => {
    const line = index + 1;
    if (!entry) return;

    if (typeof entry === "string") {
      const raw = entry.trim();
      if (!raw) return;
      try {
        if (raw.startsWith("{")) {
          const objectEntry = JSON.parse(raw);
          parsed.push(normalizeCredentialObject(objectEntry, line));
          return;
        }
      } catch {
        invalidLines.push(line);
        return;
      }

      parsed.push(normalizeCredentialObject({ emailOrPhone: raw }, line));
      return;
    }

    if (typeof entry === "object") {
      parsed.push(normalizeCredentialObject(entry, line));
      return;
    }

    invalidLines.push(line);
  });

  if (!parsed.length && Number.isFinite(Number(count)) && Number(count) > 0) {
    for (let index = 0; index < Number(count); index += 1) {
      parsed.push(normalizeCredentialObject({ label: `Account ${index + 1}` }, index + 1));
    }
  }

  return { parsed, invalidLines };
}

function getEffectiveAutomationCount({ accounts = [], count = 0, fiveSimApiKey = "" } = {}) {
  const requestedCount = Number.parseInt(count, 10);
  if (Number.isFinite(requestedCount) && requestedCount > 0) {
    return requestedCount;
  }

  const hasAccounts = Array.isArray(accounts) && accounts.some((entry) => {
    if (typeof entry === "string") return entry.trim().length > 0;
    return Boolean(entry);
  });

  if (hasAccounts) return 0;
  return String(fiveSimApiKey || "").trim() ? 1 : 0;
}

function mergeCodeBuddyCnUsageMetadata(providerSpecificData = {}, usage = {}) {
  const merged = {
    ...providerSpecificData,
    ...(usage?.providerSpecificDataPatch || {}),
  };
  for (const key of CODEBUDDY_CN_LIFECYCLE_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(providerSpecificData, key)) {
      merged[key] = providerSpecificData[key];
    }
  }
  return merged;
}

async function defaultBrowserLauncher(browser = DEFAULT_AUTOMATION_BROWSER) {
  return await createAutomationBrowserLauncher(browser, { headless: true })();
}

async function defaultSaveConnection(account) {
  const { createProviderConnection, updateProviderConnection } = await import("../../../models/index.js");
  const { assertProviderEnabled } = await import("@/lib/providerDisabled");

  await assertProviderEnabled("codebuddy-cn");

  const providerSpecificData = {
    ...(account.providerSpecificData || {}),
    ...buildCodeBuddyCnProviderMetadata({
      apiKey: account.apiKey,
      accessToken: account.accessToken,
      idToken: account.jwtToken,
      providerSpecificData: account.providerSpecificData || {},
    }),
    automation: "cbcn",
    loginEmailOrPhone: account.contactHint || undefined,
    cookiesJson: account.cookiesJson || undefined,
  };

  const name = account.label || account.email || account.contactHint || "CodeBuddy CN";
  const payload = {
    provider: "codebuddy-cn",
    authType: account.apiKey ? "apikey" : "oauth",
    name,
    email: account.email || undefined,
    providerSpecificData,
    testStatus: "active",
    isActive: false,
  };

  if (account.apiKey) payload.apiKey = account.apiKey;
  if (account.accessToken) payload.accessToken = account.accessToken;
  if (account.refreshToken) payload.refreshToken = account.refreshToken;
  if (account.jwtToken) payload.idToken = account.jwtToken;

  const connection = await createProviderConnection(payload);

  try {
    const usage = await getUsageForProvider({
      ...connection,
      providerSpecificData,
    });
    if (usage?.providerSpecificDataPatch) {
      await updateProviderConnection(connection.id, {
        providerSpecificData: mergeCodeBuddyCnUsageMetadata(providerSpecificData, usage),
      });
    }
  } catch {
    // Usage refresh is best-effort for first save.
  }

  return { connection };
}

function findTokenInValue(value, seen = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  const direct = normalizeCredentialObject(value, 1);
  if (direct.hasCredentials) {
    return {
      accessToken: direct.accessToken,
      jwtToken: direct.jwtToken,
      apiKey: direct.apiKey,
      refreshToken: direct.refreshToken,
    };
  }

  for (const child of Object.values(value)) {
    if (typeof child === "string") {
      try {
        const parsed = JSON.parse(child);
        const nested = findTokenInValue(parsed, seen);
        if (nested) return nested;
      } catch {
        continue;
      }
    }
    if (child && typeof child === "object") {
      const nested = findTokenInValue(child, seen);
      if (nested) return nested;
    }
  }
  return null;
}

async function extractCredentialsFromBrowser(page) {
  const storageDump = await page.evaluate(() => {
    const readStorage = (storage) => {
      const out = {};
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        out[key] = storage.getItem(key);
      }
      return out;
    };

    return {
      url: location.href,
      cookies: document.cookie || "",
      localStorage: readStorage(window.localStorage),
      sessionStorage: readStorage(window.sessionStorage),
    };
  }).catch(() => null);

  if (!storageDump) return null;

  const fromStorage = [
    findTokenInValue(storageDump.localStorage),
    findTokenInValue(storageDump.sessionStorage),
  ].find(Boolean);

  const contextCookies = await page.context().cookies().catch(() => []);
  const cookiesJson = JSON.stringify(contextCookies || []);

  if (fromStorage) {
    return {
      ...fromStorage,
      cookiesJson,
    };
  }

  return null;
}

async function waitForManualCredentials(job, account, page, onStep) {
  const deadline = Date.now() + (job.options.smsTimeoutMs || DEFAULT_MANUAL_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (job.cancelRequested) {
      throw new Error("Job cancelled");
    }

    onStep("awaiting_manual_login", "Waiting for manual login or credential capture");
    const found = await extractCredentialsFromBrowser(page);
    if (found) return found;

    await new Promise((resolve) => setTimeout(resolve, job.options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for CodeBuddy CN credentials from the browser session");
}

function cancelPersistedActiveJob(job) {
  if (!job || !ACTIVE_JOB_STATUSES.has(job.status)) return job || null;

  const cancelledAt = nowIso();
  const accounts = (job.accounts || []).map((account) => {
    if (!ACTIVE_JOB_STATUSES.has(account.status)) return account;
    return {
      ...account,
      status: "cancelled",
      error: account.error || "Job cancelled",
      currentStep: "cancelled",
      updatedAt: cancelledAt,
      logs: [
        ...(account.logs || []),
        createLogEntry("cancelled", "Automation cancelled"),
      ].slice(-MAX_ACCOUNT_LOG_ENTRIES),
    };
  });

  return sanitizeJob({
    ...job,
    status: "cancelled",
    finishedAt: job.finishedAt || cancelledAt,
    accounts,
  });
}

export class CodeBuddyCnAutomationManager {
  constructor({
    browserLauncher = defaultBrowserLauncher,
    saveConnection = defaultSaveConnection,
    lifecycleRunner = runCodeBuddyCnLifecycle,
    createApiKey = createCodeBuddyCnApiKeyViaPage,
    usageLoader = getUsageForProvider,
    storageName = "codebuddy-cn-automation",
  } = {}) {
    this.browserLauncher = browserLauncher;
    this.saveConnection = saveConnection;
    this.lifecycleRunner = lifecycleRunner;
    this.createApiKey = createApiKey;
    this.usageLoader = usageLoader;
    this.storageDir = path.join(DATA_DIR, storageName);
    this.metaFile = path.join(this.storageDir, "meta.json");
    this.jobs = new Map();
    this.latestJobId = readPersistedLatestJobId(this.metaFile);
  }

  async startJob({
    accounts,
    count,
    concurrent,
    browser,
    fiveSimApiKey = "",
    fiveSimCountry = FIVE_SIM_DEFAULT_COUNTRY,
    fiveSimOperator = FIVE_SIM_DEFAULT_OPERATOR,
    fiveSimProduct = FIVE_SIM_DEFAULT_PRODUCT,
    useProxy = false,
    maxRetries = 1,
    smsTimeout = DEFAULT_MANUAL_TIMEOUT_MS / 1000,
    useAllBalance = false,
  } = {}) {
    const effectiveCount = getEffectiveAutomationCount({
      accounts,
      count,
      fiveSimApiKey,
    });
    const { parsed, invalidLines } = parseCodeBuddyCnAutomationAccounts(accounts, effectiveCount);
    if (!parsed.length) {
      throw Object.assign(new Error("At least one CodeBuddy CN account or count is required"), {
        error: "At least one CodeBuddy CN account or count is required",
        invalidLines,
      });
    }
    if (invalidLines.length > 0) {
      throw Object.assign(new Error("Invalid CodeBuddy CN account payload"), {
        error: "Invalid CodeBuddy CN account payload",
        invalidLines,
      });
    }

    const createdAt = nowIso();
    const jobId = randomUUID();
    const job = {
      jobId,
      status: "running",
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
      error: null,
      cancelRequested: false,
      browser: null,
      browserChoice: normalizeAutomationBrowser(browser),
      concurrency: clampConcurrency(concurrent),
      nextIndex: 0,
      lastPreview: null,
      options: {
        fiveSimApiKey: String(fiveSimApiKey || "").trim(),
        fiveSimCountry: String(fiveSimCountry || "").trim() || FIVE_SIM_DEFAULT_COUNTRY,
        fiveSimOperator: String(fiveSimOperator || "").trim() || FIVE_SIM_DEFAULT_OPERATOR,
        fiveSimProduct: String(fiveSimProduct || "").trim() || FIVE_SIM_DEFAULT_PRODUCT,
        useProxy: useProxy === true,
        maxRetries: Math.max(1, Number.parseInt(maxRetries, 10) || 1),
        useAllBalance: useAllBalance === true,
        smsTimeoutMs: Math.max(30_000, (Number.parseInt(smsTimeout, 10) || (DEFAULT_MANUAL_TIMEOUT_MS / 1000)) * 1000),
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      },
      accounts: parsed.map((entry) => ({
        ...entry,
        status: "queued",
        error: null,
        workerId: null,
        currentStep: "queued",
        updatedAt: createdAt,
        connectionId: null,
        runtimeSession: null,
        providerSpecificData: {},
        logs: [
          createLogEntry("queued", entry.hasCredentials
            ? "Queued credential import"
            : "Queued browser-assisted registration"),
        ],
      })),
    };

    this.jobs.set(jobId, job);
    this.latestJobId = jobId;
    writePersistedLatestJobId(jobId, this.metaFile);
    await this.persistJobSnapshot(job);
    void this.runJob(jobId);
    return sanitizeJob(job);
  }

  getJob(jobId) {
    const live = this.jobs.get(jobId);
    if (live) return sanitizeJob(live, { preview: live.lastPreview || null });
    return normalizePersistedSnapshot(readJson(getJobFile(jobId, this.storageDir)));
  }

  async getJobWithPreview(jobId) {
    const live = this.jobs.get(jobId);
    if (!live) return normalizePersistedSnapshot(readJson(getJobFile(jobId, this.storageDir)));
    live.lastPreview = await this.capturePreview(live);
    await this.persistJobSnapshot(live);
    return sanitizeJob(live, { preview: live.lastPreview || null });
  }

  async getLatestJobWithPreview({ includeRecentTerminal = false } = {}) {
    const latestJobId = this.latestJobId || readPersistedLatestJobId(this.metaFile);
    if (!latestJobId) return null;
    const job = await this.getJobWithPreview(latestJobId);
    if (!job) return null;
    if (ACTIVE_JOB_STATUSES.has(job.status)) return job;
    if (includeRecentTerminal && isRecentTerminalJob(job)) return job;
    return null;
  }

  cancelJob(jobId) {
    const live = this.jobs.get(jobId);
    if (!live) {
      const persisted = readJson(getJobFile(jobId, this.storageDir));
      const cancelled = cancelPersistedActiveJob(persisted);
      if (cancelled && cancelled !== persisted) {
        writeJson(getJobFile(jobId, this.storageDir), cancelled);
      }
      return cancelled;
    }

    live.cancelRequested = true;
    if (live.browser) {
      void live.browser.close().catch(() => null);
      live.browser = null;
    }
    void this.persistJobSnapshot(live);
    return sanitizeJob(live);
  }

  async getBalanceSnapshot() {
    const { getProviderConnections } = await import("../../../models/index.js");
    const { resolveConnectionProxyConfig } = await import("@/lib/network/connectionProxy");

    const connections = await getProviderConnections({ provider: "codebuddy-cn" });
    const results = [];

    for (const connection of connections) {
      const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
      const usage = await getUsageForProvider(connection, {
        connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
        connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
        connectionNoProxy: proxyConfig.connectionNoProxy || "",
        vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
        strictProxy: false,
      }).catch((error) => ({ error: error.message }));

      results.push({
        connectionId: connection.id,
        name: connection.name,
        authKind: connection.providerSpecificData?.authKind || null,
        usage,
      });
    }

    return {
      provider: "codebuddy-cn",
      jobId: this.latestJobId,
      accounts: results,
      connectedCount: results.length,
    };
  }

  async warmupConnections({ connectionId = null } = {}) {
    const { getProviderConnections, getProviderConnection, updateProviderConnection } = await import("../../../models/index.js");
    const { resolveConnectionProxyConfig } = await import("@/lib/network/connectionProxy");

    const connections = connectionId
      ? [await getProviderConnection(connectionId)].filter(Boolean)
      : await getProviderConnections({ provider: "codebuddy-cn" });

    const results = [];

    for (const connection of connections) {
      const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
      const usage = await getUsageForProvider(connection, {
        connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
        connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
        connectionNoProxy: proxyConfig.connectionNoProxy || "",
        vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
        strictProxy: false,
      }).catch((error) => ({ error: error.message }));

      let providerSpecificData = connection.providerSpecificData || {};
      if (!usage?.error && usage?.providerSpecificDataPatch) {
        providerSpecificData = {
          ...providerSpecificData,
          ...usage.providerSpecificDataPatch,
        };
        await updateProviderConnection(connection.id, { providerSpecificData });
      }

      results.push({
        connectionId: connection.id,
        name: connection.name,
        warmed: !usage?.error,
        providerSpecificData,
        usage,
      });
    }

    return {
      provider: "codebuddy-cn",
      warmedCount: results.filter((entry) => entry.warmed).length,
      total: results.length,
      results,
    };
  }

  dequeueAccount(job, workerId) {
    while (job.nextIndex < job.accounts.length) {
      const account = job.accounts[job.nextIndex];
      job.nextIndex += 1;
      if (account.status !== "queued") continue;
      account.status = "running";
      account.workerId = workerId;
      appendAccountLog(account, "worker_assigned", `Worker ${workerId} picked up this account`);
      return account;
    }
    return null;
  }

  finalizeAccount(account, status, extras = {}) {
    account.status = status;
    account.error = extras.error || null;
    account.connectionId = extras.connectionId || null;
    if (extras.step || extras.message) {
      appendAccountLog(account, extras.step || status, extras.message || extras.error || status);
    }
  }

  setAccountStep(account, step, message, level = "info") {
    appendAccountLog(account, step, message, level);
  }

  async persistJobSnapshot(job) {
    if (!job) return;
    writeJson(getJobFile(job.jobId, this.storageDir), buildPersistedSnapshot(job));
  }

  async capturePreview(job) {
    const previewAccount = job.accounts.find((account) => account.status === "running" && account.runtimeSession?.page);
    if (!previewAccount) return null;
    const page = previewAccount.runtimeSession?.page;
    if (!page) return null;

    try {
      const screenshot = await page.screenshot({
        type: "jpeg",
        quality: 55,
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      return {
        label: previewAccount.label,
        workerId: previewAccount.workerId || null,
        status: previewAccount.status,
        step: previewAccount.currentStep || null,
        updatedAt: previewAccount.updatedAt || nowIso(),
        imageData: `data:image/jpeg;base64,${screenshot.toString("base64")}`,
      };
    } catch {
      return null;
    }
  }

  async finishAuthenticatedAccount({ job, account, page, extracted }) {
    if (job.cancelRequested) throw new Error("Job cancelled");

    account.accessToken = extracted.accessToken || account.accessToken;
    account.jwtToken = extracted.jwtToken || account.jwtToken;
    account.apiKey = extracted.apiKey || account.apiKey;
    account.cookiesJson = extracted.cookiesJson || account.cookiesJson;
    account.hasCredentials = true;

    const selectedRegion = await selectCodeBuddyCnRegion(page).catch(() => ({ selected: false, region: null }));
    if (selectedRegion.selected) {
      this.setAccountStep(account, "region_selected", `Selected CodeBuddy CN region: ${selectedRegion.region}`);
    }

    if (!account.apiKey) {
      this.setAccountStep(account, "creating_codebuddy_cn_api_key", "Trying to create CodeBuddy CN API key from browser session");
      account.apiKey = await this.createApiKey(page).catch(() => account.apiKey);
    }

    if (job.cancelRequested) throw new Error("Job cancelled");

    const lifecycle = await this.lifecycleRunner({
      page,
      accessToken: account.accessToken,
      inviteCode: job.options?.inviteCode,
      beforeActivation: async () => {
        this.setAccountStep(account, "fetching_codebuddy_cn_credits", "Fetching CodeBuddy CN credits");
        const usage = await this.usageLoader({
          provider: "codebuddy-cn",
          apiKey: account.apiKey,
          accessToken: account.accessToken,
          idToken: account.jwtToken,
          providerSpecificData: account.providerSpecificData || {},
        }).catch(() => null);
        account.providerSpecificData = mergeCodeBuddyCnUsageMetadata(account.providerSpecificData || {}, usage || {});
        if (job.cancelRequested) throw new Error("Job cancelled");
      },
      onStep: (step, message) => this.setAccountStep(account, step, message),
    });

    account.providerSpecificData = {
      ...(account.providerSpecificData || {}),
      activationStatus: lifecycle.activation?.status || "not_applicable",
      activationMethod: lifecycle.activation?.method || undefined,
      activationError: lifecycle.activation?.error || undefined,
      gatewayAuthenticated: lifecycle.gateway?.authenticated === true,
      gatewayBlocked: lifecycle.gateway?.blocked === true,
      gatewayProbation: lifecycle.gateway?.probation === true,
      gatewayMessage: lifecycle.gateway?.message || undefined,
      codebuddyCnRegion: selectedRegion.region || undefined,
    };

    if (job.cancelRequested) throw new Error("Job cancelled");

    this.setAccountStep(account, "saving_connection", "Saving CodeBuddy CN connection from captured browser credentials");
    return await this.saveConnection(account);
  }

  async processAccount(job, account, workerId) {
    if (job.cancelRequested) {
      this.finalizeAccount(account, "cancelled", {
        error: "Job cancelled",
        step: "cancelled",
        message: "Automation was cancelled before this account started",
      });
      return;
    }

    if (account.hasCredentials) {
      this.setAccountStep(account, "saving_connection", "Saving CodeBuddy CN connection from provided credentials");
      const { connection } = await this.saveConnection(account);
      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "connection_saved",
        message: "CodeBuddy CN connection saved successfully",
      });
      return;
    }

    if (!job.browser) {
      throw new Error("No automation browser is available for manual CodeBuddy CN registration");
    }

    const { context, page } = await createFreshContext(job.browser);
    account.runtimeSession = { context, page };
    let fiveSimOrderId = null;

    try {
      this.setAccountStep(account, "opening_codebuddy_cn", "Opening CodeBuddy CN in a browser window");
      await page.goto("https://www.codebuddy.cn", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await openCodeBuddyCnLoginUi(page).catch(() => false);

      let extracted = null;
      if (job.options.fiveSimApiKey) {
        this.setAccountStep(account, "starting_5sim_registration", "Starting automatic CodeBuddy CN registration with 5sim");
        extracted = await runFiveSimRegistrationFlow(job, account, page, (step, message) => {
          if (step === "got_5sim_number") {
            fiveSimOrderId = account.providerSpecificData?.fiveSimOrderId || null;
          }
          this.setAccountStep(account, step, message);
        });
      }

      if (!extracted) {
        this.setAccountStep(account, "awaiting_manual_login", "Complete the login or registration flow in the opened browser");
        extracted = await waitForManualCredentials(job, account, page, (step, message) => {
          this.setAccountStep(account, step, message);
        });
      }

      const { connection } = await this.finishAuthenticatedAccount({
        job,
        account,
        page,
        extracted,
      });
      this.finalizeAccount(account, "success", {
        connectionId: connection.id,
        step: "connection_saved",
        message: "CodeBuddy CN connection saved successfully",
      });
    } catch (error) {
      const status = job.cancelRequested ? "cancelled" : "failed_timeout";
      this.finalizeAccount(account, status, {
        error: error.message || "CodeBuddy CN browser automation did not finish",
        step: status,
        message: error.message || "CodeBuddy CN browser automation did not finish",
      });
      await cancelFiveSimOrder(job, fiveSimOrderId || account.providerSpecificData?.fiveSimOrderId).catch(() => null);
    } finally {
      account.runtimeSession = null;
      await context.close().catch(() => null);
    }
  }

  async runWorker(job, workerId) {
    while (!job.cancelRequested) {
      const account = this.dequeueAccount(job, workerId);
      if (!account) return;
      await this.processAccount(job, account, workerId);
      await this.persistJobSnapshot(job);
    }
  }

  async runJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      const needsBrowser = job.accounts.some((account) => !account.hasCredentials);
      if (needsBrowser) {
        job.browser = await this.browserLauncher(job.browserChoice || DEFAULT_AUTOMATION_BROWSER);
      }

      const workerCount = Math.min(job.concurrency, Math.max(job.accounts.length, 1));
      const workers = Array.from({ length: workerCount }, (_, index) => this.runWorker(job, index + 1));
      await Promise.allSettled(workers);

      if (job.cancelRequested) {
        job.status = "cancelled";
      } else if (job.accounts.some((account) => !TERMINAL_ACCOUNT_STATUSES.has(account.status))) {
        job.status = "running";
      } else {
        job.status = "completed";
      }
    } catch (error) {
      job.status = "failed";
      job.error = error.message || "Failed to run CodeBuddy CN automation";
      for (const account of job.accounts) {
        if (!TERMINAL_ACCOUNT_STATUSES.has(account.status)) {
          this.finalizeAccount(account, "failed", {
            error: job.error,
            step: "failed",
            message: job.error,
          });
        }
      }
    } finally {
      job.finishedAt = nowIso();
      if (job.browser) {
        await job.browser.close().catch(() => null);
        job.browser = null;
      }
      await this.persistJobSnapshot(job);
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__codeBuddyCnAutomationSingleton) {
    globalThis.__codeBuddyCnAutomationSingleton = {
      manager: new CodeBuddyCnAutomationManager(),
    };
  }
  return globalThis.__codeBuddyCnAutomationSingleton;
}

export function getCodeBuddyCnAutomationManager() {
  return getSingletonStore().manager;
}

export const __test__ = {
  clampConcurrency,
  parseCodeBuddyCnAutomationAccounts,
  buildSummary,
  buildLookupResponse,
  normalizePhoneNumber,
  extractOtpCodeFromText,
  getFiveSimOrderConfig,
  getEffectiveAutomationCount,
  hasCodeBuddyCnAuthInputs,
  getCodeBuddyCnLoginFrame,
  selectCodeBuddyCnRegion,
  mergeCodeBuddyCnUsageMetadata,
};
