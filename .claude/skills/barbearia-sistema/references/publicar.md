# Publicar o sistema de uma barbearia (passo a passo para entregar ao usuário)

Mande ao usuário, nesta ordem, os arquivos da pasta `barbearia-<slug>/` (ou `examples/barbearia-<slug>/`):
`supabase/schema.sql`, `supabase/functions/sistema/index.ts` e `<slug>-site.zip`.
Explique em português simples, numerado. Não peça chaves secretas na conversa.

## 1. Supabase (uma vez por barbearia)

1. supabase.com → **New project** (anote a senha do banco).
2. **Project Settings → API Keys**: copie a **URL** do projeto e a chave **publishable**
   (`sb_publishable_…`). Elas vão no `config.json` (`supabase.url` e `supabase.chave_publica`);
   gere o sistema de novo depois de preencher.
3. **Database → Extensions**: ative **pg_cron** e **pg_net** (avisos a cada minuto).
4. **SQL Editor → New query**: cole o `schema.sql` inteiro → **Run**.
   Se aparecer o aviso "Avisos automáticos não foram agendados", confira o passo 3 e rode de novo.
5. **Edge Functions → Deploy a new function → Via Editor**: cole o `index.ts` → **Deploy**.
   - O nome da função precisa ser o mesmo de `supabase.funcao` no config.json. Se o Supabase der
     outro nome (ex.: "quick-task"), ajuste o config.json e gere de novo (a página e o schema usam
     esse nome).
   - Nos detalhes da função, **desligue "Verify JWT"**.
6. Conferir: abrir `https://<projeto>.supabase.co/functions/v1/<funcao>/push-key` deve mostrar
   `{"publicKey": …}`.

## 2. Netlify

1. Extrair o `<slug>-site.zip`.
2. netlify.com → **Add new site → Deploy manually** → arrastar a **pasta** extraída.
   (A pasta inteira, não só o index.html: o `sw.js` é o que recebe as notificações e os ícones
   aparecem no app instalado.)
3. Atualizações: na aba **Deploys** do mesmo site, arrastar a pasta nova.
4. Opcional: **Domain management** para trocar o endereço (ex.: `barbearia-machado.netlify.app`).

## 3. Primeiro acesso da equipe

- Mande o link da Netlify e as senhas iniciais (do comentário no topo do schema.sql).
- Cada um: abre o link, **instala o app** (Android: Chrome → ⬇ ou ⋮ → Instalar app;
  iPhone: Safari → Compartilhar → Adicionar à Tela de Início), entra na **Área do barbeiro**,
  toca em **🔕 Avisos** → Permitir, e em **👤 Conta** troca a senha e gera o **código de recuperação**.
- Esqueceu a senha: login → "Esqueci minha senha" com o código; sem código, o dono gera uma
  senha provisória em Comissões → 🔑.

## 4. Mensalidade do sistema

O pop-up do dono (dia 30 ao dia 10) já vem com o Pix do desenvolvedor e o valor de `mensalidade`.
Ele não bloqueia o sistema; o dono marca "Já paguei" a partir do dia 6.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Página diz "Agendamento ainda não configurado" | faltam `supabase.url`/`chave_publica` no config.json |
| Lista de barbeiros não aparece | schema.sql não foi rodado no projeto certo |
| "A função dos avisos não respondeu" | função com outro nome, não publicada, ou "Verify JWT" ligado |
| App instalado com uma letra no ícone | publicou só o HTML; arraste a pasta do .zip |
| Notificação não chega no iPhone | precisa abrir pelo ícone da tela inicial (iOS 16.4+) |
