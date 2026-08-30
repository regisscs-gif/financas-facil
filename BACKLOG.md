# Backlog — FinançasFácil

Ideias e melhorias planejadas, ainda não implementadas. Ao concluir um item, remova daqui e registre no commit (`feat(vN):`).

## Funcionalidades

### 1. Gráfico de evolução de custo mês a mês por categoria ✅ (v119)
Implementado como nova página **Evolução** (nav 📈): gráfico de barras dos últimos 12 ciclos financeiros, com filtro por tipo (Despesa/Receita) e categoria (incluindo órfãs), média 12m, e **drill-down** — tocar um mês lista os lançamentos individuais daquele mês (conta + cartão), não só o total. Respeita `pertenceCiclo`, exclui `sub='fat'` e filtra `titular='eu'` (sem dupla contagem). `renderEvolucao`/`evoRegistros`.

### 2. Filtro por tipo de categoria ✅ (v114)
Implementado como nova página **Revisar** (nav 🏷️): visão consolidada de conta (`lancs`) + cartão (`ccLancs`) do ciclo, com filtros por tipo (receita/despesa), categoria e origem (conta/cartão), e recategorização inline via `<select>` por linha (`recatRow`). Parcelas recategorizam a série inteira; cartão dispara `syncFaturas()`.

### 3. Melhorar processo de exclusão de categoria ✅ (v116)
Fluxo de exclusão (`delCat`) agora abre modal `#ov-delcat`: mostra quantos registros usam a categoria (`contarCatUso` — lancs exceto `sub='fat'`, ccLancs, fixos, ocorrs override, todos os meses), **obriga reatribuir** para outra categoria do mesmo tipo antes de excluir (`confirmarDelCat` move tudo de uma vez), e confirma a ação. Sem registros afetados → confirmação simples. Não sobram órfãos. Se não houver outra categoria do tipo, bloqueia e pede para criar uma antes.

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
