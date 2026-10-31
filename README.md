# FinanSmart AI

Sistema web completo de controle financeiro pessoal, com dashboard,
contas, cartões, parcelamentos, planejamento mensal ("Meu mês"),
receitas e despesas, relatórios e a assistente **Luna AI** (Groq).

Tema escuro com verde esmeralda, inspirado em fintechs modernas.
Responsivo para celular, tablet e computador. Sem build: HTML + CSS +
JavaScript puro + funções serverless (Vercel, zero dependências).

## Como funciona

O sistema tem **dois modos**, escolhidos automaticamente:

1. **Modo local (sem nenhuma chave):** funciona na hora. Todos os
   dados ficam salvos no aparelho/navegador (localStorage). Sem login,
   sem sincronização entre aparelhos.
2. **Modo nuvem (com Supabase):** com `SUPABASE_URL` e
   `SUPABASE_ANON_KEY` configurados, o sistema ganha cadastro/login
   (e-mail + senha) e os dados sincronizam entre aparelhos, com RLS
   (cada usuário só vê os próprios dados).

A **Luna AI** também tem dois níveis:

- **Sem `GROQ_API_KEY`:** motor local — responde às perguntas
  calculando os seus dados reais (sobra do mês, parcelas, cartões,
  gastos por categoria, simulação de compra).
- **Com `GROQ_API_KEY`:** usa a Groq (`openai/gpt-oss-120b` por
  padrão, trocável via `GROQ_MODEL`) recebendo um resumo dos dados
  reais. A chave fica só no servidor, nunca no frontend.
- **Cadastro por conversa:** fale com a Luna ("tenho um cartão da
  Nubank com limite de R$ 3.500, já gastei R$ 1.500 em 10 parcelas,
  fecha dia 08") — ela mostra o resumo e só salva depois que você
  confirmar com "sim". Também cadastra gastos avulsos ("gastei 50 no
  mercado") e contas. Perguntas normais continuam sendo só perguntas.

## Publicação (Vercel)

1. Crie o projeto na Vercel importando o repositório
   `financas_pessoal` (framework: Other / sem build).
2. Variáveis de ambiente (Settings → Environment Variables):
   - `GROQ_API_KEY` — chave da Groq (pode adicionar depois; sem ela a
     Luna responde no modo local). **Nunca cole chave no chat.**
   - `GROQ_MODEL` — opcional (padrão: `openai/gpt-oss-120b`).
   - `SUPABASE_URL` — URL do projeto Supabase (só para o modo nuvem).
   - `SUPABASE_ANON_KEY` — chave `anon`/`publishable` do Supabase
     (pública por desenho; **nunca** a `service_role`).
3. Deploy. O site abre direto no modo local se nada estiver
   configurado.

## Banco de dados (modo nuvem — Supabase)

1. Crie um projeto no Supabase (plano grátis).
2. Abra **SQL Editor → New query**, cole o conteúdo de
   `supabase.sql` e clique em **Run**.
3. Confira em **Authentication → Providers** que o provedor **Email**
   está ativo (é o padrão).
4. Coloque `SUPABASE_URL` e `SUPABASE_ANON_KEY` nas variáveis da
   Vercel e faça redeploy.

As tabelas: `profiles`, `accounts`, `cards`, `entries`, `purchases`
— todas com RLS por `user_id` / `auth.uid()`.

## Regras de cálculo (importantes)

- **Saldo da conta** = saldo inicial + receitas − despesas −
  transferências (só contam lançamentos com data até hoje).
- **Fatura do cartão (mês)**: compras avulsas no cartão + parcelas
  do mês. Compra feita **depois do dia de fechamento** cai na fatura
  do mês seguinte (regra real de cartão).
- **Compra parcelada** nunca vira despesa cheia no mês: só a parcela
  do mês entra no comprometido. O valor restante aparece em
  Parcelamentos e nos Relatórios.
- **Pagamento de fatura** é uma transferência (conta → cartão), não
  uma despesa nova — não duplica o gasto.
- **Lançamento fixo/mensal** se repete todo mês a partir da data
  inicial; avulso aparece só no mês dele.
- **Sobra do mês** = receitas − (despesas + parcelas).
- Começa **zerado**: nenhum dado fictício. Estados vazios orientam
  o primeiro cadastro.

## Arquivos

- `index.html` — estrutura, menu lateral (9 seções), topo com
  navegação de mês.
- `styles.css` — tema escuro/esmeralda + tema claro opcional.
- `app.js` — toda a lógica: cálculos, telas, formulários, gráficos
  SVG, Supabase REST + Auth, Luna AI (local + Groq).
- `api/_lib.js`, `api/config.js`, `api/chat.js` — backend serverless.
- `supabase.sql` — esquema + RLS.
- `test/test-finansmart.js` — testes dos cálculos (Node, sem
  dependências).

## Testes locais

```bash
node test/test-finansmart.js
node --check app.js && node --check api/chat.js && node --check api/config.js && node --check api/_lib.js
```
