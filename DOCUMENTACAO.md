# FinançasFácil — Documentação Técnica Completa

**Versão atual:** v76  
**Deploy:** https://regisscs-gif.github.io/financas-facil  
**Repositório:** GitHub Pages — branch `main` serve direto em produção  

---

## 1. Visão Geral

Aplicativo PWA (Progressive Web App) mobile-first de controle financeiro pessoal. Todo o código está em **um único arquivo `index.html`** — sem build step, sem framework, sem package manager. O backend é o Supabase (banco de dados e autenticação).

**Usuários:**
- **Régis** — banco Itaú, conta Supabase principal
- **Carla** (esposa) — banco Santander, conta Supabase separada (`carlamotta.alcantara@gmail.com`)

Cada usuário tem seus dados completamente isolados. Não há dados compartilhados.

---

## 2. Estrutura de Arquivos

```
financas-facil/
├── index.html       ← TODO o app (CSS + HTML + JS inline)
├── sw.js            ← Service Worker (cache/offline)
├── manifest.json    ← Manifesto PWA (nome, ícones, display)
├── icon.svg         ← Ícone SVG (fallback)
├── icon-192.png     ← Ícone PNG para Android/Chrome
├── icon-512.png     ← Ícone PNG para Android/Chrome
└── CLAUDE.md        ← Instruções para o Claude Code
```

---

## 3. Stack Tecnológica

### Dependências externas (CDN — sem instalação local)

