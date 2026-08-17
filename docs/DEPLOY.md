# Deploy: GitHub → Render

## Importante: qual chave precisa?

"Deploy key" significa coisas diferentes conforme o objectivo:

| Objectivo | O que precisa |
|---|---|
| **Render buscar código do GitHub** | **Nada.** O Render usa OAuth pela app do GitHub. Basta autorizar. |
| Enviar código deste sandbox para o GitHub | Deploy key com **acesso de escrita** (gerada aqui) |
| CI/CD a puxar de repositórios privados | Deploy key só de leitura |

Para o caso normal — código no GitHub, Render faz deploy — **não precisa de deploy key nenhuma**.
A chave abaixo serve para enviar deste ambiente para o GitHub.

---

## Chave pública

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHuOiohR58FY6hLOzyLI6M+uflOsO+Bg5rjskJh4mz3t gni-deploy-20260817
```

Fingerprint: `SHA256:0Gw3BAArXwatgpmFI6Gx0QvAitMcpQH9g3tsStKv7vw`
Tipo: Ed25519 (mais curta e mais segura que RSA)

A chave privada está em `.deploy-keys/gni_deploy_key`, **fora do controlo de versões**
(`.gitignore`) e o scanner de segredos confirma-o em cada build.

### Instalar no GitHub

1. Crie o repositório em <https://github.com/new> (privado ou público, sem README).
2. Vá a **Settings → Deploy keys → Add deploy key**.
3. Título: `Arena sandbox`; Key: a linha acima.
4. **Marque "Allow write access"** — sem isto o `push` falha.

### Enviar o código

O remote já está configurado para `rpolicarpo100/News_ai_Agreger`. Para enviar
novos commits deste ambiente é preciso indicar a chave (o git não a usa por omissão):

```bash
cd /home/user/gni
export GIT_SSH_COMMAND='ssh -i .deploy-keys/gni_deploy_key -o IdentitiesOnly=yes'
git push origin main
```

Verificado a 17-08-2026: clone limpo do repositório → `npm ci` → `npm run build`
→ `node dist/index.js` arranca, responde 200 em `/api/health`, e com base vazia
mostra `NO VERIFIED DATA AVAILABLE` em vez de conteúdo inventado.

> Uma deploy key pertence a **um** repositório. Para vários, use uma chave por repositório
> ou uma máquina-utilizador. O GitHub rejeita a mesma chave em repositórios diferentes.

### Alternativa mais simples: token HTTPS

Se preferir evitar SSH, um Personal Access Token (fine-grained, só com
`Contents: read and write` neste repositório) também funciona:

```bash
git remote add origin https://github.com/UTILIZADOR/REPOSITORIO.git
git push -u origin main    # utilizador: o seu nome; password: o token
```

Não guarde o token em ficheiro nenhum do repositório.

---

## Render

Depois do código estar no GitHub:

1. Render → **New → Blueprint** → escolha o repositório.
2. O `render.yaml` cria a base Postgres e o serviço web, gera `VIEW_SALT` e
   `ADMIN_TOKEN`, e liga o `DATABASE_URL` automaticamente.
3. Defina `PUBLIC_BASE_URL` com o URL do Render (para canonical tags e sitemap).
4. Health check: `/api/health`.

### Variáveis de ambiente

| Variável | Origem | Notas |
|---|---|---|
| `DATABASE_URL` | Render | Automático via blueprint |
| `VIEW_SALT` | Render | Gerado; roda o hash de sessões de visualização |
| `ADMIN_TOKEN` | Render | Gerado. **Nunca reutilize o `demo-admin-token-please-rotate` dos testes** |
| `PUBLIC_BASE_URL` | Manual | O seu URL do Render |
| `SUPPORT_REVOLUT` | Opcional | Já tem `infowithgoal` por omissão |
| `SUPPORT_ETH` | Opcional | Já tem o endereço verificado por omissão |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Opcional | Sem chave, os agentes LLM reportam `UNAVAILABLE` |

### Antes de considerar produção

- **Plano gratuito adormece após 15 min**, o que **para a ingestão**. O `CYCLE_MINUTES`
  não dispara num serviço adormecido. Ou aceita que os dados só actualizam com
  visitas, ou usa plano pago com o worker `gni-worker` separado
  (e `RUN_WORKER_IN_WEB=false` no serviço web).
- **1 GB de base no plano gratuito.** Medido: 953 artigos ≈ 70 MB. Ver
  `docs/PROXIMOS-PASSOS.md`, prioridade 1.1 (retenção).

---

## Se a chave for comprometida

1. GitHub → Settings → Deploy keys → remover a chave.
2. Gerar outra: `ssh-keygen -t ed25519 -f .deploy-keys/gni_deploy_key -N ""`.
3. Uma deploy key só dá acesso a um repositório, por isso o impacto é limitado
   a este — ao contrário de um token de conta.
