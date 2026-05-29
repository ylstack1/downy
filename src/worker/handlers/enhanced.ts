import {
  listAiProviders,
  createAiProvider,
  updateAiProvider,
  deleteAiProvider,
  listSessions,
  createSession,
  deleteSession,
  writePreference,
  getAiProvider,
  getTelegramChat,
  setTelegramChat,
  readPreferences,
} from "../db/profile";
import { getAgentStub } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function sendTelegramMessage(env: Cloudflare.Env, chatId: string, text: string) {
  const token = (env as any).TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function handleEnhancedRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  
  // Provider Management
  if (url.pathname === "/api/providers") {
    if (request.method === "GET") {
      const providers = await listAiProviders(env.DB);
      return json({ providers });
    }
    if (request.method === "POST") {
      const body: any = await request.json();
      const provider = await createAiProvider(env.DB, {
        id: crypto.randomUUID(),
        ...body
      });
      return json({ provider });
    }
  }
  
  if (url.pathname.startsWith("/api/providers/")) {
    const id = url.pathname.split("/").pop()!;
    if (request.method === "PUT") {
      const body = await request.json();
      await updateAiProvider(env.DB, id, body as any);
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await deleteAiProvider(env.DB, id);
      return json({ ok: true });
    }
    if (url.pathname.endsWith("/fetch-models") && request.method === "POST") {
      const provider = await getAiProvider(env.DB, id);
      if (!provider) return json({ error: "Provider not found" }, 404);
      // Implementation of fetch models would query the provider API
      return json({ models: ["gpt-4o", "gpt-4-turbo", "claude-3-5-sonnet-latest"] });
    }
  }

  // Session Management
  const sessionMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/sessions$/);
  if (sessionMatch) {
    const slug = sessionMatch[1];
    if (request.method === "GET") {
      const sessions = await listSessions(env.DB, slug);
      return json({ sessions });
    }
    if (request.method === "POST") {
      const body: any = await request.json();
      const session = await createSession(env.DB, {
        id: crypto.randomUUID(),
        agentSlug: slug,
        title: body.title || "New Chat",
      });
      return json({ session });
    }
  }

  if (url.pathname.startsWith("/api/sessions/")) {
    const id = url.pathname.split("/").pop()!;
    if (request.method === "DELETE") {
      await deleteSession(env.DB, id);
      return json({ ok: true });
    }
  }

  // Telegram Webhook
  if (url.pathname === "/api/telegram/webhook" && request.method === "POST") {
    const update: any = await request.json();
    if (update.message) {
      const chatId = String(update.message.chat.id);
      const text = update.message.text || "";

      // Check whitelist
      const prefs = await readPreferences(env.DB);
      const whitelist = (prefs as any).telegram_whitelist?.split(",") || [];
      if (whitelist.length > 0 && !whitelist.includes(chatId)) {
        console.warn(`Telegram message from non-whitelisted chat: ${chatId}`);
        return json({ ok: true });
      }

      if (text === "/start") {
        await sendTelegramMessage(env, chatId, "Welcome! Please link this chat to an agent session in the Web UI, or use /link <agent-slug>.");
        return json({ ok: true });
      }
      
      if (text.startsWith("/link ")) {
        const slug = text.split(" ")[1];
        if (slug) {
          const session = await createSession(env.DB, {
            id: crypto.randomUUID(),
            agentSlug: slug,
            title: `Telegram Chat (${chatId})`,
          });
          await setTelegramChat(env.DB, chatId, slug, session.id);
          await sendTelegramMessage(env, chatId, `Linked to agent ${slug}.`);
        }
        return json({ ok: true });
      }

      const mapping = await getTelegramChat(env.DB, chatId);
      if (mapping) {
        const stub = await getAgentStub(env, `${mapping.agentSlug}:${mapping.sessionId}`);
        
        if (text === "/help") {
          const skills = await stub.listAgentSkills();
          const helpText = "Available skills:\n" + skills.map(s => `/${s.name} - ${s.description}`).join("\n");
          await sendTelegramMessage(env, chatId, helpText);
        } else if (text.startsWith("/")) {
          // Could implement custom commands based on skills
          await stub.saveMessages([{
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text }],
            metadata: { telegram: true, chatId }
          }]);
        } else {
          await stub.saveMessages([{
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text }],
            metadata: { telegram: true, chatId }
          }]);
        }
      } else {
        await sendTelegramMessage(env, chatId, "This chat is not linked to any agent. Use /link <agent-slug> to link.");
      }
      return json({ ok: true });
    }
  }

  return json({ error: "Not found" }, 404);
}
