import {
  CN_ACTIVATION_TIMEOUT,
  CN_ACTIVATION_URL,
  CN_DEFAULT_INVITE_CODE,
  CN_GATEWAY_STATUS_URL,
  CN_USER_INFO_URL,
  GATEWAY_AUTH_HEADER,
  GATEWAY_PROBATION_MSG,
} from "open-sse/executors/codebuddy-cn/config.js";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pageUrl(page) {
  return typeof page?.url === "function" ? page.url() : String(page?.url || "");
}

function responseError(response, fallback) {
  return String(
    response?.json?.message
    || response?.json?.error
    || response?.text
    || fallback
  ).slice(0, 240);
}

export async function requestCodeBuddyCnViaPage({ page, method = "GET", url, body = null, headers = {} }) {
  if (!page?.evaluate) throw new Error("CodeBuddy CN browser page is unavailable");
  return await page.evaluate(
    async ({ requestUrl, requestMethod, requestBody, requestHeaders }) => {
      try {
        const mergedHeaders = {
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
          ...requestHeaders,
        };
        const init = {
          method: requestMethod,
          credentials: "include",
          headers: mergedHeaders,
        };
        if (requestBody !== null) {
          mergedHeaders["Content-Type"] = "application/json";
          init.body = JSON.stringify(requestBody);
        }
        const response = await fetch(requestUrl, init);
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
      requestUrl: url,
      requestMethod: String(method || "GET").toUpperCase(),
      requestBody: body,
      requestHeaders: headers,
    }
  );
}

function accountIsActivated(payload) {
  const source = payload?.data || payload || {};
  const credits = Number(source.credits ?? source.remaining_credits ?? source.credit_remaining ?? 0);
  return source.is_activated === true || source.isActivated === true || credits > 0;
}

export async function activateCodeBuddyCnInBrowser({ page, inviteCode = CN_DEFAULT_INVITE_CODE }) {
  if (!page?.goto || !page?.locator) {
    return { success: false, error: "CodeBuddy CN activation page is unavailable" };
  }

  await page.goto(CN_ACTIVATION_URL, {
    waitUntil: "domcontentloaded",
    timeout: CN_ACTIVATION_TIMEOUT * 1000,
  });
  await page.waitForTimeout?.(3_000);

  const terms = page.locator("input[type='checkbox'], [role='checkbox']");
  if (await terms.count().catch(() => 0)) {
    await terms.first().click().catch(() => null);
    await page.waitForTimeout?.(500);
  }

  const invite = page.locator("input[name='inviteCode'], input[name='invite_code'], input[placeholder*='invite'], input[placeholder*='邀请']");
  if (inviteCode && await invite.count().catch(() => 0)) {
    await invite.first().fill(inviteCode).catch(() => null);
    await page.waitForTimeout?.(500);
  }

  const freePlan = page.locator("button:has-text('免费'), button:has-text('Free'), [data-plan='free'], [data-tier='free']");
  if (await freePlan.count().catch(() => 0)) {
    await freePlan.first().click().catch(() => null);
    await page.waitForTimeout?.(1_000);
  }

  const submit = page.locator("button[type='submit'], button:has-text('激活'), button:has-text('Activate'), button:has-text('开始')");
  if (await submit.count().catch(() => 0)) {
    await submit.first().click().catch(() => null);
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(2_000);
    const currentUrl = pageUrl(page);
    if (currentUrl && !currentUrl.includes("activation") && !currentUrl.includes("/buy/")) {
      return { success: true, method: "browser" };
    }
  }

  return { success: false, error: "CodeBuddy CN activation timed out" };
}

async function resolveActivation({ page, accessToken, inviteCode, request, activateInBrowser, onStep }) {
  let needsActivation = true;
  try {
    const userInfo = await request({
      page,
      method: "GET",
      url: CN_USER_INFO_URL,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (userInfo.status >= 200 && userInfo.status < 300 && accountIsActivated(userInfo.json)) {
      return { status: "already_active", method: "status" };
    }
    needsActivation = true;
  } catch {
    needsActivation = true;
  }

  if (!needsActivation) return { status: "already_active", method: "status" };

  onStep?.("activating_codebuddy_cn", "Activating CodeBuddy CN account");
  let browserResult = null;
  try {
    browserResult = await activateInBrowser({ page, accessToken, inviteCode });
    if (browserResult?.success) {
      return { status: "activated", method: "browser" };
    }
  } catch (error) {
    browserResult = { success: false, error: error?.message || String(error) };
  }

  const apiResult = await request({
    page,
    method: "POST",
    url: CN_ACTIVATION_URL,
    headers: { Authorization: `Bearer ${accessToken}` },
    body: {
      invite_code: inviteCode || CN_DEFAULT_INVITE_CODE,
      plan: "free",
      platform: "IDE",
    },
  }).catch((error) => ({ status: 0, text: error?.message || String(error), json: null }));

  if (apiResult.status === 200 || apiResult.status === 201) {
    return { status: "activated", method: "api" };
  }

  return {
    status: "activation_skipped",
    method: null,
    error: responseError(apiResult, browserResult?.error || "CodeBuddy CN activation failed"),
  };
}

async function resolveGateway({ page, accessToken, request }) {
  try {
    const response = await request({
      page,
      method: "GET",
      url: CN_GATEWAY_STATUS_URL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        [GATEWAY_AUTH_HEADER]: "true",
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(responseError(response, "CodeBuddy CN gateway status failed"));
    }
    const data = response.json?.data || response.json || {};
    return {
      authenticated: data.authenticated === true,
      blocked: data.blocked === true,
      probation: data.probation === true,
      message: String(data.message || ""),
    };
  } catch {
    return {
      authenticated: false,
      blocked: false,
      probation: true,
      message: GATEWAY_PROBATION_MSG,
    };
  }
}

export async function runCodeBuddyCnLifecycle({
  page,
  accessToken,
  inviteCode = CN_DEFAULT_INVITE_CODE,
  request = requestCodeBuddyCnViaPage,
  activateInBrowser = activateCodeBuddyCnInBrowser,
  beforeActivation = async () => {},
  onStep,
} = {}) {
  if (!accessToken) {
    await beforeActivation();
    return {
      activation: { status: "not_applicable", method: null },
      gateway: { authenticated: false, blocked: false, probation: false, message: "" },
    };
  }

  const gateway = await resolveGateway({ page, accessToken, request });
  await beforeActivation();
  const activation = await resolveActivation({
    page,
    accessToken,
    inviteCode,
    request,
    activateInBrowser,
    onStep,
  });
  if (activation.status === "activation_skipped") {
    onStep?.("activation_skipped", `Activation check skipped: ${activation.error}`);
  } else {
    onStep?.("activation_complete", `CodeBuddy CN activation status: ${activation.status}`);
  }
  if (gateway.blocked || gateway.probation) {
    onStep?.("gateway_probation", gateway.message || GATEWAY_PROBATION_MSG);
  } else {
    onStep?.("gateway_authenticated", "CodeBuddy CN gateway authentication confirmed");
  }

  return { activation, gateway };
}
