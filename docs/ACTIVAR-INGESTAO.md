# Activar a ingestão agendada (2 minutos, sem custo)

## O problema

O plano gratuito do Render adormece o serviço após 15 minutos de inactividade.
Um serviço adormecido **não corre o ciclo de ingestão**, por isso os dados só
actualizariam quando alguém visitasse o site.

## A solução

Um workflow do GitHub Actions (`.github/workflows/ingest.yml`) que acorda o
serviço 6 vezes por dia. O Actions é **gratuito e ilimitado** em repositórios
públicos, e o `News_ai_Agreger` é público.

### Porque não um ping de 10 em 10 minutos

O Render dá **750 horas de instância por mês, partilhadas por toda a conta**,
e esta conta tem 12 serviços gratuitos. Manter este acordado 24/7 gastaria
~730 h e esgotaria a quota de todos os outros projectos.

Em janelas: 6 × ~5 min/dia ≈ **90 h/mês**, deixando folga larga.

---

## O que falta fazer (tem de ser feito por si)

O ficheiro do workflow **não foi enviado para o GitHub**. Não é um erro de
configuração: uma *deploy key* não tem o scope `workflow`, por isso o GitHub
aceita o push mas descarta silenciosamente a pasta `.github/workflows`.

Escolha **uma** das opções:

### Opção A — colar no site do GitHub (mais rápido)

1. Vá a <https://github.com/rpolicarpo100/News_ai_Agreger>
2. **Add file → Create new file**
3. Nome do ficheiro: `.github/workflows/ingest.yml`
4. Cole o conteúdo do ficheiro `.github/workflows/ingest.yml` deste repositório
5. **Commit changes**

Repita para `.github/workflows/ci.yml` se quiser também os testes automáticos
em cada push (recomendado).

### Opção B — Personal Access Token com scope `workflow`

1. <https://github.com/settings/tokens?type=beta> → **Generate new token**
2. Repository access: apenas `News_ai_Agreger`
3. Permissions → Repository → **Contents: Read and write** e **Workflows: Read and write**
4. Depois:

```bash
cd /home/user/gni
git remote set-url origin https://github.com/rpolicarpo100/News_ai_Agreger.git
git push origin main     # utilizador: rpolicarpo100 | password: o token
```

---

## Confirmar que ficou activo

1. Separador **Actions** do repositório → deve aparecer "Ingestão agendada"
2. **Run workflow** para testar imediatamente
3. O resumo mostra artigos, eventos publicados e fontes online

O primeiro despertar demora ~60 s (arranque a frio) — o workflow tenta 12 vezes.

---

## Ajustar a frequência

Em `.github/workflows/ingest.yml`, a linha `cron`:

```yaml
- cron: '0 2,6,10,14,18,22 * * *'   # 6×/dia ≈ 90 h/mês  (actual)
- cron: '0 */3 * * *'               # 8×/dia ≈ 120 h/mês
- cron: '0 8,20 * * *'              # 2×/dia ≈ 30 h/mês  (mais conservador)
```

Vigie o consumo em Render → Billing. Se os outros 11 serviços consumirem muito,
reduza para 2–4 janelas por dia.
