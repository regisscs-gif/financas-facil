# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FinançasFácil** — responsive personal finance PWA (mobile-first, also works on desktop). Single `index.html` file, no build step, no framework, no package manager. UI language is Portuguese (pt-BR).

Deployed at: `https://regisscs-gif.github.io/financas-facil`

Two users with separate Supabase accounts: **Régis** (Itaú) and **Carla** (Santander). Features must work for both banks.

## Running / Testing

No dev server. Open `index.html` in a browser or use the deployed URL. Validate JS syntax before committing:

```bash
node -e "var fs=require('fs'),m=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*)<\/script>/);try{new Function(m[1]);console.log('✓ ok');}catch(e){console.error(e.message);}"
```

## Versioning & Deploy

- Bump `APP_VERSION` in `index.html` **and** `CACHE` in `sw.js` on every commit (both must match, e.g. `'v80'` / `'ff-v80'`).
- Commit format: `feat(vN): description` or `fix(vN): description`.
- Push to `main` → GitHub Pages serves live in ~1 minute.

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

**`'fam'` exclusion is global**: every dashboard/chart aggregating card spend must filter `titular==='eu'` (the donut, top-10, CC-vs-débito, comprometimento). Past bugs came from forgetting this.

### Plan vs real reconciliation (central concept)

The app holds **planned** items (fixos, avulso parcelas) and **real** debits imported from the bank extrato (`sub='imp'`). Reconciliation avoids double-counting when a real debit pays a planned item.

- **Fixos:** during extrato import, `fixosParaSuprimir` lists active expense fixos; checking one writes a `deleted` ocorr (suppression) and links it to the matching imported debit (`subGid` on the lanç, `sub:true`+`subVal` on the ocorr). The **Comprometimento da renda** chart (`renderProj`) is the canonical reconciler: for each fixo it uses **"realizado quando existe, senão planejado"** — matches a real debit (`av`/`imp`) by category+value within tolerance; if matched the fixo counts at the real value and the debit is excluded from "Variáveis", else it counts at the planned value (so the bar stays filled). Buckets: **Fixos · Parcelas · Variáveis · 💳 Cartão (sub='fat' due this month) · Livre**.
- **Avulso parcelas:** a real payment for an installment is reconciled **in place** — the parcela lanç is marked `pago:true` (+`pagoData`,`obs`) and the imported debit is **absorbed** (not created as a separate lanç), so there is exactly one row and no double-count anywhere. `matchParcelaPendente(desc,val,data,usadas,cat)` matches by **value (~2%/R$1) + month (±1)**; description containment and category only **rank** (boost), they are NOT required — bank descriptions are often opaque (e.g. "PIX TRANSF FOCA" for a "Passeio Caminho da Fé" parcela). At import this match is shown pre-checked per-row (`r.absorver`, toggle `extratoSetAbsorver`). Parcelas are **never deleted** on reconciliation, so `renderParc` progress counts `pago || data<=hoje`.

### Migrations / one-time repairs

Idempotent repair functions run in `init()` after `carregarDados()`, each guarded by a `db.*` flag so they run once per account, then `salvar()`. Pattern: detect → fix in place / create missing → log → toast count. Current ones:
- `reprocessarParcelasFaturaCSV()` (flag `db.migParcCSV`) — backfills future installments for card parcelas imported before replication existed.
- `reconciliarParcelasExistentes()` (flag `db.migReconcParc2`) — links already-imported debits to avulso parcelas (marks `pago`, recreates a missing parcela slot from the debit). Bumping to a new flag name re-runs it after a logic change.

When changing reconciliation logic that should re-apply to existing data, introduce a **new** flag (e.g. `migReconcParc2` → `migReconcParc3`).

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
