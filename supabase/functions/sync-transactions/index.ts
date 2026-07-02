// Supabase Edge Function: sync-transactions
// Dado um itemId (conexão Pluggy), busca contas e transações e devolve ao lab.
// Mantém CLIENT_ID/SECRET no servidor (secrets). Exige JWT (só usuário logado).
//
// Deploy: supabase functions deploy sync-transactions --project-ref <ref>
//
// Entrada (POST JSON): { itemId: string, from?: "YYYY-MM-DD" }
// Saída: { accounts: [...], transactions: [...], counts: {...} }

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

async function pluggyAuth(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) throw new Error(`auth ${res.status}: ${await res.text()}`);
  const { apiKey } = await res.json();
  return apiKey;
}

async function getJson(url: string, apiKey: string): Promise<any> {
  const res = await fetch(url, { headers: { "X-API-KEY": apiKey } });
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${await res.text()}`);
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const clientId = Deno.env.get("PLUGGY_CLIENT_ID") ?? Deno.env.get("CLIENT_ID");
  const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET") ?? Deno.env.get("CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return json({ error: "Credenciais Pluggy não configuradas no servidor." }, 500);
  }

  let itemId = "";
  let from = "";
  try {
    const body = await req.json();
    itemId = String(body?.itemId ?? "");
    from = String(body?.from ?? "");
  } catch (_) { /* ignore */ }
  if (!itemId) return json({ error: "itemId é obrigatório." }, 400);
  if (!from) {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    from = d.toISOString().slice(0, 10);
  }

  try {
    const apiKey = await pluggyAuth(clientId, clientSecret);

    // Contas do item
    const accResp = await getJson(`${PLUGGY_BASE}/accounts?itemId=${encodeURIComponent(itemId)}`, apiKey);
    const accounts = (accResp.results ?? []).map((a: any) => ({
      id: a.id,
      type: a.type,           // BANK | CREDIT
      subtype: a.subtype,
      name: a.name,
      number: a.number,
      balance: a.balance,
      currencyCode: a.currencyCode,
    }));

    // Transações por conta (paginado)
    const transactions: any[] = [];
    for (const acc of accounts) {
      let page = 1;
      let totalPages = 1;
      do {
        const url = `${PLUGGY_BASE}/transactions?accountId=${encodeURIComponent(acc.id)}&from=${from}&pageSize=500&page=${page}`;
        const tResp = await getJson(url, apiKey);
        totalPages = tResp.totalPages ?? 1;
        for (const t of (tResp.results ?? [])) {
          transactions.push({
            id: t.id,
            accountId: acc.id,
            accountType: acc.type,
            date: (t.date || "").slice(0, 10),
            description: t.description,
            descriptionRaw: t.descriptionRaw,
            amount: t.amount,               // valor (Pluggy: negativo = saída, positivo = entrada, p/ conta)
            type: t.type,                   // DEBIT | CREDIT
            category: t.category,
            currencyCode: t.currencyCode,
          });
        }
        page++;
      } while (page <= totalPages && page <= 10); // trava de segurança
    }

    return json({
      accounts,
      transactions,
      counts: { accounts: accounts.length, transactions: transactions.length },
      from,
    });
  } catch (e) {
    return json({ error: "Falha ao sincronizar", detail: String((e as Error).message) }, 502);
  }
});
