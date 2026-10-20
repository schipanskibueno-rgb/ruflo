'use strict';

// ONVIF network search + automatic stream address, against a simulated camera:
// a UDP responder for WS-Discovery and an HTTP SOAP endpoint that checks the password digest.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mbs-onvif-'));
process.env.MBS_DATA_DIR = DATA;
process.env.MBS_DISCOVERY_ADDR = '127.0.0.1';

const CAMERA = { user: 'admin', pass: 'ABCDEF', serial: 'DS-2CD1023G0E-I20230101AAWRF12345678' };
let soapPort;
let probes = 0;

function soapServer() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const nonce = /<wsse:Nonce[^>]*>([^<]+)</.exec(body);
      const created = /<wsu:Created>([^<]+)</.exec(body);
      const digest = /<wsse:Password[^>]*>([^<]+)</.exec(body);
      const user = /<wsse:Username>([^<]+)</.exec(body);
      const expected = nonce && crypto.createHash('sha1')
        .update(Buffer.concat([Buffer.from(nonce[1], 'base64'), Buffer.from(created[1] + CAMERA.pass)])).digest('base64');
      const send = (inner, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/soap+xml' });
        res.end(`<?xml version="1.0"?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"
          xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
          xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><env:Body>${inner}</env:Body></env:Envelope>`);
      };
      if (!user || user[1] !== CAMERA.user || digest[1] !== expected) {
        return send('<env:Fault><env:Code><env:Value>env:Sender</env:Value><env:Subcode><env:Value>ter:NotAuthorized</env:Value></env:Subcode></env:Code></env:Fault>', 400);
      }
      if (body.includes('GetDeviceInformation')) {
        return send(`<tds:GetDeviceInformationResponse><tds:Manufacturer>HIKVISION</tds:Manufacturer><tds:Model>DS-2CD1023G0E-I</tds:Model>
          <tds:SerialNumber>${CAMERA.serial}</tds:SerialNumber></tds:GetDeviceInformationResponse>`);
      }
      if (body.includes('GetCapabilities')) {
        return send(`<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media><tt:XAddr>http://127.0.0.1:${soapPort}/onvif/Media</tt:XAddr>
          </tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse>`);
      }
      if (body.includes('GetProfiles')) {
        assert.equal(req.url, '/onvif/Media');
        return send('<trt:GetProfilesResponse><trt:Profiles token="Profile_1" fixed="true"></trt:Profiles><trt:Profiles token="Profile_2"></trt:Profiles></trt:GetProfilesResponse>');
      }
      if (body.includes('GetStreamUri')) {
        const token = /<trt:ProfileToken>([^<]+)</.exec(body)[1];
        const ch = token === 'Profile_2' ? '102' : '101';
        return send(`<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>rtsp://127.0.0.1:554/Streaming/Channels/${ch}?transportmode=unicast&amp;profile=${token}</tt:Uri></trt:MediaUri></trt:GetStreamUriResponse>`);
      }
      send('', 500);
    });
  });
}

let soap;
let udp;
let server;
let base;

test.before(async () => {
  soap = soapServer();
  await new Promise((r) => soap.listen(0, '127.0.0.1', r));
  soapPort = soap.address().port;
  udp = dgram.createSocket('udp4');
  udp.on('message', (msg, rinfo) => {
    if (!msg.toString().includes('Probe')) return;
    probes++;
    const reply = `<?xml version="1.0"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
      xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><e:Body><d:ProbeMatches><d:ProbeMatch>
      <d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/name/HIKVISION%20Portaria onvif://www.onvif.org/hardware/DS-2CD1023G0E-I</d:Scopes>
      <d:XAddrs>http://127.0.0.1:${soapPort}/onvif/device_service</d:XAddrs></d:ProbeMatch></d:ProbeMatches></e:Body></e:Envelope>`;
    udp.send(reply, rinfo.port, rinfo.address);
  });
  await new Promise((r) => udp.bind(0, '127.0.0.1', r));
  process.env.MBS_DISCOVERY_PORT = String(udp.address().port);

  const db = require('../lib/db');
  db.open();
  server = require('../server').createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  require('../lib/streams').stopAll();
  server.close();
  soap.close();
  udp.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});

async function call(cookie, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

test('procurar na rede, achar pelo nº de série e pegar o endereço RTSP sozinho', async () => {
  const { cookie } = await call('', 'POST', '/api/auth/setup', { name: 'Admin', login: 'admin', password: 'senha-forte-1' });

  const found = await call(cookie, 'GET', '/api/onvif/discover');
  assert.equal(found.status, 200);
  assert.ok(probes >= 1);
  assert.equal(found.data.length, 1);
  assert.equal(found.data[0].host, '127.0.0.1');
  assert.equal(found.data[0].name, 'HIKVISION Portaria');

  // QR from a Hikvision sticker: 9-char serial + 6-letter verification code (= password).
  const wrong = await call(cookie, 'POST', '/api/onvif/find', { serial: 'F12345678', username: 'admin', password: 'errada' });
  assert.equal(wrong.data.match, null, 'senha errada não acha');
  assert.equal(wrong.data.scanned, 1);
  const match = await call(cookie, 'POST', '/api/onvif/find', { serial: 'F12345678', username: 'admin', password: 'ABCDEF' });
  assert.equal(match.data.match.host, '127.0.0.1');
  assert.equal(match.data.match.manufacturer, 'HIKVISION');

  // Test + save with brand "onvif": the server asks the camera for its stream address.
  const badPass = await call(cookie, 'POST', '/api/cameras/test', { brand: 'onvif', host: '127.0.0.1', port: soapPort, username: 'admin', password: 'x' });
  assert.equal(badPass.data.ok, false);
  assert.match(badPass.data.error, /senha/);

  const cam = await call(cookie, 'POST', '/api/cameras', {
    name: 'Portaria', brand: 'onvif', host: '127.0.0.1', port: soapPort, stream: 1,
    username: 'admin', password: 'ABCDEF', serial: 'F12345678', enabled: false,
  });
  assert.equal(cam.status, 201, JSON.stringify(cam.data));
  assert.equal(cam.data.url, 'rtsp://127.0.0.1:554/Streaming/Channels/102?transportmode=unicast&profile=Profile_2');
  assert.equal(cam.data.serial, 'F12345678');

  // Editing without host keeps the resolved address and the password.
  const edited = await call(cookie, 'PUT', `/api/cameras/${cam.data.id}`, { name: 'Portaria 2', brand: 'onvif', username: 'admin', enabled: false });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.url, cam.data.url);
});
