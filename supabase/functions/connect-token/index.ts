// Supabase Edge Function: connect-token
// Porta o endpoint Flask do exemplo para Deno. Guarda CLIENT_ID/CLIENT_SECRET
// como secrets do projeto (supabase secrets set) — nunca no código nem no browser.
//
// Fluxo: autentica na Pluggy (CLIENT_ID/SECRET → apiKey) e cria um connect token
// que o frontend usa para abrir o Pluggy Connect com segurança.
//
// Deploy:
//   supabase functions deploy connect-token
//   supabase secrets set PLUGGY_CLIENT_ID=... PLUGGY_CLIENT_SECRET=...
//
// A função exige JWT válido do Supabase (o app já loga via Google), então só
// usuários autenticados conseguem gerar tokens.

const PLUGGY_BASE = "https://api.pluggy.ai";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const clientId = Deno.env.get("PLUGGY_CLIENT_ID") ?? Deno.env.get("CLIENT_ID");
  const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET") ?? Deno.env.get("CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return json({ error: "Credenciais Pluggy não configuradas no servidor." }, 500);
  }

  let clientUserId = "financas-user";
  try {
    const body = await req.json();
    if (body && typeof body.clientUserId === "string" && body.clientUserId) {
      clientUserId = body.clientUserId;
    }
  } catch (_) { /* body opcional */ }

  // 1) Autentica na Pluggy → apiKey
  const authRes = await fetch(`${PLUGGY_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!authRes.ok) {
    const detail = await authRes.text();
    return json({ error: "Falha ao autenticar na Pluggy", status: authRes.status, detail }, 502);
  }
  const { apiKey } = await authRes.json();

  // 2) Cria connect token
  const ctRes = await fetch(`${PLUGGY_BASE}/connect_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ clientUserId }),
  });
  if (!ctRes.ok) {
    const detail = await ctRes.text();
    return json({ error: "Falha ao criar connect token", status: ctRes.status, detail }, 502);
  }
  const ct = await ctRes.json();
  const accessToken = ct.accessToken ?? ct.access_token;

  return json({ accessToken });
});
