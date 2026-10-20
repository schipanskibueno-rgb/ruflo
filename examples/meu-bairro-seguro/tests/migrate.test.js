'use strict';

// A database from the first version (e-mail login, no map columns) must upgrade in place
// without losing cameras: rebuilding the users table must not cascade-delete them.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mbs-migrate-'));
process.env.MBS_DATA_DIR = DATA;

test('migra banco da primeira versão sem perder câmeras', () => {
  const old = new DatabaseSync(path.join(DATA, 'bairro.db'));
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE cameras (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT 'generic', url TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL DEFAULT '', transcode INTEGER NOT NULL DEFAULT 0, audio INTEGER NOT NULL DEFAULT 0,
      record INTEGER NOT NULL DEFAULT 1, retention_days INTEGER NOT NULL DEFAULT 7, enabled INTEGER NOT NULL DEFAULT 1,
      location TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    INSERT INTO users VALUES (1, 'Antigo', 'antigo@x.com', 'h', 1, 1);
    INSERT INTO cameras (owner_id, name, url, created_at) VALUES (1, 'Portão', 'rtsp://x/1', 1);`);
  old.close();

  const db = require('../lib/db');
  db.open();
  assert.deepEqual({ ...db.one('SELECT login, can_add_cameras FROM users') }, { login: 'antigo@x.com', can_add_cameras: 1 });
  const cam = db.one('SELECT name, lat, serial FROM cameras');
  assert.deepEqual({ ...cam }, { name: 'Portão', lat: null, serial: '' });
  assert.equal(db.one('PRAGMA foreign_keys').foreign_keys, 1);
  db.get().close();
  fs.rmSync(DATA, { recursive: true, force: true });
});
