import { BaseExecutor } from "./base.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../config/providers.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared.js";
import { OAUTH_ENDPOINTS, buildKimiHeaders } from "../config/appConstants.js";
import { buildClineHeaders } from "../shared/clineAuth.js";
import { getCachedClaudeHeaders } from "../utils/claudeHeaderCache.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { stripUnsupportedParams } from "../translator/concerns/paramSupport.js";
import { randomUUID } from "crypto";
import { gzipSync } from "zlib";

const CODEBUDDY_SYSTEM_PROMPT = "You are CodeBuddy Code.";
const CODEBUDDY_MIN_OUTPUT_TOKENS = 16;
const CODEBUDDY_TOOL_DESCRIPTION_MAX_CHARS = 1200;
const CODEBUDDY_SCHEMA_DESCRIPTION_MAX_CHARS = 500;
const CODEBUDDY_ALLOWED_REQUEST_FIELDS = [
  "temperature",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
  "stop",
  "tool_choice",
  "parallel_tool_calls",
  "response_format",
];
const CODEBUDDY_REQUEST_ILLEGAL_CODE = 11140;
const CODEBUDDY_CHAT_PROVIDERS = new Set(["codebuddy"]);

export function isCodeBuddyChatProvider(provider) {
  return CODEBUDDY_CHAT_PROVIDERS.has(provider);
}

function codeBuddyRequestId() {
  return randomUUID().replace(/-/g, "");
}

function truncateMiddle(text, maxChars, label = "truncated for CodeBuddy") {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.75);
  const tail = Math.max(0, maxChars - head - label.length - 12);
  return `${text.slice(0, head)}\n\n[${label}]\n\n${text.slice(-tail)}`;
}

function parseBase64DataUri(url) {
  if (typeof url !== "string") return null;
  const match = url.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/i);
  if (!match) return null;
  return {
    declaredMime: match[1].toLowerCase(),
    payload: match[2],
  };
}

function sniffImageMimeFromBase64(payload) {
  if (typeof payload !== "string" || payload.length === 0) return null;
  try {
    const bytes = Buffer.from(payload, "base64");
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
      return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    if (bytes.length >= 6) {
      const gifHeader = bytes.subarray(0, 6).toString("ascii");
      if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "image/gif";
    }
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
      return "image/webp";
    }
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return "image/bmp";
    }
    if (bytes.length >= 4) {
      const boxType = bytes.subarray(4, 12).toString("ascii");
      if (boxType.startsWith("ftypavif")) return "image/avif";
      if (boxType.startsWith("ftypheic") || boxType.startsWith("ftypheix") || boxType.startsWith("ftyphevc") || boxType.startsWith("ftyphevx")) {
        return "image/heic";
      }
    }
    if (bytes.length >= 4 && (
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
      || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
    )) {
      return "image/tiff";
    }
    const textPrefix = bytes.subarray(0, 128).toString("utf8").trimStart();
    if (textPrefix.startsWith("<svg") || textPrefix.startsWith("<?xml")) {
      return "image/svg+xml";
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeCodeBuddyImagePart(part) {
  if (!part || typeof part !== "object" || part.type !== "image_url") return part;
  const rawUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
  const parsed = parseBase64DataUri(rawUrl);
  if (!parsed) return part;
  const actualMime = sniffImageMimeFromBase64(parsed.payload);
  if (!actualMime || actualMime === parsed.declaredMime) return part;
  const normalizedUrl = `data:${actualMime};base64,${parsed.payload}`;
  if (typeof part.image_url === "string") {
    return {
      ...part,
      image_url: normalizedUrl,
    };
  }
  return {
    ...part,
    image_url: {
      ...part.image_url,
      url: normalizedUrl,
    },
  };
}

function sanitizeCodeBuddyContent(content, role) {
  if (role === "system" || role === "developer") return "";
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (!part || typeof part !== "object") return part;
    return normalizeCodeBuddyImagePart(part);
  });
}

function sanitizeCodeBuddySchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeCodeBuddySchema);
  const next = { ...schema };
  if (typeof next.description === "string") {
    next.description = truncateMiddle(
      next.description,
      CODEBUDDY_SCHEMA_DESCRIPTION_MAX_CHARS,
      "schema description truncated"
    );
  }
  for (const key of Object.keys(next)) {
    if (key !== "description" && next[key] && typeof next[key] === "object") {
      next[key] = sanitizeCodeBuddySchema(next[key]);
    }
  }
  return next;
}

