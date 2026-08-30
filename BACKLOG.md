# Backlog — FinançasFácil

Ideias e melhorias planejadas, ainda não implementadas. Ao concluir um item, remova daqui e registre no commit (`feat(vN):`).

## Funcionalidades

### 1. Gráfico de evolução de custo mês a mês por categoria
Novo gráfico no dashboard mostrando a evolução do gasto ao longo dos meses, quebrado por categoria.
- Eixo X: meses (últimos N ciclos financeiros).
- Uma série/linha por categoria de despesa (ou barras empilhadas).
- Respeitar o ciclo financeiro configurado (`lancsDoMes()` é cycle-aware) e o filtro `titular==='eu'` para gastos de cartão.
- Permitir escolher quantos meses exibir.

### 2. Filtro por tipo de categoria ✅ (v114)
Implementado como nova página **Revisar** (nav 🏷️): visão consolidada de conta (`lancs`) + cartão (`ccLancs`) do ciclo, com filtros por tipo (receita/despesa), categoria e origem (conta/cartão), e recategorização inline via `<select>` por linha (`recatRow`). Parcelas recategorizam a série inteira; cartão dispara `syncFaturas()`.

### 3. Melhorar processo de exclusão de categoria
Rever o fluxo de exclusão de categoria (`catsR`/`catsE`):
- Alertar/tratar lançamentos que usam a categoria a ser excluída (reatribuir, bloquear ou marcar como "sem categoria").
- Evitar categorias órfãs em `lancs`/`ccLancs` após a exclusão.
- Confirmação clara antes de excluir.

### 4. Melhorar apontamento de gastos fixos durante a sincronização
Aprimorar a supressão/reconciliação de fixos no preview de sync do Pluggy (`mostrarPreviewSync`/`confirmarMergeSync`):
- Facilitar identificar e marcar qual débito importado quita cada fixo do mês.
- Melhorar o match (categoria + valor + tolerância) e a visibilidade de quais fixos ainda não foram apontados.
- Reduzir esforço manual e evitar duplicidade com a lógica de "realizado quando existe, senão planejado".

### 5. Validação de CC com fatura parcial
Permitir a conferência da fatura (`conferirFaturaPDF`/`conferirFaturaDiff`) quando só há uma parte da fatura disponível:
- Aceitar validar/conciliar um subconjunto de compras sem exigir a fatura fechada completa.
- Não marcar como "sobrando" os lançamentos do site que simplesmente ainda não constam na fatura parcial.
- Suportar múltiplas rodadas de conferência conforme a fatura vai fechando.