| Biblioteca | Versão | Uso |
|---|---|---|
| [Supabase JS](https://supabase.com/docs/reference/javascript) | 2.106.2 | Auth + banco de dados |
| [Axios](https://axios-http.com/) | 1.6.2 | Requisições HTTP à API REST do Supabase |
| [SheetJS (XLSX)](https://shejsf.io/) | 0.18.5 | Leitura de arquivos XLS/XLSX (carregado on-demand) |
| [PDF.js](https://mozilla.github.io/pdf.js/) | 3.11.174 | Leitura de PDF de faturas (carregado on-demand) |

SheetJS e PDF.js são carregados dinamicamente apenas quando o usuário abre um arquivo desses formatos (economiza ~2MB de download em uso normal).

---

## 4. Estrutura do `index.html`

O arquivo está dividido em seções delimitadas por comentários banner (`// ── SEÇÃO ──`):

```
<head>
  Dependências CDN (Supabase, Axios)
  <style> ... CSS inline (todo o sistema de estilos) ... </style>
</head>
<body>
  Toast global (#toast)
  #login-screen     ← Tela de login (Google OAuth)
  #app-screen       ← App principal (oculto até autenticar)
    Header (.hdr)   ← Logo + navegação de mês + botão de usuário
    Pages           ← Uma <div.page> por aba (dash, lanc, fix, parc, cc, cfg)
    FAB + Nav       ← Botão flutuante + barra de navegação inferior
    Modais (.ov)    ← Todos os modais de edição (fixos, lançamentos, cartões, etc.)

  <script>
    // ── SUPABASE CONFIG ──     Credenciais e init do cliente
    // ── SEGURANÇA ──           escHtml() — sanitização de HTML
    // ── LOG ──                 Sistema de log em localStorage
    // ── SUPABASE AUTH ──       loginGoogle, checkSession, logout
    // ── SUPABASE DATA ──       authHeaders, carregarDados, salvarNuvem, salvar
    // ── DADOS ──               var db (estado em memória), constantes, EMO map
    // ── CICLO FINANCEIRO ──    getCiclo, pertenceCiclo, prevCiclo, nextCiclo
    // ── CONFIGURAÇÕES ──       fixosVigentes, periodoFatura, gastosCC, syncFaturas
    // ── UI ──                  toast, nav, FAB, swipe, modais utilitários
    // ── LANÇAMENTOS ──         CRUD de db.lancs
    // ── FIXOS ──               CRUD de db.fixos + ocorrs
    // ── CARTÕES ──             CRUD de db.cartoes + ccLancs
    // ── IMPORT CSV ──          Parser e preview de CSV de cartão
    // ── IMPORT EXTRATO ──      Parser XLS/CSV de conta corrente (Itaú + Santander)
    // ── IMPORT FATURA PDF ──   Parser PDF de fatura (Itaú + Santander)
    // ── RENDER ──              render(), renderDash, renderLancs, renderFixos, etc.
    // ── COFRINHOS ──           CRUD de cofrinhos e movimentos
    // ── INIT ──                init(), iniciarDados(), service worker
  </script>
</body>
```

---

## 5. Modelo de Dados (`db`)

O objeto `db` é o **estado completo do app**. É carregado do Supabase na inicialização e salvo de volta como JSON toda vez que há uma mutação.

```javascript
var db = {
  // Lançamentos avulsos e parcelados (conta corrente)
  lancs: [
    {
      id: Number,          // ID único (auto-incremento via db.nid)
      desc: String,        // Descrição
      val: Number,         // Valor absoluto (sempre positivo)
      data: String,        // "YYYY-MM-DD"
      cat: String,         // Categoria (deve existir em catsR ou catsE)
      tipo: 'r' | 'e',    // Receita ou Despesa
      sub: 'av' | 'pa' | 'fat' | 'imp',  // Avulso / Parcelado / Fatura-CC (auto) / Importado
      // Campos extras para sub='pa' (parcelado):
      pid: Number,         // ID do grupo de parcelas
      pn: Number,          // Número da parcela atual (1-based)
      pt: Number,          // Total de parcelas
      total: Number,       // Valor total da compra parcelada
      // Campos extras para sub='fat' (fatura automática de CC):
      ccId: Number,        // ID do cartão
      ccMk: String,        // Mês-key da fatura ("YYYY-MM")
      // Campo de dedup para sub='imp' (importado):
      csvKey: String,      // "data|desc|valor" — chave de deduplicação
    }
  ],

  // Itens recorrentes mensais
  fixos: [
    {
      id: Number,          // ID único
      gid: Number,         // ID do grupo (mesmo gid = mesmo item em versões diferentes)
      desc: String,
      val: Number,
      dia: Number,         // Dia do mês de referência (ex: 5 = dia 5)
      cat: String,
      tipo: 'r' | 'e',
      ini: String,         // Mês-key de início ("YYYY-MM")
      fim: String | null,  // Mês-key de encerramento (null = ainda ativo)
    }
  ],

  // Overrides por mês para itens fixos (edição pontual ou exclusão)
  ocorrs: [
    {
      id: Number,
      gid: Number,         // gid do fixo ao qual esta ocorrência se refere
      mk: String,          // Mês-key afetado ("YYYY-MM")
      desc: String,
      val: Number,
      dia: Number,
      cat: String,
      tipo: 'r' | 'e',
      deleted: Boolean,    // true = suprimido neste mês
    }
  ],

  // Cartões de crédito (máx. 2)
  cartoes: [
    {
      id: Number,
      nome: String,        // Ex: "Nubank"
      limite: Number,      // Limite do cartão em R$
      fecha: Number,       // Dia de fechamento (31 = último dia do mês)
      vence: Number,       // Dia de vencimento (31 = último dia do mês)
    }
  ],

  // Lançamentos de cartão de crédito
  ccLancs: [
    {
      id: Number,
      ccId: Number,        // ID do cartão
      desc: String,
      val: Number,         // Valor da parcela (não o total)
      data: String,        // "YYYY-MM-DD" — data da compra
      cat: String,
      titular: 'eu' | 'fam',  // Quem fez a compra
      sub: 'av' | 'pa',   // Avulso ou Parcelado
      // Campos extras para sub='pa':
      pid: Number,
      pn: Number,
      pt: Number,
      parcTotal: Number,   // Total de parcelas (duplica pt — legado)
      // Campo de dedup de importação:
      csvKey: String,
    }
  ],

  // Pagamentos de fatura rastreados (legado — não usado ativamente)
  ccPagamentos: [],

  // Categorias de receita (array de strings, ordenado alfabeticamente)
  catsR: ['Salário', 'Freelance', 'Investimentos', 'Outros'],

  // Categorias de despesa (array de strings, ordenado alfabeticamente)
  catsE: ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Vestuário', 'Outros'],

  // Configuração do ciclo financeiro
  cfg: {
    modelo: 'cal' | 'custom',  // Mês calendário ou ciclo personalizado
    diaInicio: Number,          // Dia de início (relevante só se modelo='custom')
  },

  // Cofrinhos (poupanças virtuais)
  cofrinhos: [
    { id: Number, nome: String }
  ],

  // Movimentos dos cofrinhos
  cofrinhoMovs: [
    {
      id: Number,
      cofId: Number,       // ID do cofrinho
      val: Number,         // Positivo = entrada, negativo = saída
      desc: String,
      data: String,        // "YYYY-MM-DD"
    }
  ],

  // Contadores de auto-incremento
  nid: Number,   // Próximo ID para lancs, cartoes, ccLancs
  ngid: Number,  // Próximo gid para fixos
  noid: Number,  // Próximo ID para ocorrs
  ncid: Number,  // Próximo ID para cofrinhos
  nmid: Number,  // Próximo ID para cofrinhoMovs
}
```

### Regra crítica: IDs nunca devem ser reusados

Os contadores `nid`, `ngid`, `noid`, `ncid`, `nmid` são incrementados ao criar cada item e nunca decrementados. Apagar um item não "devolve" seu ID.

---

## 6. Autenticação

### Fluxo de Login

1. Usuário clica "Entrar com Google"
2. `loginGoogle()` chama `supa.auth.signInWithOAuth()` → redireciona para o Google
3. Google redireciona de volta para `https://regisscs-gif.github.io/financas-facil` com tokens na URL
4. Supabase JS trata o callback PKCE automaticamente
5. `init()` chama `checkSession()` que chama `supa.auth.getSession()` — se encontrar sessão válida, o app é iniciado

### `authHeaders()`

**Sempre use esta função** para fazer chamadas à API do Supabase. Ela:
- Chama `supa.auth.getSession()` para renovar o token se necessário
- Atualiza as variáveis globais `accessToken` e `currentUser`
- Retorna o objeto de headers com `Authorization` e `apikey`

```javascript
async function authHeaders() {
  var { data: { session } } = await supa.auth.getSession();
  if (session) { accessToken = session.access_token; currentUser = session.user; }
  return { Authorization: 'Bearer ' + accessToken, 'apikey': SUPA_KEY, 'Content-Type': 'application/json' };
}
```

### Banco de Dados Supabase

- Tabela: `financas`
- Colunas relevantes: `user_id` (UUID do Google), `dados` (JSON com o `db` inteiro), `updated_at`
- O `db` inteiro é salvo em uma única linha por usuário
- Row Level Security (RLS) garante que cada usuário só acessa sua própria linha

---

## 7. Persistência

### `salvar()`

```javascript
function salvar() {
  if (!currentUser || !accessToken) return; // guarda: nunca salva antes de carregar
  clearTimeout(saveTimer);
  saveTimer = setTimeout(salvarNuvem, 800); // debounce de 800ms
}
```

Chame `salvar()` toda vez que `db` for mutado. O debounce agrupa múltiplas mutações rápidas em uma única chamada de rede.

### `salvarNuvem()`

Faz `PATCH` em `/rest/v1/financas?user_id=eq.{id}` com o `db` atual serializado. Exibe o indicador de salvamento (ponto verde animado no header).

### `carregarDados()`

Faz `GET` na mesma tabela, faz merge com `Object.assign({}, db, dadosRemoto)`. Tenta 2 vezes em caso de falha (espera 1,5s entre tentativas).

---

## 8. Sistema de Ciclo Financeiro

### Dois modos

**Calendário (`cfg.modelo === 'cal'`):** ciclo = 1º ao último dia do mês.

**Personalizado (`cfg.modelo === 'custom'`, `cfg.diaInicio = N`):** ciclo do "mês M" vai do dia N do mês M-1 até o dia N-1 do mês M.  
Exemplo: `diaInicio = 25`, mês de Maio = 25/Abr a 24/Mai.

### Funções principais

```javascript
// Retorna {ini: Date, fim: Date} para o ciclo m/y
function getCiclo(m, y) { ... }

// Verifica se uma data string "YYYY-MM-DD" pertence ao ciclo m/y
// CRÍTICO: usa comparação de strings, NÃO comparação de Date
// A comparação de Date excluiria incorretamente o último dia (midnight vs noon)
function pertenceCiclo(dataStr, m, y) {
  var c = getCiclo(m, y);
  var iniStr = ..., fimStr = ...;
  return dataStr >= iniStr && dataStr <= fimStr;
}

// Aplica o ciclo correto ao abrir o app (pode avançar um mês se hoje pertence ao próximo ciclo)
function ajustarCicloInicial() { ... }
```

### Variáveis de navegação

```javascript
var curM = new Date().getMonth(); // 0-11
var curY = new Date().getFullYear();
```

`prevCiclo()` e `nextCiclo()` alteram `curM`/`curY` e chamam `render()`.

### Importante: fixos vs lançamentos

- `lancsDoMes(m, y)` usa `pertenceCiclo()` no modo custom — respeitam o ciclo
- `fixosVigentes(m, y)` usa comparação de mês-key string — **não é cycle-aware** — sempre aparecem para o mês calendário
- Isso é intencional: fixos são configurados por mês, não por ciclo

---

## 9. Itens Fixos (Recorrentes)

### Modelo de versionamento por `gid`

Cada item fixo tem um `gid` (group ID). Editar um fixo **não altera** o registro existente — cria uma nova versão com `ini = mesKey atual` e fecha a versão anterior com `fim = mesKey atual`.

Isso preserva o histórico: se você mudou o valor do aluguel em Junho, os meses anteriores continuam com o valor antigo.

```
fixos = [
  { gid: 1, desc: "Aluguel", val: 1500, ini: "2024-01", fim: "2025-06" },
  { gid: 1, desc: "Aluguel", val: 1700, ini: "2025-06", fim: null },
]
```

### `fixosVigentes(m, y)`

Resolve qual versão de cada gid está ativa em m/y. Aplica overrides de `ocorrs` por cima. Retorna array de itens com os dados efetivos para aquele mês.

```javascript
function fixosVigentes(m, y) {
  var mk = mesKey(m, y), base = {};
  // Seleciona a versão mais recente de cada gid que cobre mk
  db.fixos.forEach(function(f) {
    if (f.ini <= mk && (f.fim === null || f.fim > mk)) {
      if (!base[f.gid] || f.ini > base[f.gid].ini) base[f.gid] = f;
    }
  });
  // Aplica ocorrs (overrides por mês)
  var result = [];
  Object.keys(base).forEach(function(gid) {
    var f = base[gid];
    var ov = db.ocorrs.find(function(o) { return o.gid === +gid && o.mk === mk; });
    if (ov) {
      if (!ov.deleted) result.push({ ...dados do ov... });
    } else {
      result.push({ ...dados do f... });
    }
  });
  return result;
}
```

### `ocorrs` — overrides por mês

Permite editar ou excluir um fixo em um mês específico sem afetar outros meses:
- `deleted: false` + dados alterados = valor/descrição diferente neste mês
- `deleted: true` = item suprimido neste mês (não aparece)

---

## 10. Cartões de Crédito

### Período de Fatura

```javascript
function periodoFatura(cc, m, y) {
  // Fatura do mês M fecha no dia cc.fecha do mês M
  // Início: dia cc.fecha + 1 do mês M-1
  // Fim: dia cc.fecha do mês M (às 23:59:59)
  var dF = cc.fecha || 10;
  var lastFim = new Date(y, m + 1, 0).getDate();   // último dia do mês M
  var lastIni = new Date(y, m, 0).getDate();        // último dia do mês M-1
  var dFim = Math.min(dF, lastFim);
  var dIni = Math.min(dF, lastIni) + 1;
  return { ini: new Date(y, m - 1, dIni), fim: new Date(y, m, dFim, 23, 59, 59) };
}
```

Exemplo: cartão fecha dia 10 → fatura de Junho = 11/Mai a 10/Jun.

Dia 31 é automaticamente clampado para o último dia real do mês (`Math.min(dF, lastDay)`).

### `gastosCC(ccId, m, y)`

Retorna todos os `ccLancs` que pertencem à fatura do mês m/y para o cartão ccId. Usa `periodoFatura()` e compara datas com `new Date(l.data+'T12:00:00')` (meio-dia para evitar problemas de fuso horário).

### `syncFaturas()`

**Função crítica.** Deve ser chamada sempre que `ccLancs` ou `cartoes` for alterado.

1. Remove todos os lançamentos `sub='fat'` de `db.lancs`
2. Recalcula quais faturas de quais meses têm gastos (`titular='eu'`)
3. Cria um lançamento automático de despesa (`sub='fat'`) com vencimento no dia `cc.vence` do mês seguinte ao fechamento

Isso é o que faz as faturas de cartão aparecerem como despesas na aba de Lançamentos e nos cálculos financeiros.

### Titular

Cada `ccLanc` tem `titular: 'eu' | 'fam'`:
- `'eu'` = gasto próprio, entra na fatura calculada e nos totais
- `'fam'` = gasto de familiar (ex: cartão adicional da Carla), não entra no total da fatura mas é exibido separadamente como "a reembolsar"

---

## 11. Resumos Financeiros

### `somaR(m, y)` e `somaE(m, y)`

Somam receitas/despesas do mês, incluindo lançamentos avulsos/parcelados/importados E fixos vigentes. Excluem lançamentos `sub='fat'` do total de despesas (as faturas de CC já estão nos gastos diretos via `ccLancs`).

```javascript
function somaR(m, y) {
  var r = lancsDoMes(m, y).filter(l => l.tipo === 'r').reduce(...);
  r += fixosVigentes(m, y).filter(f => f.tipo === 'r').reduce(...);
  return r;
}
```

---

## 12. Sistema de Import

### 12.1 Import de Extrato de Conta Corrente (XLS/CSV)

**Formatos suportados:** XLS/XLSX (via SheetJS), CSV (separado por vírgula ou ponto-vírgula)

**Bancos suportados:**
- **Itaú:** colunas `Data | Descrição | _ | Valor` (valor positivo = receita, negativo = despesa)
- **Santander:** colunas `Data | Descrição | _ | _ | Crédito | Débito` (colunas separadas para C/D)

**Detecção automática de banco:** `detectarBancoExtrato(rows)` procura "Crédito" na coluna 4 para Santander, "valor" na coluna 3 para Itaú.

**Fluxo:**
1. Usuário abre Import Selector, escolhe arquivo de conta corrente
2. Se XLS: carrega SheetJS on-demand, converte para array de arrays
3. `parsearLinhasExtrato()` → detecta banco → chama parser específico
4. Exibe preview com checkboxes, categorias editáveis, titular (EU/FAM)
5. Deduplicação: `csvKey = "data|desc|valor"` — duplicatas exatas são ignoradas; possíveis duplicatas (mesma data+valor, desc diferente) são desmarcadas mas visíveis
6. Seção de fixos para suprimir: mostra fixos vigentes nos meses do extrato para o usuário marcar os que já estão no extrato (evita duplicação)
7. `confirmarImportExtrato()`: cria lançamentos com `sub='imp'` e, se marcados, cria `ocorrs` deletando os fixos

### 12.2 Import de Fatura CSV (Cartão)

**Formato:** `Data,Descrição,Valor` — exportado pela operadora

**Fluxo similar ao extrato**, porém:
- Os lançamentos vão para `db.ccLancs`, não `db.lancs`
- Tem campo "Titular" por linha (EU/FAM)
- `ajustarDataParcela()`: detecta sufixo `I2/12` na descrição e avança a data proporcionalmente

### 12.3 Import de Fatura PDF

**Formatos suportados:**
- Fatura PDF Santander (senha = CPF sem pontos)
- Fatura PDF Itaú (senha = CPF sem pontos)

**Fluxo:**
1. Usuário seleciona PDF → modal pede senha + seleciona cartão
2. `carregarPDFJS()` carrega pdfjs-dist on-demand
3. `lerPDFFatura()`: extrai texto por página, agrupa por linha Y (corrige o problema do PDF.js que insere espaços entre caracteres)
4. `detectarBancoPDF()`: procura "Itaú" nas primeiras 40 linhas
5. Parser específico por banco:

**Santander:** `parsearFaturaSantander()`
- Procura seção "Detalhamento da Fatura"
- Cada linha: `DD/MM DESCRIÇÃO [NN/TT] VALOR` — regex detecta parcelamento `NN/TT`
- Data de parcelas = dia 10 do mês de fatura (`billingDate()`)
- `inferYear()`: meses ≤ billingMonth = billingYear, caso contrário billingYear-1

**Itaú:** `parsearFaturaItau()`
- Procura seção "Lançamentos: compras e saques" (normalizado sem espaços para tolerar "Lan ç amentos")
- Para em "Compras parceladas"
- Regex: `(\d{2})\/(\d{2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})`

**Parcelamentos detectados nos PDFs:**
- Santander: `NN/TT` logo antes do valor na linha
- Itaú: último `NN/TT` encontrado na descrição
- Se `TT > 1`: é parcelado → cria entrada principal + `futureDates` para parcelas futuras
- Parcelas futuras são inseridas em `ccLancs` com `billingDate(k)` para meses k=1...(TT-PN)

---

## 13. Sistema de Renderização

### `render()`

```javascript
function render() {
  document.getElementById('mlabel').textContent = getCicloLabel(curM, curY);
  renderDash(); renderLancs(); renderFixos(); renderParc(); renderCCs(); renderProj(); renderCofrinhos();
}
```

Chamada em toda navegação e mutação de dados. Reescreve o innerHTML de todos os containers. Não há virtual DOM — é DOM direto.

### `renderDash()`

Dashboard principal. Calcula saldo/receitas/despesas do mês atual e anterior, mostra:
- Card de saldo (verde se positivo, vermelho se negativo) + tag % MoM
- Cards de receitas e despesas + tag % MoM + valor do mês anterior
- Card de cartões (se houver cartões): barra de progresso por cartão, % do limite, valor família

### `varTag(cur, prev, inv)`

Helper de tag de variação MoM:
- `cur`: valor atual, `prev`: valor anterior
- `inv = true`: "menor é melhor" (despesas) — ↑ é ruim (vermelho), ↓ é bom (verde)
- `inv = false`: "maior é melhor" (receitas, saldo) — ↑ é bom (verde), ↓ é ruim (vermelho)
- Retorna string HTML `<span>↑X%</span>` ou `''` se `prev === 0`

### `renderProj()` — Projeção (5 gráficos)

Todos renderizados como HTML/CSS puro, sem canvas:

1. **Receita vs Despesa (próx. 6 meses):** barras horizontais segmentadas por categoria de receita / por tipo de despesa (débito + cartão)
2. **Donut por categoria (mês atual):** `conic-gradient` CSS — cada fatia é um segmento angular
3. **Comprometimento da renda:** barra segmentada (Fixos / Parcelas / Variáveis / Livre)
4. **Top 10 despesas:** barras relativas ao maior gasto
5. **CC vs Débito por categoria:** barras duplas (vermelho = débito, roxo claro = cartão)

O donut inclui tag `varTag` por categoria comparando com o mês anterior (`catMapP`).

`fmtK(v)` — formatador compacto para gráficos: `1234 → +1.2k`, `-500 → -500`.

### `escHtml(s)`

**Sempre use para inserir strings do usuário em HTML.** Escapa `& < > " '`. Previne XSS.

```javascript
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')...; }
```

---

## 14. Sistema de Modais (Overlays)

### Estrutura HTML

```html
<div class="ov" id="ov-xxx">      ← Overlay escuro (oculto por default)
  <div class="mod">               ← Container do modal (bottom sheet)
    ...conteúdo...
  </div>
</div>
```

### Abrir/Fechar

```javascript
document.getElementById('ov-xxx').classList.add('on');    // Abre
fechar('ov-xxx');                                          // Fecha (remove .on)
```

### Hierarquia Z-Index (CRÍTICO)

```css
.ov                { z-index: 100 }  /* Base: todos os overlays */
#ov-cof-cad,
#ov-cof-mov        { z-index: 110 }  /* Cofrinhos: acima do detalhe */
#ov-confirm        { z-index: 120 }  /* Confirmação: acima de tudo */
```

**Regra:** nunca feche um modal para "dar espaço" a outro. Use z-index maior. O modal de confirmação precisa aparecer sobre qualquer outro modal aberto.

### Modal de Confirmação

```javascript
confirmar(mensagem, callbackOk, labelBtn2, callbackOk2)
```

Suporta até 2 ações (ex: "Remover só esta" e "Remover todas as parcelas"). `callbackOk2` e `labelBtn2` são opcionais.

---

## 15. Sistema de Log

Logs são armazenados em `localStorage` (chave `ff_log`), máximo 300 entradas, TTL de 90 dias.

```javascript
log('nome_da_acao', { dados: opcionais });  // ação normal
logError('nomeDaFuncao', errorObject);       // erro capturado
```

Convenções de nomenclatura:
- `lanc_add`, `lanc_edit`, `lanc_del`
- `fixo_add`, `fixo_edit`, `fixo_end`
- `ocorr_edit`, `ocorr_del`
- `cartao_add`, `cartao_edit`, `cartao_del`
- `cc_lanc_add`, `cc_lanc_edit`, `cc_lanc_del`, `cc_lanc_del_all`
- `csv_import`, `extrato_import`, `fatura_pdf_import`
- `cfg_save`, `nav`, `login`, `logout`, `error`

O usuário pode copiar o log em Config → Log de atividade → "Copiar log completo" para enviar ao suporte.

---

## 16. Cofrinhos (Reservas)

Cofrinhos são poupanças virtuais independentes do saldo financeiro principal.

### Estrutura

- `db.cofrinhos`: lista de cofrinhos (`{id, nome}`)
- `db.cofrinhoMovs`: todos os movimentos de todos os cofrinhos (`{id, cofId, val, desc, data}`)
  - `val > 0` = entrada
  - `val < 0` = saída

### `cofSaldo(cofId)`

Calcula o saldo de um cofrinho **somando todos os seus movimentos** — o saldo nunca é armazenado, sempre calculado:

```javascript
function cofSaldo(cofId) {
  return (db.cofrinhoMovs || [])
    .filter(m => m.cofId === cofId)
    .reduce((s, m) => s + m.val, 0);
}
```

### Rendimento

O botão "📈 Rendimento" (em Config → Reservas) permite reconciliar o saldo virtual com o saldo real da poupança:
1. Usuário informa o saldo real atual
2. App calcula `diff = saldoReal - somaDeTodosOsCofrinhos`
3. Se `diff > 0`: usuário escolhe em qual cofrinho depositar o rendimento → cria movimento positivo
4. Se `diff < 0`: exibe aviso (pode haver saída não registrada)

---

## 17. Resumo Família

Gera um texto monospace com todos os gastos `titular='fam'` do mês atual, formatado para compartilhar por WhatsApp etc.

```
Gastos Família — Junho 2025
────────────────────────────────────────
15/06  Supermercado Extra          R$ 234,50
...
────────────────────────────────────────
Total                              R$ 567,80
```

Compartilha via Web Share API (mobile) com fallback para clipboard.

---

## 18. CSS — Classes Principais

| Classe | Uso |
|---|---|
| `.card` | Container branco-escuro com bordas arredondadas |
| `.row2` | Grid 2 colunas para cards lado a lado |
| `.it` | Item de lista (lançamento, fixo) com ícone + texto + valor |
| `.ico` | Ícone circular colorido |
| `.iinfo` | Texto principal + subtexto de um `.it` |
| `.ival` | Valor monetário em um `.it` |
| `.ebtn` | Botão de edição (lápis) em um `.it` |
| `.fab` | Botão de ação flutuante (roxo, fixo no canto) |
| `.nav` | Barra de navegação inferior |
| `.nb` | Botão da barra de navegação; `.nb.on` = ativo |
| `.ov` | Overlay de modal (fundo escuro); `.ov.on` = visível |
| `.mod` | Container do modal (bottom sheet) |
| `.sbtn` | Botão de submit (roxo `#818cf8`) |
| `.dbtn` | Botão destrutivo (vermelho `#f87171`) |
| `.cbtn` | Botão de cancelar (transparente, borda cinza) |
| `.gbtn` | Botão de sucesso (verde `#34d399`, texto preto) |
| `.ttb` | Toggle button (tipo de lançamento); `.ttb.rd` = despesa; `.ttb.gr` = receita; `.ttb.yw` = familiar |
| `.tag` | Badge inline pequeno |
| `.tfix` | Tag "Fixo" (verde musgo) |
| `.tprc` | Tag de parcelamento (roxo) |
| `.tfam` | Tag "Família" (amarelo) |
| `.pw` | Progress bar wrapper |
| `.pb` | Progress bar fill |
| `.chip` | Chip de categoria (Config) com botão de remoção |
| `.cc-card` | Card de cartão de crédito (gradiente azul escuro) |
| `.empty` | Estado vazio centralizado (cinza) |
| `.toast` | Toast de feedback (verde, fixo no topo) |
| `.sec` | Separador de seção em uppercase |
| `.info-box` | Box informativo cinza escuro |
| `.saving-dot` | Ponto verde animado no header (salvando) |

---

## 19. Paleta de Cores

| Cor | Hex | Uso semântico |
|---|---|---|
| Verde | `#34d399` | Receita, positivo, sucesso, entrada |
| Vermelho | `#f87171` | Despesa, negativo, erro, saída |
| Amarelo | `#fbbf24` | Família (gasto familiar), alerta |
| Roxo | `#818cf8` | Primário (logo, FAB, botão submit, parcelamento) |
| Ciano | `#2dd4bf` | Fixo (tag), variante verde |
| Fundo base | `#0f1117` | Body background |
| Fundo card | `#1a1d27` | Cards principais |
| Fundo elevado | `#22263a` | Campos de input, cards internos |
| Borda | `#2a2f4a` | Divisores, bordas de input |
| Texto principal | `#e8eaf6` | Texto padrão |
| Texto secundário | `#7b80a0` | Labels, subtexto, datas |
| Roxo claro | `#a5b4fc` | Cartão de crédito (barra, texto CC) |

**Gradiente do CC card:** `linear-gradient(135deg, #1e1b4b, #312e81)` — não alterar junto com a paleta.

As cores com `rgba()` seguem o mesmo padrão: `rgba(52,211,153,*)` para verde, `rgba(248,113,113,*)` para vermelho, etc.

---

## 20. EMO Map (Emojis por Categoria)

O objeto `EMO` mapeia nomes de categorias para emojis. A função `emo(cat)` faz lookup exato e depois substring case-insensitive (para variações de acentuação):

```javascript
function emo(c) {
  if (!c) return '📁';
  if (EMO[c]) return EMO[c];
  // fallback: busca substring
  var cl = c.toLowerCase(), keys = Object.keys(EMO);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i].toLowerCase();
    if (k.length >= 4 && cl.includes(k)) return EMO[keys[i]];
  }
  return '📁';
}
```

---

## 21. Funções Utilitárias

```javascript
// Formata valor monetário: R$ 1.234,56
fmt(v)

// Formata compacto para gráficos: +1.2k, -500
fmtK(v)   // definida DENTRO de renderProj() — escopo local

// Zero-padding: 5 → "05"
pad(n)

// Data de hoje: "YYYY-MM-DD"
hoje()

// Mês-key: mesKey(5, 2025) → "2025-06"
mesKey(m, y)  // m é 0-based

// Avança data: avanca(2025, 6, 15, 1) → "2025-07-15"
// m1 é 1-based (junho = 6)
avanca(y, m1, d, j)

// Filtra lançamentos do mês m/y (respeita ciclo financeiro)
lancsDoMes(m, y)

// Soma receitas do mês (lançamentos + fixos)
somaR(m, y)

// Soma despesas do mês (lançamentos + fixos, excluindo sub='fat')
somaE(m, y)

// Retorna lançamentos de CC de um cartão para o mês m/y
gastosCC(ccId, m, y)

// Tag HTML de variação MoM
varTag(cur, prev, inv)

// Preenche um <select> com array de valores
fillSel(id, arr, valorSelecionado)
```

---

## 22. Inicialização (`init()`)

```javascript
async function init() {
  var loggedIn = await checkSession();
  if (loggedIn) {
    // Exibe app, preenche nome/email do usuário
    await iniciarDados();  // INSERT ignorando duplicata (cria linha se não existe)
    await carregarDados(); // GET e merge com db padrão
    migrarDados();         // Remove faturas antigas que eram salvas como sub='av' (legado)
    ajustarCicloInicial(); // Avança mês se hoje pertence ao próximo ciclo
    syncFaturas();         // Recalcula lançamentos sub='fat'
    salvar();              // Persiste estado limpo
    render();              // Renderiza toda a UI
  }
}
```

---

## 23. Service Worker (PWA)

`sw.js` implementa **network-first com fallback offline**:

1. **Fetch:** tenta buscar da rede; se offline, serve do cache
2. **Online:** sempre atualiza o cache do shell (`index.html`)
3. **Install:** pré-cacheia o shell na versão atual
4. **Activate:** apaga caches antigos (versões anteriores)

```javascript
var CACHE = 'ff-v76'; // deve ser atualizado a cada versão
```

**Auto-reload:** quando um novo Service Worker assume controle (`controllerchange`), a página recarrega automaticamente. Isso garante que o usuário sempre rode o código novo sem precisar limpar cache manualmente.

---

## 24. Versionamento e Deploy

### Como versionar

1. Incrementar `APP_VERSION` no início do `<script>`: `var APP_VERSION = 'v77';`
2. Incrementar `CACHE` em `sw.js`: `var CACHE = 'ff-v77';`
3. Fazer commit com formato: `feat(v77): descrição` ou `fix(v77): descrição`
4. Push para `main` → GitHub Pages serve em ~1 minuto

### Validar JS antes de commitar

```bash
node -e "var fs=require('fs'),m=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*)<\/script>/);try{new Function(m[1]);console.log('✓ ok');}catch(e){console.error(e.message);}"
```

---

## 25. Invariantes Críticas (Não Quebrar)

1. **`pertenceCiclo` usa comparação de string**, não Date. Trocar para Date vai excluir o último dia do ciclo.

2. **`syncFaturas()` deve ser chamada** toda vez que `db.ccLancs` ou `db.cartoes` for alterado. Sem isso, as faturas automáticas ficam desatualizadas.

3. **`salvar()` tem guard** `if (!currentUser || !accessToken) return` — nunca salva antes da sessão ser estabelecida e os dados carregados. Não remover.

4. **IDs de auto-incremento nunca retrocedem.** Ao deletar itens, os contadores (`nid`, `ngid`, etc.) permanecem no mesmo valor.

5. **`avanca(y, m1, d, j)`** recebe `m1` com indexação 1-based (Janeiro = 1). Não confundir com o padrão JS onde meses são 0-based.

6. **Z-index dos modais:** `.ov` = 100, cofrinhos = 110, `#ov-confirm` = 120. Nunca colocar um novo modal em z-index ≤ 100 se ele precisa aparecer sobre outros.

7. **`escHtml()` em todo conteúdo do usuário.** Qualquer string vinda de `db` que for inserida via `innerHTML` deve passar por `escHtml()`.

8. **Máximo 2 cartões.** Verificado na UI com `if (db.cartoes.length < 2)`.

9. **`diaInicio` do ciclo custom deve ser entre 2 e 28** (validado em `salvarCfg()`). Dia 1 é equivalente ao modo calendário. Dia 29-31 pode falhar em meses curtos.

---

## 26. Diagnóstico de Problemas

### Pedir log ao usuário

1. Usuário abre o app → aba Config → card "Log de atividade" → "Copiar log completo"
2. Cola no chat

### Erros comuns

| Sintoma | Causa provável |
|---|---|
| Dados não aparecem após login | `carregarDados()` falhou — checar log por `error` entries |
| Fatura do cartão não aparece em Lançamentos | `syncFaturas()` não foi chamado ou cartão não tem gastos `titular='eu'` |
| Valor errado no dashboard | `somaE` inclui `sub='fat'` — verificar se o filtro está correto |
| Import CSV gera duplicatas | `csvKey` estava diferente (possível variação de espaço/case) |
| PDF sem transações | Banco errado detectado por `detectarBancoPDF`, ou seção não encontrada |
| Modal de confirmação aparece atrás de outro modal | Z-index incorreto — verificar hierarquia CSS |

---

*Documentação gerada em Junho/2026 — versão v76 do app.*
