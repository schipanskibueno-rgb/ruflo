'use strict';

// Recording index and playback playlists. ffmpeg writes one CSV per process run with
// "file,start,end" lines (relative seconds); the file name carries the UTC start time.
const fs = require('fs');
const path = require('path');
const { recDir } = require('./streams');

const SEGMENT_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.ts$/;

function fileStart(name) {
  const m = SEGMENT_RE.exec(name);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

function listSegments(cameraId, fromMs = 0, toMs = Number.MAX_SAFE_INTEGER) {
  const dir = recDir(cameraId);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const present = new Set(entries.filter((f) => SEGMENT_RE.test(f)));
  const segments = [];
  for (const csv of entries.filter((f) => /^list-\d+\.csv$/.test(f))) {
    const text = fs.readFileSync(path.join(dir, csv), 'utf8');
    for (const line of text.split('\n')) {
      const [file, startRel, endRel] = line.trim().split(',');
      if (!present.has(file)) continue;
      const start = fileStart(file);
      const duration = Number(endRel) - Number(startRel);
      if (!(duration > 0)) continue;
      const end = start + duration * 1000;
      if (end < fromMs || start > toMs) continue;
      segments.push({ file, start, duration });
    }
  }
  return segments.sort((a, b) => a.start - b.start);
}

// Merges consecutive segments into ranges for the timeline bar.
function ranges(segments) {
  const out = [];
  for (const s of segments) {
    const end = s.start + s.duration * 1000;
    const last = out[out.length - 1];
    if (last && s.start - last.end < 5000) last.end = Math.max(last.end, end);
    else out.push({ start: s.start, end });
  }
  return out;
}

function playlist(segments, urlPrefix) {
  const target = Math.ceil(Math.max(1, ...segments.map((s) => s.duration)));
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${target}`, '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-MEDIA-SEQUENCE:0'];
  segments.forEach((s, i) => {
    // Every chunk restarts its timestamps at zero, so mark each boundary.
    if (i > 0) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(s.start).toISOString()}`);
    lines.push(`#EXTINF:${s.duration.toFixed(3)},`, `${urlPrefix}${s.file}`);
  });
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}

function isSegmentName(name) {
  return SEGMENT_RE.test(name);
}

// Deletes recordings older than the camera's retention and CSV indexes that point to nothing.
function prune(cameraId, retentionDays) {
  const dir = recDir(cameraId);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - retentionDays * 86400e3;
  let removed = 0;
  for (const f of entries) {
    const start = fileStart(f);
    if (start !== null && start < cutoff) {
      fs.rmSync(path.join(dir, f), { force: true });
      removed++;
    }
  }
  const left = new Set(fs.readdirSync(dir));
  for (const csv of entries.filter((f) => /^list-\d+\.csv$/.test(f))) {
    const created = Number(csv.slice(5, -4));
    if (created > cutoff) continue;
    const files = fs.readFileSync(path.join(dir, csv), 'utf8').split('\n').map((l) => l.split(',')[0]).filter(Boolean);
    if (!files.some((f) => left.has(f))) fs.rmSync(path.join(dir, csv), { force: true });
  }
  return removed;
}

module.exports = { listSegments, ranges, playlist, isSegmentName, prune };
