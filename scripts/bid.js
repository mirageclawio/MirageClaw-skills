#!/usr/bin/env node
// SECURITY MANIFEST:
//   Environment variables accessed: MARKETPLACE_API_KEY
//   External endpoints called: {BASE}/upload/image, {BASE}/upload/video, {BASE}/jobs/:jobId/bids
//   Local files read: --preview path (must be under /tmp/)
//   Local files written: none

'use strict';

require('./lib/env').loadEnv();

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { CONFIG_PATH } = require('./lib/constants');
const BASE_URL = 'https://api.mirageclaw.io';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    if (i + 1 >= argv.length) break; // bounds check: skip if no value
    args[argv[i].replace('--', '')] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args['job-id'] || !args.preview || !args.price || !args.introduction) {
  console.error('[Bid] Usage: bid.js --job-id <id> --preview <path> --price <n> --introduction <text> [--protection <low|medium|high>] [--preview-type <image|video>]');
  process.exit(1);
}

const protection = args.protection || 'medium';

// Path traversal defense
const previewPath = path.resolve(args.preview);
if (!previewPath.startsWith('/tmp/')) {
  console.error('[Bid] ERROR: Preview path must be under /tmp/');
  process.exit(1);
}
if (!fs.existsSync(previewPath)) {
  console.error(`[Bid] ERROR: Preview file not found: ${previewPath}`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch (err) {
  console.error('[Bid] ERROR: Failed to read config:', err.message);
  process.exit(1);
}

if (!config.agentId) {
  console.error('[Bid] ERROR: agentId not found. Run register.js first.');
  process.exit(1);
}

// ─── Validate API Key ────────────────────────────────────────────────────
const apiKey = process.env.MARKETPLACE_API_KEY;
if (!apiKey) {
  console.error('[Bid] ERROR: MARKETPLACE_API_KEY not set.');
  process.exit(1);
}

// Mime type from extension
const ext      = path.extname(previewPath).toLowerCase();
const { MIME_MAP, isVideo } = require('./lib/constants');
const mimeType = MIME_MAP[ext] || 'image/png';

// ── Determine preview type (auto-detect or CLI override) ──────────────────
const previewType = args['preview-type'] || (isVideo(ext) ? 'video' : 'image');

// ── Main (async for fetch) ───────────────────────────────────────────────
(async () => {
  // ── Step 1: Upload ─────────────────────────────────────────────────────
  const uploadUrl = previewType === 'video'
    ? `${BASE_URL}/upload/video?protection=${protection}`
    : `${BASE_URL}/upload/image?purpose=bid_preview&protection=${protection}`;

  console.log(`[Bid] Uploading preview (${mimeType}, type=${previewType}, protection=${protection})...`);

  const fileBuffer = fs.readFileSync(previewPath);
  const blob = new Blob([fileBuffer], { type: mimeType });
  const form = new FormData();
  form.append('file', blob, path.basename(previewPath));

  let uploadRes;
  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form
    });
    if (!res.ok) {
      console.error(`[Bid] ERROR: Upload failed (HTTP ${res.status})`);
      console.error('[Bid] Response:', await res.text());
      process.exit(1);
    }
    uploadRes = await res.json();
  } catch (err) {
    console.error('[Bid] ERROR: Upload failed:', err.message);
    process.exit(1);
  }

  const previewUrl = uploadRes.url;
  const originalPath = uploadRes.originalPath || null;
  if (!previewUrl) {
    console.error('[Bid] ERROR: No URL in upload response');
    process.exit(1);
  }
  console.log(`[Bid] 📤 Uploaded: ${previewUrl}`);
  if (originalPath) console.log(`[Bid] 🔒 Original path: ${originalPath}`);

  // ── Step 2: Submit bid ─────────────────────────────────────────────────
  const bidPayload = {
    agentId: config.agentId,
    introduction: args.introduction,
    preview: previewUrl,
    originalPath: originalPath,
    price: Number(args.price),
    previewType: previewType
  };

  try {
    const res = await fetch(`${BASE_URL}/jobs/${args['job-id']}/bids`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(bidPayload)
    });

    if (res.status === 409) { console.log(`[Bid] SKIP — Already bid on Job #${args['job-id']}`); process.exit(0); }
    if (res.status === 400) { console.log(`[Bid] SKIP — Job #${args['job-id']} no longer open`); process.exit(0); }

    if (!res.ok) {
      console.error(`[Bid] ERROR: Bid failed (HTTP ${res.status}):`, await res.text());
      process.exit(1);
    }

    console.log(`[Bid] ✅ Bid submitted — Job #${args['job-id']} @ ${args.price}`);
  } catch (err) {
    console.error(`[Bid] ERROR: Bid failed: ${err.message}`);
    process.exit(1);
  }
})();
