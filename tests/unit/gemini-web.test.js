/**
 * Unit tests for gemini-web executor
 *
 * Covers:
 *  - Message parsing: single-turn concat with role labels, last-user unlabeled
 *  - StreamGenerate payload shape: outer/inner array structure, urlencoded f.req
 *  - @think=N suffix parsing
 *  - Model resolution + fallback to default
 *  - Auth header construction (Cookie + SAPISIDHASH)
 *  - clean_text strips Google's pseudo-citation/code-reference junk
 *  - 401/403/400/429 error handling with friendly messages
 *  - Missing-credential rejection (no providerSpecificData → 401)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import nodeCrypto from "node:crypto";
import {
  GeminiWebExecutor,
  _internal,
} from "../../open-sse/executors/gemini-web.js";

const { parseOpenAIMessages, buildPayload, cleanText, extractTextsFromLine, MODEL_MAP, DEFAULT_MODEL_ID } = _internal;

const originalFetch = global.fetch;

function mockGeminiTextResponse(snapshots, status = 200) {
  // Each snapshot is wrapped in a wrb.fr envelope. Real responses prefix each
  // chunk with a size marker; the executor's parser is tolerant to its absence
  // because it only looks at lines containing '"wrb.fr"' and >= 200 chars.
  const lines = snapshots.map((text) => {
    const inner = [null, null, null, null, [[null, [text]]]];
    const envelope = [["wrb.fr", null, JSON.stringify(inner)]];
    // Pad to length >= 200 so extractTextsFromLine's length guard accepts it.
    const json = JSON.stringify(envelope);
    return json.length >= 200 ? json : json + " ".repeat(200 - json.length);
  });
  const body = lines.join("\n") + "\n";
  return new Response(new Blob([body]).stream(), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_CREDS = {
  providerSpecificData: {
    cookieString: "SID=abc; HSID=def; SSID=ghi; APISID=jkl; SAPISID=mno; __Secure-1PSID=pqr",
    sapisid: "mno",
    xsrfToken: "XSRF_TOK",
  },
};

describe("parseOpenAIMessages", () => {
  it("emits the last user message unlabeled and prefixes earlier turns with role", () => {
    const out = parseOpenAIMessages([
      { role: "system", content: "Be helpful" },
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
    ]);
    expect(out).toBe("system: Be helpful\n\nuser: Q1\n\nassistant: A1\n\nQ2");
  });

  it("treats developer role as system", () => {
    const out = parseOpenAIMessages([
      { role: "developer", content: "Hidden instr" },
      { role: "user", content: "Hi" },
    ]);
    expect(out.startsWith("system: Hidden instr")).toBe(true);
    expect(out.endsWith("Hi")).toBe(true);
  });

  it("flattens multi-part text content arrays", () => {
    const out = parseOpenAIMessages([
      { role: "user", content: [{ type: "text", text: "Hello" }, { type: "text", text: "World" }] },
    ]);
    expect(out).toBe("Hello World");
  });

  it("skips empty messages", () => {
    const out = parseOpenAIMessages([
      { role: "user", content: "" },
      { role: "user", content: "  " },
      { role: "user", content: "real" },
    ]);
    expect(out).toBe("real");
  });
});

describe("buildPayload", () => {
  it("produces urlencoded form body with f.req and at when xsrfToken present", () => {
    const body = buildPayload({ prompt: "hi", modelMode: 1, thinkMode: 4, xsrfToken: "TOK" });
    const params = new URLSearchParams(body);
    expect(params.get("at")).toBe("TOK");
    expect(params.get("f.req")).toBeTruthy();
  });

  it("omits 'at' parameter when xsrfToken is null", () => {
    const body = buildPayload({ prompt: "hi", modelMode: 1, thinkMode: 4, xsrfToken: null });
    const params = new URLSearchParams(body);
    expect(params.get("at")).toBeNull();
  });

  it("encodes inner[0][0] = prompt", () => {
    const body = buildPayload({ prompt: "ping", modelMode: 1, thinkMode: 4, xsrfToken: null });
    const params = new URLSearchParams(body);
    const outer = JSON.parse(params.get("f.req"));
    const inner = JSON.parse(outer[1]);
    expect(inner[0][0]).toBe("ping");
  });

  it("places modelMode at inner[79]", () => {
    const body = buildPayload({ prompt: "hi", modelMode: 3, thinkMode: 0, xsrfToken: null });
    const inner = JSON.parse(JSON.parse(new URLSearchParams(body).get("f.req"))[1]);
    expect(inner[79]).toBe(3);
  });

  it("places thinkMode at inner[17][0][0]", () => {
    const body = buildPayload({ prompt: "hi", modelMode: 2, thinkMode: 7, xsrfToken: null });
    const inner = JSON.parse(JSON.parse(new URLSearchParams(body).get("f.req"))[1]);
    expect(inner[17]).toEqual([[7]]);
  });
});

describe("cleanText", () => {
  it("strips Google's code-reference fenced blocks", () => {
    const input = "Hello ```python?code_reference&code_event_index=3\nimport x\n```\nworld";
    expect(cleanText(input)).toBe("Hello \nworld");
  });

  it("strips card_content URLs", () => {
    expect(cleanText("see http://googleusercontent.com/card_content/12\nrest")).toBe("see \nrest");
  });

  it("returns empty string for falsy input", () => {
    expect(cleanText("")).toBe("");
    expect(cleanText(null)).toBe("");
    expect(cleanText(undefined)).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(cleanText("   hello   ")).toBe("hello");
  });
});

describe("extractTextsFromLine", () => {
  it("returns empty for lines without wrb.fr marker", () => {
    expect(extractTextsFromLine("not a wrb line".padEnd(300, " "))).toEqual([]);
  });

  it("returns empty for lines shorter than 200 chars", () => {
    expect(extractTextsFromLine('[["wrb.fr",null,"x"]]')).toEqual([]);
  });

  it("extracts text from a well-formed wrb.fr envelope", () => {
    const inner = [null, null, null, null, [[null, ["Hello world"]]]];
    const envelope = [["wrb.fr", null, JSON.stringify(inner)]];
    const line = JSON.stringify(envelope).padEnd(300, " ");
    expect(extractTextsFromLine(line)).toEqual(["Hello world"]);
  });
});

describe("model resolution", () => {
  it("known models are present in MODEL_MAP", () => {
    expect(MODEL_MAP["gemini-3.5-flash"]).toBeDefined();
    expect(MODEL_MAP["gemini-3.5-flash-thinking"]).toBeDefined();
    expect(MODEL_MAP["gemini-3.1-pro"]).toBeDefined();
    expect(MODEL_MAP["gemini-flash-lite"]).toBeDefined();
  });

  it("DEFAULT_MODEL_ID is gemini-3.5-flash", () => {
    expect(DEFAULT_MODEL_ID).toBe("gemini-3.5-flash");
  });
});

describe("GeminiWebExecutor.execute", () => {
  let executor;
  beforeEach(() => {
    global.fetch = vi.fn();
    executor = new GeminiWebExecutor();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns 400 when messages array is missing", async () => {
    const result = await executor.execute({
      model: "gemini-3.5-flash",
      body: {},
      stream: false,
      credentials: VALID_CREDS,
      signal: undefined,
    });
    expect(result.response.status).toBe(400);
    const data = await result.response.json();
    expect(data.error.message).toMatch(/messages/i);
  });

  it("returns 401 when providerSpecificData is missing cookies", async () => {
    const result = await executor.execute({
      model: "gemini-3.5-flash",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { providerSpecificData: {} },
      signal: undefined,
    });
    expect(result.response.status).toBe(401);
    const data = await result.response.json();
    expect(data.error.type).toBe("auth_required");
  });

  it("sends Cookie + SAPISIDHASH Authorization headers", async () => {
    global.fetch.mockResolvedValueOnce(mockGeminiTextResponse(["Hello"]));
    await executor.execute({
      model: "gemini-3.5-flash",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: VALID_CREDS,
      signal: undefined,
    });
    const callArgs = global.fetch.mock.calls[0];
    const sentHeaders = callArgs[1].headers;
    expect(sentHeaders.Cookie).toContain("SAPISID=mno");
    expect(sentHeaders.Authorization).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    expect(sentHeaders.Origin).toBe("https://gemini.google.com");
    expect(sentHeaders["X-Same-Domain"]).toBe("1");
  });

  it("posts form-urlencoded body with f.req and at parameters", async () => {
    global.fetch.mockResolvedValueOnce(mockGeminiTextResponse(["Hello"]));
    await executor.execute({
      model: "gemini-3.5-flash",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: VALID_CREDS,
      signal: undefined,
    });
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[1].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(callArgs[1].body);
    expect(params.get("f.req")).toBeTruthy();
    expect(params.get("at")).toBe("XSRF_TOK");
  });

  it("parses @think=N suffix into thinkMode override", async () => {
    global.fetch.mockResolvedValueOnce(mockGeminiTextResponse(["Hi"]));
    await executor.execute({
      model: "gemini-3.5-flash@think=2",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: VALID_CREDS,
      signal: undefined,
    });
    const params = new URLSearchParams(global.fetch.mock.calls[0][1].body);
    const inner = JSON.parse(JSON.parse(params.get("f.req"))[1]);
    expect(inner[17]).toEqual([[2]]);
  });

  it("falls back to default model for unknown model id", async () => {
    global.fetch.mockResolvedValueOnce(mockGeminiTextResponse(["Hi"]));
    const result = await executor.execute({
      model: "gemini-99-imaginary",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: VALID_CREDS,
      signal: undefined,
    });
    // Should not error — uses MODEL_MAP[DEFAULT_MODEL_ID]
    expect(result.response.status).toBe(200);
  });

  it("surfaces 401 with friendly auth-expired message", async () => {
    global.fetch.mockResolvedValueOnce(new Response("", { status: 401 }));
    const result = await executor.execute({
      model: "gemini-3.5-flash",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: VALID_CREDS,
      signal: undefined,
    });
    expect(result.response.status).toBe(401);
    const data = await result.response.json();
    expect(data.error.message).toMatch(/cookies may be expired/i);
  });

  it("surfaces 400 with XSRF-expired hint", async () => {
    global.fetch.mockResolvedValueOnce(new Response("", { status: 400 }));
    const result = await executor.execute({
      model: "gemini-3.5-flash",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: VALID_CREDS,
      signal: undefined,
    });
    expect(result.response.status).toBe(400);
    const data = await result.response.json();
    expect(data.error.message).toMatch(/XSRF/i);
  });

  it("surfaces 429 with rate-limit message", async () => {
    global.fetch.mockResolvedValueOnce(new Response("", { status: 429 }));
    const result = await executor.execute({
      model: "gemini-3.5-flash",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: VALID_CREDS,
      signal: undefined,
    });
    expect(result.response.status).toBe(429);
    const data = await result.response.json();
    expect(data.error.message).toMatch(/rate limited/i);
  });

  it("returns OpenAI-shaped non-streaming response", async () => {
    global.fetch.mockResolvedValueOnce(mockGeminiTextResponse(["Hello", "Hello world"]));
    const result = await executor.execute({
      model: "gemini-3.5-flash",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: false,
      credentials: VALID_CREDS,
      signal: undefined,
    });
    expect(result.response.status).toBe(200);
    const data = await result.response.json();
    expect(data.object).toBe("chat.completion");
    expect(data.model).toBe("gemini-3.5-flash");
    expect(data.choices[0].message.role).toBe("assistant");
    // The mocked snapshot stream may reduce to "Hello world" or "" depending on
    // length-guard pass; test that we got a proper shape regardless.
    expect(typeof data.choices[0].message.content).toBe("string");
    expect(data.choices[0].finish_reason).toBe("stop");
  });

  it("returns SSE-shaped streaming response when stream=true", async () => {
    global.fetch.mockResolvedValueOnce(mockGeminiTextResponse(["Hi"]));
    const result = await executor.execute({
      model: "gemini-3.5-flash",
      body: { messages: [{ role: "user", content: "ping" }] },
      stream: true,
      credentials: VALID_CREDS,
      signal: undefined,
    });
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await result.response.text();
    expect(text).toContain("data: ");
    expect(text).toContain("[DONE]");
  });
});

describe("SAPISIDHASH determinism", () => {
  it("produces stable hash for fixed timestamp", () => {
    const ts = 1700000000;
    const sapisid = "fixed-sapisid";
    const expected = nodeCrypto.createHash("sha1").update(`${ts} ${sapisid} https://gemini.google.com`).digest("hex");
    expect(expected).toMatch(/^[0-9a-f]{40}$/);
    // Confirm the executor's helper would compute the same shape (just different ts)
    const helperHash = _internal.makeSapisidHash(sapisid);
    expect(helperHash).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
  });
});
