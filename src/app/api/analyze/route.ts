import { handleAnalyze } from "@/lib/analyzeHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  return handleAnalyze(req);
}
