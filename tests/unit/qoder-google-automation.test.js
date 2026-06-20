import { describe, expect, it } from "vitest";
import { handleQoderSelectAccounts, runGoogleAccountAutomation } from "../../src/lib/oauth/services/automation/googleOAuth.js";

function createLocator(overrides = {}) {
  return Object.assign({
    first() { return this; },
    nth() { return this; },
    async count() { return 0; },
    async isVisible() { return false; },
    async isEnabled() { return false; },
    async click() { return null; },
    async fill() { return null; },
    async press() { return null; },
    async pressSequentially() { return null; },
    async type() { return null; },
    async scrollIntoViewIfNeeded() { return null; },
    async isChecked() { return false; },
    async check() { return null; },
    async inputValue() { return ""; },
    async innerText() { return ""; },
    async textContent() { return ""; },
    async boundingBox() { return null; },
  }, overrides);
}

function createAutomationPage({ url, text }) {
  return {
    async goto() { return null; },
    async waitForTimeout() { return null; },
    url() { return url; },
    frames() { return []; },
    mainFrame() { return null; },
    locator() { return createLocator(); },
    mouse: {
      async move() { return null; },
      async down() { return null; },
      async up() { return null; },
    },
    keyboard: {
      async press() { return null; },
    },
    async evaluate(fn) {
      const source = String(fn);
      if (source.includes("slice(0, 500)")) return null;
      if (source.includes("document.body?.innerText")) return text;
      return null;
    },
  };
}

function neverResolves() {
  return new Promise(() => {});
}

function createGoogleEmailPage() {
  let emailValue = "";
  let nextClicks = 0;
  let approveClicks = 0;

  const emailLocator = createLocator({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async fill(value) { emailValue = value; },
    async inputValue() { return emailValue; },
  });

  const nextLocator = createLocator({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() { nextClicks += 1; },
  });

  const approveLocator = createLocator({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() { approveClicks += 1; },
  });

  const page = createAutomationPage({
    url: "https://accounts.google.com/o/oauth2/v2/auth",
    text: "Sign in Use your Google Account. Qoder wants to access your Google Account.",
  });

  page.locator = (selector) => {
    if (selector.includes("#identifierId") || selector.includes('input[name="identifier"]')) return emailLocator;
    if (selector === "#identifierNext button") return nextLocator;
    if (selector.includes("Allow")) return approveLocator;
    return createLocator();
  };

  return {
    page,
    get emailValue() { return emailValue; },
    get nextClicks() { return nextClicks; },
    get approveClicks() { return approveClicks; },
  };
}

function createGoogleIndonesianConsentPage() {
  let continueClicks = 0;
  let resolveSuccess;
  const successPromise = new Promise((resolve) => {
    resolveSuccess = resolve;
  });

  const continueLocator = createLocator({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() {
      continueClicks += 1;
      resolveSuccess({ tokens: {} });
    },
  });

  const page = createAutomationPage({
    url: "https://accounts.google.com/signin/oauth/id",
    text: "Login ke qoder.com Google akan mengizinkan qoder.com mengakses info tentang Anda ini Nama dan foto profil Alamat email Lanjutkan",
  });

  page.locator = (selector) => {
    if (selector.includes("Lanjutkan")) return continueLocator;
    return createLocator();
  };

  return {
    page,
    successPromise,
    get continueClicks() { return continueClicks; },
  };
}

