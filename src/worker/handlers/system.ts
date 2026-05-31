import { readPreferences, listAiProviders } from "../db/profile";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Surface server-side configuration that the client needs to know about so it
 * can show setup nudges.
 *
 * Routes:
 *   GET /api/system-status
 */
export async function handleSystemStatusRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const [prefs, providers] = await Promise.all([
    readPreferences(env.DB),
    listAiProviders(env.DB),
  ]);

  return json({
    exaConfigured: !!env.EXA_API_KEY,
    telegramConfigured: !!(env as any).TELEGRAM_BOT_TOKEN,
    vpcTunnelConfigured: !!(env as any).VPC_TUNNEL_URL,
    aiProvidersCount: providers.length,
    telegramWhitelist: (prefs as any).telegram_whitelist || "",
  });
}
