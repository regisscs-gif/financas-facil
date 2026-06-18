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
  fixos[],         // recurring items, versioned by gid + ini/fim month keys
  ocorrs[],        // per-month overrides or soft-deletes for a fixo
  cartoes[],       // credit cards (max 2)
  ccLancs[],       // credit card transactions (titular: 'eu'|'fam')
  ccPagamentos[],  // legacy, unused
  catsR[],         // income categories
  catsE[],         // expense categories
  cfg,             // { modelo: 'cal'|'custom', diaInicio: number }
  cofrinhos[],     // virtual savings jars { id, nome }
  cofrinhoMovs[],  // jar movements { id, cofId, val, desc, data }
  nid, ngid, noid, ncid, nmid  // auto-increment counters — never decrement
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

`periodoFatura(cc, m, y)` computes the billing window for a card's invoice. `gastosCC(ccId, m, y)` returns transactions within that window. `syncFaturas()` rebuilds all `sub='fat'` entries in `db.lancs` — **must be called** after any mutation to `db.ccLancs` or `db.cartoes`.

### Cofrinhos (savings jars)

Saldo is always computed: `cofSaldo(cofId)` sums `cofrinhoMovs` for that jar — never stored directly.

### Desktop layout

At ≥768px, CSS overrides in `@media(min-width:768px)` apply:
- `.nav` becomes a left sidebar (200px).
- `#app-screen` gets `margin-left:200px`.
- `#pg-dash.on` uses `display:flex` with `#dash-col1` (38%, summary cards) and `#dash-col2` (62%, charts in a 2-col sub-grid, first chart full-width).
- All other pages use full content width.
- Mobile layout is completely unaffected.

### Security

`escHtml(s)` — always use when inserting user-sourced strings into `innerHTML`. Escapes `& < > " '`.

### Import system

- **Extrato (XLS/CSV):** auto-detects Itaú vs Santander format. Deduplicates by `csvKey = "data|desc|valor"`. SheetJS loaded on-demand.
- **Fatura CSV:** goes to `ccLancs`, with per-row titular (eu/fam) and installment date adjustment.
- **Fatura PDF:** PDF.js loaded on-demand. Parsers for Santander and Itaú detect installments (`NN/TT` pattern) and auto-create future installment entries.

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
