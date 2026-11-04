# config.json — referência

O gerador (`scripts/gerar_sistema.py`) lê um arquivo como este. Exemplo completo e real:
`exemplos/machado.json`. Caminhos de imagens são relativos à pasta do config.json.

```json
{
  "slug": "machado",                         // obrigatório; minúsculo, números e hífen
  "nome": "Barbearia Machado",               // obrigatório
  "nome_completo": "Barbearia Machado Prime", // opcional (padrão: nome)
  "nome_curto": "Machado",                   // opcional (padrão: nome sem "Barbearia ")
  "slogan": "Especialista em prótese capilar", // opcional
  "emoji": "🪓",                              // opcional (padrão ✂️)
  "dono": { "nome": "Adão", "feminino": false }, // obrigatório: primeiro nome do dono(a)
  "whatsapp": "(42) 99965-3210",             // obrigatório: DDD + número
  "instagram": "barbearia_machado_27",       // opcional, com ou sem @
  "endereco": { "rua": "R. Cel. Olegário de Macedo, 134", "bairro": "Água Suja",
                "cidade": "Castro", "uf": "PR", "cep": "84165-690" }, // rua, cidade e uf obrigatórios
  "fuso": "America/Sao_Paulo",               // opcional
  "cores": {
    "primaria": "#e8302a",                   // obrigatória
    "destaque": "#c29760",                   // obrigatória
    "creme": "#f3e9d2",                      // opcional: texto "Barbearia" do topo no tema escuro
    "fundo_logo": "#000000"                  // opcional: fundo atrás da logo nos ícones
    // opcionais (calculadas se faltarem): primaria_clara, primaria_hover, primaria_escura,
    // primaria_mais_escura, destaque_clara, destaque_escura
  },
  "fonte_titulo": "Oswald",                  // opcional: nome no Google Fonts
  "logo": "originais/logo.png",              // recomendado; sem ele usa as imagens já existentes em img/
  "supabase": { "url": "https://xxxx.supabase.co", "chave_publica": "sb_publishable_…",
                "funcao": "quick-task" },    // nome com que a função foi publicada
  "mensalidade": 69.90,                      // valor do Pix mensal do sistema
  "intervalo": 30,                           // opcional: minutos entre os horários oferecidos (padrão 30; Machado 40)
  "horarios": { "seg": ["09:00", "12:00", "13:00", "20:00"], "sab": ["08:30", "16:00"], "dom": null },
                                             // dias: seg ter qua qui sex sab dom; null/ausente = fechado
                                             // 2 horários = abre e fecha; 4 = abre, almoço, volta, fecha
                                             // (com almoço às 12:00, um corte de 40 min tem 11:20 como último horário)
  "barbeiros": [                             // na ordem em que aparecem; exatamente um "dono": true
    { "id": "adao", "nome": "Adão Machado", "cargo": "Barbeiro Proprietário", "dono": true,
      "senha": "machado26", "bio": "…", "foto": "originais/adao.jpg",
      "recorte": [0.25, 0.3, 0.75, 0.8] }    // recorte opcional: frações [x1, y1, x2, y2]
  ],
  "servicos": [                              // na ordem em que aparecem; categoria agrupa na tela
    { "id": "corte", "categoria": "Cabelo", "nome": "Corte de Cabelo", "preco": 45,
      "duracao": 40, "descricao": "…", "tag": "Mais pedido" } // preco 0 = "Consultar"; tag opcional
  ]
}
```

O JSON real não aceita comentários (`//`): eles estão aqui só para explicar.

## Regras que o gerador confere

- Textos não podem ter `< > " \ ` { }`; apóstrofo vira ’ e `&` vira "e" (para não quebrar a página).
- `id` de barbeiro e serviço: minúsculo, números e hífen; sem repetir.
- Senhas: 5+ caracteres (6+ recomendado) e diferentes entre si, porque o login é só pela senha.
- Duração do serviço entre 5 e 600 minutos; preço ≥ 0.
- Pelo menos um dia de funcionamento, um barbeiro e um serviço.

## Rodar o schema de novo (atualizações)

O `schema.sql` gerado pode ser rodado de novo sem perder agendamentos nem senhas trocadas:
barbeiros, serviços e horários voltam aos valores do config.json; serviço que saiu da lista fica
inativo (some para o cliente) e volta se for recolocado; o mesmo vale para barbeiros;
dia sem horário passa a ficar fechado. Senhas só são criadas para
quem ainda não existe.
