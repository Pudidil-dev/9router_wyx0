import { describe, expect, it } from "vitest";
import { OneMinAIExecutor, __testables, wrapOneMinSSE } from "../../open-sse/executors/one-min-ai.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS, getModelsByProviderId } from "../../open-sse/config/providerModels.js";

function streamFromText(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("OneMinAIExecutor", () => {
  it("registers 1min-ai provider alias and models", () => {
    expect(getExecutor("1min-ai")).toBeInstanceOf(OneMinAIExecutor);
    expect(PROVIDER_ID_TO_ALIAS["1min-ai"]).toBe("1min");
    expect(PROVIDER_MODELS["1min"].some((model) => model.id === "gpt-4o-mini")).toBe(true);
    expect(getModelsByProviderId("1min-ai").some((model) => model.id === "gpt-4o-mini")).toBe(true);
  });

  it("translates OpenAI messages to the 1min chat API payload", () => {
    const body = __testables.buildOneMinBody("gpt-4o-mini", {
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
    });

    expect(body).toEqual({
      type: "UNIFY_CHAT_WITH_AI",
      model: "gpt-4o-mini",
      promptObject: {
        prompt: "SYSTEM: Be concise.\n\nHello",
      },
    });
  });

  it("uses generated API key and 1min unified chat streaming endpoint", () => {
    const executor = new OneMinAIExecutor();
    const credentials = {
      accessToken: "one-min-web-token",
      apiKey: "one-min-api-key",
      providerSpecificData: { teamId: "team-123" },
    };
    const headers = executor.buildHeaders(credentials, true);
    const body = executor.transformRequest("gpt-4o-mini", {
      messages: [{ role: "user", content: "Ping" }],
    });

    expect(executor.buildUrl("gpt-4o-mini", true, credentials)).toBe("https://api.1min.ai/api/chat-with-ai?isStreaming=true");
    expect(headers["X-Auth-Token"]).toBe("Bearer one-min-web-token");
    expect(headers["API-KEY"]).toBe("one-min-api-key");
    expect(body).toMatchObject({
      type: "UNIFY_CHAT_WITH_AI",
      model: "gpt-4o-mini",
    });
  });

  it("wraps 1min content events as OpenAI SSE chunks", async () => {
    const upstream = new Response(streamFromText([
      "event: content",
      "data: {\"content\":\"hello\"}",
      "",
      "event: done",
      "data: {\"message\":\"done\"}",
      "",
    ].join("\n")), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const wrapped = wrapOneMinSSE(upstream, "gpt-4o-mini");
    const text = await wrapped.text();

    expect(text).toContain("\"object\":\"chat.completion.chunk\"");
    expect(text).toContain("\"content\":\"hello\"");
    expect(text).toContain("data: [DONE]");
  });
});
