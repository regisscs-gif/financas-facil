# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FinançasFácil** — responsive personal finance PWA (mobile-first, also works on desktop). No build step, no framework, no package manager. UI language is Portuguese (pt-BR).

Deployed at: `https://regisscs-gif.github.io/financas-facil` (GitHub Pages, repo is **public**).

Two users with separate Supabase accounts: **Régis** (Itaú + Nubank) and **Carla** (Santander). Features must work for both banks.

### Repository layout
- **`index.html`** — the **production** app (single-file). As of **v101** it includes the promoted **Pluggy / Open Finance** integration (previously built in `lab.html`).
- **`lab.html`** — parallel copy of `index.html` used as an isolated staging environment (persists to table `financas_lab`, never touches production data). Kept for validating future changes before promotion; scheduled to be retired once production is stable. Still carries LAB-only helpers (Zerar lab, Copiar produção→lab, injeção manual de itemId, `includeSandbox:true`) that must **never** be promoted to `index.html`.
- **`sw.js`** — service worker (production only; `lab.html` registers none). Network-first for the shell, `skipWaiting`+`clients.claim` on update. The `index.html` `controllerchange` listener reloads **only if a controller already existed at page load** (`hadController` guard, v111) — reloading on the first `clients.claim` was what made the app blink/reload ~1-2s after every open.
- **`.github/workflows/pages.yml`** — GitHub Actions workflow that deploys the repo root to GitHub Pages. Replaced the legacy Pages builder (see Versioning & Deploy).
- **`supabase/functions/{connect-token,sync-transactions}/`** — Deno Edge Functions that hold the Pluggy secrets.
- **`pluggy/*.js`** — local Node scripts to test Pluggy without the browser (read `pluggy/.env`, gitignored).
- **`manifest.json`, `icon-*`** — PWA assets. **`DOCUMENTACAO.md`** — long-form pt-BR product doc.

## Running / Testing

No dev server for production. Validate JS syntax before **every** commit (works for `index.html` or `lab.html`):

```bash
node -e "var fs=require('fs'),src=fs.readFileSync('lab.html','utf8'),b=src.split('<script>')[1].split('</script>')[0];try{new Function(b);console.log('✓ ok');}catch(e){console.error(e.message);process.exit(1);}"
```

**Local dev for `lab.html` (fast loop, avoids GitHub Pages latency):** Pages serves with `Cache-Control: max-age=600` (10-min CDN cache) plus a build queue, so the live URL can take ~10 min to update. Instead serve locally:

```bash
python3 -m http.server 8000    # run in the repo root; open http://localhost:8000/lab.html (NOT file://)
```

`lab.html`'s `redirectTo` is dynamic (`window.location.origin + pathname`), so Google login works on localhost **once `http://localhost:8000/lab.html` is added to Supabase → Authentication → Redirect URLs**. **Production `index.html` uses a FIXED `redirectTo`** (the Pages URL), so localhost Google login does not round-trip there — validate `index.html` changes with the headless smoke check below and/or on the deployed URL (`?cb=$(date +%s)` to bust CDN cache).

**Headless smoke check (no login needed)** — catches load-time JS errors and confirms the app shell renders after a `cp`/refactor. Serve locally, then:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --enable-logging=stderr --v=1 --virtual-time-budget=6000 \
  --dump-dom http://localhost:8000/index.html 2>/tmp/c.log >/tmp/dom.html
grep -iE "uncaught|is not defined|is not a function|referenceerror|typeerror" /tmp/c.log \
  | grep -viE "ServiceWorker|financas-facil/sw.js|manifest"   # the SW/manifest 404s are local-only (Pages path prefix)
