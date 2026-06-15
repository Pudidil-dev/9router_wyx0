import { getSettings, updateSettings } from "@/lib/localDb";
import { runProxyScrape } from "@/lib/proxyScraper/runScrape";

const MIN_INTERVAL_MINUTES = 5;

const g = global.__proxyScraperScheduler ??= {
  timer: null,
  running: false,
  nextRunAt: null,
  started: false,
  startupRunDone: false,
  lastError: null,
};

function normalizeIntervalMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES) return 60;
  return Math.floor(minutes);
}

function buildRunOptions(settings, overrides = {}) {
  return {
    sourceIds: overrides.sourceIds || settings.proxyScraperSourceIds || ["github", "free-proxy-list"],
    activateImported: overrides.activateImported ?? settings.proxyScraperActivateImported !== false,
    testAfterImport: overrides.testAfterImport ?? settings.proxyScraperTestAfterImport === true,
    limit: overrides.limit || settings.proxyScraperLimit || 100,
    persistLastRun: true,
  };
}

export function getProxyScraperStatus() {
  return {
    running: g.running,
    scheduled: !!g.timer,
    nextRunAt: g.nextRunAt,
    lastError: g.lastError,
  };
}

export async function triggerProxyScraperRun(overrides = {}) {
  if (g.running) {
    throw new Error("Proxy scraper is already running");
  }

  g.running = true;
  g.lastError = null;
  try {
    const settings = await getSettings();
    const result = await runProxyScrape(buildRunOptions(settings, overrides));
    await updateSettings({
      proxyScraperLastRunAt: result.ranAt,
      proxyScraperLastSummary: result.summary,
    });
    return result;
  } catch (error) {
    g.lastError = error.message;
    throw error;
  } finally {
    g.running = false;
  }
}

function clearTimer() {
  if (g.timer) {
    clearInterval(g.timer);
    g.timer = null;
    g.nextRunAt = null;
  }
}

export async function refreshProxyScraperSchedule() {
  const settings = await getSettings();
  clearTimer();

  if (settings.proxyScraperEnabled !== true) {
    g.started = true;
    return getProxyScraperStatus();
  }

  const intervalMinutes = normalizeIntervalMinutes(settings.proxyScraperIntervalMinutes);
  const intervalMs = intervalMinutes * 60 * 1000;

  const scheduleNextRun = () => {
    g.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  };

  scheduleNextRun();
  g.timer = setInterval(() => {
    scheduleNextRun();
    triggerProxyScraperRun().catch((error) => {
      console.log("[ProxyScraper] Scheduled run failed:", error.message);
    });
  }, intervalMs);
  if (g.timer.unref) g.timer.unref();

  if (settings.proxyScraperRunOnStartup === true && !g.startupRunDone) {
    g.startupRunDone = true;
    triggerProxyScraperRun().catch((error) => {
      console.log("[ProxyScraper] Startup run failed:", error.message);
    });
  }

  g.started = true;
  return getProxyScraperStatus();
}

export async function initializeProxyScraperScheduler() {
  if (g.started) return getProxyScraperStatus();
  return refreshProxyScraperSchedule();
}