function normalizeCodeBuddyTools(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    if (tool.function && typeof tool.function === "object") {
      return {
        ...tool,
        function: {
          ...tool.function,
          description: truncateMiddle(
            tool.function.description || "",
            CODEBUDDY_TOOL_DESCRIPTION_MAX_CHARS,
            "tool description truncated"
          ),
          parameters: sanitizeCodeBuddySchema(tool.function.parameters),
        },
      };
    }
    return {
      ...tool,
      description: truncateMiddle(
        tool.description || "",
        CODEBUDDY_TOOL_DESCRIPTION_MAX_CHARS,
        "tool description truncated"
      ),
      input_schema: sanitizeCodeBuddySchema(tool.input_schema),
      parameters: sanitizeCodeBuddySchema(tool.parameters),
    };
  });
}

function normalizeCodeBuddyMessages(messages) {
  const source = Array.isArray(messages) ? messages : [];
  const next = [{ role: "system", content: CODEBUDDY_SYSTEM_PROMPT }];
  for (const message of source) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "system" || message.role === "developer") continue;
    const sanitized = {
      ...message,
      content: sanitizeCodeBuddyContent(message.content, message.role),
    };
    if (sanitized.role === "user" && typeof sanitized.content === "string") {
      next.push({ ...sanitized, content: [{ type: "text", text: sanitized.content }] });
    } else {
      next.push(sanitized);
    }
  }
  return next;
}

function buildCodeBuddyBody(model, transformed, maxTokens, maxCompletionTokens) {
  const body = {
    model,
    messages: normalizeCodeBuddyMessages(transformed.messages),
    stream: true,
  };
  for (const field of CODEBUDDY_ALLOWED_REQUEST_FIELDS) {
    if (transformed[field] !== undefined) body[field] = transformed[field];
  }
  if (Array.isArray(transformed.tools)) body.tools = normalizeCodeBuddyTools(transformed.tools);
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    body.max_tokens = Math.max(maxTokens, CODEBUDDY_MIN_OUTPUT_TOKENS);
  } else if (Number.isFinite(maxCompletionTokens) && maxCompletionTokens > 0) {
    body.max_tokens = Math.max(maxCompletionTokens, CODEBUDDY_MIN_OUTPUT_TOKENS);
  }
  return body;
}

