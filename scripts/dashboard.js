#!/usr/bin/env node
// SECURITY MANIFEST:
//   Environment variables accessed: MARKETPLACE_API_KEY
//   External endpoints called: {BASE}/agents/:agentId
//   Local files read: ~/.openclaw/marketplace-config.json, ~/.openclaw/marketplace.env
//   Local files written: none

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { CONFIG_PATH } = require('./lib/constants');
const { fmtCredits, fmtNoShow } = require('./lib/format');
const { send, edit } = require('./lib/messaging');
require('./lib/env').loadEnv();

// Optional --message-id for edit-in-place (Refresh button)
const msgIdArg = process.argv.indexOf('--message-id');
const editMessageId = msgIdArg !== -1 ? process.argv[msgIdArg + 1] : null;

const BASE_URL = 'https://api.mirageclaw.io';

// ─── Load config ──────────────────────────────────────────────────────────
if (!fs.existsSync(CONFIG_PATH)) {
  process.stderr.write('[Dashboard] ERROR: marketplace-config.json not found.\n');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch (err) {
  process.stderr.write(`[Dashboard] ERROR: Failed to parse config: ${err.message}\n`);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function shortId(id) {
  if (!id) return 'Not registered';
  return id.length > 12 ? id.slice(0, 8) + '...' : id;
}

// ─── Main (async for fetch) ──────────────────────────────────────────────
const apiKey = process.env.MARKETPLACE_API_KEY;

(async () => {
  let agent = null;
  if (config.agentId && apiKey) {
    try {
      const res = await fetch(`${BASE_URL}/agents/mine`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        const agents = await res.json();
        agent = Array.isArray(agents) ? agents[0] : agents;
      }
    } catch (_) {
      // Server unreachable — show config-only dashboard
    }
  }

  // ─── Build dashboard ────────────────────────────────────────────────────
  const name       = config.agentName || 'Agent';
  const statusIcon = agent?.isOnline ? '🟢 Online' : (agent ? '🔴 Offline' : '⚪ Unknown');

  const minBudget  = config.minBudget ?? 10;
  const maxNoShow  = fmtNoShow(config.maxNoShowRate);
  const preset     = config.presetMode ? 'On' : 'Off';
  const autoAccept = config.presetAutoAccept ? 'Yes' : 'No';
  const protection = config.presetProtection || 'medium';
  const bidPct     = config.presetPricePercent ?? 100;

  const available  = Number(agent?.availableEarnings) || 0;
  const withdrawn  = Number(agent?.withdrawnEarnings) || 0;
  const total      = Number(agent?.totalEarnings) || 0;

  const cap = config.capabilities?.visual || config.capabilities?.default;
  const apiName = typeof cap === 'string' ? 'Local script' : (cap?.api || 'N/A');
  const envKey  = typeof cap === 'string' ? '' : (cap?.envKey || '');
  const apiDisplay = envKey ? `${apiName} (${envKey})` : apiName;

  const lines = [
    `📊 Agent Dashboard — ${name}`,
    ``,
    `═══ Profile ═══════════════════`,
    `  Agent ID   : ${shortId(config.agentId)}`,
    `  Name       : ${name}`,
    `  Status     : ${statusIcon}`,
    ``,
    `═══ Settings ══════════════════`,
    `  Min Budget : ${fmtCredits(minBudget)}`,
    `  Max NoShow : ${maxNoShow}`,
    `  Preset     : ${preset}`,
  ];

  if (config.presetMode) {
    lines.push(
      `  Auto-Accept: ${autoAccept}`,
      `  Protection : ${protection}`,
      `  Bid Price  : ${bidPct}%`,
    );
  }

  lines.push(``, `═══ Credits ═══════════════════`);

  if (agent) {
    lines.push(
      `  Available  : ${fmtCredits(available)}`,
      `  Withdrawn  : ${fmtCredits(withdrawn)}`,
      `  Total      : ${fmtCredits(total)}`,
    );
  } else if (config.agentId) {
    lines.push(`  (Server unreachable)`);
  } else {
    lines.push(`  (Not registered)`);
  }

  lines.push(``, `═══ Image API ═════════════════`, `  Provider   : ${apiDisplay}`);

  const message = lines.join('\n');

  process.stdout.write(JSON.stringify({
    type: 'MARKETPLACE_DASHBOARD',
    ts: new Date().toISOString(),
    agentId: config.agentId || null
  }) + '\n');

  // ─── Inline buttons for settings ───────────────────────────────────────
  const presetLabel  = config.presetMode ? '✅ Preset' : '❌ Preset';
  const acceptLabel  = config.presetAutoAccept ? '✅ Auto-Accept' : '❌ Auto-Accept';
  const noshowLabel  = config.maxNoShowRate != null ? `🚫 NoShow ${config.maxNoShowRate}%` : '🚫 NoShow Off';

  const buttons = JSON.stringify([
    [
      { text: presetLabel,  callback_data: 'config preset' },
      { text: acceptLabel,  callback_data: 'config autoaccept' },
    ],
    [
      { text: `🔒 Protection: ${protection}`, callback_data: 'config protection' },
      { text: `💰 Bid: ${bidPct}%`,           callback_data: 'config bidprice' },
    ],
    [
      { text: `📊 Min: ${minBudget}c`,  callback_data: 'config minbudget' },
      { text: noshowLabel,               callback_data: 'config maxnoshow' },
    ],
    [
      { text: '🔄 Refresh', callback_data: 'dashboard' },
    ],
  ]);

  if (config.telegramChatId) {
    let sentMsgId = null;
    try {
      if (editMessageId) {
        sentMsgId = edit(config.telegramChatId, editMessageId, message, { buttons });
      } else {
        sentMsgId = send(config.telegramChatId, message, { buttons });
      }
    } catch (_) { /* non-blocking */ }

    if (sentMsgId) {
      fs.writeFileSync('/tmp/dashboard_msgid.txt', String(sentMsgId));
      process.stdout.write(JSON.stringify({
        type: 'MARKETPLACE_DASHBOARD_MSG_ID',
        messageId: sentMsgId
      }) + '\n');
    }
  }
})();
