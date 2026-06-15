import { mergeProxyPool, updateSettings } from "@/lib/localDb";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { normalizeScrapedProxy } from "./normalize.js";
import { scrapeProxySources } from "./sources.js";

const DEFAULT_SOURCE_IDS = ["github", "free-proxy-list"];
const DEFAULT_PROTOCOLS = ["http", "https", "socks4", "socks5"];
const MAX_LIMIT = 1000;
const TEST_CONCURRENCY = 25;
const TEST_TIMEOUT_MS = 5000;

function normalizeSourceIds(sourceIds) {
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) return DEFAULT_SOURCE_IDS;
  if (sourceIds.includes("all")) return DEFAULT_SOURCE_IDS;
  return sourceIds.filter((id) => DEFAULT_SOURCE_IDS.includes(id));
}

function toPositiveLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return 100;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

async function testNormalizedCandidates(candidates, limit, summary, errors) {
  const alive = [];
  const queue = [...candidates];

  const worker = async () => {
    while (queue.length > 0 && alive.length < limit) {
      const item = queue.shift();
      if (!item) break;

      const result = await testProxyUrl({
        proxyUrl: item.pool.proxyUrl,
        testUrl: "http://httpbin.org/ip",
        timeoutMs: TEST_TIMEOUT_MS,
      });

      if (result.ok) {
        alive.push({
          ...item,
          pool: {
            ...item.pool,
            testStatus: "active",
            lastTestedAt: new Date().toISOString(),
            lastError: null,
            lastResponseMs: result.elapsedMs || null,
          },
        });
      } else {
        summary.skippedDead += 1;
        errors.push({
          sourceId: item.pool.sourceId,
          proxy: item.pool.proxyUrl,
          error: result.error || `Proxy test failed with status ${result.status}`,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(TEST_CONCURRENCY, queue.length) }, worker));
  return alive.slice(0, limit);
}

export async function runProxyScrape(options = {}) {
  const sourceIds = normalizeSourceIds(options.sourceIds);
  const limit = toPositiveLimit(options.limit);
  const activateImported = options.activateImported !== false;
  const scrapedAt = new Date().toISOString();

  const summary = {
    fetched: 0,
    normalized: 0,
    created: 0,
    merged: 0,
    skippedUnsupported: 0,
    skippedInvalid: 0,
    skippedDead: 0,
    failed: 0,
  };

  if (sourceIds.length === 0) {
    return { ok: false, summary, errors: [{ error: "No valid sources selected" }] };
  }

  const { candidates, errors } = await scrapeProxySources({
    sourceIds,
    protocols: DEFAULT_PROTOCOLS,
    target: options.target || "us",
  });

  summary.fetched = candidates.length;
  summary.failed = errors.length;

  const seen = new Set();
  const normalizedCandidates = [];
  const importedPools = [];

  for (const candidate of candidates) {
    const normalized = normalizeScrapedProxy(candidate, { activateImported, scrapedAt });
    if (normalized.skipped) {
      if (normalized.reason === "unsupported_protocol") summary.skippedUnsupported += 1;
      else summary.skippedInvalid += 1;
      continue;
    }

    const key = `${normalized.pool.type}:${normalized.pool.proxyUrl}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedCandidates.push(normalized);
  }

  const shouldTestBeforeSave = options.testAfterImport !== false;
  const candidatesToSave = shouldTestBeforeSave
    ? await testNormalizedCandidates(normalizedCandidates, limit, summary, errors)
    : normalizedCandidates.slice(0, limit);

  summary.normalized = candidatesToSave.length;

  for (const normalized of candidatesToSave) {
    try {
      const { pool, action } = await mergeProxyPool(normalized.pool);
      if (action === "merged") summary.merged += 1;
      else summary.created += 1;
      if (pool) importedPools.push(pool);
    } catch (error) {
      summary.failed += 1;
      errors.push({ sourceId: normalized.pool.sourceId, proxy: normalized.pool.proxyUrl, error: error.message });
    }
  }

  const result = {
    ok: true,
    summary,
    importedPools,
    errors,
    ranAt: scrapedAt,
  };

  if (options.persistLastRun === true) {
    await updateSettings({
      proxyScraperLastRunAt: scrapedAt,
      proxyScraperLastSummary: summary,
    });
  }

  return result;
}
