'use strict';

// ONVIF is the vendor-neutral camera standard (Intelbras, Hikvision, Dahua, XMEye, Tapo...).
// Two uses here:
//   discover()      WS-Discovery multicast probe: lists cameras on the server's network.
//   getStreamUri()  asks the camera itself for its RTSP address, so no brand template is needed.
// Responses are parsed with small regexes on local element names; no XML library needed.
const crypto = require('crypto');
const dgram = require('dgram');
const { HttpError } = require('./http');

const DISCOVERY_ADDR = process.env.MBS_DISCOVERY_ADDR || '239.255.255.250';
const DISCOVERY_PORT = Number(process.env.MBS_DISCOVERY_PORT) || 3702;

const tag = (xml, name) => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? m[1].trim() : '';
};
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const scope = (scopes, key) => {
  const m = new RegExp(`onvif://www\\.onvif\\.org/${key}/([^\\s]+)`).exec(scopes);
  return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : '';
};

function discover({ timeout = 3000 } = {}) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map();
    const probe = `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
<e:Header><w:MessageID>uuid:${crypto.randomUUID()}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>
<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`;
    socket.on('message', (msg, rinfo) => {
      const xml = msg.toString('utf8');
      const xaddr = tag(xml, 'XAddrs').split(/\s+/).find((a) => /^https?:\/\//.test(a));
      if (!xaddr) return;
      const scopes = tag(xml, 'Scopes');
      let host = rinfo.address;
      try {
        host = new URL(xaddr).hostname;
      } catch {
        /* keep sender address */
      }
      found.set(xaddr, { host, xaddr, name: scope(scopes, 'name'), hardware: scope(scopes, 'hardware') });
    });
    socket.on('error', () => finish());
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve([...found.values()].sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true })));
    }
    socket.bind(0, () => {
      const buf = Buffer.from(probe);
      socket.send(buf, DISCOVERY_PORT, DISCOVERY_ADDR, () => {});
      setTimeout(() => socket.send(buf, DISCOVERY_PORT, DISCOVERY_ADDR, () => {}), 300);
    });
    setTimeout(finish, timeout);
  });
}

function securityHeader(user, pass) {
  if (!user) return '';
  const nonce = crypto.randomBytes(16);
  const created = new Date().toISOString();
  const digest = crypto.createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created + (pass || ''))])).digest('base64');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<s:Header><wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
 xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken>
<wsse:Username>${esc(user)}</wsse:Username>
<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password>
<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</wsse:Nonce>
<wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>`;
}

function checkUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, 'Endereço ONVIF inválido.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'Endereço ONVIF inválido.');
  return u.toString();
}

async function soap(url, body, user, pass) {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
 xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
 xmlns:tt="http://www.onvif.org/ver10/schema">${securityHeader(user, pass)}<s:Body>${body}</s:Body></s:Envelope>`;
  let res;
  try {
    res = await fetch(checkUrl(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
      body: envelope,
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
  } catch {
    throw new HttpError(502, 'A câmera não respondeu no endereço ONVIF.');
  }
  const xml = await res.text();
  if (/NotAuthorized|Unauthorized|not authorized/i.test(xml) || res.status === 401) {
    throw new HttpError(401, 'Usuário ou senha da câmera incorretos.');
  }
  if (!res.ok) throw new HttpError(502, `A câmera recusou o pedido ONVIF (HTTP ${res.status}).`);
  return xml;
}

async function getDeviceInfo(xaddr, user, pass) {
  const xml = await soap(xaddr, '<tds:GetDeviceInformation/>', user, pass);
  return { manufacturer: tag(xml, 'Manufacturer'), model: tag(xml, 'Model'), serial: tag(xml, 'SerialNumber') };
}

// stream 0 = first (main) profile, 1 = second (sub) profile when the camera has one.
async function getStreamUri(xaddr, user, pass, stream = 0) {
  const caps = await soap(xaddr, '<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>', user, pass);
  const mediaBlock = /<(?:[\w-]+:)?Media>([\s\S]*?)<\/(?:[\w-]+:)?Media>/.exec(caps);
  const mediaUrl = (mediaBlock && tag(mediaBlock[1], 'XAddr')) || xaddr;
  const profiles = await soap(mediaUrl, '<trt:GetProfiles/>', user, pass);
  const tokens = [...profiles.matchAll(/<(?:[\w-]+:)?Profiles[^>]*\btoken="([^"]+)"/g)].map((m) => m[1]);
  if (!tokens.length) throw new HttpError(502, 'A câmera não informou nenhum perfil de vídeo.');
  const token = tokens[Math.min(stream, tokens.length - 1)];
  const xml = await soap(
    mediaUrl,
    `<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol>` +
      `</tt:Transport></trt:StreamSetup><trt:ProfileToken>${token.replace(/[<&"]/g, '')}</trt:ProfileToken></trt:GetStreamUri>`,
    user,
    pass,
  );
  const uri = decode(tag(xml, 'Uri'));
  if (!/^rtsps?:\/\//i.test(uri)) throw new HttpError(502, 'A câmera não devolveu um endereço RTSP.');
  // Credentials are added by the server at stream time; never keep them inside the URL.
  const clean = new URL(uri);
  clean.username = '';
  clean.password = '';
  return clean.toString();
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Finds which camera on the network has this serial (as printed on the sticker / QR code).
async function findBySerial(serial, user, pass) {
  const want = norm(serial);
  if (want.length < 4) throw new HttpError(400, 'Número de série muito curto.');
  const devices = await discover();
  const checks = await Promise.all(
    devices.map((d) => getDeviceInfo(d.xaddr, user, pass).then((info) => ({ ...d, ...info })).catch(() => null)),
  );
  const match = checks.find((d) => d && norm(d.serial) && (norm(d.serial).includes(want) || want.includes(norm(d.serial))));
  return { match: match || null, scanned: devices.length };
}

module.exports = { discover, getDeviceInfo, getStreamUri, findBySerial, checkUrl };
