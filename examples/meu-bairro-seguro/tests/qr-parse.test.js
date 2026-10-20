'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseCameraCode } = require('../public/js/qr-parse');

test('QR Hikvision/EZVIZ: série, código de verificação e modelo', () => {
  const r = parseCameraCode('ys7.com\r\nF12345678\r\nABCDEF\r\nCS-C6N-A0-1C2WFR');
  assert.equal(r.kind, 'serial');
  assert.equal(r.serial, 'F12345678');
  assert.equal(r.code, 'ABCDEF');
  assert.equal(r.model, 'CS-C6N-A0-1C2WFR');
  assert.equal(r.brand, 'hikvision');
});

test('QR Dahua/Imou/Intelbras com SN e SC', () => {
  const r = parseCameraCode('{SN:7F0ABC1PAZ12345,DT:IPC-C22EP,SC:a1b2c3d4}');
  assert.equal(r.serial, '7F0ABC1PAZ12345');
  assert.equal(r.code, 'a1b2c3d4');
  assert.equal(r.brand, 'dahua');
  assert.equal(parseCameraCode('Intelbras Mibo SN:ABC1234567,SC:zz99').brand, 'intelbras');
});

test('QR com endereço RTSP separa usuário e senha', () => {
  const r = parseCameraCode('rtsp://admin:s%40nha@192.168.0.20:554/stream1');
  assert.equal(r.kind, 'url');
  assert.equal(r.url, 'rtsp://192.168.0.20:554/stream1');
  assert.equal(r.username, 'admin');
  assert.equal(r.password, 's@nha');
});

test('link de app com id, código digitado e marcas só-nuvem', () => {
  assert.deepEqual(
    (({ kind, serial, brand }) => ({ kind, serial, brand }))(parseCameraCode('http://yoosee.co/qr?id=12345678')),
    { kind: 'serial', serial: '12345678', brand: 'yoosee' },
  );
  const typed = parseCameraCode('  a1b2c3d4e5f60718 ');
  assert.equal(typed.serial, 'a1b2c3d4e5f60718');
  assert.equal(typed.brand, 'xmeye');
  assert.equal(parseCameraCode('https://smartapp.tuya.com/s/p?p=abc').kind, 'cloud');
  assert.equal(parseCameraCode('').kind, 'empty');
});
