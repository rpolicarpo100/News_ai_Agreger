# Próximos passos

Estado em 17-08-2026. Diagnóstico feito contra a base de dados real, não por estimativa.

| | |
|---|---|
| Commits | 8 |
| Testes | 102, todos a passar |
| Tabelas | 27 |
| Linhas de código | ~6 000 |
| Dependências | 5 |
| Fontes | 14/14 online |
| Eventos publicados | 662 |
| Fila de revisão | 106 |

---

## O que encontrei ao diagnosticar (já corrigido)

Antes de recomendar trabalho novo, verifiquei o `review_open: 120` que ficou pendente. Era um sintoma real.

**Regressão: um agente opcional não configurado bloqueava toda a publicação.**
Ao adicionar o agente LLM, a verificação `no_agent_failures` do supervisor passou a falhar em *todos* os eventos, porque "sem chave de API" era contado como falha de agente. A publicação caiu de ~400 eventos para 1, e a fila encheu-se de eventos que não precisavam de juízo humano nenhum.

A primeira correcção comparava o texto da nota (`not configured`) e falhou em silêncio, porque a nota diz `No LLM provider configured`. Substituí a comparação de strings por um campo explícito `UnavailableReason`: `not_configured | budget_exhausted | error`. Um agente que rebenta continua a ser apanhado — há um teste que injecta um agente propositadamente defeituoso.

Resultado: **1 → 662 publicados**, fila de 494 → 106. Os 106 restantes são legítimos: 97 eventos que o classificador não conseguiu categorizar (correctamente retidos) e 9 que precisam mesmo de decisão humana.

Também corrigido: lote de processamento de 60 → 400, para a fila drenar em vez de estagnar; e a base PGlite de desenvolvimento agora recupera sozinha se ficar ilegível, em vez de rebentar no arranque.

---

## Prioridade 1 — Bloqueadores antes de produção

### 1.1 Retenção de dados — IMPLEMENTADO, com uma limitação

Medido em produção: a base passou de 11,9 MB para **107 MB em poucas horas**
(8853 artigos). A retenção por idade não chegava, porque tudo tinha menos de
14 dias.

Implementado: tecto absoluto `RETAIN_MAX_PAYLOADS` (2000), que liberta os
payloads mais antigos independentemente da idade. Libertou 6856 na primeira
execução, mantendo intacta a proveniência (URL, título, fonte, datas).

**Limitação honesta:** o `VACUUM` que corre a seguir marca o espaço como
reutilizável dentro do ficheiro — a base **deixa de crescer** — mas não devolve
espaço ao disco. O tamanho continua a marcar ~107 MB. Para o reduzir seria
preciso `VACUUM FULL`, que bloqueia a tabela e não é aceitável com o serviço a
servir pedidos.

Consequência prática: 107 MB de 1 GB, com o crescimento travado. Se precisar de
recuperar o espaço, corra `VACUUM FULL article;` numa janela de manutenção
através do `psql` do Render.

### 1.1b Notas anteriores sobre retenção
**Problema medido:** 953 artigos ocupam 70 MB. Projecção: ~714 MB aos 10 000 artigos, e o plano gratuito do Render dá 1 GB. As tabelas `audit_log`, `agent_run` e `provenance` crescem sempre e nada as limpa.

**Proposta:** política de retenção por tabela, com o princípio de que a auditoria nunca desaparece silenciosamente — é *arquivada* e o resumo mantém-se. Artigos de eventos arquivados perdem o `payload` verbatim (o maior campo) mas mantêm URL, título e proveniência.

### 1.2 Migrações versionadas
**Problema:** `schema.sql` é inteiramente `IF NOT EXISTS`. Isso é seguro para *acrescentar*, mas não consegue alterar uma coluna existente. A primeira mudança de tipo obrigaria a intervenção manual em produção.

**Proposta:** ficheiros numerados `migrations/001_*.sql` com uma tabela `schema_migrations`, aplicados por ordem e registados. Trabalho pequeno agora, muito caro depois.

### 1.3 Rotação do token de administração
O `demo-admin-token-please-rotate` que usei em testes não pode ir para lado nenhum. O blueprint do Render gera um automaticamente — confirmar que é esse o que fica.

### 1.4 Cold start no plano gratuito
O plano gratuito adormece o serviço após 15 minutos de inactividade, o que **para a ingestão**. O `CYCLE_MINUTES=10` nunca dispara num serviço adormecido. Ou se aceita que os dados só actualizam quando alguém visita, ou se passa a plano pago com um worker separado. Isto é uma decisão sua, não técnica.

---

## Prioridade 2 — Qualidade dos dados

### 2.1 Os 97 eventos por classificar
Não é um bug: o portão de qualidade retém correctamente o que não consegue categorizar. Mas 97 em 768 (13%) sugere lacunas nas regras. Vale a pena analisar os títulos retidos e alargar o dicionário — em português sobretudo, que tem menos termos que o inglês.

### 2.2 Deduplicação entre fontes
GDACS e USGS reportam o mesmo sismo com títulos diferentes ("Green earthquake (Magnitude 6.1M...)" vs "M 6.1 - 56 km NNE of Port-Olry"). O grafo liga-os correctamente por coordenadas, mas continuam a ser dois eventos. Fundi-los exigiria comparar magnitude + coordenadas + tempo, não texto.

---

## Prioridade 3 — Funcionalidades

### 3.1 Canal de email
Desbloqueia alertas por email e recuperação de palavra-passe. Já não é bloqueante — a caixa de entrada interna funciona — mas a recuperação de palavra-passe é uma lacuna real de produto. Precisa de um fornecedor (Resend, Postmark).

### 3.2 Navegação no grafo
Explorar caminhos de vários saltos entre eventos, com a evidência de cada ligação visível.

### 3.3 Mais agentes LLM
O arnês de verificação já existe e está testado. Acrescentar agentes (tipificação de afirmações políticas, distinção entre artigo científico e comunicado de imprensa) é agora trabalho incremental e seguro.

---

## Recomendação

Pela ordem: **1.1 retenção** e **1.2 migrações** são as duas que ficam exponencialmente mais caras quanto mais tarde forem feitas. Tudo o resto pode esperar sem juros.

Se o objectivo for pôr isto online esta semana, a sequência mínima é 1.2 → 1.1 → 1.3, e decidir 1.4.