```

A cross-reference sanity check (every inline `on*` handler maps to a defined function; every `getElementById` id exists) also catches dangling references after edits.

**Deploy an Edge Function** (Supabase CLI; no Docker required):

```bash
supabase functions deploy sync-transactions --project-ref wnllrhszlantunpwozhv
supabase secrets set --env-file supabase/.env   # PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET
```

**Local Pluggy tests** (no browser; read creds from `pluggy/.env`): `node pluggy/test-connection.js` (creds ok), `node pluggy/sandbox-test.js` (create a sandbox item + inspect real account/transaction shapes), `node pluggy/merge-test.js` (candidate/dedup logic).

## Versioning & Deploy

- **Production (`index.html`):** bump `APP_VERSION` in `index.html` **and** `CACHE` in `sw.js` together on every production commit (must match, e.g. `'v111'` / `'ff-v111'`). Commit format `feat(vN):` / `fix(vN):`. Push to `main` → the GitHub Actions workflow deploys in ~30s.
- **Deploy is via GitHub Actions**, not the legacy Pages builder (`build_type: workflow`). The legacy builder hung at dispatch (`duration: 0`, "building" for >1h) and stopped publishing — do NOT diagnose deploys with `gh api .../pages/builds`. Instead: `gh run list --workflow=pages.yml` and `gh run view <id>`. Confirm live: `curl -s "https://regisscs-gif.github.io/financas-facil/index.html?cb=$(date +%s)" | grep APP_VERSION`. Pages CDN cache is ~10min (`max-age=600`) — use `?cb=`/`?v=N` to bust.
- **Lab (`lab.html`):** version is `'v100-lab · build N'` (in `APP_VERSION`, shown in the LAB banner). Bump **build N** on every lab change — it's the only way to confirm a reload picked up new code. Commit format `feat(lab):` / `fix(lab):`. `lab.html` does NOT touch `sw.js` or `index.html`.
- **Production is UNFROZEN as of v101** (Pluggy promoted). Regular production edits to `index.html` / `sw.js` resume the normal bump-both rule above. `lab.html` remains the isolated staging copy for risky changes.
- Docs-only commits (this file) do not bump any version.

## Architecture

### Single-file layout (`index.html`)

```
<style>   — all CSS inline, ending with @media(min-width:768px) desktop overrides
<body>    — login screen, app screen (header + pages + modals + nav)
<script>  — sections separated by // ── BANNER ── comments:
  SUPABASE CONFIG · SEGURANÇA · LOG · SUPABASE AUTH · SUPABASE DATA
  DADOS · CICLO FINANCEIRO · CONFIGURAÇÕES · UI · LANÇAMENTOS · FIXOS
  CARTÕES · IMPORT CSV · IMPORT EXTRATO · IMPORT FATURA PDF · RENDER
  COFRINHOS · INIT
