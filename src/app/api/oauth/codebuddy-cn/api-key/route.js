import { NextResponse } from "next/server";
import { createProviderConnection, updateProviderConnection } from "@/models";
import { assertProviderEnabled } from "@/lib/providerDisabled";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { buildCodeBuddyCnProviderMetadata } from "open-sse/services/codebuddyCn.js";
import { getUsageForProvider } from "open-sse/services/usage.js";

/**
 * POST /api/oauth/codebuddy-cn/api-key
 *
 * Manually add a CodeBuddy CN connection from a pasted API key — the same
 * credential the OAuth/automation flows mint, but supplied directly. The key is
 * stored as an apikey connection; credit metadata is enriched best-effort via the
 * usage probe (which is also where an invalid key surfaces), so the save never
 * blocks behind the GFW.
 */
export async function POST(request) {
  try {
    await assertProviderEnabled("codebuddy-cn");

    const body = await request.json().catch(() => ({}));
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (!apiKey) {
      return NextResponse.json({ error: "API key is required" }, { status: 400 });
    }

    const providerSpecificData = {
      ...buildCodeBuddyCnProviderMetadata({ apiKey, providerSpecificData: {} }),
      authKind: "api_key",
      addedVia: "manual",
    };

    const connection = await createProviderConnection({
      provider: "codebuddy-cn",
      authType: "apikey",
      apiKey,
      name: name || "CodeBuddy CN (API Key)",
      providerSpecificData,
      testStatus: "active",
      isActive: AI_PROVIDERS["codebuddy-cn"]?.defaultActive !== false,
    });

    // Best-effort credit enrichment (mirrors the automation's defaultSaveConnection).
    try {
      const { resolveConnectionProxyConfig } = await import("@/lib/network/connectionProxy");
      const proxyConfig = await resolveConnectionProxyConfig(providerSpecificData);
      const usage = await getUsageForProvider(
        { ...connection, providerSpecificData },
        {
          connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
          connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
          connectionNoProxy: proxyConfig.connectionNoProxy || "",
          vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
          strictProxy: false,
        }
      );
      if (usage?.providerSpecificDataPatch) {
        await updateProviderConnection(connection.id, {
          providerSpecificData: { ...providerSpecificData, ...usage.providerSpecificDataPatch },
        });
      }
    } catch {
      // Usage refresh is best-effort; the connection is already saved.
    }

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to add CodeBuddy CN API key" },
      { status: error?.status || 500 }
    );
  }
}
