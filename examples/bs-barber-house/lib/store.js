'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = { bookings: [], blocks: [], gallery: [] };

if (fs.existsSync(DB_FILE)) {
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (err) {
    const backup = `${DB_FILE}.corrupt-${Date.now()}`;
    fs.copyFileSync(DB_FILE, backup);
    console.error(`[store] db.json ilegível, cópia salva em ${backup}:`, err.message);
  }
}

// Escrita atômica: grava em arquivo temporário e renomeia.
function save() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function newId() {
  return crypto.randomUUID();
}

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (const byte of crypto.randomBytes(6)) code += chars[byte % chars.length];
  return code;
}

module.exports = {
  get db() { return db; },
  save,
  newId,
  newCode,
  DATA_DIR,
  UPLOAD_DIR,
};