```

### Backend: Supabase

- Credentials: `SUPA_URL`, `SUPA_KEY` at the top of the script.
- One row per user in the `financas` table. Entire `db` object stored as JSON in the `dados` column.
- Always use `authHeaders()` for REST calls — it refreshes the access token before every request.

### In-memory state (`db`)

```
db = {
  lancs[],         // avulso/parcelado/importado transactions (sub: 'av'|'pa'|'fat'|'imp')
                   //   sub='pa' parcela: pn/pt/pid/total; reconciled adds pago/pagoData/obs
                   //   sub='imp' linked to a substituted fixo carries subGid
  fixos[],         // recurring items, versioned by gid + ini/fim month keys
  ocorrs[],        // per-month overrides or soft-deletes for a fixo
                   //   import-substitution adds sub:true + subVal to the deleted ocorr
  cartoes[],       // credit cards (max 2)
  ccLancs[],       // credit card transactions (titular: 'eu'|'fam')
  ccPagamentos[],  // legacy, unused
  catsR[],         // income categories
  catsE[],         // expense categories
  cfg,             // { modelo: 'cal'|'custom', diaInicio: number }
  cofrinhos[],     // virtual savings jars { id, nome }
  cofrinhoMovs[],  // jar movements { id, cofId, val, desc, data }
  nid, ngid, noid, ncid, nmid, // auto-increment counters — never decrement
  migParcCSV, migReconcParc2   // one-time migration guards (see Migrations)
}
```

### Persistence

`salvar()` debounces `salvarNuvem()` by 800ms. Guard: `if (!currentUser || !accessToken) return` — never saves before auth + initial load.

### Render cycle

`render()` calls all page renderers on every navigation and mutation. Direct DOM via `innerHTML` — no reactive framework. Always call `render()` after mutating `db`.

### Financial cycle

- **Calendar** (`cfg.modelo === 'cal'`): 1st–last day of month.
- **Custom** (`cfg.diaInicio = N`): month M = day N of M-1 through day N-1 of M.
- `pertenceCiclo(dataStr, m, y)` uses **string comparison** — do NOT switch to Date comparison (midnight vs noon breaks the last day).
- `lancsDoMes()` is cycle-aware. `fixosVigentes()` is NOT — fixos always appear by calendar month. This is intentional.

### Recurring items (`fixos`) versioning

Each item has a `gid`. Editing creates a new version (`ini = current mesKey`, closes old with `fim = current mesKey`). `fixosVigentes(m, y)` returns the active version per gid with `ocorrs` applied on top.

### Credit card invoices

`periodoFatura(cc, m, y)` computes the billing window for a card's invoice. `gastosCC(ccId, m, y)` returns transactions within that window. `totalFaturaEu(ccId, m, y)` sums only `titular==='eu'` (family/`'fam'` spending is "a reembolsar" and never counts as the user's expense). `syncFaturas()` rebuilds all `sub='fat'` entries in `db.lancs` using `totalFaturaEu` — **must be called** after any mutation to `db.ccLancs` or `db.cartoes`. Each `sub='fat'` lanç carries `ccId` + `ccMk` (billing `mesKey`); tapping it in the Lançamentos list expands an inline drill-down (`toggleFatura`/`drillFaturaHTML`, state `faturaExp`) listing that invoice's purchases.

**Invoice assignment is date-based, with a `fatMk` override (v107).** A ccLanc normally belongs to whichever invoice window (`periodoFatura`) its `data` falls in. But a purchase made before a card's closing that *posts late* appears on the **next** PDF invoice with an earlier date — the date model can't place it there. So a ccLanc may carry an optional `fatMk` (billing `mesKey`): when set, both `gastosCC` and `syncFaturas` **force** it into that invoice, bypassing the date window. Only the invoice-reconciliation "Adicionar" (`confAddFaltante`) sets it today.

**`'fam'` exclusion is global**: every dashboard/chart aggregating card spend must filter `titular==='eu'` (the donut, top-10, CC-vs-débito, comprometimento). Past bugs came from forgetting this.

### Invoice reconciliation (Conferência da fatura)

`conferirFaturaPDF()` re-parses a card's PDF fatura in "conferência" mode (`conferindoFatura=true`, so the fatura parsers skip their cross-source dedup and yield the raw list) and `conferirFaturaDiff()` diffs it against `gastosCC` for the current invoice. `renderConfDiff()` shows two lists: **⬇ Na fatura, faltando no site** and **⬆ No site, não está na fatura**. Matching is a multiset consume: first pass by normalized-desc + value (`dkNorm`), then a **2nd pass matches leftover parcelas by value + `pn/pt` ignoring the description** (v106) — bank descriptions drift between the PDF and predicted/Pluggy parcelas, so a parcela's identity is value + installment number. Each "faltando" row has an editable **category select** and an **Eu/Família toggle** (v108); `confAddFaltante(i)` creates the ccLanc with the chosen `cat`/`titular` and stamps `fatMk` = the invoice being reconciled (so late-posted purchases land in this invoice, not the one their date implies). `confDelSobrando(id)` removes an extra site lanç. Both call `syncFaturas()`+`salvar()`+re-render.

### Plan vs real reconciliation (central concept)

The app holds **planned** items (fixos, avulso parcelas) and **real** debits imported from the bank extrato (`sub='imp'`). Reconciliation avoids double-counting when a real debit pays a planned item.

- **Fixos:** during extrato import, `fixosParaSuprimir` lists active expense fixos; checking one writes a `deleted` ocorr (suppression) and links it to the matching imported debit (`subGid` on the lanç, `sub:true`+`subVal` on the ocorr). The **Comprometimento da renda** chart (`renderProj`) is the canonical reconciler: for each fixo it uses **"realizado quando existe, senão planejado"** — matches a real debit (`av`/`imp`) by category+value within tolerance; if matched the fixo counts at the real value and the debit is excluded from "Variáveis", else it counts at the planned value (so the bar stays filled). Buckets: **Fixos · Parcelas · Variáveis · 💳 Cartão (sub='fat' due this month) · Livre**.
- **Avulso parcelas:** a real payment for an installment is reconciled **in place** — the parcela lanç is marked `pago:true` (+`pagoData`,`obs`) and the imported debit is **absorbed** (not created as a separate lanç), so there is exactly one row and no double-count anywhere. `matchParcelaPendente(desc,val,data,usadas,cat)` matches by **value (~2%/R$1) + month (±1)**; description containment and category only **rank** (boost), they are NOT required — bank descriptions are often opaque (e.g. "PIX TRANSF FOCA" for a "Passeio Caminho da Fé" parcela). At import this match is shown pre-checked per-row (`r.absorver`, toggle `extratoSetAbsorver`). Parcelas are **never deleted** on reconciliation, so `renderParc` progress counts `pago || data<=hoje`.

### Migrations / one-time repairs

Idempotent repair functions run in `init()` after `carregarDados()`, each guarded by a `db.*` flag so they run once per account, then `salvar()`. Pattern: detect → fix in place / create missing → log → toast count. Current ones:
- `reprocessarParcelasFaturaCSV()` (flag `db.migParcCSV`) — backfills future installments for card parcelas imported before replication existed.
- `reconciliarParcelasExistentes()` (flag `db.migReconcParc2`) — links already-imported debits to avulso parcelas (marks `pago`, recreates a missing parcela slot from the debit). Bumping to a new flag name re-runs it after a logic change.

When changing reconciliation logic that should re-apply to existing data, introduce a **new** flag (e.g. `migReconcParc2` → `migReconcParc3`).

### Evolução (12 meses, com drill-down, v119)

Page `pg-evo` (nav 📈 "Evol.", `renderEvolucao()`). Bar chart of the last 12 financial cycles ending at `curM/curY` (window recomputed from the header month nav; `evoMesSel` clamps to the newest cycle if it falls outside). Filters: **tipo** (Despesa/Receita, `evoTipo`) and **categoria** (`evoCat`, includes orphans via `revFiltroCatOpts`). `evoRegistros(m,y,t)` is the per-cycle source — `db.lancs` (except `sub='fat'`) + `db.ccLancs` (`titular==='eu'`, expense only) matched by `pertenceCiclo` — so no double-count and card 'fam' excluded (invariants 1 & 8). Hand-built inline **SVG line chart** (no chart lib, v120): polyline over 12 points, value label (`fmtK`) at each dot, subtle area fill, dashed 12-month average line; selected dot enlarged/outlined; per-column transparent `<rect>` overlays are the tap targets → `setEvoMes(mk)`. Below the chart, a **drill-down** lists the individual lançamentos composing the selected month (desc, cat, origin 🏦/💳, date, value) — not just the total — plus a 12-month average. FAB hidden on this page.

### Revisar (recategorização consolidada, v114)

Page `pg-rev` (nav 🏷️ "Revisar", `renderRevisar()`). Unifies account (`db.lancs`, excluding `sub='fat'` aggregates) and card (`db.ccLancs`) transactions of the current cycle (`pertenceCiclo`) into one flat list, with filters by **tipo** (receita/despesa — the "filtro por tipo de categoria"), **categoria**, and **origem** (conta/cartão). Each row has an inline category `<select>` → `recatRow(origem,id,novaCat)`: writes `cat` back to the right array; for `sub='pa'` it recategorizes the **whole series** (all rows sharing `pid`); card edits call `syncFaturas()` before `salvar()`. Read-only aggregation view — no create/delete here.

### Gerenciar categorias — renomear/excluir (v116–v118)

Config → Categorias lists each category as a **full-width tappable row** (`.catrow`, emoji + name + chevron) — not tiny pills — so mobile has one big touch target per item and no destructive button to mis-tap (v118 usability fix; the old ✏️/× chips were cramped). Tapping a row opens `#ov-editcat`, a **single modal with two panes**:

