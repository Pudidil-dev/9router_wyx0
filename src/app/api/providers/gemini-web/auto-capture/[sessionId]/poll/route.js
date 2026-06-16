import { NextResponse } from "next/server";
import { pollGeminiWebAutoCapture } from "@/lib/oauth/services/geminiWebAutoCapture";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { sessionId } = await params;
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
  }
  const status = pollGeminiWebAutoCapture(sessionId);
  return NextResponse.json({ ok: true, ...status });
}
