---
name: barbearia-sistema
description: Cria o sistema de agendamento online de uma barbearia (página de agendamento + app instalável + painel do dono e dos barbeiros + avisos no celular + comissões + mensalidade por Pix), personalizado com o nome, a logo, as cores, os barbeiros, as fotos, os serviços, os preços e os horários de cada barbearia, a partir do modelo da Barbearia Machado. Use quando o usuário pedir um site, sistema, app ou página de agendamento para uma barbearia (ou salão) nova, quiser "fazer igual ao da Machado" para outro cliente, ou atualizar os dados (barbeiros, serviços, horários, cores) de um sistema já gerado por esta skill.
---

# Sistema de agendamento para barbearias

Gera, para cada barbearia, o mesmo sistema já em produção na Barbearia Machado, trocando tudo o que é da barbearia: nome, logo, cores, fonte,
contatos, endereço, barbeiros e fotos, serviços e preços, horários, dono(a), Supabase e mensalidade.
O que é do desenvolvedor fica igual em todos: crédito no rodapé e Pix da mensalidade (Murilo).

## O que o sistema entrega (para explicar ao cliente)

- **Cliente**: escolhe barbeiro (com foto) → serviço → dia/horário → dados; comprovante; WhatsApp;
  salvar na agenda; agendamento "todo mês"; tema claro/escuro; app instalável com a logo.
- **Barbeiro**: agenda própria, marca em qualquer horário pelo painel, avisos no celular
  ("Agora: Carlos — 14:00", "Novo agendamento"), quanto tem a receber, troca de senha e código de
  recuperação.
- **Dono(a)**: agenda de todos, clientes, bloqueios, galeria, comissões (% por barbeiro, pagar e
  zerar, senha provisória para barbeiro), lembrete de pagar a equipe no último dia do mês e
  mensalidade do sistema por Pix (dia 30 ao dia 10, botão "Já paguei" a partir do dia 6).

## Onde ficam as coisas (funciona em qualquer projeto)

- `SKILL_DIR` = a pasta onde está este SKILL.md (ex.: `~/.claude/skills/barbearia-sistema/` quando
  instalada para o usuário, ou `.claude/skills/barbearia-sistema/` dentro de um projeto). Os scripts
  e o modelo são lidos de lá; não dependem do repositório.
- Pasta da barbearia = `barbearia-<slug>/` no projeto atual (num repositório com pasta `examples/`,
  use `examples/barbearia-<slug>/`). Se o projeto estiver vazio, crie direto na raiz dele.
- Requisitos: Python 3 e Pillow (`pip install pillow`, se `import PIL` falhar).

## Passo a passo

1. **Entrevista** — siga `references/perguntas.md` em rodadas curtas com AskUserQuestion
   (até 4 perguntas por vez, ofereça padrões "(Recomendado)"). Peça a logo, as fotos dos barbeiros e
   a lista de serviços (print serve). Não invente preço, horário, endereço ou telefone: pergunte.
   Para sugerir cores: `python3 SKILL_DIR/scripts/cores_da_logo.py <logo>`.
2. **Arquivos de origem** — guarde logo e fotos em `barbearia-<slug>/originais/`
   (copie dos uploads; nomes simples como `logo.png`, `<id>.jpg`).
3. **Configuração** — escreva `barbearia-<slug>/config.json` conforme
   `SKILL_DIR/references/configuracao.md` (exemplo real: `SKILL_DIR/exemplos/machado.json`). Mostre um resumo e confirme.
4. **Gerar** — `python3 SKILL_DIR/scripts/gerar_sistema.py barbearia-<slug>/config.json`
   (gera na própria pasta do config) e depois `python3 build.py` dentro dela. Corrija o config se o gerador apontar erro.
5. **Conferir** antes de entregar:
   - nenhum dado de outra barbearia: `grep -n "Machado\|Adão\|Olegário\|99965" agendamento.html supabase/schema.sql`
     (só pode aparecer no crédito do desenvolvedor, se a barbearia não for a Machado);
   - abrir `<slug>-agendamento.html` no navegador (Playwright) e tirar print da tela de barbeiros
     e de serviços; conferir cores, fotos (rosto visível no círculo; senão ajuste `recorte`) e o
     texto de horário do calendário; mostrar os prints ao usuário;
   - se houver Postgres local, rodar o schema.sql (simulando `auth`, `anon`, `authenticated`)
     e testar `staff_login` com as senhas iniciais.
6. **Entregar** — envie `supabase/schema.sql`, `supabase/functions/sistema/index.ts` e
   `<slug>-site.zip`, com o passo a passo de `references/publicar.md` (Supabase → função →
   Netlify → primeiro acesso da equipe) e a lista de senhas iniciais.
7. **Versionar** — se o projeto for um repositório git, siga as regras dele (branch, commit, push). Nunca grave
   senhas reais trocadas pelo dono nem chaves secretas (`sb_secret_…`, `service_role`); a chave
   publicável (`sb_publishable_…`) pode ficar no site.

## Atualizar uma barbearia já gerada

Edite o `config.json` dela, rode o gerador e o `build.py` de novo, e entregue o que mudou:
`schema.sql` (barbeiros/serviços/horários — pode rodar de novo sem perder agendamentos nem senhas),
o `.zip` (página) e, só se mudou, o `index.ts`. Ajustes feitos à mão no `agendamento.html` gerado
são perdidos ao gerar de novo: prefira mudar o modelo.

## Mudar o modelo (vale para todas as barbearias)

O modelo (`template/`) vem da Barbearia Machado (referência em produção no repositório
`schipanskibueno-rgb/ruflo`, pasta `examples/barbearia-machado/`). Para levar uma melhoria a todas:
1. faça e teste a mudança na pasta da Machado;
2. rode `python3 SKILL_DIR/scripts/atualizar_modelo.py <pasta-da-machado>` (troca os dados da Machado por `{{CAMPOS}}`; para com
   erro se algum trecho esperado mudou — ajuste a lista de trocas no script);
3. confira: gere `exemplos/machado.json` numa pasta temporária e compare com a Machado
   (`diff` do `agendamento.html` deve mostrar só comentários e a ordem das fotos);
4. gere as outras barbearias de novo.

Campos novos no modelo: use `{{NOME_EM_MAIUSCULAS}}`, adicione o valor em `campos` no
`gerar_sistema.py` e documente em `references/configuracao.md`. O gerador para com erro se algum
`{{CAMPO}}` ficar sem valor.

## Limites conhecidos

- Um Supabase por barbearia (os dados não se misturam); cada uma tem sua função de avisos.
- Bloqueio por falta de pagamento não está ativo (o pop-up só avisa).
- O site completo de apresentação da Machado (`index.html`) não faz parte do modelo; esta skill gera o sistema de agendamento + app + painel.
