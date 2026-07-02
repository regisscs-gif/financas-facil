#!/usr/bin/env node
// Teste de conexão com a Pluggy — zero dependências (usa fetch nativo do Node 18+).
// Valida CLIENT_ID/CLIENT_SECRET e reproduz o fluxo do endpoint /connect-token.
//
// Como rodar (as credenciais ficam só na sua máquina):
//   1. cp pluggy/.env.example pluggy/.env  e preencha CLIENT_ID/CLIENT_SECRET
//   2. node pluggy/test-connection.js
// Ou sem arquivo: CLIENT_ID=... CLIENT_SECRET=... node pluggy/test-connection.js

const fs = require('fs');
const path = require('path');

// Loader mínimo de .env (procura pluggy/.env e ./.env)
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

async function main() {
  loadEnv();
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('✗ Faltam CLIENT_ID e/ou CLIENT_SECRET.');
    console.error('  Crie pluggy/.env (veja pluggy/.env.example) ou exporte as variáveis.');
    process.exit(1);
  }
  console.log('CLIENT_ID detectado: ' + clientId.slice(0, 4) + '…' + clientId.slice(-4));

  // 1) Autenticação → apiKey (valida as credenciais)
  console.log('\n[1/2] POST /auth ...');
  const authRes = await fetch(BASE + '/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!authRes.ok) {
    const t = await authRes.text();
    console.error('✗ /auth falhou: HTTP ' + authRes.status + ' — ' + t);
    process.exit(1);
  }
  const { apiKey } = await authRes.json();
  console.log('✓ Autenticado. apiKey: ' + String(apiKey).slice(0, 8) + '… (' + String(apiKey).length + ' chars)');

  // 2) Connect token (mesmo passo do endpoint /connect-token do exemplo)
  console.log('\n[2/2] POST /connect_token ...');
  const ctRes = await fetch(BASE + '/connect_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ clientUserId: 'teste-conexao' }),
  });
  if (!ctRes.ok) {
    const t = await ctRes.text();
    console.error('✗ /connect_token falhou: HTTP ' + ctRes.status + ' — ' + t);
    process.exit(1);
  }
  const ct = await ctRes.json();
  const token = ct.accessToken || ct.access_token;
  console.log('✓ Connect token gerado: ' + String(token).slice(0, 12) + '…');
  console.log('\n✅ Conexão com a Pluggy OK. Credenciais válidas e fluxo /connect-token funcionando.');
}

main().catch((e) => { console.error('✗ Erro inesperado:', e.message); process.exit(1); });