- **Edit pane** (`#editcat-pane`, default): name input + Salvar + a red "🗑 Excluir categoria" button + Cancelar. `editCat(t,i)` fills it and shows a usage hint (`contarCatUso`). `confirmarEditCat()` renames: validates (non-empty, not a duplicate of the same tipo — no merge), rewrites the name in `catsR`/`catsE` and calls `reescreverCat(t,antigo,novo)`.
- **Delete pane** (`#delcat-pane`): reached via `editcatIrExcluir()` (swaps panes in place — no second modal, so no z-index stacking). Shows how many records use it and a **required reassignment** `<select>` of other same-tipo categories. `confirmarDelCat()` moves everything via `reescreverCat` then splices the name out. "Voltar" (`editcatVoltar`) returns to the edit pane. Zero usage → simple confirm (no select). No other category of that tipo → blocked (create one first).

`reescreverCat(t,antigo,novo)` is the shared rewrite over all months/sources: `db.lancs` (except `sub='fat'`, whose `cat` is the hardcoded 'Cartão de Crédito' regenerated by `syncFaturas`), `db.ccLancs` (only when `t==='e'`), `db.fixos`, and non-deleted override `db.ocorrs` (the edit override at ~line 1139 carries `cat`+`tipo`). So renaming and delete-with-reassign never leave orphans. Note `emo(cat)` is name-based, so renaming can change the displayed emoji. Existing orphans (pre-v116) are still handled read-side by the Revisar screen ("(removida)").

