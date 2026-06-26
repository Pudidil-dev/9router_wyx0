import { proxyAwareFetch } from "../utils/proxyFetch.js";

const BASE64_BLOCK_SIZE = 4;

export const CODEBUDDY_CN_DEFAULT_DOMAIN = "www.codebuddy.cn";
export const CODEBUDDY_CN_PROBE_URL = `https://${CODEBUDDY_CN_DEFAULT_DOMAIN}/console/api/client/v1/api-keys`;
export const CODEBUDDY_CN_CONSOLE_ACCOUNTS_URL = `https://${CODEBUDDY_CN_DEFAULT_DOMAIN}/console/accounts`;

function withBase64Padding(raw) {
  const normalized = String(raw || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = (BASE64_BLOCK_SIZE - (normalized.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
  return normalized + "=".repeat(padding);
}

export function stripUndefinedEntries(object) {
  return Object.fromEntries(
    Object.entries(object || {}).filter(([, value]) => value !== undefined)
  );
}

export function decodeJwtPayloadLoose(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(withBase64Padding(parts[1]), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function isJwtLike(token) {
  return typeof token === "string" && token.split(".").length === 3;
}

function firstDefinedString(source, keys = []) {
  for (const key of keys) {
    const value = source?.[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return undefined;
}

function firstDefinedNumber(source, keys = []) {
  for (const key of keys) {
    const value = source?.[key];
    if (value === undefined || value === null || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

export function extractCodeBuddyCnIdentityFromJwt(jwt) {
  const payload = decodeJwtPayloadLoose(jwt);
  if (!payload) return null;

  return stripUndefinedEntries({
    jwtSub: firstDefinedString(payload, ["sub", "uid", "userId", "user_id", "accountId"]),
    jwtEmail: firstDefinedString(payload, ["email", "mail", "preferred_username", "upn"]),
    jwtName: firstDefinedString(payload, ["name", "nickname", "username"]),
    jwtExp: firstDefinedNumber(payload, ["exp"]),
    codebuddyCnUserId: firstDefinedString(payload, ["user_id", "userId", "uid", "sub"]),
    codebuddyCnEnterpriseId: firstDefinedString(payload, ["enterprise_id", "enterpriseId", "tenant_id", "tenantId", "org_id", "orgId"]),
  });
}

export function resolveCodeBuddyCnCredential(credentials = {}) {
  const providerSpecificData = credentials.providerSpecificData || {};
  const candidates = [
    { authKind: "api_key", token: credentials.apiKey, source: "apiKey" },
    { authKind: "api_key", token: providerSpecificData.apiKey, source: "providerSpecificData.apiKey" },
    { authKind: "access_token", token: credentials.accessToken, source: "accessToken" },
    { authKind: "access_token", token: providerSpecificData.accessToken || providerSpecificData.access_token, source: "providerSpecificData.accessToken" },
    { authKind: "jwt_token", token: providerSpecificData.jwtToken || providerSpecificData.jwt_token, source: "providerSpecificData.jwtToken" },
    { authKind: "jwt_token", token: credentials.idToken, source: "idToken" },
  ];

  for (const candidate of candidates) {
    const token = typeof candidate.token === "string" ? candidate.token.trim() : "";
    if (token) {
      return { ...candidate, token };
    }
  }

  return { authKind: null, token: "", source: null };
}

export function buildCodeBuddyCnProviderMetadata(credentials = {}) {
  const providerSpecificData = credentials.providerSpecificData || {};
  const resolved = resolveCodeBuddyCnCredential(credentials);
  const identityToken = [
    providerSpecificData.jwtToken,
    providerSpecificData.jwt_token,
    credentials.idToken,
    isJwtLike(credentials.accessToken) ? credentials.accessToken : null,
    isJwtLike(providerSpecificData.accessToken) ? providerSpecificData.accessToken : null,
    isJwtLike(providerSpecificData.access_token) ? providerSpecificData.access_token : null,
  ].find((value) => typeof value === "string" && value.trim());

  const identity = identityToken ? extractCodeBuddyCnIdentityFromJwt(identityToken) : null;

  return stripUndefinedEntries({
    authKind: resolved.authKind || providerSpecificData.authKind,
    jwtSub: identity?.jwtSub || providerSpecificData.jwtSub,
    jwtEmail: identity?.jwtEmail || providerSpecificData.jwtEmail,
    jwtName: identity?.jwtName || providerSpecificData.jwtName,
    jwtExp: identity?.jwtExp || providerSpecificData.jwtExp,
    codebuddyCnUserId: identity?.codebuddyCnUserId || providerSpecificData.codebuddyCnUserId,
    codebuddyCnEnterpriseId: identity?.codebuddyCnEnterpriseId || providerSpecificData.codebuddyCnEnterpriseId,
  });
}

export function buildCodeBuddyCnAuthHeaders(credentials = {}, extraHeaders = {}) {
  const providerSpecificData = credentials.providerSpecificData || {};
  const resolved = resolveCodeBuddyCnCredential(credentials);
  if (!resolved.token) {
    throw new Error("CodeBuddy CN credentials are incomplete");
  }

  const domain = providerSpecificData.domain || CODEBUDDY_CN_DEFAULT_DOMAIN;
  const headers = {
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0",
    "X-Requested-With": "XMLHttpRequest",
    "X-Domain": domain,
    "Authorization": `Bearer ${resolved.token}`,
    ...extraHeaders,
  };

  if (resolved.authKind === "api_key") {
    headers["X-API-Key"] = resolved.token;
  }

  return headers;
}

function createCodeBuddyCnApiKeyName() {
  const suffix = Math.floor(Math.random() * 900000) + 100000;
  return `9router-cbcn-${Date.now().toString(36)}-${suffix}`;
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Resolve the user_enterprise_id needed for API key creation. Prefer the value
// already decoded from the JWT; otherwise probe /console/accounts with the Bearer
// token (the same authoritative "logged in" call the browser automation makes).
export async function fetchCodeBuddyCnEnterpriseId({ accessToken, providerSpecificData = {}, proxyOptions = null, fetchImpl = proxyAwareFetch } = {}) {
  const fromMeta = String(providerSpecificData.codebuddyCnEnterpriseId || "").trim();
  if (fromMeta) {
    return { enterpriseId: fromMeta, uid: String(providerSpecificData.codebuddyCnUserId || "").trim() };
  }

  try {
    const response = await fetchImpl(
      CODEBUDDY_CN_CONSOLE_ACCOUNTS_URL,
      {
        method: "GET",
        headers: buildCodeBuddyCnAuthHeaders(
          { accessToken, providerSpecificData },
          { Accept: "application/json, text/plain, */*" }
        ),
      },
      proxyOptions
    );
    const json = await readJsonSafe(response);
    const accounts = json?.data?.accounts || [];
    if (response.ok && json?.code === 0 && accounts.length) {
      const first = accounts[0] || {};
      return {
        enterpriseId: String(first.userEnterpriseId || first.user_enterprise_id || "personal-edition-user-id"),
        uid: String(first.uid || ""),
      };
    }
  } catch {
    // best-effort; fall through to the personal default
  }

  return { enterpriseId: "personal-edition-user-id", uid: "" };
}

// Mints a CodeBuddy CN API key purely from the backend using the OAuth access
// token as a Bearer credential — no browser/cookies required. This mirrors what
// the bulk automation does, and crucially still works when the account is
// "access restricted" in the UI, because the token itself remains valid.
export async function mintCodeBuddyCnApiKeyViaBackend({ accessToken, providerSpecificData = {}, proxyOptions = null, fetchImpl = proxyAwareFetch } = {}) {
  const token = String(accessToken || "").trim();
  if (!token) return null;

  const { enterpriseId } = await fetchCodeBuddyCnEnterpriseId({ accessToken: token, providerSpecificData, proxyOptions, fetchImpl });

  try {
    const response = await fetchImpl(
      CODEBUDDY_CN_PROBE_URL,
      {
        method: "POST",
        headers: buildCodeBuddyCnAuthHeaders(
          { accessToken: token, providerSpecificData },
          { "Content-Type": "application/json", Accept: "application/json, text/plain, */*" }
        ),
        body: JSON.stringify({
          name: createCodeBuddyCnApiKeyName(),
          expire_in_days: -1,
          user_enterprise_id: enterpriseId,
        }),
      },
      proxyOptions
    );
    const json = await readJsonSafe(response);
    if (!response.ok || json?.code !== 0) return null;
    const apiKey = String(json?.data?.key || json?.data?.api_key || json?.data?.token || "").trim();
    return apiKey || null;
  } catch {
    return null;
  }
}

function collectObjects(value, out = []) {
  if (!value || typeof value !== "object") return out;
  if (!Array.isArray(value)) out.push(value);
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out);
    return out;
  }
  for (const child of Object.values(value)) collectObjects(child, out);
  return out;
}

export function extractCodeBuddyCnCredits(payload) {
  const candidates = collectObjects(payload);
  for (const candidate of candidates) {
    const total = firstDefinedNumber(candidate, [
      "credit_limit",
      "codebuddy_cn_credit_limit",
      "credit_capacity_size",
      "total_credits",
      "totalCredits",
    ]);
    const remaining = firstDefinedNumber(candidate, [
      "remaining_credits",
      "credit_remaining",
      "credit_capacity_remain",
      "remainingCredits",
    ]);
    let used = firstDefinedNumber(candidate, [
      "codebuddy_cn_credit_used",
      "credit_used",
      "credit_capacity_used",
      "used_credits",
      "usedCredits",
    ]);
    const usedPercent = firstDefinedNumber(candidate, ["used_percent", "credit_used_percent"]);
    const exhausted = candidate.credit_exhausted === true;

    if (used === undefined && total !== undefined && remaining !== undefined) {
      used = Math.max(0, total - remaining);
    }
    if (used === undefined && total !== undefined && usedPercent !== undefined) {
      used = Math.max(0, total * (usedPercent / 100));
    }
    const normalizedTotal = total ?? (used !== undefined && remaining !== undefined ? used + remaining : undefined);
    const normalizedRemaining = remaining ?? (normalizedTotal !== undefined && used !== undefined ? Math.max(0, normalizedTotal - used) : undefined);

    if (
      normalizedTotal !== undefined ||
      normalizedRemaining !== undefined ||
      used !== undefined ||
      exhausted
    ) {
      return stripUndefinedEntries({
        creditLimit: normalizedTotal,
        remainingCredits: normalizedRemaining,
        creditUsed: used,
        usedPercent,
        aliyunUserType: firstDefinedString(candidate, ["aliyun_user_type"]),
        creditExhausted: exhausted || undefined,
      });
    }
  }
  return null;
}

export function buildCodeBuddyCnUsageResult(payload, providerSpecificData = {}, nowIso = new Date().toISOString()) {
  const creditSnapshot = extractCodeBuddyCnCredits(payload);
  const metadata = stripUndefinedEntries({
    creditSource: "codebuddy-cn",
    warmupAt: nowIso,
    codebuddyCnCreditLimit: creditSnapshot?.creditLimit,
    codebuddyCnCreditUsed: creditSnapshot?.creditUsed,
    aliyunUserType: creditSnapshot?.aliyunUserType || providerSpecificData.aliyunUserType,
    creditExhausted: creditSnapshot?.creditExhausted,
  });

  if (!creditSnapshot) {
    return {
      plan: "CodeBuddy CN",
      message: "CodeBuddy CN connected. Credit metadata was not exposed by the upstream response.",
      quotas: {},
      providerSpecificDataPatch: metadata,
    };
  }

  const total = Math.max(0, Number(creditSnapshot.creditLimit || 0));
  const remaining = Math.max(0, Number(creditSnapshot.remainingCredits ?? Math.max(0, total - Number(creditSnapshot.creditUsed || 0))));
  const used = Math.max(0, Number(creditSnapshot.creditUsed ?? Math.max(0, total - remaining)));

  return {
    plan: "CodeBuddy CN",
    quotas: {
      "CodeBuddy CN Credits": {
        used,
        total,
        remaining,
        remainingPercentage: total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0,
        unit: "credits",
        unlimited: false,
      },
    },
    providerSpecificDataPatch: metadata,
  };
}