function createGooglePasswordFallbackPage() {
  let passwordValue = "";
  let nextClicks = 0;

  const passwordLocator = createLocator({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async fill() { throw new Error("fill failed"); },
    async press(key) {
      if (key === "Backspace") passwordValue = "";
    },
    async pressSequentially() { passwordValue = "bad-prefix"; },
    async type(value) { passwordValue += value; },
    async inputValue() { return passwordValue; },
  });

  const nextLocator = createLocator({
    async count() { return 1; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async click() { nextClicks += 1; },
  });

  const page = createAutomationPage({
    url: "https://accounts.google.com/signin/v2/challenge/pwd",
    text: "Enter your password",
  });

  page.locator = (selector) => {
    if (selector === 'input[type="password"]') return passwordLocator;
    if (selector === "#passwordNext button") return nextLocator;
    return createLocator();
  };

  return {
    page,
    get passwordValue() { return passwordValue; },
    get nextClicks() { return nextClicks; },
  };
}

function createQoderSelectionPage(url) {
  let selectionClicks = 0;

  return {
    url() { return url; },
    async waitForTimeout() { return null; },
    async evaluate(_fn, args = {}) {
      if (!args.allowAccountSelection) return null;
      selectionClicks += 1;
      return { clicked: true, method: "account-card: akuntunggalbaru9@gmail.com" };
    },
    get selectionClicks() { return selectionClicks; },
  };
}

function createQoderDevicePageWithOnlyMarketingButton() {
  return {
    url() { return "https://qoder.com/device/selectAccounts"; },
    async waitForTimeout() { return null; },
    async evaluate(_fn, args = {}) {
      if (!args.allowAccountSelection) return null;
      return { clicked: true, method: "first-visible-btn: QoderWork" };
    },
  };
}

function createQoderMarketingRedirectPage() {
  let currentUrl = "https://qoder.com/qoderwork";
  const visited = [];
  let resolveSuccess;
  const successPromise = new Promise((resolve) => {
    resolveSuccess = resolve;
  });

  return {
    page: {
      async goto(url) {
        visited.push(url);
        currentUrl = visited.length === 1 ? "https://qoder.com/qoderwork" : url;
        if (visited.length > 1) {
          resolveSuccess({ tokens: { accessToken: "access-after-reopen" } });
        }
      },
      async waitForTimeout() { return null; },
      url() { return currentUrl; },
      frames() { return []; },
      mainFrame() { return null; },
      locator() { return createLocator(); },
      mouse: {
        async move() { return null; },
        async down() { return null; },
        async up() { return null; },
      },
      keyboard: {
        async press() { return null; },
      },
      async evaluate(fn) {
        const source = String(fn);
        if (source.includes("document.body?.innerText")) return "QoderWork Desktop";
        return null;
      },
    },
    successPromise,
    get visited() { return visited; },
  };
}

function createClosingQoderPage() {
  let waitCount = 0;

  return {
    async goto() { return null; },
    async waitForTimeout() {
      waitCount += 1;
      if (waitCount > 1) {
        throw new Error("page.waitForTimeout: Target page, context or browser has been closed");
      }
      return null;
    },
    url() { return "https://qoder.com/qoderwork"; },
    frames() { return []; },
    mainFrame() { return null; },
    locator() { return createLocator(); },
    mouse: {
      async move() { return null; },
      async down() { return null; },
      async up() { return null; },
    },
    keyboard: {
      async press() { return null; },
    },
    async evaluate(fn) {
      const source = String(fn);
      if (source.includes("document.body?.innerText")) return "QoderWork Desktop";
      return null;
    },
  };
}

describe("Qoder Google automation", () => {
  it("submits the Google email screen before attempting consent approval", async () => {
    const googlePage = createGoogleEmailPage();
    const steps = [];

    const result = await runGoogleAccountAutomation({
      page: googlePage.page,
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      email: "user@example.com",
      password: "password",
      successPromise: Promise.resolve({ tokens: {} }),
      shortTimeoutMs: 1000,
      serviceLabel: "Qoder",
      onStep: (step) => steps.push(step),
    });

    expect(result.status).toBe("success");
    expect(googlePage.emailValue).toBe("user@example.com");
    expect(googlePage.nextClicks).toBe(1);
    expect(googlePage.approveClicks).toBe(0);
    expect(steps).toContain("google_email_input_found");
    expect(steps).toContain("google_email_submitted");
    expect(steps).not.toContain("approving_google_consent");
    expect(steps).not.toContain("approving_consent");
  });

  it("approves Indonesian Google OAuth consent with the Lanjutkan button", async () => {
    const consentPage = createGoogleIndonesianConsentPage();
    const steps = [];

    const result = await runGoogleAccountAutomation({
      page: consentPage.page,
      authUrl: "https://accounts.google.com/signin/oauth/id",
      email: "user@example.com",
      password: "password",
      successPromise: consentPage.successPromise,
      shortTimeoutMs: 2000,
      serviceLabel: "Qoder",
      onStep: (step) => steps.push(step),
    });

    expect(result.status).toBe("success");
    expect(consentPage.continueClicks).toBe(1);
    expect(steps).toContain("approving_google_consent");
  });

  it("clears a partial password before the final typing fallback", async () => {
    const passwordPage = createGooglePasswordFallbackPage();

    const result = await runGoogleAccountAutomation({
      page: passwordPage.page,
      authUrl: "https://accounts.google.com/signin/v2/challenge/pwd",
      email: "user@example.com",
      password: "correct-password",
      successPromise: Promise.resolve({ tokens: {} }),
      shortTimeoutMs: 1000,
      serviceLabel: "Qoder",
    });

    expect(result.status).toBe("success");
    expect(passwordPage.passwordValue).toBe("correct-password");
    expect(passwordPage.nextClicks).toBe(1);
  });

  it("does not click QoderWork marketing cards as account selectors", async () => {
    const page = createQoderSelectionPage("https://qoder.com/qoderwork");
    const steps = [];

    const handled = await handleQoderSelectAccounts(page, (step) => steps.push(step));

    expect(handled).toBe(false);
    expect(page.selectionClicks).toBe(0);
    expect(steps).toContain("qoder_page_seen");
    expect(steps).toContain("qoder_non_device_page");
    expect(steps).not.toContain("qoder_select_accounts");
  });

  it("still clicks account selectors on the Qoder device flow page", async () => {
    const page = createQoderSelectionPage("https://qoder.com/device/selectAccounts");
    const steps = [];

    const handled = await handleQoderSelectAccounts(page, (step) => steps.push(step));

    expect(handled).toBe(true);
    expect(page.selectionClicks).toBe(1);
    expect(steps).toContain("qoder_page_seen");
    expect(steps).not.toContain("qoder_non_device_page");
    expect(steps).toContain("qoder_select_accounts");
  });

  it("does not click generic QoderWork buttons on the device flow page", async () => {
    const page = createQoderDevicePageWithOnlyMarketingButton();
    const steps = [];

    const handled = await handleQoderSelectAccounts(page, (step) => steps.push(step));

    expect(handled).toBe(false);
    expect(steps).toContain("qoder_page_seen");
    expect(steps).not.toContain("qoder_non_device_page");
    expect(steps).not.toContain("qoder_select_accounts");
  });

  it("reopens Qoder device auth when provider redirects to a non-device page", async () => {
    const qoderPage = createQoderMarketingRedirectPage();
    const steps = [];
    const authUrl = "https://qoder.com/device/selectAccounts?nonce=secret-nonce";

    const result = await runGoogleAccountAutomation({
      page: qoderPage.page,
      authUrl,
      email: "user@example.com",
      password: "password",
      successPromise: qoderPage.successPromise,
      shortTimeoutMs: 2000,
      serviceLabel: "Qoder",
      successStep: "qoder_token_received",
      successMessage: "Qoder device token received",
      onStep: (step) => steps.push(step),
    });

    expect(result).toMatchObject({
      status: "success",
      tokens: { accessToken: "access-after-reopen" },
    });
    expect(qoderPage.visited).toEqual([authUrl, authUrl]);
    expect(steps).toContain("qoder_non_device_page");
    expect(steps).toContain("reopening_qoder_device_auth");
    expect(steps).toContain("qoder_token_received");
  });

  it("waits for Qoder token polling when the browser closes after authorization", async () => {
    const steps = [];
    const successPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ tokens: { accessToken: "access-1" } }), 1000);
    });

    const result = await runGoogleAccountAutomation({
      page: createClosingQoderPage(),
      authUrl: "https://qoder.com/device/selectAccounts",
      email: "user@example.com",
      password: "password",
      successPromise,
      shortTimeoutMs: 2500,
      serviceLabel: "Qoder",
      successStep: "qoder_token_received",
      successMessage: "Qoder device token received",
      onStep: (step) => steps.push(step),
    });

    expect(result).toMatchObject({
      status: "success",
      tokens: { accessToken: "access-1" },
    });
    expect(steps).toContain("waiting_for_token_after_browser_closed");
    expect(steps).toContain("qoder_token_received");
  });

  it("does not treat Qoder provider-page text as rejected Google credentials", async () => {
    const result = await runGoogleAccountAutomation({
      page: createAutomationPage({
        url: "https://qoder.com/device/selectAccounts",
        text: "Select an account. If you couldn't sign in, choose another account.",
      }),
      authUrl: "https://qoder.com/device/selectAccounts",
      email: "user@example.com",
      password: "password",
      successPromise: neverResolves(),
      shortTimeoutMs: 1,
      serviceLabel: "Qoder",
    });

    expect(result.status).toBe("needs_manual");
    expect(result.error).not.toBe("Google rejected the supplied email or password.");
  });

  it("keeps Google secure-browser blocks open for manual assist", async () => {
    const result = await runGoogleAccountAutomation({
      page: createAutomationPage({
        url: "https://accounts.google.com/signin/v2/challenge/pwd",
        text: "Couldn't sign you in. This browser or app may not be secure.",
      }),
      authUrl: "https://accounts.google.com/signin/v2/challenge/pwd",
      email: "user@example.com",
      password: "password",
      successPromise: neverResolves(),
      shortTimeoutMs: 1000,
      serviceLabel: "Qoder",
    });

    expect(result.status).toBe("needs_manual");
    expect(result.error).toContain("secure-browser challenge");
  });

  it("still treats Google auth-page invalid markers as rejected credentials", async () => {
    const result = await runGoogleAccountAutomation({
      page: createAutomationPage({
        url: "https://accounts.google.com/signin/v2/challenge/pwd",
        text: "Wrong password. Try again or click Forgot password to reset it.",
      }),
      authUrl: "https://accounts.google.com/signin/v2/challenge/pwd",
      email: "user@example.com",
      password: "bad-password",
      successPromise: neverResolves(),
      shortTimeoutMs: 1000,
      serviceLabel: "Qoder",
    });

    expect(result).toMatchObject({
      status: "failed_invalid_credentials",
      error: "Google rejected the supplied email or password.",
    });
  });
});
