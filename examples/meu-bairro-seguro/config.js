'use strict';

const path = require('path');

const DATA_DIR = path.resolve(process.env.MBS_DATA_DIR || path.join(__dirname, 'data'));

module.exports = {
  port: Number(process.env.PORT) || 3000,
  dataDir: DATA_DIR,
  dbFile: path.join(DATA_DIR, 'bairro.db'),
  mediaDir: path.join(DATA_DIR, 'media'),
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
  // Segment lengths: live HLS (low latency) and recording chunks.
  liveSegmentSeconds: 1,
  recordSegmentSeconds: Number(process.env.MBS_RECORD_SEGMENT_SECONDS) || 60,
  defaultRetentionDays: 7,
  sessionDays: 14,
  // Set COOKIE_SECURE=1 when serving over HTTPS (behind a reverse proxy).
  cookieSecure: process.env.COOKIE_SECURE === '1',
  // Only these schemes may be used as camera sources (no file:, no pipe:, etc.).
  allowedSchemes: ['rtsp:', 'rtsps:', 'rtmp:', 'rtmps:', 'http:', 'https:'],
};
