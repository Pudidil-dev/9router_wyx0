import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createKiroCallbackMonitor } from "../../src/lib/oauth/services/automation/googleOAuth.js";

function createEmitter(overrides = {}) {
  return Object.assign(new EventEmitter(), overrides);
}

describe("Kiro callback monitor", () => {
  it("stops waiting when the automation context closes", async () => {
    const context = createEmitter();
    const page = createEmitter({
      url: () => "https://accounts.google.com/accounts/SetSID",
    });
    const callbackPromise = createKiroCallbackMonitor(context, page, 5_000);

    context.emit("close");

    await expect(callbackPromise).rejects.toThrow("Kiro callback browser closed");
  });

  it("captures the Kiro callback from a failed custom-protocol request", async () => {
    const context = createEmitter();
    const page = createEmitter({ url: () => "https://accounts.google.com/accounts/SetSID" });
    const callbackPromise = createKiroCallbackMonitor(context, page, 5_000);

    page.emit("requestfailed", {
      url: () => "kiro://kiro.kiroAgent/authenticate-success?code=callback-code&state=callback-state",
    });

    await expect(callbackPromise).resolves.toMatchObject({
      code: "callback-code",
      state: "callback-state",
    });
  });

  it("captures callbacks exposed through redirect Location headers", async () => {
    const context = createEmitter();
    const page = createEmitter({ url: () => "https://accounts.google.com/accounts/SetSID" });
    const callbackPromise = createKiroCallbackMonitor(context, page, 5_000);

    page.emit("response", {
      allHeaders: async () => ({
        location: "kiro://kiro.kiroAgent/authenticate-success?code=location-code&state=location-state",
      }),
    });

    await expect(callbackPromise).resolves.toMatchObject({
      code: "location-code",
      state: "location-state",
    });
  });
});
