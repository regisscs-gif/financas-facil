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

  try {
    const apiKey = await pluggyAuth(clientId, clientSecret);

    // Status do item (diagnóstico: UPDATING/UPDATED/erro)
    let item: any = null;
    try {
      const it = await getJson(`${PLUGGY_BASE}/items/${encodeURIComponent(itemId)}`, apiKey);
      item = {
        id: it.id,
        status: it.status,
        executionStatus: it.executionStatus,
        lastUpdatedAt: it.lastUpdatedAt,
        connector: it.connector?.name,
        error: it.error ?? null,
      };
    } catch (e) {
      item = { error: String((e as Error).message) };
    }

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
      txCount: 0,
    }));

    // Transações por conta — GET /v2/transactions com paginação por cursor.
    // O campo `next` da resposta JÁ é a querystring da próxima página
    // (ex.: "?accountId=X&after=Y"), então é usado direto — não wrapear.
    // Regra de sinal: amount < 0 = saída/despesa; amount > 0 = entrada/receita
    // (o campo `type` é inconsistente em cartão, então NÃO é usado p/ direção).
    // Filtro de data é feito aqui (a v2 não aceita `from`). Como a v2 devolve
    // da mais nova p/ a mais antiga, paramos de paginar ao cruzar o `from`.
    const transactions: any[] = [];
    for (const acc of accounts) {
      let url: string | null = `${PLUGGY_BASE}/v2/transactions?accountId=${encodeURIComponent(acc.id)}`;
      let guard = 0;
      let sawOlder = false;
      while (url && guard < 200) {
        const tResp = await getJson(url, apiKey);
        for (const t of (tResp.results ?? [])) {
          const d = (t.date || "").slice(0, 10);
          if (from && d < from) { sawOlder = true; continue; }
          acc.txCount++;
          const cc = t.creditCardMetadata || null;
          transactions.push({
            id: t.id,
            accountId: acc.id,
            accountType: acc.type,          // BANK | CREDIT
            date: d,
            description: t.description || t.descriptionRaw,
            amount: t.amount,
            category: t.category,
            categoryId: t.categoryId,
            status: t.status,               // POSTED | PENDING
            installment: cc ? { n: cc.installmentNumber, total: cc.totalInstallments } : null,
            currencyCode: t.currencyCode,
          });
        }
        if (from && sawOlder) break; // já passou da data de corte
        const next = tResp.next;
        url = next
          ? (String(next).startsWith("http")
              ? String(next)
              : `${PLUGGY_BASE}/v2/transactions${String(next).startsWith("?") ? next : "?" + next}`)
          : null;
        guard++;
      }
    }

    return json({
      item,
      accounts,
      transactions,
      counts: { accounts: accounts.length, transactions: transactions.length },
    });
  } catch (e) {
    return json({ error: "Falha ao sincronizar", detail: String((e as Error).message) }, 502);
  }
});
