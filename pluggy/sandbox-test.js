#!/usr/bin/env node
// Diagnóstico local do fluxo Pluggy SEM widget: cria um item de sandbox
// (Pluggy Bank) via API, espera sincronizar e lê contas + transações.
// Lê credenciais de pluggy/.env (não imprime segredos).
//
//   node pluggy/sandbox-test.js
//
// Objetivo: validar o pipeline e ver o FORMATO REAL das transações p/ o merge.

const fs = require('fs');
const path = require('path');

function loadEnv() {
  for (const p of [path.join(__dirname, '.env'), path.join(process.cwd(), '.env')]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const BASE = 'https://api.pluggy.ai';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, apiKey, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'X-API-KEY': apiKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text}`);
  return json;
}

async function main() {
  loadEnv();
  const clientId = process.env.CLIENT_ID, clientSecret = process.env.CLIENT_SECRET;
  if (!clientId || !clientSecret) { console.error('✗ faltam CLIENT_ID/CLIENT_SECRET em pluggy/.env'); process.exit(1); }

  console.log('[1] auth...');
  const { apiKey } = await api('POST', '/auth', null, { clientId, clientSecret });
  console.log('    ok');

  console.log('[2] procurando conector sandbox "Pluggy Bank"...');
  const conns = await api('GET', '/connectors?sandbox=true&countries=BR', apiKey);
  const list = conns.results || [];
  console.log('    conectores sandbox:', list.map((c) => `${c.id}:${c.name}`).join(', ') || '(nenhum)');
  const pb = list.find((c) => /pluggy bank/i.test(c.name)) || list[0];
  if (!pb) { console.error('✗ nenhum conector sandbox disponível'); process.exit(1); }
  console.log(`    usando connector ${pb.id} (${pb.name}); credenciais:`, (pb.credentials || []).map((x) => x.name).join(', '));

  // Sandbox Pluggy Bank aceita user-ok/password-ok (sucesso). Tenta combos.
  const combos = [ { user: 'user-ok', password: 'password-ok' }, { user: 'user-ok', password: 'user-ok' } ];
  let itemId = null;
  for (const params of combos) {
    console.log(`[3] criando item (connector ${pb.id}, user=${params.user})...`);
    let item = await api('POST', '/items', apiKey, { connectorId: pb.id, parameters: params });
    itemId = item.id;
    console.log('    itemId:', itemId, '| status inicial:', item.status);
    // poll
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      item = await api('GET', `/items/${itemId}`, apiKey);
      process.stdout.write(`    poll ${i + 1}: ${item.status}/${item.executionStatus}\n`);
      if (item.status !== 'UPDATING') break;
    }
    if (item.status === 'UPDATED') break;
    console.log('    → não sincronizou com esse combo (status:', item.status, ')');
    itemId = null;
  }
  if (!itemId) { console.error('✗ não consegui um item UPDATED no sandbox'); process.exit(1); }

  console.log('[4] contas...');
  const accs = (await api('GET', `/accounts?itemId=${itemId}`, apiKey)).results || [];
  accs.forEach((a) => console.log(`    - ${a.type}/${a.subtype} "${a.name}" saldo=${a.balance} ${a.currencyCode} id=${a.id}`));

  console.log('[5] transações via /v2/transactions (cursor)...');
  for (const a of accs) {
    const tx = (await api('GET', `/v2/transactions?accountId=${a.id}`, apiKey));
    const results = tx.results || [];
    console.log(`\n  === Conta ${a.type} "${a.name}" — chaves da resposta: ${Object.keys(tx).join(',')} ===`);
    console.log('    [paginação bruta]:', JSON.stringify(Object.fromEntries(Object.entries(tx).filter(([k])=>k!=='results'))));
    console.log(`    total nesta página: ${results.length}`);
    results.slice(0, 10).forEach((t) => {
      console.log(`    ${(t.date||'').slice(0,10)} | ${t.type} | ${String(t.amount).padStart(10)} | ${t.category || '-'} | ${t.description}`);
    });
    if (results[0]) console.log('    [shape tx bruta]:', JSON.stringify(results[0]));
  }
  console.log('\n✅ pipeline sandbox OK. itemId de teste:', itemId);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
