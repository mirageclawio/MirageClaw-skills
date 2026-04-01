'use strict';

const { LLM_MODELS } = require('./constants');

/**
 * Detect active LLM provider from environment variables.
 * Returns { provider, apiKey } or null if none found.
 */
function detectProvider() {
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY };
  }
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    return { provider: 'google', apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY };
  }
  return null;
}

/**
 * Call LLM with provider-specific routing.
 * @param {string} provider - 'anthropic' | 'openai' | 'google' | 'ollama'
 * @param {string} apiKey
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {object} opts - { maxTokens: 512, timeout: 20000 }
 * @returns {Promise<string|null>}
 */
async function callLLM(provider, apiKey, systemPrompt, userMessage, opts = {}) {
  const maxTokens = opts.maxTokens || 512;
  const timeout   = opts.timeout   || 20000;

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: LLM_MODELS.anthropic,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      }),
      signal: AbortSignal.timeout(timeout)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.content?.[0]?.text?.trim() || null;
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: LLM_MODELS.openai,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      }),
      signal: AbortSignal.timeout(timeout)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  }

  if (provider === 'google') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODELS.google}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: maxTokens }
      }),
      signal: AbortSignal.timeout(timeout)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  }

  if (provider === 'ollama') {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODELS.ollama,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      }),
      signal: AbortSignal.timeout(timeout > 20000 ? timeout : 30000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.message?.content?.trim() || null;
  }

  return null;
}

module.exports = { detectProvider, callLLM };
