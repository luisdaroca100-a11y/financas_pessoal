'use strict';

const { sendJSON } = require('./_lib');

// Configuração pública do frontend. NUNCA expõe chaves secretas:
// só a anon key do Supabase (pública por desenho) e flags.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return sendJSON(res, 405, { error: 'method_not_allowed' });
  return sendJSON(res, 200, {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    groqConfigured: !!process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
  });
};
