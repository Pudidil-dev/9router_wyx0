let initialized = false;
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build"
  || process.env.NEXT_PHASE === "phase-export"
  || process.env.NEXT_PHASE === "phase-static";

export async function ensureOutboundProxyInitialized() {
  if (isBuildPhase || initialized) return initialized;

  try {
    const [{ getSettings }, { applyOutboundProxyEnv }] = await Promise.all([
      import("../localDb.js"),
      import("./outboundProxy.js"),
    ]);
    const settings = await getSettings();
    applyOutboundProxyEnv(settings);
    initialized = true;
  } catch (error) {
    console.error("[ServerInit] Error initializing outbound proxy:", error);
  }

  return initialized;
}

// Defer init so HTTP server accepts connections first
if (!isBuildPhase) {
  setImmediate(() => {
    ensureOutboundProxyInitialized().catch(console.log);
  });
}

export default ensureOutboundProxyInitialized;