### Cofrinhos (savings jars)

Saldo is always computed: `cofSaldo(cofId)` sums `cofrinhoMovs` for that jar — never stored directly.

### Desktop layout

At ≥768px, CSS overrides in `@media(min-width:768px)` apply:
- `.nav` becomes a left sidebar (200px).
- `#app-screen` gets `margin-left:200px`.
- `#pg-dash.on` uses `display:flex` with `#dash-col1` and `#dash-col2` both `flex:1 1 0` (50/50), each a flex column with `gap:10px`.
- `#dash-col1` always holds 3 fixed summary elements (saldo card, `.row2`, `#d-cc-card`) at the top. The chart cards are distributed across both columns by `balanceDash()`.
- `balanceDash()` distribution is **deterministic** (no height measurement, no `requestAnimationFrame`): it appends the charts in a fixed `ORDER` list by id — even indices → `#dash-col2`, odd → `#dash-col1`. This keeps the layout identical across reloads. Re-runs on window resize (debounced 150ms). To change the chart layout, edit the `ORDER` array / parity.
- All other pages use full content width.
- Mobile layout is completely unaffected (`balanceDash()` is a no-op when `window.innerWidth < 768`).

### Security

`escHtml(s)` — always use when inserting user-sourced strings into `innerHTML`. Escapes `& < > " '`.

### Import system

- **Extrato (XLS/CSV):** auto-detects Itaú vs Santander → `db.lancs` as `sub='imp'`. Dedup by `csvKey = "data|desc|valor"`. SheetJS loaded on-demand. Also runs fixo suppression and avulso-parcela auto-reconciliation (see reconciliation section).
- **Fatura CSV/XLSX (`mostrarPreviewCSV` / `parsearFaturaXLSX`):** → `db.ccLancs`, per-row titular (Titular→`eu`, Adicional/etc→`fam`). Detects installments and **replicates future parcelas** (`sub='pa'` + `pn`/`pt`/`pid`), same as PDF. XLSX dates arrive as `dd/mm/yyyy` and values as `R$ 1,234.56` (US-style: comma=thousands, dot=decimal). Installment dedup uses **identity** `ccParcKey(l)` (cartão§descBase§valor§n/t), robust to predicted future dates — **each fatura parser must build its own `existingParc` map** (a missing declaration here caused a hard crash on import).
- **Fatura PDF:** PDF.js loaded on-demand. Parsers for Santander and Itaú detect installments (`NN/TT`) and auto-create future installment entries.

### External CDN libraries (SRI gotcha)

axios + Supabase load at the top with `integrity` (SRI). **Do not use jsDelivr `*.min.js` paths with SRI** — jsDelivr re-minifies on the fly (Terser version bumps change the bytes → hash mismatch → browser blocks the script → `supa` undefined → blank login that does nothing). Use the package's own immutable file (e.g. `dist/umd/supabase.js`, not `.min.js`) and compute its hash with `curl -s URL | openssl dgst -sha512 -binary | openssl base64 -A`. cdnjs serves files as-is (stable). On-demand libs (SheetJS, PDF.js) are loaded without SRI.

### Utilities

- `mesKey(m, y)` → `"YYYY-MM"` (m is 0-based)
- `avanca(y, m1, d, j)` — m1 is **1-based** (Janeiro = 1)
- `fmtK(v)` — compact formatter, defined **inside** `renderProj()` (local scope only)
- `varTag(cur, prev, inv)` — MoM % tag; `inv=true` means lower is better (expenses)

### Log system

`log(action, data)` writes to `localStorage` (`ff_log`, max 300 entries). When diagnosing bugs, ask the user to copy from Config → Log de atividade → "Copiar log completo".

