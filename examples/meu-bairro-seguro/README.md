# Meu Bairro Seguro

Sistema web (HTML, roda no navegador do computador e do celular) para reunir câmeras de
**qualquer marca** num mapa do bairro: cada câmera é um ícone no lugar onde fica, e um clique
mostra o vídeo ao vivo. Cada pessoa entra com o **próprio login e senha** e vê só as câmeras
liberadas para ela.

## Como rodar

Requisitos: Node.js 22.13+ e `ffmpeg`/`ffprobe` instalados no servidor.

```bash
cd examples/meu-bairro-seguro
npm install
npm start            # http://localhost:3000
npm test             # testes com câmeras simuladas (RTMP e ONVIF)
```

No primeiro acesso a tela pede para criar o **administrador**. Depois disso não existe
cadastro aberto: o administrador cria o acesso de cada pessoa em **Pessoas**.

Variáveis de ambiente: `PORT`, `MBS_DATA_DIR` (banco + gravações, padrão `./data`),
`COOKIE_SECURE=1` (quando estiver atrás de HTTPS), `FFMPEG_PATH`, `FFPROBE_PATH`.

> Ler QR pela câmera do celular e "Usar minha localização" só funcionam em **HTTPS** (ou em
> `localhost`) — é regra dos navegadores. Em produção, coloque um proxy com HTTPS na frente
> (Caddy, Nginx + Let's Encrypt).

## O que faz

| Recurso | Como |
|---|---|
| **Mapa** (tela inicial) | Cada câmera é um ícone colorido pelo status (verde online, amarelo conectando, vermelho offline). Clique no ícone: vídeo ao vivo, ampliar, gravações, editar. Lista lateral com todas, inclusive as sem local |
| **Cadastro por QR** | "Ler QR da câmera" usa a câmera do celular. Entende QR de Hikvision/EZVIZ, Dahua/Imou/Intelbras, Yoosee, XMEye/iCSee e QR com endereço RTSP |
| **Cadastro por código** | "Digitar código": nº de série / código da etiqueta |
| **Procurar na rede** | Busca ONVIF: lista as câmeras da rede; com o nº de série do QR, acha a câmera certa sozinho e pega o endereço do vídeo |
| **ONVIF automático** | Marca "Automático (ONVIF)": só IP, usuário e senha — o sistema pergunta à câmera o endereço do vídeo |
| Modelos por marca | Hikvision, Intelbras, Dahua, XMEye/iCSee, Tapo, Reolink, Uniview, Yoosee, Axis, ou URL manual (RTSP, RTMP, HTTP/HLS) |
| **Local no mapa** | No cadastro: clicar no mapa, arrastar o ícone ou "Usar minha localização" |
| **Tema claro / escuro** | Claro por padrão; botão no topo troca e o navegador lembra a escolha |
| **Acesso por pessoa** | Administrador cria login + senha, define se a pessoa pode cadastrar câmeras e marca quais câmeras ela vê (e se vê gravações). Cada um pode trocar a própria senha |
| Mosaico | 1, 4, 9 ou 16 câmeras, páginas e rodízio automático |
| Gravação e linha do tempo | Blocos de 60 s, 1 a 90 dias por câmera; reprodução de 1x a 8x |
| Grupos de vizinhança | Cada morador decide quais câmeras **suas** entram no grupo |
| Link temporário | Ao vivo ou trecho gravado, com validade, senha e limite de acessos |
| Segurança | Senha da câmera nunca vai para o navegador; senhas com scrypt; sessões HttpOnly; CSP; limite de tentativas de login |

## Sobre o QR e o código da etiqueta

O QR da etiqueta traz o **nº de série** e um **código de verificação**, feitos para o app de
nuvem do fabricante (Hik-Connect, Imou, Intelbras Cloud, iCSee). Em várias marcas esse código
também é a senha da câmera. O sistema usa esses dados assim:

1. Lê o QR (ou o código digitado) e preenche marca, nº de série e senha.
2. Procura na rede, por ONVIF, a câmera com aquele nº de série e pega o endereço do vídeo.
3. Testa a conexão. Falta só dar um nome e salvar.

**Limite:** isso funciona quando a câmera está na mesma rede do servidor. Conectar **só pelo
nº de série, pela internet**, passa pela nuvem do fabricante e exige contrato de integração
com cada um (por exemplo a Imou Open API ou a EZVIZ Open Platform). Esta versão não faz isso. Para câmera em
outro lugar, use o IP/DDNS da câmera, uma VPN, ou rode o sistema num mini-PC na rede do local.

Câmeras **só-nuvem** (algumas Tuya/Smart Life, Ring, Nest) não liberam o vídeo para outros
sistemas; o leitor de QR avisa quando reconhece uma delas.

## Limites desta versão

- O mapa usa os mapas gratuitos do OpenStreetMap; para muitos acessos por dia, use um provedor de mapas próprio (a política de uso do OpenStreetMap limita o volume).
- O ao vivo tem alguns segundos de atraso (HLS, não medido em câmera real). Para menos de 1 s, colocar o [MediaMTX](https://github.com/bluenviron/mediamtx) na frente e servir WebRTC.
- Ainda não tem: detecção de movimento e alertas, controle PTZ, chat do grupo, 2FA, app Android/Windows (o site funciona no celular).
- Cada câmera ativa é um processo `ffmpeg`. Sem conversão o custo de CPU é baixo; com "Converter para H.264", conte ~1 núcleo para cada 2–4 câmeras 1080p.

## Estrutura

```
server.js              HTTP, rotas, primeiro acesso, links públicos
lib/streams.js         um ffmpeg por câmera: HLS ao vivo + gravação
lib/recordings.js      índice das gravações, reprodução, retenção
lib/onvif.js           busca na rede (WS-Discovery) e endereço do vídeo via ONVIF
lib/access.js          quem vê qual câmera (dono, liberada pelo admin, grupo)
lib/users.js           pessoas, logins e câmeras liberadas (admin)
lib/api.js             câmeras, compartilhamentos, grupos, links
lib/presets.js         modelos de URL por marca
lib/db.js              banco SQLite e migração da versão anterior
public/                interface (HTML + JS sem framework, Leaflet para o mapa, jsQR para QR)
public/js/qr-parse.js  leitura dos QR das marcas
tests/                 testes com câmeras simuladas
```
