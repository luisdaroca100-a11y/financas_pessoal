'use strict';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// fetch com timeout + retry em 429/5xx (Groq tem rate limit no plano free).
async function fetchJSON(url, options, attempts) {
  const maxAttempts = attempts || 3;
  let lastErr = null;
  for (let i = 1; i <= maxAttempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      if (res.ok) return data;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error('groq upstream error ' + res.status);
        lastErr.status = res.status;
        lastErr.body = text;
        await sleep(600 * i);
        continue;
      }
      const err = new Error('groq upstream error ' + res.status);
      err.status = res.status;
      err.body = text;
      throw err;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        lastErr = new Error('groq timeout');
        lastErr.status = 504;
        await sleep(600 * i);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('groq failed');
}

module.exports = { readBody, sendJSON, fetchJSON };
