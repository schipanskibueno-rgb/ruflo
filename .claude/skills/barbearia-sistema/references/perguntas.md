# Roteiro de perguntas para uma barbearia nova

Faça as perguntas em rodadas curtas (AskUserQuestion aceita até 4 por vez; use "Other" para respostas
livres). Não pergunte o que já foi respondido na conversa ou nos arquivos enviados. Quando houver um
padrão bom, ofereça-o como opção "(Recomendado)".

## Rodada 1 — Identidade

1. **Nome da barbearia** como aparece para o cliente (ex.: "Barbearia Machado") e, se houver, o nome
   completo/comercial (ex.: "Barbearia Machado Prime").
2. **Nome curto** para o ícone do app e o topo do painel (1 palavra, ex.: "Machado").
3. **Frase da marca / especialidade** (ex.: "Especialista em prótese capilar") — vai na descrição do
   site e no texto alternativo da logo. Opcional.
4. **Emoji da marca** nas mensagens de WhatsApp (ex.: 🪓, 💈, ✂️). Padrão: ✂️.

## Rodada 2 — Logo e cores

- Peça a **logo** (de preferência PNG com fundo transparente, ou a imagem do Instagram).
- Rode `python3 SKILL_DIR/scripts/cores_da_logo.py <logo>` e ofereça as cores sugeridas como opção:
  - **primária**: botões, destaques, preços em destaque (no código: variáveis `--red`);
  - **destaque**: detalhes, ícones, faixas (no código: `--copper`).
- **Fonte dos títulos** (Google Fonts). Padrão: Oswald (condensada, combina com barbearia).
  Alternativas que funcionam bem: Bebas Neue, Anton, Barlow Condensed, Archivo Black.
- Cor de fundo da logo: se a logo tiver fundo (não transparente), o gerador usa a cor do canto.
  Para mudar, `cores.fundo_logo`.

## Rodada 3 — Contato e endereço

- **WhatsApp** da barbearia (recebe as confirmações dos clientes).
- **Instagram** (@).
- **Endereço**: rua e número, bairro, cidade, UF, CEP (vai no mapa "Como chegar" e no comprovante).
- **Fuso horário**, só se a barbearia não estiver no horário de Brasília (ex.: MT → America/Cuiaba,
  AM → America/Manaus).

## Rodada 4 — Horário de funcionamento

- Horário de abertura e fechamento de **cada dia da semana** (seg a dom) e quais dias fecha.
- **Intervalo entre os horários** (de 30 em 30, de 40 em 40 min…): normalmente a duração do corte.
- **Intervalo de almoço** (ex.: 12:00 às 13:00) e em quais dias. O cliente não marca nesse período;
  os horários seguem o intervalo a partir da abertura e da volta do almoço; antes do almoço entra
  o horário que termina exatamente nele (corte de 40 min → 11:20). O último horário do dia é o
  último da grade que começa antes do fechamento (fecha 20:00, de 40 em 40 → 19:40).
- Lembre: o cliente só agenda dentro desse horário; os barbeiros, pelo painel, podem marcar em
  qualquer dia e hora.

## Rodada 5 — Equipe

Para cada barbeiro: **nome**, **cargo** (Barbeiro, Barbeira, Barbeiro Proprietário…), **frase curta**
(bio, opcional) e **foto**. Pergunte também:

- **Quem é o dono(a)** — vê e gerencia tudo (agenda de todos, comissões, mensalidade). Pergunte se é
  homem ou mulher, para os textos ("definido pelo Adão" / "pela Maria").
- **Ordem** em que aparecem na tela de agendamento.
- **Senhas iniciais**: padrão `<id>26` (ex.: `nick26`). Cada pessoa precisa de uma senha diferente;
  depois cada um troca em 👤 Conta. Não grave a senha real do dono no repositório: use uma inicial e
  peça para ele trocar no primeiro acesso.
- Fotos: o gerador recorta um quadrado centralizado, puxado para cima. Se o rosto ficar pequeno ou fora
  do centro, use `recorte` com frações da foto (ex.: `[0.25, 0.3, 0.75, 0.8]`).

## Rodada 6 — Serviços e preços

Peça a **lista de serviços** (print do sistema antigo, cardápio, foto da tabela de preços). Para cada um:
nome, **preço** (0 = "Consultar"), **duração em minutos** e **categoria** (ex.: Cabelo, Barba, Combos,
Química e tratamentos). Se a duração não for informada, proponha valores e confirme
(ex.: corte 40, barba 30, corte + barba 60, sobrancelha 15, platinado 180).
Pergunte se algum serviço merece **etiqueta** ("Mais pedido", "Mais completo", "Comece aqui").

## Rodada 7 — Sistema

- **Valor da mensalidade** do sistema (Pix para o desenvolvedor; padrão R$ 69,90).
- **Supabase** do cliente: URL do projeto e chave publicável (`sb_publishable_…`), e o nome com que a
  função dos avisos foi (ou será) publicada. Se ainda não existir, gere sem e preencha depois.
- **Slug** (identificador sem espaços, minúsculo, ex.: `machado`): define a pasta
  `barbearia-<slug>/` e os nomes dos arquivos.

## Antes de gerar

Mostre um resumo curto (nome, cores, horários, equipe com senhas iniciais, nº de serviços, mensalidade)
e pergunte se pode gerar. Depois de gerar, mostre um print da tela de agendamento para aprovação.
