import nodeCrypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

/**
 * Gemini Web Executor
 *
 * JS port of https://github.com/Sophomoresty/gemini-web2api (MIT-licensed).
 * Reverse-engineered StreamGenerate protocol from gemini.google.com.
 *
 * EXPERIMENTAL — protocol changes upstream regularly; account ban risk applies.
 *
 * The user supplies Google session cookies; we compute SAPISIDHASH (the real
 * auth) per-request from the SAPISID cookie + a timestamp. The XSRF token
 * (`SNlM0e`) is opportunistically scraped from the bootstrap response and
 * reused; if missing or stale, we send the request without it (Google often
 * accepts that for chat).
 */

const GEMINI_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const GEMINI_BL = "boq_assistant-bard-web-server_20260525.09_p0";
const STREAM_GENERATE_PATH = "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

// MODE_CATEGORY enum from Gemini frontend JS source (per gemini-web2api docs):
// 1=FAST, 2=THINKING, 3=PRO, 4=AUTO, 5=FAST_DYNAMIC_THINKING, 6=FLASH_LITE
const MODEL_MAP = {
  "gemini-3.5-flash":               { mode: 1, think: 4 },
  "gemini-3.5-flash-thinking":      { mode: 2, think: 0 },
  "gemini-3.5-flash-thinking-lite": { mode: 5, think: 0 },
  "gemini-3.1-pro":                 { mode: 3, think: 4 },
  "gemini-auto":                    { mode: 4, think: 4 },
  "gemini-flash-lite":              { mode: 6, think: 4 },
};
const DEFAULT_MODEL_ID = "gemini-3.5-flash";

function makeSapisidHash(sapisid) {
  const ts = Math.floor(Date.now() / 1000);
  const hash = nodeCrypto.createHash("sha1").update(`${ts} ${sapisid} https://gemini.google.com`).digest("hex");
  return `SAPISIDHASH ${ts}_${hash}`;
}

function uuidV4() {
  return nodeCrypto.randomUUID();
}

/**
 * Convert OpenAI messages → single prompt string.
 * Gemini's web protocol is single-turn; we synthesize prior turns by labeling
 * roles and concatenating. The last user message is left unlabeled.
 */
function parseOpenAIMessages(messages) {
  const extracted = [];
  for (const msg of messages) {
    let role = String(msg.role || "user");
    if (role === "developer") role = "system";
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.filter((c) => c.type === "text").map((c) => String(c.text || "")).join(" ");
    }
    if (!content.trim()) continue;
    extracted.push({ role, text: content });
  }
  let lastUserIdx = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "user") { lastUserIdx = i; break; }
  }
  const parts = [];
  for (let i = 0; i < extracted.length; i++) {
    const { role, text } = extracted[i];
    parts.push(i === lastUserIdx ? text : `${role}: ${text}`);
  }
  return parts.join("\n\n");
}

/**
 * Build Gemini's StreamGenerate POST body (urlencoded form).
 * Mirrors `_build_payload` in gemini-web2api/gemini.py:
 *   inner = [None] * 102 with sparse fields
 *   outer = [None, JSON.stringify(inner)]
 *   form  = { "f.req": JSON.stringify(outer), "at"?: xsrfToken }
 */
function buildPayload({ prompt, modelMode, thinkMode, xsrfToken }) {
  const inner = new Array(102).fill(null);
  inner[0] = [prompt, 0, null, null, null, null, 0];
  inner[1] = ["en"];
  inner[2] = ["", "", "", null, null, null, null, null, null, ""];
  inner[6] = [0];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  inner[17] = [[thinkMode]];
  inner[18] = 0;
  inner[27] = 1;
  inner[30] = [4];
  inner[41] = [2];
  inner[53] = 0;
  inner[59] = uuidV4();
  inner[61] = [];
  inner[68] = 1;
  inner[79] = modelMode;

  const outer = [null, JSON.stringify(inner)];
  const params = new URLSearchParams();
  params.set("f.req", JSON.stringify(outer));
  if (xsrfToken) params.set("at", xsrfToken);
  return params.toString();
}

function buildStreamUrl() {
  const reqid = Math.floor(Date.now() / 1000) % 1000000;
  return `https://gemini.google.com${STREAM_GENERATE_PATH}?bl=${encodeURIComponent(GEMINI_BL)}&hl=en&_reqid=${reqid}&rt=c`;
}

/**
 * Strip Google's pseudo-citation/code-reference junk that leaks into prose.
 * Mirrors `clean_text` in gemini-web2api.
 */
function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g, "")
    .replace(/http:\/\/googleusercontent\.com\/card_content\/\d+\n?/g, "")
    .trim();
}

/**
 * Parse one `wrb.fr` envelope line into the list of text strings it carries.
 * Mirrors `_extract_texts_from_line` in gemini-web2api.
 */
function extractTextsFromLine(line) {
  if (!line.includes('"wrb.fr"') || line.length < 200) return [];
  let arr;
  try { arr = JSON.parse(line); } catch { return []; }
  const innerStr = arr?.[0]?.[2];
  if (!innerStr || innerStr.length < 50) return [];
  let inner;
  try { inner = JSON.parse(innerStr); } catch { return []; }
  if (!Array.isArray(inner) || inner.length <= 4 || !inner[4]) return [];
  const texts = [];
  for (const part of inner[4]) {
    if (Array.isArray(part) && part.length > 1 && Array.isArray(part[1])) {
      for (const t of part[1]) {
        if (typeof t === "string" && t) texts.push(t);
      }
    }
  }
  return texts;
}

