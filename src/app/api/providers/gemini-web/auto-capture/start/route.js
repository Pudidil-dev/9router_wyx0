import { NextResponse } from "next/server";
import { startGeminiWebAutoCapture } from "@/lib/oauth/services/geminiWebAutoCapture";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}

  try {
    const { sessionId } = await startGeminiWebAutoCapture({ browser: body?.browser });
    return NextResponse.json({ ok: true, sessionId });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to start auto-capture" },
      { status: 500 }
    );
  }
}