### Backup (v102)

Config → 💾 Backup: `exportarBackup()` downloads the whole in-memory `db` as JSON (`financas-backup-<email>-<date>.json`); `restaurarBackup(input)` reads a JSON file, validates it looks like a `db` (has `lancs[]`), confirms, then `db = Object.assign({}, db, parsed)` (merges over defaults, same as `carregarDados`) and persists. Each user backs up their own account.

## Pluggy / Open Finance (promoted to production in v101)

Automatic bank sync (Open Finance aggregator). Replaces manual extrato/fatura import for connected accounts. **Built and tested in `lab.html`, promoted to `index.html` in v101.** `lab.html` stays as the staging copy for future changes; the LAB-only helpers there (Zerar lab / Copiar produção→lab / injeção manual de itemId / `includeSandbox:true`) are stripped from production `index.html` (which uses `includeSandbox:false`).

**Secrets never reach the browser** (repo is public). Flow: `browser → Supabase Edge Function (holds Pluggy secrets) → Pluggy API`.
- `connect-token` — `auth → connect_token`; opens the Pluggy Connect widget (SDK pinned `cdn.pluggy.ai/pluggy-connect/v2.11.0`).
- `sync-transactions` — body `{itemId, from?, accountsOnly?, accountIds?}` → returns `{item, accounts, transactions}`. `accountsOnly` skips transactions (for the config screen); `accountIds` limits which accounts' transactions are fetched. Both functions require a valid Supabase user JWT.

**Pluggy gotchas (verified via `pluggy/*.js`):**
- `/transactions` is **deprecated (410)** → use `GET /v2/transactions`. Response `{results, next}` where `next` is already the next-page querystring (`?accountId=…&after=…`) — append it directly; do NOT wrap as `&cursor=`. v2 rejects `pageSize`/`from`/`to` (filter dates client-side; stop paginating once older than `from`).
- **Direction = sign of `amount`** for BANK accounts (negative=expense, positive=income). On CREDIT the sign is **inconsistent** (sandbox negative, real positive) — treat every card tx as an expense EXCEPT payments/refunds detected by keyword. The `type` (DEBIT/CREDIT) field is unreliable.
- One Pluggy **item = one bank**; an item can return multiple **accounts** (Itaú returns corrente + poupança). Bank name = `item.connector.name`.
- Sandbox: use connector **"Pluggy Bank"** (id 2, creds `user-ok`/`password-ok`) for reliable data; "MeuPluggy" items sometimes 404 `ITEM_NOT_FOUND`.

**`db` fields (lab):**
- `pluggyItems[]` (item ids) · `pluggyItemNames{itemId:nome}` (bank name per connection, editable) · `pluggySeen{plId:true}` (consumed tx ids, e.g. collapsed installment members).
- `pluggyLastSync` ('YYYY-MM-DD', v103) — watermark of the last successful sync; the "trazer a partir de" field defaults to `syncFromDefault()` (= last-sync date minus a buffer, or hoje−90d on first sync), so `from` re-reads the retroactive window between sessions. **The watermark advances only when the triage is *completed* in `confirmarMergeSync`, never at fetch time in `sincronizarBanco` (v105 fix)** — otherwise cancelling a preview and re-syncing would move `from` to today and silently drop older, never-triaged transactions. **`pluggyLastSync` stays the *true* last-sync date (the "Última sincronização" hint must not lie); the retroactive buffer is applied only at read time in `syncFromDefault()` (v112).** The Open Finance aggregator sometimes back-dates transactions it adds *after* a sync, so `from` = `pluggyLastSync` − `syncBufferDias()` days catches them; re-widening the window is safe (imported tx dedup by `plId`, rejected ones live in `pluggyIgnored`), so nothing needs re-marking. `pluggyBufferDias` (v113) — the buffer in days, editable in Config → 🔗 Bancos ("Recuo automático da janela"), clamped 0–90, default `SYNC_BUFFER_PADRAO=10` when unset (0 = no recuo). `onSyncBuffer()` persists it and re-fills the date field + hint live. `pluggyIgnored{plId:{desc,val,data,target}}` (v103; metadata added v104, back-compat with old `{plId:true}`) — tx the user chose NOT to import; merged into the preview's `existing` set so they never re-appear. Rejected (unchecked) candidates at `confirmarMergeSync` are recorded here. Managed via **Config → 🚫 Registros ignorados** (`abrirIgnorados`/`renderIgnorados`, modal `#ov-ignorados`): per-item `restaurarIgnorado(plId)` + `restaurarTodosIgnorados()`; the in-preview `reabilitarIgnorados()` clears all at once.
- `pluggyAccs{plAccId:{itemId,tipo,name,nome,incluir,ccId,configurado}}` — **import config, single source of truth**: BANK `incluir`; CREDIT `ccId` = app card id | `'new'` | `'ignore'`. Sync only imports accounts with `configurado` (require-config-before-import).
- `contas[{id,nome,plAccId,itemId}]` — bank-account registry (mirrors `cartoes`); imported bank lançamentos get `contaId`; the Lançamentos page filters by conta (chips).
- Imported records carry `plId` (stable Pluggy tx id) for dedup.