function parseCodeBuddyErrorBody(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatCodeBuddyRequestIllegalMessage(parsed, fallbackText) {
  const upstream = fallbackText || JSON.stringify(parsed);
  return `${upstream} - CodeBuddy rejected the chat request as illegal. This usually means the connection is using a plugin OAuth access token instead of a CodeBuddy API key created from the browser-backed import flow, or the account is not allowed to call this chat endpoint.`;
}
// Auth header descriptors — derived from registry transport.auth, fallback to hardcoded defaults.
const BEARER = { combined: true, header: "Authorization", scheme: "bearer" };
const XAPIKEY = { combined: true, header: "x-api-key", scheme: "raw" };
const AUTH_DESCRIPTORS = Object.fromEntries(
  Object.entries(PROVIDERS)
    .filter(([, t]) => t.auth)
    .map(([id, t]) => [id, t.auth])
);

// Apply a token to a header per scheme (matches legacy: combined always sets, even when undefined).
function setAuth(headers, spec, token) {
  headers[spec.header] = spec.scheme === "bearer" ? `Bearer ${token}` : token;
}

// Resolve auth onto headers from a descriptor.
function applyAuth(headers, desc, credentials) {
  if (desc.combined) {
    // combined providers always set the header (legacy behavior, incl. noAuth → "Bearer undefined")
    setAuth(headers, desc, credentials.apiKey || credentials.accessToken);
    if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    return;
  }
  // split apiKey/oauth: set only the matching branch (legacy: anthropic-compatible skips when both absent)
  if (credentials.apiKey) setAuth(headers, desc.apiKey, credentials.apiKey);
  else if (credentials.accessToken) setAuth(headers, desc.oauth, credentials.accessToken);
  if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
}

// Provider-specific header quirks kept as small hooks (not pure auth).
const HEADER_HOOKS = {
  kimiHeaders: (h) => Object.assign(h, buildKimiHeaders()),
  clineHeaders: (h, c) => Object.assign(h, buildClineHeaders(c.apiKey || c.accessToken)),
  kilocodeOrg: (h, c) => { if (c.providerSpecificData?.orgId) h["X-Kilocode-OrganizationID"] = c.providerSpecificData.orgId; },
  claudeOverlay: (h) => {
    const cached = getCachedClaudeHeaders();
    if (!cached) return;
    for (const lcKey of Object.keys(cached)) {
      const titleKey = lcKey.replace(/(^|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
      if (lcKey === "anthropic-beta") {
        const staticBetaStr = h[titleKey] || h[lcKey] || "";
        const flags = new Set(staticBetaStr.split(",").map(f => f.trim()).filter(Boolean));
        for (const f of cached[lcKey].split(",").map(f => f.trim()).filter(Boolean)) flags.add(f);
        cached[lcKey] = Array.from(flags).join(",");
      }
      if (titleKey !== lcKey && h[titleKey] !== undefined) delete h[titleKey];
    }
    Object.assign(h, cached);
  },
};

// Config-driven OAuth refresh grants — derived from registry oauth.refresh.
const REFRESH_GRANTS = Object.fromEntries(
  Object.entries(PROVIDER_OAUTH)
    .filter(([, o]) => o.refresh)
    .map(([id, o]) => {
      const tokenUrl = o.tokenUrl;
      const encoding = o.refresh.encoding;
      const extraParams = o.refresh.scope ? { scope: o.refresh.scope } : {};
      return [id, {
        encoding,
        url: () => tokenUrl,
        params: (ex) => id === "gemini"
          ? { client_id: ex.config.clientId, client_secret: ex.config.clientSecret, ...extraParams }
          : { client_id: o.clientId, ...extraParams },
      }];
    })
);

export class DefaultExecutor extends BaseExecutor {
  constructor(provider) {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
  }

  transformRequest(model, body) {
    const transformed = this.applyJsonSchemaFallback(body);
    if (isCodeBuddyChatProvider(this.provider)) {
      const maxTokens = Number(transformed.max_tokens);
      const maxCompletionTokens = Number(transformed.max_completion_tokens);
      return buildCodeBuddyBody(model, transformed, maxTokens, maxCompletionTokens);
    }

    if (transformed && typeof transformed === "object") {
      // quirk: some openai-compatible providers reject Anthropic's client_metadata field
      if (this.config.quirks?.dropClientMetadata) {
        delete transformed.client_metadata;
      }
      stripUnsupportedParams(this.provider, model, transformed);
    }

    return injectReasoningContent({ provider: this.provider, model, body: transformed });
  }

  prepareRequestBody(transformedBody, headers) {
    const bodyStr = JSON.stringify(transformedBody);
    if (!isCodeBuddyChatProvider(this.provider)) return bodyStr;
    headers["Content-Encoding"] = "gzip";
    return gzipSync(bodyStr);
  }

  parseError(response, bodyText) {
    if (!isCodeBuddyChatProvider(this.provider)) return super.parseError(response, bodyText);
    const parsed = parseCodeBuddyErrorBody(bodyText);
    if (parsed?.code === CODEBUDDY_REQUEST_ILLEGAL_CODE) {
      return {
        status: response.status,
        message: formatCodeBuddyRequestIllegalMessage(parsed, bodyText),
      };
    }
    const message = parsed?.msg || parsed?.message || bodyText;
    return { status: response.status, message: message || `HTTP ${response.status}` };
  }

  async shouldRefreshForResponse(response) {
    if (!isCodeBuddyChatProvider(this.provider)) return super.shouldRefreshForResponse(response);
    if (response.status === 401) return true;
    if (response.status !== 403) return false;
    try {
      const parsed = await response.clone().json();
      if (parsed?.code === CODEBUDDY_REQUEST_ILLEGAL_CODE) return false;
    } catch {
      // If the response cannot be inspected, keep the legacy refresh behavior.
    }
    return true;
  }

  // Fallback json_schema → json_object for openai-compatible providers without native Structured Output.
  applyJsonSchemaFallback(body) {
    if (!this.provider?.startsWith?.("openai-compatible-")) return body;
    const rf = body?.response_format;
    if (rf?.type !== "json_schema" || !rf.json_schema?.schema) return body;

    const schemaJson = JSON.stringify(rf.json_schema.schema, null, 2);
    const prompt = `You must respond with valid JSON that strictly follows this JSON schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\nRespond ONLY with the JSON object, no other text.`;

    const messages = Array.isArray(body.messages) ? body.messages.map(m => ({ ...m })) : [];
    const sys = messages.find(m => m.role === "system");
    if (sys) {
      if (typeof sys.content === "string") sys.content = `${sys.content}\n\n${prompt}`;
      else if (Array.isArray(sys.content)) sys.content.push({ type: "text", text: `\n\n${prompt}` });
    } else {
      messages.unshift({ role: "system", content: prompt });
    }
    return { ...body, messages, response_format: { type: "json_object" } };
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || OPENAI_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    // gemini-format: build :streamGenerateContent / :generateContent path
    if (this.config.format === "gemini") {
      return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    }
    // urlSuffix (e.g. ?beta=true) declared per-provider in registry
    if (this.config.urlSuffix) {
      return `${this.config.baseUrl}${this.config.urlSuffix}`;
    }
    const url = this.config.baseUrl;
    if (url?.includes("{accountId}")) {
      const accountId = credentials?.providerSpecificData?.accountId;
      if (!accountId) throw new Error(`${this.provider} requires accountId in providerSpecificData`);
      return url.replace("{accountId}", accountId);
    }
    return url;
  }

  // Fallback descriptor for providers without an explicit entry in AUTH_DESCRIPTORS.
  resolveAuthDescriptor() {
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      return { apiKey: { header: "x-api-key", scheme: "raw" }, oauth: { header: "Authorization", scheme: "bearer" }, anthropicVersion: true };
    }
    if (this.config?.format === "claude") {
      return { ...XAPIKEY, anthropicVersion: true };
    }
    return BEARER;
  }

  buildHeaders(credentials, stream = true) {
    const headers = { "Content-Type": "application/json", ...this.config.headers };
    if (isCodeBuddyChatProvider(this.provider)) {
      const requestId = codeBuddyRequestId();
      const conversationId = codeBuddyRequestId();
      headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
      headers["Accept"] = "text/event-stream";
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["User-Agent"] = "CLI/2.105.2 CodeBuddy/2.105.2";
      headers["X-Requested-With"] = "XMLHttpRequest";
      headers["X-Domain"] = credentials.providerSpecificData?.domain || credentials.providerSpecificData?.rawAuth?.domain || this.config.domain || "www.codebuddy.ai";
      headers["X-Request-ID"] = requestId;
      headers["X-Conversation-ID"] = conversationId;
      headers["X-Conversation-Request-ID"] = conversationId;
      headers["X-Conversation-Message-ID"] = requestId;
      headers["X-Agent-Intent"] = "craft";
      headers["X-IDE-Type"] = "CLI";
      headers["X-IDE-Name"] = "CLI";
      headers["X-IDE-Version"] = "2.105.2";
      headers["X-Private-Data"] = "false";
      headers["X-Product"] = "SaaS";
    } else {
      const desc = AUTH_DESCRIPTORS[this.provider] || this.resolveAuthDescriptor();
      // Hooks run BEFORE auth so dynamic overlays (claude cached headers) can't clobber the token.
      for (const hook of desc.hooks || []) HEADER_HOOKS[hook]?.(headers, credentials);
      applyAuth(headers, desc, credentials);
    }

    // Strip first-party Claude Code identity headers for non-Anthropic anthropic-compatible upstreams
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "";
      const isOfficialAnthropic = baseUrl === "" || baseUrl.includes("api.anthropic.com");
      if (!isOfficialAnthropic) {
        // Some third-party Anthropic-compatible gateways require Bearer auth in
        // addition to x-api-key. Send both (x-api-key already set above) so
        // gateways that read either header succeed.
        if (credentials.apiKey && !headers["Authorization"]) {
          headers["Authorization"] = `Bearer ${credentials.apiKey}`;
        }
        delete headers["anthropic-dangerous-direct-browser-access"];
        delete headers["Anthropic-Dangerous-Direct-Browser-Access"];
        delete headers["x-app"];
        delete headers["X-App"];
        // Strip claude-code-20250219 from Anthropic-Beta / anthropic-beta
        for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
          if (headers[betaKey]) {
            const filtered = headers[betaKey]
              .split(",")
              .map(s => s.trim())
              .filter(f => f && f !== "claude-code-20250219")
              .join(",");
            if (filtered) {
              headers[betaKey] = filtered;
            } else {
              delete headers[betaKey];
            }
          }
        }
      }
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  // Generic OAuth refresh for the common {grant_type, refresh_token, client_id[, ...]} shape.
  // grant = REFRESH_GRANTS[provider]; client creds resolved from PROVIDERS or this.config.
  refreshFromGrant(credentials, proxyOptions) {
    const grant = REFRESH_GRANTS[this.provider];
    const params = { grant_type: "refresh_token", refresh_token: credentials.refreshToken, ...grant.params(this) };
    return grant.encoding === "json"
      ? this.refreshWithJSON(grant.url(), params, proxyOptions)
      : this.refreshWithForm(grant.url(), params, proxyOptions);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    const refreshers = {
      claude: () => this.refreshFromGrant(credentials, proxyOptions),
      codex: () => this.refreshFromGrant(credentials, proxyOptions),
      qwen: () => this.refreshWithForm(OAUTH_ENDPOINTS.qwen.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.qwen.clientId }, proxyOptions),
      iflow: () => this.refreshIflow(credentials.refreshToken, proxyOptions),
      gemini: () => this.refreshFromGrant(credentials, proxyOptions),
      kiro: () => this.refreshKiro(credentials.refreshToken, proxyOptions),
      codebuddy: () => this.refreshCodeBuddy(credentials.refreshToken, proxyOptions),
      cline: () => this.refreshCline(credentials.refreshToken, proxyOptions),
      "kimi-coding": () => this.refreshKimiCoding(credentials.refreshToken, proxyOptions),
      kilocode: () => this.refreshKilocode(credentials.refreshToken, proxyOptions)
    };

    const refresher = refreshers[this.provider];
    if (!refresher) return null;

    try {
      const result = await refresher();
      if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
      return result;
    } catch (error) {
      log?.error?.("TOKEN", `${this.provider} refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshWithJSON(url, body, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || body.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshWithForm(url, params, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams(params)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || params.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshIflow(refreshToken, proxyOptions = null) {
    const basicAuth = btoa(`${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`);
    const response = await proxyAwareFetch(OAUTH_ENDPOINTS.iflow.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "Authorization": `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: PROVIDERS.iflow.clientId, client_secret: PROVIDERS.iflow.clientSecret })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKiro(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(PROVIDERS.kiro.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "kiro-cli/1.0.0" },
      body: JSON.stringify({ refreshToken })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || refreshToken, expiresIn: tokens.expiresIn };
  }

  async refreshCodeBuddy(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(PROVIDERS.codebuddy.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "CLI/2.63.2 CodeBuddy/2.63.2",
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "www.codebuddy.ai",
        "X-Refresh-Token": refreshToken,
        "X-Auth-Refresh-Source": "plugin",
        "X-Product": "SaaS",
      },
      body: "{}"
    }, proxyOptions);
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data || payload;
    const accessToken = data?.accessToken || data?.access_token;
    if (!accessToken) return null;
    return {
      accessToken,
      refreshToken: data?.refreshToken || data?.refresh_token || refreshToken,
      expiresIn: data?.expiresIn || data?.expires_in || 86400,
    };
  }

  async refreshCline(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(PROVIDERS.cline.refreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" })
    }, proxyOptions);
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data || payload;
    const expiresAtIso = data?.expiresAt;
    const expiresIn = expiresAtIso ? Math.max(1, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000)) : undefined;
    return { accessToken: data?.accessToken, refreshToken: data?.refreshToken || refreshToken, expiresIn };
  }

  async refreshKimiCoding(refreshToken, proxyOptions = null) {
    const kimiHeaders = buildKimiHeaders();
    const response = await proxyAwareFetch(PROVIDERS["kimi-coding"].refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        ...kimiHeaders
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: PROVIDERS["kimi-coding"].clientId })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKilocode(refreshToken, proxyOptions = null) {
    // Kilocode uses device code flow, no refresh token support
    return null;
  }
}

export default DefaultExecutor;
