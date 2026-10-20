# CamHub — todas as câmeras num lugar só

Sistema web para cadastrar câmeras IP, DVR e NVR de **qualquer marca**, assistir ao vivo
num mosaico, gravar, voltar na linha do tempo e **compartilhar** com outras pessoas —
sem depender do aplicativo de cada fabricante.

## Como rodar

Requisitos: Node.js 22.13+ e `ffmpeg`/`ffprobe` instalados no servidor.

```bash
cd examples/camhub
npm install
npm start            # http://localhost:3000
npm test             # teste de ponta a ponta com uma câmera simulada
```

A primeira conta criada vira **administrador** (a "central"): ela enxerga todas as câmeras.

Variáveis de ambiente: `PORT`, `CAMHUB_DATA_DIR` (banco + gravações, padrão `./data`),
`COOKIE_SECURE=1` (quando estiver atrás de HTTPS), `FFMPEG_PATH`, `FFPROBE_PATH`.

## O que já faz

| Recurso | Como |
|---|---|
| Cadastro de câmera de qualquer marca | Modelos prontos de URL RTSP para Hikvision, Intelbras, Dahua, XMEye/iCSee, Tapo, Reolink, Uniview, Yoosee, Axis, ou URL manual (RTSP, RTMP, HTTP/HLS) |
| Testar conexão | Botão "Testar conexão" usa `ffprobe` e mostra codec e resolução |
| Mosaico ao vivo | 1, 4, 9 ou 16 câmeras, páginas e rodízio automático, foto instantânea |
| Gravação contínua | Blocos de 60 s, retenção por câmera (1 a 90 dias), limpeza automática |
| Linha do tempo | Escolhe o dia, clica na faixa verde e assiste de 1x a 8x |
| Compartilhar com uma pessoa | Por e-mail; escolhe se pode ver gravações ou só o ao vivo |
| Grupos (vizinhança/condomínio) | O administrador cria o grupo e convida pessoas; cada morador decide quais câmeras **suas** entram |
| Link temporário | Ao vivo ou trecho gravado, com validade, senha e limite de acessos; revogar corta quem já abriu |
| Segurança | Senha de câmera nunca vai para o navegador; senhas com scrypt; sessões HttpOnly; CSP; limite de tentativas |

## Como cadastrar câmeras de apps diferentes

O que torna a câmera "independente do app" é o **RTSP**: quase todo DVR, NVR e câmera IP
tem esse recurso, mesmo quando o fabricante empurra o aplicativo próprio.

- **Intelbras / Dahua / Hikvision / Uniview / Reolink:** RTSP vem ligado. Use o IP, a porta 554, o usuário e a senha do equipamento.
- **XMEye / iCSee / Yoosee:** normalmente funciona na porta 554; algumas pedem para ativar "RTSP" ou "ONVIF" no app.
- **Tapo:** crie uma "Conta da câmera" em *Configurações avançadas* no app Tapo; esse usuário/senha é o do RTSP.
- **Câmeras só-nuvem** (algumas Tuya/Smart Life, Mibo Cloud, Ring, Nest): não expõem RTSP, então não dá para puxar a imagem sem o fabricante. Nesse caso troque a câmera ou use um DVR.
- **H.265:** marque "Converter para H.264" (o botão de teste avisa quando precisa). Navegadores não tocam H.265.

## Câmeras em outro endereço (fora da rede do servidor)

O servidor **busca** o vídeo na câmera. Se a câmera está na casa do cliente e o servidor
está na nuvem, uma destas opções é necessária:

1. Redirecionar a porta 554 no roteador do cliente e usar DDNS (ex.: `cliente.ddns.net`).
2. VPN entre o local e o servidor (WireGuard/Tailscale) — mais seguro que abrir porta.
3. Rodar o CamHub num computador/mini-PC dentro da rede do cliente.

## Limites desta versão e próximos passos

- O ao vivo tem alguns segundos de atraso (HLS, não medido em câmera real). Para menos de 1 s, colocar o [MediaMTX](https://github.com/bluenviron/mediamtx) na frente e servir WebRTC.
- Câmeras que **enviam** o vídeo (RTMP push do DVR) precisam de um servidor RTMP como o MediaMTX.
- Ainda não tem: detecção de movimento e alertas, PTZ/ONVIF, mapa, chat do grupo, 2FA, app Android/Windows (o site já funciona no celular), cobrança.
- O SQLite embutido do Node (`node:sqlite`) atende uma central pequena/média; para muitos servidores, trocar por PostgreSQL.
- Cada câmera ativa é um processo `ffmpeg`. Sem conversão, o custo de CPU é baixo (só copia o vídeo); com "Converter para H.264", conte ~1 núcleo para cada 2–4 câmeras 1080p.

## Estrutura

```
server.js            HTTP, rotas, links públicos
lib/streams.js       um ffmpeg por câmera: HLS ao vivo + gravação
lib/recordings.js    índice das gravações, playlists de reprodução, retenção
lib/access.js        quem vê qual câmera (dono, compartilhamento, grupo)
lib/api.js           câmeras, compartilhamentos, grupos, links
lib/presets.js       modelos de URL por marca
public/              interface web (sem framework)
tests/e2e.test.js    teste completo com câmera simulada
```
