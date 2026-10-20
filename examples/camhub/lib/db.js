'use strict';

const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cameras (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'generic',
  url TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  transcode INTEGER NOT NULL DEFAULT 0,
  audio INTEGER NOT NULL DEFAULT 0,
  record INTEGER NOT NULL DEFAULT 1,
  retention_days INTEGER NOT NULL DEFAULT 7,
  enabled INTEGER NOT NULL DEFAULT 1,
  location TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS camera_shares (
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_playback INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (camera_id, user_id)
);
CREATE TABLE IF NOT EXISTS share_groups (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES share_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS group_cameras (
  group_id INTEGER NOT NULL REFERENCES share_groups(id) ON DELETE CASCADE,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  can_playback INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, camera_id)
);
CREATE TABLE IF NOT EXISTS share_links (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('live', 'recording')),
  from_ts INTEGER,
  to_ts INTEGER,
  pass_hash TEXT,
  expires_at INTEGER NOT NULL,
  max_views INTEGER,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

let db;

function open(file = config.dbFile) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

function get() {
  if (!db) open();
  return db;
}

const one = (sql, ...params) => get().prepare(sql).get(...params);
const all = (sql, ...params) => get().prepare(sql).all(...params);
const run = (sql, ...params) => get().prepare(sql).run(...params);

function tx(fn) {
  get().exec('BEGIN');
  try {
    const out = fn();
    get().exec('COMMIT');
    return out;
  } catch (err) {
    get().exec('ROLLBACK');
    throw err;
  }
}

module.exports = { open, get, one, all, run, tx };
