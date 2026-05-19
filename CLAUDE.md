# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FinançasFácil** — a mobile-first personal finance PWA written as a single `index.html` file (no build step, no framework, no package manager). The UI language is Portuguese (pt-BR).

Deployed at: `https://regisscs-gif.github.io/financas-facil`

## Running / Testing

Open `index.html` directly in a browser. There is no build step, no dev server, no test suite. Changes are immediately visible by refreshing the file in the browser.

## Architecture

### Single-file structure
Everything lives in `index.html`: inline CSS (`<style>`), inline HTML, and inline JavaScript (`<script>`). Sections are marked with banner comments like `// ── SUPABASE CONFIG ──`.

### Backend: Supabase
- **URL/Key** defined at the top of the script (`SUPA_URL`, `SUPA_KEY` — publishable key, not secret).
- **Auth**: Google OAuth via Supabase redirect flow. After redirect, `handleAuthCallback()` reads `access_token` from the URL hash; `checkSession()` restores from `localStorage`.
- **Data storage**: one row per user in the `financas` table. The entire `db` object is stored as a single JSON blob in the `dados` column and fetched/patched via REST.

### In-memory state (`db`)
```
db = {
  lancs[],        // one-off & installment transactions
  fixos[],        // recurring items (versioned by gid + ini/fim month keys)
  ocorrs[],       // per-month overrides/deletions for a fixo occurrence
  cartoes[],      // credit cards (max 2)
  ccLancs[],      // credit card transactions
  ccPagamentos[], // tracked invoice payments (ties back to lancs)
  catsR[],        // income categories
  catsE[],        // expense categories
  cfg,            // { modelo: 'cal'|'custom', diaInicio: number }
  nid, ngid, noid // auto-increment ID counters
}
```

### Month key
`mesKey(m, y)` returns a `"YYYY-MM"` string (e.g. `"2025-05"`). These strings are used as sort keys and identifiers throughout `fixos.ini/fim`, `ocorrs.mk`, and `ccPagamentos.mk`. String comparison on them is intentional and safe.

### Financial cycle model
- **Calendar** (`cfg.modelo === 'cal'`): standard 1st–last day of month.
- **Custom** (`cfg.modelo === 'custom'`, `cfg.diaInicio = N`): cycle for "month M" runs from day N of month M-1 through day N-1 of month M. `getCiclo(m, y)` and `pertenceCiclo(dateStr, m, y)` handle all cycle math.
- **Important split**: `lancsDoMes()` uses `pertence()`, which filters by the `data` field's year+month directly — it does **not** respect the custom cycle. Only fixos go through `pertenceCiclo()`. This means a `lanc` with `data = "2025-04-28"` always belongs to April regardless of cycle config.

### Recurring items (`fixos`) versioning
Each recurring item has a `gid` (group ID). When a fixo is edited, the old version gets `fim` set to the current month key and a new version is inserted with `ini` at the current month. `fixosVigentes(m, y)` resolves the active version per gid for a given month. `ocorrs` records per-month overrides (value/description changes or soft deletes) without breaking the version chain.

### Persistence
`salvar()` schedules `salvarNuvem()` with an 800 ms debounce. `salvarNuvem()` sends a PATCH to Supabase with the full `db` blob. Data is never saved before the user authenticates and the initial load completes (guarded by the `currentUser` check).

### Render cycle
`render()` calls all page-specific render functions. Most data mutations end with `salvar(); render();`. The month navigator (`curM`/`curY`) drives all render functions — no reactive framework, just direct DOM manipulation via `innerHTML`.

### Credit card invoices
Invoice period is calculated from the card's `fecha` (closing day): `periodoFatura(cc, m, y)` returns `{ini, fim}` for month M's billing cycle. `pagarFatura()` creates a corresponding `lanc` entry (expense) and records the payment in `ccPagamentos`.
