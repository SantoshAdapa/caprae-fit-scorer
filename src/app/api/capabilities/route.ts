export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const allowlistOnly = process.env.ALLOWED_DOMAINS_ONLY === "true";

  return Response.json({
    llm: false,
    persistence: false,
    allowlistOnly,
  });
}