**Flow:** config (`abrirConfigImport`/`salvarConfigImport`, the single settings screen for connection names + which accounts to import + card de→para) → `sincronizarBanco` (gates on config, passes `accountIds`) → `buildSyncCandidates` (BANK→`db.lancs` sub='imp' with `contaId`; CREDIT→`db.ccLancs`; **installments collapsed** into one candidate — strip trailing `N/N` from the desc — that **replicates the full series** at merge) → `mostrarPreviewSync` (compact one-line rows, per-bank grouping, editable category, Eu/Família toggle, fixo suppression) → `confirmarMergeSync`.

**Dedup layers:** (a) Pluggy×Pluggy by `plId`/`pluggySeen`; (b) Pluggy×existing by **date+value** (`syncDVKey` — names differ across sources) → pre-unchecked "possível duplicata"; (c) installments by `ccParcKey` (date-independent). The PDF/CSV fatura importers (`parsearFaturaItau/Santander`) also dedup **cross-source** so re-importing a fatura for a Pluggy-managed card doesn't duplicate: parcela by `ccParcKey` (hard skip), non-parcela by value+normalized-desc on the same card (soft "dup?").

## Critical invariants — do not break

1. `pertenceCiclo` must use string comparison, not Date.
2. Call `syncFaturas()` after every mutation to `ccLancs` or `cartoes`.
3. `salvar()` guard (`if (!currentUser || !accessToken) return`) must stay.
4. Auto-increment counters (`nid`, etc.) never decrement.
5. `avanca()` takes 1-based month (`m1`); JS `Date` constructor takes 0-based.
6. Modal z-index hierarchy: `.ov` = 100, `#ov-cof-cad`/`#ov-cof-mov` = 110, `#ov-confirm` = 120. Never close a modal to make room for another — raise z-index instead.
7. `escHtml()` on all user-sourced strings inserted via `innerHTML`.
8. Filter `titular==='eu'` everywhere card spend is aggregated for the user (`'fam'` is reimbursable, never the user's expense).
9. Each fatura parser must declare its own `existingParc` (parcela identity dedup) — a missing one throws and is caught as a generic "Erro ao ler o arquivo".
10. Reconciliation must not double-count: a reconciled avulso parcela is `pago` and absorbs its imported debit (one row); never create both. Parcelas are never deleted on reconciliation.
11. Top-level SRI must point at immutable CDN files, never jsDelivr-minified `.min.js` (see External CDN libraries).
12. Migration/repair functions are idempotent and guarded by a `db.mig*` flag; to re-apply after a logic change, use a new flag name.
13. **Pluggy now lives in production `index.html` (v101).** Use `lab.html` only as staging for risky changes; it persists to `financas_lab` (never point it at `financas`) and keeps LAB-only helpers that must never reach production. When promoting lab→prod again, strip the LAB scaffolding (banner, `financas_lab`, dynamic `redirectTo`, Zerar/Copiar/itemId helpers, `includeSandbox:true`) and re-add the service-worker registration.
14. Pluggy secrets live only in Edge Function env (Supabase secrets), never in `index.html`/`lab.html`/git. Anything under `pluggy/.env` / `supabase/.env` is gitignored — keep it that way (public repo).
15. Pluggy dedup uses `plId` (Pluggy×Pluggy) + date/value + `ccParcKey` for installments; card transaction direction comes from keyword detection, not the `amount` sign or `type` field (both unreliable on CREDIT).
