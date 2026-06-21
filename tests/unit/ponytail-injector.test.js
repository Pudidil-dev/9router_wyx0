import { describe, it, expect } from "vitest";
import { injectPonytail } from "open-sse/rtk/ponytail.js";
import { FORMATS } from "open-sse/translator/formats.js";

describe("ponytail injector", () => {
  it("injects into OpenAI-style messages", () => {
    const body = {
      messages: [{ role: "user", content: "build date picker" }],
    };

    injectPonytail(body, FORMATS.OPENAI, "full");

    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("laziest competent senior engineer");
  });

  it("appends to Responses API instructions", () => {
    const body = { instructions: "Existing instruction" };

    injectPonytail(body, FORMATS.OPENAI_RESPONSES, "lite");

    expect(body.instructions).toContain("Existing instruction");
    expect(body.instructions).toContain("smallest reasonable implementation");
  });

  it("injects into Claude cached system array before cache_control block", () => {
    const body = {
      system: [
        { type: "text", text: "Existing" },
        { type: "text", text: "Cached", cache_control: { type: "ephemeral" } },
      ],
    };

    injectPonytail(body, FORMATS.CLAUDE, "ultra");

    expect(body.system[1].text).toContain("Delete need before adding implementation");
    expect(body.system[2].cache_control).toBeTruthy();
  });
});
