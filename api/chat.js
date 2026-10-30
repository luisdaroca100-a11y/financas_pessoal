'use strict';

const { json, readBody, sleep } = require('./_lib');

const GROQ_BASE = process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

const SYSTEM =
  'Você é uma assistente de IA prestativa que conversa em português do Brasil. ' +
  'Responda de forma natural e direta, como o ChatGPT: entenda o que a pessoa quer, ' +
  'responda à pergunta, explique quando precisar e faça perguntas só quando algo ' +
  'estiver realmente ambíguo. Não repita a mesma pergunta várias vezes. ' +
  'Se a pessoa pedir algo que você não pode fazer, explique em uma frase e ofereça ' +
  'uma alternativa útil.';

async function callGroq(messages, key) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000);
    try {
      const r = await fetch(GROQ_BASE + '/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 1024
        })
      });
      if (r.ok) {
        const data = await r.json();
        const content = data && data.choices && data.choices[0] &&
          data.choices[0].message && data.choices[0].message.content;
        if (typeof content === 'string' && content.trim()) return content;
        throw new Error('empty_reply');
      }
      lastErr = new Error('groq_status_' + r.status);
      if (r.status === 429 || r.status >= 500) {
        await sleep(1200 * attempt);
        continue;
      }
      throw lastErr;
    } catch (e) {
      lastErr = e;
      if (e && e.name === 'AbortError') {
        await sleep(1000 * attempt);
        continue;
      }
      if (attempt < 3 && lastErr && /^groq_status_(429|5\d\d)$/.test(lastErr.message)) {
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('groq_failed');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return json(res, 500, {
      error: 'groq_not_configured',
      message: 'GROQ_API_KEY não configurada no projeto.'
    });
  }

  const body = await readBody(req);
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({ role: m.role, content: m.content }))
    .slice(-30);

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json(res, 400, { error: 'empty_message' });
  }

  try {
    const reply = await callGroq([{ role: 'system', content: SYSTEM }, ...messages], key);
    return json(res, 200, { reply, provider: 'groq' });
  } catch (e) {
    return json(res, 502, {
      error: 'groq_unavailable',
      message: 'A assistente está indisponível agora. Tente de novo em instantes.'
    });
  }
};