/**
 * Async generator: read Gemini's batched response (newline-delimited wrb.fr
 * envelopes prefixed by chunk-size markers) and yield monotonically growing
 * "best so far" snapshots.
 */
async function* readGeminiTextSnapshots(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        for (const t of extractTextsFromLine(trimmed)) yield t;
      }
    }
    buffer += decoder.decode();
    for (const line of buffer.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      for (const t of extractTextsFromLine(trimmed)) yield t;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Convert the snapshot stream into incremental deltas (Gemini sends growing
 * full-text snapshots, OpenAI clients want diff chunks).
 */
async function* extractDeltas(body, signal) {
  let prev = "";
  for await (const snapshot of readGeminiTextSnapshots(body, signal)) {
    if (snapshot.length > prev.length && snapshot.startsWith(prev.slice(0, Math.min(prev.length, snapshot.length)))) {
      const delta = snapshot.slice(prev.length);
      const cleaned = cleanText(delta);
      if (cleaned) yield { delta: cleaned };
      prev = snapshot;
    } else if (snapshot.length > prev.length) {
      // Snapshot diverged from previous prefix (rare — usually a re-rendered
      // earlier candidate). Emit the difference from the longest common prefix.
      let i = 0;
      while (i < prev.length && i < snapshot.length && prev[i] === snapshot[i]) i++;
      const delta = snapshot.slice(i);
      const cleaned = cleanText(delta);
      if (cleaned) yield { delta: cleaned };
      prev = snapshot;
    }
  }
  yield { done: true, fullText: cleanText(prev) };
}

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildStreamingResponse(body, model, cid, created, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));
        for await (const chunk of extractDeltas(body, signal)) {
          if (chunk.done) break;
          if (chunk.delta) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: chunk.delta }, finish_reason: null, logprobs: null }],
            })));
          }
        }
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: `[Stream error: ${err.message || String(err)}]` }, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });
}

async function buildNonStreamingResponse(body, model, cid, created, signal) {
  let fullText = "";
  for await (const chunk of extractDeltas(body, signal)) {
    if (chunk.done) { fullText = chunk.fullText || fullText; break; }
    if (chunk.delta) fullText += chunk.delta;
  }
  fullText = cleanText(fullText);

  const promptTokens = Math.ceil(fullText.length / 4);
  const completionTokens = Math.ceil(fullText.length / 4);
  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: { role: "assistant", content: fullText }, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super("gemini-web", PROVIDERS["gemini-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: buildStreamUrl(), headers: {}, transformedBody: body };
    }

    // Resolve model + thinking-depth override (`@think=N` suffix)
    let modelName = String(model || DEFAULT_MODEL_ID);
    let thinkOverride = null;
    if (modelName.includes("@think=")) {
      const [base, raw] = modelName.split("@think=");
      modelName = base;
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) thinkOverride = parsed;
    }
    const cfg = MODEL_MAP[modelName] || MODEL_MAP[DEFAULT_MODEL_ID];
    const modelMode = cfg.mode;
    const thinkMode = thinkOverride ?? cfg.think;

    const prompt = parseOpenAIMessages(messages);
    if (!prompt.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty prompt after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: buildStreamUrl(), headers: {}, transformedBody: body };
    }

    const psd = credentials?.providerSpecificData || {};
    const cookieString = psd.cookieString;
    const sapisid = psd.sapisid;
    const xsrfToken = psd.xsrfToken || null;

    if (!cookieString || !sapisid) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing Gemini cookies — re-authenticate via the Cookie modal", type: "auth_required" },
      }), { status: 401, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: buildStreamUrl(), headers: {}, transformedBody: body };
    }

    const url = buildStreamUrl();
    const formBody = buildPayload({ prompt, modelMode, thinkMode, xsrfToken });

    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://gemini.google.com",
      "Referer": "https://gemini.google.com/app",
      "X-Same-Domain": "1",
      "User-Agent": GEMINI_USER_AGENT,
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cookie": cookieString,
      "Authorization": makeSapisidHash(sapisid),
    };

    log?.info?.("GEMINI-WEB", `Query to ${modelName} (mode=${modelMode}, think=${thinkMode}), prompt_len=${prompt.length}`);

    let response;
    try {
      response = await fetch(url, { method: "POST", headers, body: formBody, signal });
    } catch (err) {
      log?.error?.("GEMINI-WEB", `Fetch failed: ${err.message || String(err)}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Gemini connection failed: ${err.message || String(err)}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url, headers, transformedBody: { prompt, modelMode, thinkMode } };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Gemini returned HTTP ${status}`;
      if (status === 401 || status === 403 || status === 302) {
        errMsg = "Gemini auth failed — cookies may be expired. Re-paste cookies via the Cookie modal.";
      } else if (status === 400) {
        errMsg = "Gemini rejected the request (likely XSRF token expired). Re-paste cookies to refresh.";
      } else if (status === 429) {
        errMsg = "Gemini rate limited. Wait a moment and retry, or rotate cookies.";
      }
      log?.warn?.("GEMINI-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url, headers, transformedBody: { prompt, modelMode, thinkMode } };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Gemini returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url, headers, transformedBody: { prompt, modelMode, thinkMode } };
    }

    const cid = `chatcmpl-gmw-${uuidV4().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, modelName, cid, created, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, modelName, cid, created, signal);
    }
    return { response: finalResponse, url, headers, transformedBody: { prompt, modelMode, thinkMode } };
  }
}

// Exported helpers for tests
export const _internal = {
  parseOpenAIMessages,
  buildPayload,
  cleanText,
  extractTextsFromLine,
  makeSapisidHash,
  MODEL_MAP,
  DEFAULT_MODEL_ID,
};

export default GeminiWebExecutor;
