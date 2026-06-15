import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { runProxyScrape } from "@/lib/proxyScraper/runScrape";
import { getProxyScraperStatus, triggerProxyScraperRun } from "@/shared/services/proxyScraperScheduler";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_SOURCES = new Set(["all", "github", "free-proxy-list"]);

function normalizeBody(body = {}) {
  const sourceIds = Array.isArray(body.sourceIds)
    ? body.sourceIds.filter((id) => VALID_SOURCES.has(id))
    : ["github", "free-proxy-list"];

  if (sourceIds.length === 0) {
    return { error: "Select at least one proxy source" };
  }

  const limit = Number(body.limit || 100);
  if (!Number.isFinite(limit) || limit <= 0) {
    return { error: "Limit must be a positive number" };
  }

  return {
    sourceIds,
    activateImported: body.activateImported !== false,
    testAfterImport: body.testAfterImport === true,
    limit: Math.min(Math.floor(limit), 1000),
    target: typeof body.target === "string" ? body.target : "us",
  };
}

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      status: getProxyScraperStatus(),
      settings: {
        proxyScraperEnabled: settings.proxyScraperEnabled === true,
        proxyScraperRunOnStartup: settings.proxyScraperRunOnStartup === true,
        proxyScraperIntervalMinutes: settings.proxyScraperIntervalMinutes,
        proxyScraperSourceIds: settings.proxyScraperSourceIds,
        proxyScraperActivateImported: settings.proxyScraperActivateImported,
        proxyScraperTestAfterImport: settings.proxyScraperTestAfterImport,
        proxyScraperLastRunAt: settings.proxyScraperLastRunAt,
        proxyScraperLastSummary: settings.proxyScraperLastSummary,
      },
    });
  } catch (error) {
    console.log("Error getting proxy scraper status:", error);
    return NextResponse.json({ error: "Failed to get proxy scraper status" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const normalized = normalizeBody(body);

    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const useScheduler = body.useScheduler === true;
    const result = useScheduler
      ? await triggerProxyScraperRun(normalized)
      : await runProxyScrape({ ...normalized, persistLastRun: true });

    return NextResponse.json({
      ok: result.ok !== false,
      summary: result.summary,
      errors: result.errors || [],
      ranAt: result.ranAt,
    });
  } catch (error) {
    console.log("Error scraping proxies:", error);
    return NextResponse.json({ error: error.message || "Failed to scrape proxies" }, { status: 500 });
  }
}
