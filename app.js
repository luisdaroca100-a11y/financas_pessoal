'use strict';
/* ============================================================
   FinanSmart AI — aplicativo de controle financeiro pessoal
   Frontend vanilla (sem build). Dados: localStorage (modo local)
   ou Supabase REST + Auth (quando SUPABASE_URL/ANON_KEY setados).
   Assistente Luna AI: motor local com dados reais + Groq via
   /api/chat quando GROQ_API_KEY configurada no servidor.
   ============================================================ */

// __PURE_START__
function parseValorBR(s) {
  let t = String(s == null ? '' : s).trim().replace(/[R$\s]/g, '');
  if (!t) return NaN;
  if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return Number(t);
}
function fmt(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function chaveMes(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function indiceMes(ch) {
  const p = String(ch).split('-');
  return Number(p[0]) * 12 + (Number(p[1]) - 1);
}
function chaveDeIndice(i) {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return y + '-' + String(m).padStart(2, '0');
}
function deslocarMes(ch, n) { return chaveDeIndice(indiceMes(ch) + n); }
function rotuloMes(ch) {
  const p = String(ch).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function diaNoMes(y, m, d) {
  const last = new Date(y, m, 0).getDate();
  return Math.min(d, last);
}
function invoiceMonthFor(dateISO, card) {
  const y = Number(dateISO.slice(0, 4));
  const m = Number(dateISO.slice(5, 7));
  const d = Number(dateISO.slice(8, 10));
  let idx = y * 12 + (m - 1);
  if (card && card.closingDay && d > Number(card.closingDay)) idx += 1;
  return chaveDeIndice(idx);
}
function ocorrenciasNoMes(entry, ch) {
  // Devolve as ocorrências da entrada no mês ch (expande recorrentes).
  // Cada ocorrência: { date, attribution, valor }
  const out = [];
  const start = entry.date.slice(0, 7);
  const day = Number(entry.date.slice(8, 10));
  if (!entry.recurring) {
    if (start === ch) {
      out.push({ date: entry.date, attribution: entry.date.slice(0, 7), valor: entry.amount });
    }
    return out;
  }
  if (indiceMes(ch) < indiceMes(start)) return out;
  const p = ch.split('-');
  const y = Number(p[0]);
  const m = Number(p[1]);
  const dd = diaNoMes(y, m, day);
  const date = ch + '-' + String(dd).padStart(2, '0');
  out.push({ date, attribution: ch, valor: entry.amount });
  return out;
}
function expandEntries(state, ch) {
  // Ocorrências de lançamentos cujo mês de ATRIBUIÇÃO é ch.
  // (compras no cartão após o fechamento caem na fatura do mês seguinte,
  // então olhamos também as ocorrências do mês anterior.)
  const out = [];
  const cardsById = {};
  state.cards.forEach(function (c) { cardsById[c.id] = c; });
  const meses = [deslocarMes(ch, -1), ch];
  state.entries.forEach(function (e) {
    const card = e.cardId ? cardsById[e.cardId] : null;
    meses.forEach(function (m) {
      ocorrenciasNoMes(e, m).forEach(function (oc) {
        const attribution = e.cardId ? invoiceMonthFor(oc.date, card) : oc.attribution;
        if (attribution === ch) out.push({ entry: e, date: oc.date, valor: oc.valor });
      });
    });
  });
  return out;
}
function parcelasDoMes(state, ch) {
  const out = [];
  state.purchases.forEach(function (p) {
    const k = indiceMes(ch) - indiceMes(p.firstMonth);
    if (k < 0 || k >= p.n) return;
    out.push({
      purchase: p, k: k + 1, valor: p.total / p.n, mes: ch,
      pago: (p.paidMonths || []).indexOf(ch) !== -1
    });
  });
  return out;
}
function faturaCartao(state, cardId, ch) {
  const card = state.cards.find(function (c) { return c.id === cardId; });
  if (!card) return { avulsas: 0, parcelas: 0, total: 0, pagos: 0, pago: false, faltam: 0 };
  let avulsas = 0;
  expandEntries(state, ch).forEach(function (oc) {
    if (oc.entry.type === 'despesa' && oc.entry.cardId === cardId) avulsas += oc.valor;
  });
  let parcelas = 0;
  parcelasDoMes(state, ch).forEach(function (x) {
    if (x.purchase.cardId === cardId) parcelas += x.valor;
  });
  let pagos = 0;
  state.entries.forEach(function (e) {
    if (e.type === 'transferencia' && e.cardId === cardId && e.invoiceMonth === ch) pagos += e.amount;
  });
  const total = avulsas + parcelas;
  return { avulsas, parcelas, total, pagos, pago: total > 0 && pagos >= total - 0.009, faltam: Math.max(0, total - pagos) };
}
function usoCartao(state, cardId, ch) { return faturaCartao(state, cardId, ch).total; }
function ocorrenciasAte(entry, refISO) {
  // Ocorrências com data <= refISO (para evolução de saldo).
  const out = [];
  if (!entry.recurring) {
    if (entry.date <= refISO) out.push({ date: entry.date, valor: entry.amount });
    return out;
  }
  const startIdx = indiceMes(entry.date.slice(0, 7));
  const endIdx = indiceMes(refISO.slice(0, 7));
  const day = Number(entry.date.slice(8, 10));
  for (let i = startIdx; i <= endIdx; i++) {
    const ch = chaveDeIndice(i);
    const p = ch.split('-');
    const dd = diaNoMes(Number(p[0]), Number(p[1]), day);
    const date = ch + '-' + String(dd).padStart(2, '0');
    if (date <= refISO) out.push({ date, valor: entry.amount });
  }
  return out;
}
function saldoConta(state, accId, refISO) {
  const acc = state.accounts.find(function (a) { return a.id === accId; });
  if (!acc) return 0;
  const ref = refISO || new Date().toISOString().slice(0, 10);
  let s = Number(acc.initial) || 0;
  state.entries.forEach(function (e) {
    ocorrenciasAte(e, ref).forEach(function () {
      if (e.accountId === accId) {
        if (e.type === 'receita') s += e.amount;
        if (e.type === 'despesa') s -= e.amount;
        if (e.type === 'transferencia') s -= e.amount;
      }
      if (e.type === 'transferencia' && e.destAccountId === accId) s += e.amount;
    });
  });
  return s;
}
function saldoTotal(state, refISO) {
  return state.accounts.reduce(function (s, a) { return s + saldoConta(state, a.id, refISO); }, 0);
}
function totaisMes(state, ch) {
  let receitas = 0;
  let despesas = 0;
  expandEntries(state, ch).forEach(function (oc) {
    if (oc.entry.type === 'receita') receitas += oc.valor;
    if (oc.entry.type === 'despesa') despesas += oc.valor;
  });
  let parcelas = 0;
  parcelasDoMes(state, ch).forEach(function (x) { parcelas += x.valor; });
  let faturas = 0;
  state.cards.forEach(function (c) { faturas += faturaCartao(state, c.id, ch).total; });
  const comprometido = despesas + parcelas;
  return { receitas, despesas, parcelas, faturas, comprometido, sobra: receitas - comprometido };
}
function gastosPorCategoria(state, ch) {
  const map = {};
  expandEntries(state, ch).forEach(function (oc) {
    if (oc.entry.type !== 'despesa') return;
    const cat = oc.entry.category || 'Outros';
    map[cat] = (map[cat] || 0) + oc.valor;
  });
  parcelasDoMes(state, ch).forEach(function (x) {
    const cat = x.purchase.category || 'Compras';
    map[cat] = (map[cat] || 0) + x.valor;
  });
  return Object.keys(map).map(function (k) { return { categoria: k, valor: map[k] }; })
    .sort(function (a, b) { return b.valor - a.valor; });
}
function compromissosDoMes(state, ch) {
  const grupos = {
    receitas: [], fixas: [], assinaturas: [], emprestimos: [],
    parcelas: [], faturas: [], outras: []
  };
  expandEntries(state, ch).forEach(function (oc) {
    const e = oc.entry;
    if (e.type === 'receita') { grupos.receitas.push(oc); return; }
    if (e.type !== 'despesa') return;
    if (e.cardId) { grupos.faturas.push(oc); return; }
    if (e.recurring && e.kind === 'emprestimo') { grupos.emprestimos.push(oc); return; }
    if (e.recurring && (e.kind === 'assinatura' || e.category === 'Assinaturas')) { grupos.assinaturas.push(oc); return; }
    if (e.recurring) { grupos.fixas.push(oc); return; }
    grupos.outras.push(oc);
  });
  grupos.parcelas = parcelasDoMes(state, ch);
  function soma(arr, fn) { return arr.reduce(function (s, x) { return s + fn(x); }, 0); }
  const tReceitas = soma(grupos.receitas, function (x) { return x.valor; });
  const tComp = soma(grupos.fixas, function (x) { return x.valor; })
    + soma(grupos.assinaturas, function (x) { return x.valor; })
    + soma(grupos.emprestimos, function (x) { return x.valor; })
    + soma(grupos.parcelas, function (x) { return x.valor; })
    + soma(grupos.faturas, function (x) { return x.valor; })
    + soma(grupos.outras, function (x) { return x.valor; });
  return { grupos, tReceitas, tComp, disponivel: tReceitas - tComp };
}
function fimDaCompra(p) { return chaveDeIndice(indiceMes(p.firstMonth) + p.n - 1); }
function restanteCompra(p) {
  const pagos = (p.paidMonths || []).length;
  return { pagos, restantes: p.n - pagos, valorRestante: (p.n - pagos) * (p.total / p.n) };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseValorBR, fmt, esc, chaveMes, indiceMes, chaveDeIndice, deslocarMes,
    rotuloMes, diaNoMes, invoiceMonthFor, ocorrenciasNoMes, expandEntries,
    parcelasDoMes, faturaCartao, usoCartao, ocorrenciasAte, saldoConta,
    saldoTotal, totaisMes, gastosPorCategoria, compromissosDoMes,
    fimDaCompra, restanteCompra
  };
}
// __PURE_END__

const CATEGORIAS_RECEITA = ['Salário', 'Serviços', 'Vendas', 'Rendimentos', 'Outros'];
const CATEGORIAS_DESPESA = ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Lazer', 'Compras', 'Assinaturas', 'Outros'];
const TIPOS_CONTA = ['Conta corrente', 'Poupança', 'Carteira (espécie)', 'Conta digital', 'Outro'];
const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'Hipercard', 'American Express', 'Outra'];
const COR_CATEGORIA = {
  'Alimentação': '#f5b544', 'Moradia': '#5aa9ff', 'Transporte': '#10c98a',
  'Saúde': '#f26d6d', 'Lazer': '#a78bfa', 'Compras': '#f472b6',
  'Assinaturas': '#38bdf8', 'Outros': '#9db0a6', 'Salário': '#10c98a',
  'Serviços': '#5aa9ff', 'Vendas': '#f5b544', 'Rendimentos': '#a78bfa'
};
const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/* ================= CONFIG / MODO DE DADOS ================= */
let CONFIG = { supabaseUrl: '', supabaseAnonKey: '', groqConfigured: false, groqModel: '' };
let MODO = 'local'; // 'local' | 'supabase'
let SESSION = null; // { access_token, refresh_token, user }

const LS_DADOS = 'finansmart_v1';
const LS_SESSAO = 'finansmart_session';
const LS_CHAT = 'finansmart_luna_v1';
const LS_TEMA = 'finansmart_tema';

function estadoVazio() {
  return {
    profile: { name: 'Luis', theme: 'dark', alertLimit: 80 },
    accounts: [],
    cards: [],
    entries: [],
    purchases: []
  };
}
let state = estadoVazio();
let mesSel = chaveMes(new Date());
let cartaoAberto = null; // id do cartão com o detalhe aberto
let cartaoMes = null; // mês exibido dentro do detalhe do cartão
let comprasExpandidas = {}; // id da compra -> cronograma aberto no detalhe
let rotaAtual = 'dashboard';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function hojeISO() { return new Date().toISOString().slice(0, 10); }

function salvarLocal() {
  try { localStorage.setItem(LS_DADOS, JSON.stringify(state)); } catch (e) {}
}
function carregarLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_DADOS) || 'null');
    if (d && typeof d === 'object') {
      const base = estadoVazio();
      const s = Object.assign(base, d);
      s.profile = Object.assign(base.profile, d.profile || {});
      s.accounts = Array.isArray(d.accounts) ? d.accounts : [];
      s.cards = Array.isArray(d.cards) ? d.cards : [];
      s.entries = Array.isArray(d.entries) ? d.entries : [];
      s.purchases = Array.isArray(d.purchases) ? d.purchases : [];
      return s;
    }
  } catch (e) {}
  return estadoVazio();
}

/* ---------- Supabase REST (zero dependências) ---------- */
function sbHeaders(extra) {
  const h = {
    'apikey': CONFIG.supabaseAnonKey,
    'Content-Type': 'application/json'
  };
  if (SESSION && SESSION.access_token) h['Authorization'] = 'Bearer ' + SESSION.access_token;
  if (extra) Object.assign(h, extra);
  return h;
}
async function sbFetch(path, opts) {
  const r = await fetch(CONFIG.supabaseUrl + path, opts);
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
  if (!r.ok) {
    const msg = (data && (data.message || data.error_description || data.msg)) || ('Erro ' + r.status);
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}
async function sbAuth(action, body, useRefresh) {
  const url = CONFIG.supabaseUrl + '/auth/v1/' + action;
  const headers = { 'apikey': CONFIG.supabaseAnonKey, 'Content-Type': 'application/json' };
  if (useRefresh && SESSION) headers['Authorization'] = 'Bearer ' + SESSION.refresh_token;
  else if (SESSION && SESSION.access_token) headers['Authorization'] = 'Bearer ' + SESSION.access_token;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const data = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(data.msg || data.error_description || data.message || ('Erro ' + r.status));
  return data;
}
function guardarSessao(s) {
  SESSION = s;
  try {
    if (s) localStorage.setItem(LS_SESSAO, JSON.stringify(s));
    else localStorage.removeItem(LS_SESSAO);
  } catch (e) {}
}
function lerSessao() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SESSAO) || 'null');
    if (s && s.access_token) return s;
  } catch (e) {}
  return null;
}
async function sbValidarSessao() {
  if (!SESSION) return false;
  try {
    const me = await sbFetch('/auth/v1/user', { headers: sbHeaders() });
    SESSION.user = me;
    return true;
  } catch (e) {
    if (e.status === 401 && SESSION.refresh_token) {
      try {
        const data = await sbAuth('token?grant_type=refresh_token', { refresh_token: SESSION.refresh_token }, true);
        guardarSessao({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
        return true;
      } catch (e2) { guardarSessao(null); return false; }
    }
    return false;
  }
}
/* Mapeamento JS <-> linhas Supabase (id texto, user_id uuid) */
const TABELAS = {
  accounts: ['id', 'user_id', 'name', 'type', 'initial'],
  cards: ['id', 'user_id', 'name', 'bank', 'brand', 'limit_value', 'closing_day', 'due_day', 'best_day', 'color'],
  entries: ['id', 'user_id', 'type', 'description', 'amount', 'category', 'date', 'account_id', 'card_id', 'kind', 'recurring', 'invoice_month', 'dest_account_id'],
  purchases: ['id', 'user_id', 'name', 'total', 'card_id', 'n', 'first_month', 'category', 'paid_months'],
  profiles: ['id', 'name', 'theme']
};
function linhaParaConta(r) { return { id: r.id, name: r.name, type: r.type, initial: Number(r.initial) || 0 }; }
function contaParaLinha(a, userId) { return { id: a.id, user_id: userId, name: a.name, type: a.type, initial: a.initial }; }
function linhaParaCartao(r) {
  return { id: r.id, name: r.name, bank: r.bank || '', brand: r.brand || '', limit: Number(r.limit_value) || 0, closingDay: Number(r.closing_day) || 1, dueDay: Number(r.due_day) || 10, bestDay: Number(r.best_day) || 1, color: r.color || '#0a9a68' };
}
function cartaoParaLinha(c, userId) {
  return { id: c.id, user_id: userId, name: c.name, bank: c.bank, brand: c.brand, limit_value: c.limit, closing_day: c.closingDay, due_day: c.dueDay, best_day: c.bestDay, color: c.color };
}
function linhaParaEntry(r) {
  return { id: r.id, type: r.type, desc: r.description, amount: Number(r.amount) || 0, category: r.category || 'Outros', date: r.date, accountId: r.account_id || null, cardId: r.card_id || null, kind: r.kind || 'avulsa', recurring: !!r.recurring, invoiceMonth: r.invoice_month || null, destAccountId: r.dest_account_id || null };
}
function entryParaLinha(e, userId) {
  return { id: e.id, user_id: userId, type: e.type, description: e.desc, amount: e.amount, category: e.category, date: e.date, account_id: e.accountId, card_id: e.cardId, kind: e.kind, recurring: e.recurring, invoice_month: e.invoiceMonth, dest_account_id: e.destAccountId };
}
function linhaParaCompra(r) {
  return { id: r.id, name: r.name, total: Number(r.total) || 0, cardId: r.card_id || null, n: Number(r.n) || 1, firstMonth: r.first_month, category: r.category || 'Compras', paidMonths: Array.isArray(r.paid_months) ? r.paid_months : [] };
}
function compraParaLinha(p, userId) {
  return { id: p.id, user_id: userId, name: p.name, total: p.total, card_id: p.cardId, n: p.n, first_month: p.firstMonth, category: p.category, paid_months: p.paidMonths || [] };
}
async function sbCarregarTudo() {
  const userId = SESSION.user.id;
  const [accs, cards, entries, purs, profs] = await Promise.all([
    sbFetch('/rest/v1/accounts?select=*&user_id=eq.' + userId, { headers: sbHeaders() }),
    sbFetch('/rest/v1/cards?select=*&user_id=eq.' + userId, { headers: sbHeaders() }),
    sbFetch('/rest/v1/entries?select=*&user_id=eq.' + userId + '&order=date.asc', { headers: sbHeaders() }),
    sbFetch('/rest/v1/purchases?select=*&user_id=eq.' + userId, { headers: sbHeaders() }),
    sbFetch('/rest/v1/profiles?select=*&id=eq.' + userId, { headers: sbHeaders() })
  ]);
  state = estadoVazio();
  state.accounts = (accs || []).map(linhaParaConta);
  state.cards = (cards || []).map(linhaParaCartao);
  state.entries = (entries || []).map(linhaParaEntry);
  state.purchases = (purs || []).map(linhaParaCompra);
  if (profs && profs[0]) state.profile = { name: profs[0].name || 'Luis', theme: profs[0].theme || 'dark', alertLimit: Number(profs[0].alert_limit) || 80 };
}
async function sbUpsert(tabela, linha) {
  await sbFetch('/rest/v1/' + tabela, {
    method: 'POST',
    headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
    body: JSON.stringify(linha)
  });
}
async function sbDelete(tabela, id) {
  await sbFetch('/rest/v1/' + tabela + '?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE', headers: sbHeaders()
  });
}
/* Persistência unificada: local grava tudo; nuvem grava o objeto alterado */
async function persistir(objetoAlterado) {
  if (MODO === 'supabase' && objetoAlterado && SESSION) {
    const userId = SESSION.user.id;
    try {
      if (objetoAlterado._colecao === 'accounts') await sbUpsert('accounts', contaParaLinha(objetoAlterado, userId));
      if (objetoAlterado._colecao === 'cards') await sbUpsert('cards', cartaoParaLinha(objetoAlterado, userId));
      if (objetoAlterado._colecao === 'entries') await sbUpsert('entries', entryParaLinha(objetoAlterado, userId));
      if (objetoAlterado._colecao === 'purchases') await sbUpsert('purchases', compraParaLinha(objetoAlterado, userId));
      if (objetoAlterado._colecao === 'profile') {
        await sbUpsert('profiles', { id: userId, name: state.profile.name, theme: state.profile.theme, alert_limit: state.profile.alertLimit || 80 });
      }
    } catch (e) {
      toast('Não consegui salvar na nuvem: ' + e.message);
    }
  }
  salvarLocal();
}
async function removerDaNuvem(colecao, id) {
  if (MODO !== 'supabase') return;
  const mapa = { accounts: 'accounts', cards: 'cards', entries: 'entries', purchases: 'purchases' };
  await sbDelete(mapa[colecao], id);
}
function marcar(colecao, obj) {
  const c = Object.assign({}, obj);
  c._colecao = colecao;
  return c;
}

/* ================= UI HELPERS ================= */
const $ = function (id) { return document.getElementById(id); };
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('visivel');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('visivel'); }, 3200);
}
function openModal(html) {
  $('modalRoot').innerHTML = '<div class="modal aberto"><div class="folha">' + html + '</div></div>';
}
function closeModal() { $('modalRoot').innerHTML = ''; }
function mostrarErro(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('visivel', !!msg);
}
function nomeConta(id) {
  const a = state.accounts.find(function (x) { return x.id === id; });
  return a ? a.name : '';
}
function nomeCartao(id) {
  const c = state.cards.find(function (x) { return x.id === id; });
  return c ? c.name : '';
}
function dataBR(iso) {
  const p = String(iso || '').split('-');
  if (p.length !== 3) return '';
  return p[2] + '/' + p[1] + '/' + p[0];
}
function mesCurto(ch) {
  const p = ch.split('-');
  return MESES_PT[Number(p[1]) - 1].slice(0, 3) + '/' + p[0].slice(2);
}
function aplicarTema() {
  const tema = (state.profile && state.profile.theme) || 'dark';
  document.documentElement.setAttribute('data-theme', tema);
}
function limiteAlerta() { return Number((state.profile && state.profile.alertLimit) || 80); }
function atualizarBadgeModo() {
  const b = $('modoBadge');
  if (MODO === 'supabase') {
    b.textContent = 'Nuvem Supabase';
    b.classList.add('nuvem');
    $('sideUserSub').textContent = 'Sincronizado entre aparelhos';
  } else {
    b.textContent = 'Modo local';
    b.classList.remove('nuvem');
    $('sideUserSub').textContent = 'Seus dados neste aparelho';
  }
  $('sideUserName').textContent = 'Olá, ' + ((state.profile && state.profile.name) || 'Luis');
}

/* ================= GRÁFICOS SVG ================= */
function svgBarras(legendas, serieA, serieB, rotuloA, rotuloB) {
  const W = 560, H = 230, base = 190, topo = 18;
  const max = Math.max(1, Math.max.apply(null, serieA.concat(serieB)));
  const n = legendas.length;
  const larg = W / n;
  const bw = Math.min(26, larg / 4);
  let rects = '';
  let labels = '';
  for (let i = 0; i < n; i++) {
    const cx = larg * i + larg / 2;
    const hA = (serieA[i] / max) * (base - topo);
    const hB = (serieB[i] / max) * (base - topo);
    rects += '<rect x="' + (cx - bw - 3) + '" y="' + (base - hA) + '" width="' + bw + '" height="' + hA + '" rx="5" fill="#10c98a"><title>' + esc(rotuloA) + ': ' + fmt(serieA[i]) + '</title></rect>';
    rects += '<rect x="' + (cx + 3) + '" y="' + (base - hB) + '" width="' + bw + '" height="' + hB + '" rx="5" fill="#f26d6d"><title>' + esc(rotuloB) + ': ' + fmt(serieB[i]) + '</title></rect>';
    labels += '<text x="' + cx + '" y="' + (base + 18) + '" text-anchor="middle" font-size="11" fill="#9db0a6">' + esc(legendas[i]) + '</text>';
  }
  return '<svg class="grafico" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="rgba(255,255,255,.15)" />' +
    rects + labels +
    '<text x="4" y="14" font-size="11" fill="#9db0a6">' + fmt(max) + '</text></svg>' +
    '<div class="legenda"><span><i style="background:#10c98a"></i>' + esc(rotuloA) + '</span><span><i style="background:#f26d6d"></i>' + esc(rotuloB) + '</span></div>';
}
function svgDonut(partes) {
  const total = partes.reduce(function (s, p) { return s + p.valor; }, 0);
  if (!total) return '<div class="vazio">Sem gastos neste período.</div>';
  const R = 62, C = 2 * Math.PI * R;
  let off = 0;
  let segs = '';
  partes.forEach(function (p) {
    const frac = p.valor / total;
    const len = frac * C;
    segs += '<circle cx="80" cy="80" r="' + R + '" fill="none" stroke="' + (COR_CATEGORIA[p.categoria] || '#9db0a6') + '" stroke-width="20" stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 80 80)"><title>' + esc(p.categoria) + ': ' + fmt(p.valor) + '</title></circle>';
    off += len;
  });
  let legenda = '';
  partes.forEach(function (p) {
    legenda += '<span><i style="background:' + (COR_CATEGORIA[p.categoria] || '#9db0a6') + '"></i>' + esc(p.categoria) + ' — ' + fmt(p.valor) + ' (' + Math.round((p.valor / total) * 100) + '%)</span>';
  });
  return '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><svg width="160" height="160" viewBox="0 0 160 160">' + segs +
    '<text x="80" y="76" text-anchor="middle" font-size="13" fill="#9db0a6">Total</text>' +
    '<text x="80" y="96" text-anchor="middle" font-size="16" font-weight="800" fill="currentColor">' + fmt(total) + '</text></svg>' +
    '<div class="legenda" style="flex:1;min-width:170px">' + legenda + '</div></div>';
}
function svgLinha(rotulos, valores) {
  const W = 560, H = 210, base = 175, topo = 22;
  const max = Math.max.apply(null, valores);
  const min = Math.min.apply(null, valores.concat([0]));
  const span = Math.max(1, max - min);
  const stepX = W / Math.max(1, valores.length - 1);
  let pts = '';
  let dots = '';
  let labels = '';
  valores.forEach(function (v, i) {
    const x = stepX * i;
    const y = base - ((v - min) / span) * (base - topo);
    pts += (i ? ' ' : '') + x + ',' + y;
    dots += '<circle cx="' + x + '" cy="' + y + '" r="4.5" fill="#10c98a"><title>' + esc(rotulos[i]) + ': ' + fmt(v) + '</title></circle>';
    if (i % 2 === 0) labels += '<text x="' + x + '" y="' + (base + 18) + '" text-anchor="middle" font-size="11" fill="#9db0a6">' + esc(rotulos[i]) + '</text>';
  });
  return '<svg class="grafico" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="rgba(255,255,255,.15)" />' +
    '<polyline points="' + pts + '" fill="none" stroke="#10c98a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />' +
    dots + labels + '</svg>';
}

/* ================= FORMULÁRIOS ================= */
function optionsContas(sel, permitirVazio) {
  let h = permitirVazio ? '<option value="">Sem conta</option>' : '';
  state.accounts.forEach(function (a) {
    h += '<option value="' + a.id + '"' + (sel === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>';
  });
  return h;
}
function optionsCartoes(sel, vazioLabel) {
  let h = vazioLabel ? '<option value="">' + esc(vazioLabel) + '</option>' : '';
  state.cards.forEach(function (c) {
    h += '<option value="' + c.id + '"' + (sel === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
  });
  return h;
}
function formLancamentoHTML(tipo, pre) {
  const p = pre || {};
  const isRec = tipo === 'receita';
  const cats = isRec ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;
  const catOpts = cats.map(function (c) {
    return '<option' + (p.category === c ? ' selected' : '') + '>' + c + '</option>';
  }).join('');
  const tipoLabel = isRec ? 'Receita' : 'Despesa';
  return '<h3>' + (p.id ? 'Editar ' : 'Nova ') + tipoLabel + '</h3>' +
    '<form id="formLancamento" data-tipo="' + tipo + '" data-id="' + (p.id || '') + '">' +
    '<div class="campo"><label>Descrição</label><input id="fDesc" type="text" maxlength="60" required value="' + esc(p.desc || '') + '" placeholder="Ex.: ' + (isRec ? 'Salário' : 'Mercado') + '"></div>' +
    '<div class="linha-form"><div class="campo"><label>Valor (R$)</label><input id="fValor" type="text" inputmode="decimal" required value="' + (p.amount != null ? String(p.amount).replace('.', ',') : '') + '" placeholder="Ex.: 150,00"></div>' +
    '<div class="campo"><label>Data</label><input id="fData" type="date" required value="' + esc(p.date || hojeISO()) + '"></div></div>' +
    '<div class="linha-form"><div class="campo"><label>Categoria</label><select id="fCategoria">' + catOpts + '</select></div>' +
    (isRec
      ? '<div class="campo"><label>Conta</label><select id="fConta">' + optionsContas(p.accountId, true) + '</select></div>'
      : '<div class="campo"><label>Pago com</label><select id="fCartao">' + optionsCartoes(p.cardId, 'Conta / dinheiro') + '</select></div>') +
    '</div>' +
    (isRec
      ? ''
      : '<div class="campo"><label>Conta (quando pago com dinheiro)</label><select id="fConta">' + optionsContas(p.accountId, true) + '</select></div>') +
    (isRec
      ? '<div class="campo"><label><input id="fRecorrente" type="checkbox" style="width:auto"' + (p.recurring ? ' checked' : '') + '> Repetir todo mês (receita fixa)</label></div>'
      : '<div class="campo"><label>Tipo</label><select id="fKind">' +
        '<option value="avulsa"' + (p.kind === 'avulsa' || !p.kind ? ' selected' : '') + '>Avulsa (só este mês)</option>' +
        '<option value="fixa"' + (p.kind === 'fixa' ? ' selected' : '') + '>Fixa mensal</option>' +
        '<option value="assinatura"' + (p.kind === 'assinatura' ? ' selected' : '') + '>Assinatura mensal</option>' +
        '<option value="emprestimo"' + (p.kind === 'emprestimo' ? ' selected' : '') + '>Empréstimo / financiamento</option></select></div>') +
    '<div class="erro" id="erroForm"></div>' +
    '<div class="botoes"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">' + (p.id ? 'Salvar' : 'Adicionar') + '</button></div></form>';
}
function formTransferenciaHTML(pre) {
  const p = pre || {};
  return '<h3>Nova transferência / pagamento</h3>' +
    '<form id="formTransferencia" data-id="' + (p.id || '') + '">' +
    '<div class="campo"><label>Descrição</label><input id="fDesc" type="text" maxlength="60" required value="' + esc(p.desc || '') + '" placeholder="Ex.: Transferência para poupança"></div>' +
    '<div class="linha-form"><div class="campo"><label>Valor (R$)</label><input id="fValor" type="text" inputmode="decimal" required value="' + (p.amount != null ? String(p.amount).replace('.', ',') : '') + '"></div>' +
    '<div class="campo"><label>Data</label><input id="fData" type="date" required value="' + esc(p.date || hojeISO()) + '"></div></div>' +
    '<div class="campo"><label>Conta de origem (sai o dinheiro)</label><select id="fConta">' + optionsContas(p.accountId, false) + '</select></div>' +
    '<div class="campo"><label>Conta de destino (opcional)</label><select id="fDest">' + optionsContas(p.destAccountId, true) + '</select></div>' +
    '<div class="erro" id="erroForm"></div>' +
    '<div class="botoes"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Transferir</button></div></form>';
}
function formContaHTML(pre) {
  const p = pre || {};
  const tipoOpts = TIPOS_CONTA.map(function (t) {
    return '<option' + (p.type === t ? ' selected' : '') + '>' + t + '</option>';
  }).join('');
  return '<h3>' + (p.id ? 'Editar conta' : 'Nova conta') + '</h3>' +
    '<form id="formConta" data-id="' + (p.id || '') + '">' +
    '<div class="campo"><label>Nome do banco ou conta</label><input id="fNome" type="text" maxlength="40" required value="' + esc(p.name || '') + '" placeholder="Ex.: Banco Inter"></div>' +
    '<div class="campo"><label>Tipo de conta</label><select id="fTipo">' + tipoOpts + '</select></div>' +
    '<div class="campo"><label>Saldo inicial (R$)</label><input id="fSaldo" type="text" inputmode="decimal" required value="' + (p.initial != null ? String(p.initial).replace('.', ',') : '') + '" placeholder="Ex.: 1.000,00"><div class="ajuda">O saldo atual é calculado automaticamente com entradas e saídas.</div></div>' +
    '<div class="erro" id="erroForm"></div>' +
    '<div class="botoes"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Salvar</button></div></form>';
}
function formCartaoHTML(pre) {
  const p = pre || {};
  const bandOpts = BANDEIRAS.map(function (b) {
    return '<option' + (p.brand === b ? ' selected' : '') + '>' + b + '</option>';
  }).join('');
  function diaOpts(sel) {
    let h = '';
    for (let d = 1; d <= 31; d++) h += '<option' + (Number(sel) === d ? ' selected' : '') + '>' + d + '</option>';
    return h;
  }
  return '<h3>' + (p.id ? 'Editar cartão' : 'Novo cartão') + '</h3>' +
    '<form id="formCartao" data-id="' + (p.id || '') + '">' +
    '<div class="campo"><label>Nome do cartão</label><input id="fNome" type="text" maxlength="40" required value="' + esc(p.name || '') + '" placeholder="Ex.: Nubank"></div>' +
    '<div class="linha-form"><div class="campo"><label>Banco</label><input id="fBanco" type="text" maxlength="30" value="' + esc(p.bank || '') + '" placeholder="Ex.: Nubank"></div>' +
    '<div class="campo"><label>Bandeira</label><select id="fBandeira">' + bandOpts + '</select></div></div>' +
    '<div class="campo"><label>Limite total (R$)</label><input id="fLimite" type="text" inputmode="decimal" required value="' + (p.limit != null ? String(p.limit).replace('.', ',') : '') + '" placeholder="Ex.: 5.000,00"></div>' +
    '<div class="linha-form"><div class="campo"><label>Dia de fechamento</label><select id="fFech">' + diaOpts(p.closingDay || 1) + '</select></div>' +
    '<div class="campo"><label>Dia de vencimento</label><select id="fVenc">' + diaOpts(p.dueDay || 10) + '</select></div></div>' +
    '<div class="linha-form"><div class="campo"><label>Melhor dia de compra</label><select id="fMelhor">' + diaOpts(p.bestDay || 1) + '</select></div>' +
    '<div class="campo"><label>Cor do cartão</label><input id="fCor" type="color" value="' + esc(p.color || '#0a9a68') + '"></div></div>' +
    '<div class="erro" id="erroForm"></div>' +
    '<div class="botoes"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Salvar</button></div></form>';
}
function formCompraHTML(pre) {
  const p = pre || {};
  return '<h3>' + (p.id ? 'Editar compra parcelada' : 'Nova compra parcelada') + '</h3>' +
    '<form id="formCompra" data-id="' + (p.id || '') + '">' +
    '<div class="campo"><label>Nome da compra</label><input id="fNome" type="text" maxlength="60" required value="' + esc(p.name || '') + '" placeholder="Ex.: Celular"></div>' +
    '<div class="linha-form"><div class="campo"><label>Valor total (R$)</label><input id="fTotal" type="text" inputmode="decimal" required value="' + (p.total != null ? String(p.total).replace('.', ',') : '') + '" placeholder="Ex.: 1.200,00"></div>' +
    '<div class="campo"><label>Quantidade de parcelas</label><input id="fN" type="number" min="1" max="48" step="1" required value="' + (p.n || '') + '" placeholder="Ex.: 12"></div></div>' +
    '<div class="linha-form"><div class="campo"><label>Cartão utilizado</label><select id="fCartao">' + optionsCartoes(p.cardId, 'Sem cartão (boleto / carnê)') + '</select></div>' +
    '<div class="campo"><label>Categoria</label><select id="fCategoria">' + CATEGORIAS_DESPESA.map(function (c) { return '<option' + (p.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div></div>' +
    '<div class="campo"><label>Mês da primeira parcela</label><input id="fInicio" type="month" required value="' + esc(p.firstMonth || mesSel) + '"></div>' +
    '<div class="erro" id="erroForm"></div>' +
    '<div class="botoes"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Salvar</button></div></form>';
}
function formPagarFaturaHTML(cardId, ch) {
  const fat = faturaCartao(state, cardId, ch);
  const card = state.cards.find(function (c) { return c.id === cardId; });
  return '<h3>Pagar fatura — ' + esc(card.name) + '</h3>' +
    '<p class="sub" style="margin-bottom:14px">Fatura de ' + esc(rotuloMes(ch)) + ': <b>' + fmt(fat.total) + '</b> &bull; já pago: ' + fmt(fat.pagos) + ' &bull; faltam: <b>' + fmt(fat.faltam) + '</b></p>' +
    '<form id="formPagarFatura" data-card="' + cardId + '" data-mes="' + ch + '">' +
    '<div class="campo"><label>Conta de onde sai o pagamento</label><select id="fConta">' + optionsContas(null, false) + '</select></div>' +
    '<div class="campo"><label>Valor a pagar (R$)</label><input id="fValor" type="text" inputmode="decimal" required value="' + String(Math.max(0, fat.faltam)).replace('.', ',') + '"></div>' +
    '<div class="campo"><label>Data do pagamento</label><input id="fData" type="date" required value="' + hojeISO() + '"></div>' +
    '<div class="erro" id="erroForm"></div>' +
    '<div class="botoes"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button>' +
    '<button type="submit" class="btn btn-primary">Confirmar pagamento</button></div></form>';
}

/* ================= VIEWS ================= */
function kpiHTML(rotulo, valor, detalhe, classe) {
  return '<div class="card kpi"><div class="rotulo">' + rotulo + '</div>' +
    '<div class="valor ' + (classe || '') + '">' + valor + '</div>' +
    '<div class="detalhe">' + detalhe + '</div></div>';
}
function ultimasMovimentacoesHTML(limite) {
  const itens = state.entries.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, limite || 8);
  if (!itens.length) return '<div class="vazio">Nenhuma movimentação ainda.<br><button type="button" class="btn btn-primary" data-action="novo-lancamento" data-tipo="despesa">+ Adicionar lançamento</button></div>';
  return itens.map(function (e) {
    const sinal = e.type === 'receita' ? '+' : (e.type === 'despesa' ? '−' : '⇄');
    const cls = e.type === 'receita' ? 'pos' : (e.type === 'despesa' ? 'neg' : '');
    const extra = e.cardId ? ' &bull; ' + esc(nomeCartao(e.cardId)) : (e.accountId ? ' &bull; ' + esc(nomeConta(e.accountId)) : '');
    return '<div class="linha"><div class="desc">' + esc(e.desc) + '<small>' + esc(dataBR(e.date)) + ' &bull; ' + esc(e.category) + extra + (e.recurring ? ' &bull; 🔁 mensal' : '') + '</small></div>' +
      '<span class="valor ' + cls + '">' + sinal + ' ' + fmt(e.amount) + '</span></div>';
  }).join('');
}
function vDashboard() {
  const t = totaisMes(state, mesSel);
  let parcFuturo = 0;
  let parcRestanteQtd = 0;
  state.purchases.forEach(function (p) {
    const r = restanteCompra(p);
    parcFuturo += r.valorRestante;
    parcRestanteQtd += r.restantes;
  });
  const saldo = saldoTotal(state);
  const meses = [];
  const recs = [];
  const desps = [];
  for (let i = 5; i >= 0; i--) {
    const ch = deslocarMes(mesSel, -i);
    meses.push(mesCurto(ch));
    const tt = totaisMes(state, ch);
    recs.push(tt.receitas);
    desps.push(tt.comprometido);
  }
  const cats = gastosPorCategoria(state, mesSel);
  const cartoesTop = state.cards.map(function (c) {
    const f = faturaCartao(state, c.id, mesSel);
    return { c, f, pct: c.limit > 0 ? Math.min(100, (f.total / c.limit) * 100) : 0 };
  }).sort(function (a, b) { return b.f.total - a.f.total; }).slice(0, 3);
  return '<div class="grid kpis">' +
    kpiHTML('Saldo total disponível', fmt(saldo), state.accounts.length + ' conta(s) cadastrada(s)') +
    kpiHTML('Receitas do mês', fmt(t.receitas), esc(rotuloMes(mesSel)), 'verde') +
    kpiHTML('Despesas do mês', fmt(t.despesas), 'Lançamentos avulsos, fixos e no cartão') +
    kpiHTML('Faturas dos cartões', fmt(t.faturas), 'Compras + parcelas deste mês', t.faturas > 0 ? 'vermelho' : '') +
    kpiHTML('Parcelas a pagar', fmt(parcFuturo), parcRestanteQtd + ' parcela(s) restante(s) no total') +
    kpiHTML('Sobra no orçamento', fmt(t.sobra), t.sobra < 0 ? 'Você está acima do orçamento' : 'Receitas menos compromissos do mês', t.sobra < 0 ? 'vermelho' : 'verde') +
    '</div>' +
    '<div class="grid duas" style="margin-top:16px">' +
    '<div class="card"><h3>Receitas x despesas</h3><p class="sub">Últimos 6 meses (despesas incluem parcelas)</p>' + svgBarras(meses, recs, desps, 'Receitas', 'Despesas + parcelas') + '</div>' +
    '<div class="card"><h3>Gastos por categoria</h3><p class="sub">' + esc(rotuloMes(mesSel)) + ' — despesas + parcelas</p><div style="margin-top:12px">' + svgDonut(cats) + '</div></div>' +
    '</div>' +
    '<div class="grid duas" style="margin-top:16px">' +
    '<div class="card"><h3>Últimas movimentações</h3>' + ultimasMovimentacoesHTML(8) + '</div>' +
    '<div class="card"><h3>Cartões neste mês</h3>' +
    (cartoesTop.length ? cartoesTop.map(function (x) {
      return '<div style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;font-size:14px"><b>' + esc(x.c.name) + '</b><span>' + fmt(x.f.total) + ' / ' + fmt(x.c.limit) + '</span></div>' +
        '<div class="barra"><i class="' + (x.pct >= 100 ? 'estouro' : (x.pct >= limiteAlerta() ? 'amarelo' : '')) + '" style="width:' + x.pct + '%"></i></div>' +
        '<div class="sub" style="margin-top:6px">Disponível: ' + fmt(x.c.limit - x.f.total) + (x.f.pago ? ' &bull; <span class="tag verde">Fatura paga</span>' : '') + '</div></div>';
    }).join('') + '<button type="button" class="btn btn-ghost btn-sm" data-action="ir" data-rota="cartoes">Ver todos os cartões</button>'
      : '<div class="vazio">Nenhum cartão cadastrado.<br><button type="button" class="btn btn-primary" data-action="novo-cartao">+ Cadastrar cartão</button></div>') +
    '</div></div>';
}
function vContas() {
  const total = saldoTotal(state);
  const lista = state.accounts.map(function (a) {
    const saldo = saldoConta(state, a.id);
    const movs = state.entries.filter(function (e) { return e.accountId === a.id || e.destAccountId === a.id; })
      .sort(function (x, y) { return x.date < y.date ? 1 : -1; }).slice(0, 6);
    return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
      '<div><h3>' + esc(a.name) + '</h3><p class="sub">' + esc(a.type) + ' &bull; saldo inicial ' + fmt(a.initial) + '</p></div>' +
      '<div style="text-align:right"><div style="font-size:22px;font-weight:800;color:' + (saldo < 0 ? 'var(--red)' : 'inherit') + '">' + fmt(saldo) + '</div></div></div>' +
      '<div style="margin-top:12px">' + (movs.length ? movs.map(function (e) {
        const entrou = e.destAccountId === a.id;
        const saiu = e.accountId === a.id;
        const v = entrou && !saiu ? e.amount : -e.amount;
        return '<div class="linha"><div class="desc">' + esc(e.desc) + '<small>' + esc(dataBR(e.date)) + ' &bull; ' + esc(e.category) + '</small></div><span class="valor ' + (v >= 0 ? 'pos' : 'neg') + '">' + (v >= 0 ? '+' : '−') + ' ' + fmt(Math.abs(v)) + '</span></div>';
      }).join('') : '<div class="vazio" style="padding:10px">Sem movimentações nesta conta.</div>') + '</div>' +
      '<div class="acoes-linha" style="margin-top:12px"><button type="button" class="btn btn-ghost btn-sm" data-action="editar-conta" data-id="' + a.id + '">Editar</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="novo-lancamento" data-tipo="receita" data-conta="' + a.id + '">+ Entrada</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="novo-lancamento" data-tipo="despesa" data-conta="' + a.id + '">− Saída</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-action="apagar-conta" data-id="' + a.id + '">Apagar</button></div></div>';
  }).join('');
  return '<div class="grid kpis" style="grid-template-columns:1fr 1fr 1fr">' +
    kpiHTML('Saldo total em contas', fmt(total), state.accounts.length + ' conta(s)') +
    kpiHTML('Contas cadastradas', String(state.accounts.length), 'Bancos e dinheiro em espécie') +
    kpiHTML('Dinheiro em espécie', fmt(state.accounts.filter(function (a) { return a.type.indexOf('espécie') !== -1; }).reduce(function (s, a) { return s + saldoConta(state, a.id); }, 0)), 'Soma das carteiras') +
    '</div>' +
    '<div class="sec-head"><h2>Minhas contas</h2><div class="acoes"><button type="button" class="btn btn-primary" data-action="nova-conta">+ Nova conta</button></div></div>' +
    (lista || '<div class="card"><div class="vazio">Nenhuma conta cadastrada ainda.<br>Cadastre seu banco ou sua carteira para acompanhar o saldo de verdade.<br><button type="button" class="btn btn-primary" data-action="nova-conta">+ Cadastrar primeira conta</button></div></div>') +
    (lista ? '<div class="grid tres" style="margin-top:0">' + lista + '</div>' : '');
}
function cartaoVisualHTML(c, fatura) {
  const cor = c.color || '#0a9a68';
  return '<div class="cartao-visual" style="background:linear-gradient(130deg,' + esc(cor) + ',' + esc(cor) + 'cc 60%,#0a0f0d)">' +
    '<div class="topo"><div class="banco">' + esc(c.bank || c.name) + '</div><div class="ondas" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>' +
    '<div class="chip"></div>' +
    '<div class="numero">•••• •••• •••• ••••</div>' +
    '<div class="rodape"><span><small>TITULAR</small><b>' + esc(state.profile.name || 'Luis') + '</b></span><span><small>BANDEIRA</small><b>' + esc(c.brand || '') + '</b></span></div></div>';
}
function vCartoes() {
  if (cartaoAberto) {
    const c = state.cards.find(function (x) { return x.id === cartaoAberto; });
    if (c) return detalheCartaoHTML(c);
    cartaoAberto = null;
  }
  const lista = state.cards.map(function (c) {
    const f = faturaCartao(state, c.id, mesSel);
    const disp = c.limit - f.total;
    const pct = c.limit > 0 ? Math.min(100, (f.total / c.limit) * 100) : 0;
    return '<div class="card clicavel" data-action="abrir-cartao" data-id="' + c.id + '"><div style="display:flex;justify-content:center">' + cartaoVisualHTML(c, f) + '</div>' +
      '<div style="text-align:center;margin-top:10px"><span class="cartao-dica">Toque no cartão para ver as parcelas e os meses ›</span></div>' +
      '<div style="margin-top:12px"><h3>' + esc(c.name) + '</h3><p class="sub">' + esc(c.bank) + ' &bull; ' + esc(c.brand) + '</p></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:14px;text-align:center">' +
      '<div><div class="sub">Limite total</div><b>' + fmt(c.limit) + '</b></div>' +
      '<div><div class="sub">Utilizado (' + esc(mesCurto(mesSel)) + ')</div><b>' + fmt(f.total) + '</b></div>' +
      '<div><div class="sub">Disponível</div><b style="color:' + (disp < 0 ? 'var(--red)' : 'var(--emerald)') + '">' + fmt(disp) + '</b></div></div>' +
      '<div class="barra"><i class="' + (pct >= 100 ? 'estouro' : (pct >= limiteAlerta() ? 'amarelo' : '')) + '" style="width:' + pct + '%"></i></div>' +
      '<div class="sub" style="margin-top:10px">Fechamento dia ' + c.closingDay + ' &bull; vencimento dia ' + c.dueDay + ' &bull; melhor dia de compra: dia ' + c.bestDay + '</div>' +
      '<div class="sub" style="margin-top:6px">Fatura de ' + esc(rotuloMes(mesSel)) + ': compras ' + fmt(f.avulsas) + ' + parcelas ' + fmt(f.parcelas) + ' = <b>' + fmt(f.total) + '</b> ' +
      (f.pago ? '<span class="tag verde">Fatura paga</span>' : (f.pagos > 0 ? '<span class="tag amarelo">Pago parcial: ' + fmt(f.pagos) + '</span>' : '<span class="tag vermelho">Em aberto</span>')) + '</div>' +
      '<div class="acoes-linha" style="margin-top:14px;flex-wrap:wrap">' +
      (f.total > 0 && !f.pago ? '<button type="button" class="btn btn-primary btn-sm" data-action="pagar-fatura" data-id="' + c.id + '">Pagar fatura</button>' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="editar-cartao" data-id="' + c.id + '">Editar</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-action="apagar-cartao" data-id="' + c.id + '">Apagar</button></div></div>';
  }).join('');
  return '<div class="sec-head"><h2>Cartões de crédito</h2><div class="acoes"><button type="button" class="btn btn-primary" data-action="novo-cartao">+ Novo cartão</button></div></div>' +
    (lista ? '<div class="grid tres">' + lista + '</div>'
      : '<div class="card"><div class="vazio">Nenhum cartão cadastrado.<br>Cadastre seus cartões para controlar limites, faturas e vencimentos.<br><button type="button" class="btn btn-primary" data-action="novo-cartao">+ Cadastrar cartão</button></div></div>');
}

function detalheCartaoHTML(c) {
  const ch = cartaoMes || mesSel;
  const f = faturaCartao(state, c.id, ch);
  const disp = c.limit - f.total;
  const pct = c.limit > 0 ? Math.min(100, (f.total / c.limit) * 100) : 0;
  const avulsas = expandEntries(state, ch).filter(function (oc) { return oc.entry.type === 'despesa' && oc.entry.cardId === c.id; });
  const parcelas = parcelasDoMes(state, ch).filter(function (x) { return x.purchase.cardId === c.id; });
  let linhasFatura = '';
  if (!avulsas.length && !parcelas.length) linhasFatura = '<div class="vazio" style="padding:12px">Nada nesta fatura.</div>';
  else {
    linhasFatura = avulsas.map(function (oc) {
      return '<div class="linha"><div class="desc">' + esc(oc.entry.desc) + '<small>' + esc(dataBR(oc.date)) + ' &bull; ' + esc(oc.entry.category) + ' &bull; compra avulsa</small></div><span class="valor">' + fmt(oc.valor) + '</span></div>';
    }).join('') + parcelas.map(function (x) {
      return '<div class="linha"><div class="desc">' + esc(x.purchase.name) + '<small>Parcela ' + x.k + ' de ' + x.purchase.n + (x.pago ? ' &bull; ✓ paga' : '') + '</small></div>' +
        '<div class="acoes-linha"><span class="valor">' + fmt(x.valor) + '</span>' +
        '<button type="button" class="btn ' + (x.pago ? 'btn-primary' : 'btn-ghost') + ' btn-sm" data-action="toggle-parcela" data-id="' + x.purchase.id + '" data-mes="' + ch + '">' + (x.pago ? '✓ Paga' : 'Marcar paga') + '</button></div></div>';
    }).join('');
  }
  const compras = state.purchases.filter(function (p) { return p.cardId === c.id; }).sort(function (a, b) { return a.firstMonth < b.firstMonth ? -1 : 1; });
  let linhasCompras = '';
  if (!compras.length) linhasCompras = '<div class="vazio" style="padding:12px">Nenhuma compra parcelada neste cartão.</div>';
  else linhasCompras = compras.map(function (p) {
    const r = restanteCompra(p);
    const mensal = p.total / p.n;
    const aberto = !!comprasExpandidas[p.id];
    let cronograma = '';
    if (aberto) {
      for (let k = 0; k < p.n; k++) {
        const m = chaveDeIndice(indiceMes(p.firstMonth) + k);
        const pago = (p.paidMonths || []).indexOf(m) !== -1;
        cronograma += '<div class="linha"><div class="desc">Parcela ' + (k + 1) + ' de ' + p.n + '<small>' + esc(rotuloMes(m)) + (m === ch ? ' &bull; mês exibido' : '') + '</small></div>' +
          '<div class="acoes-linha"><span class="valor">' + fmt(mensal) + '</span>' +
          '<button type="button" class="btn ' + (pago ? 'btn-primary' : 'btn-ghost') + ' btn-sm" data-action="toggle-parcela" data-id="' + p.id + '" data-mes="' + m + '">' + (pago ? '✓ Paga' : 'Marcar paga') + '</button></div></div>';
      }
    }
    return '<div class="card" style="margin-bottom:12px"><button type="button" class="compra-toggle" data-action="toggle-cronograma" data-id="' + p.id + '">' +
      '<span><b>' + esc(p.name) + '</b><small>' + esc(p.category) + ' &bull; ' + fmt(mensal) + '/mês &bull; ' + r.pagos + '/' + p.n + ' pagas &bull; termina em ' + esc(mesCurto(fimDaCompra(p))) + '</small></span>' +
      '<span style="text-align:right"><b>' + fmt(p.total) + '</b><small>' + (aberto ? 'Ocultar meses ▴' : 'Ver meses ▾') + '</small></span></button>' +
      (aberto ? '<div style="border-top:1px solid var(--border);margin-top:10px">' + cronograma + '</div>' : '') +
      '<div class="barra"><i style="width:' + Math.round((r.pagos / p.n) * 100) + '%"></i></div>' +
      '<div class="sub" style="margin-top:8px">Restam ' + r.restantes + ' parcelas &bull; valor restante: <b>' + fmt(r.valorRestante) + '</b></div></div>';
  }).join('');
  let chips = '';
  const hoje = chaveMes(new Date());
  for (let i = 0; i < 6; i++) {
    const m = deslocarMes(hoje, i);
    let tot = 0;
    parcelasDoMes(state, m).forEach(function (x) { if (x.purchase.cardId === c.id) tot += x.valor; });
    chips += '<button type="button" class="mes-chip' + (m === ch ? ' ativo' : '') + '" data-action="cartao-mes-chip" data-mes="' + m + '"><b>' + esc(mesCurto(m)) + '</b><span>' + fmt(tot) + '</span></button>';
  }
  return '<div class="sec-head"><h2>' + esc(c.name) + '</h2><div class="acoes"><button type="button" class="btn btn-ghost" data-action="voltar-cartoes">‹ Voltar para cartões</button><button type="button" class="icon-btn" data-action="menu-cartao" data-id="' + c.id + '" aria-label="Mais opções" style="font-size:20px;line-height:1">⋯</button></div></div>' +
    '<div style="display:flex;justify-content:center;margin-bottom:16px">' + cartaoVisualHTML(c, f) + '</div>' +
    '<div class="grid kpis">' +
    kpiHTML('Limite total', fmt(c.limit), esc(c.bank) + ' • ' + esc(c.brand)) +
    kpiHTML('Utilizado (' + esc(mesCurto(ch)) + ')', fmt(f.total), 'Compras ' + fmt(f.avulsas) + ' + parcelas ' + fmt(f.parcelas), f.total > c.limit ? 'vermelho' : '') +
    kpiHTML('Limite disponível', fmt(disp), disp < 0 ? 'Acima do limite' : 'Para novas compras', disp < 0 ? 'vermelho' : 'verde') +
    '</div>' +
    '<div class="barra" style="margin-bottom:16px"><i class="' + (pct >= 100 ? 'estouro' : (pct >= limiteAlerta() ? 'amarelo' : '')) + '" style="width:' + pct + '%"></i></div>' +
    '<div class="card" style="margin-bottom:14px"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;text-align:center">' +
    '<div><div class="sub">Fechamento</div><b>Dia ' + c.closingDay + '</b></div>' +
    '<div><div class="sub">Vencimento</div><b>Dia ' + c.dueDay + '</b></div>' +
    '<div><div class="sub">Melhor dia de compra</div><b>Dia ' + c.bestDay + '</b></div></div></div>' +
    '<div class="sec-head"><h2>Próximos meses — parcelas</h2></div>' +
    '<div class="mes-chips">' + chips + '</div>' +
    '<div class="sec-head" style="margin-top:18px"><h2>Fatura de ' + esc(rotuloMes(ch)) + '</h2><div class="acoes"><div class="mes-nav"><button type="button" class="icon-btn" data-action="cartao-mes-ant" aria-label="Mês anterior">‹</button><span>' + esc(rotuloMes(ch)) + '</span><button type="button" class="icon-btn" data-action="cartao-mes-prox" aria-label="Próximo mês">›</button></div></div></div>' +
    '<div class="card" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h3>Total da fatura</h3><b style="font-size:22px">' + fmt(f.total) + '</b></div>' +
    '<div class="sub" style="margin-top:6px">Compras avulsas ' + fmt(f.avulsas) + ' + parcelas ' + fmt(f.parcelas) + ' &bull; ' +
    (f.pago ? '<span class="tag verde">Fatura paga</span>' : (f.pagos > 0 ? '<span class="tag amarelo">Pago parcial: ' + fmt(f.pagos) + ' — faltam ' + fmt(f.faltam) + '</span>' : '<span class="tag vermelho">Em aberto</span>')) + '</div>' +
    '<div style="margin-top:8px">' + linhasFatura + '</div>' +
    (f.total > 0 && !f.pago ? '<div class="acoes-linha" style="margin-top:12px"><button type="button" class="btn btn-primary btn-sm" data-action="pagar-fatura-cartao" data-id="' + c.id + '" data-mes="' + ch + '">Pagar fatura de ' + esc(mesCurto(ch)) + '</button></div>' : '') + '</div>' +
    '<div class="sec-head"><h2>Parcelas deste cartão</h2></div>' +
    linhasCompras;
}

function menuCartaoHTML(c) {
  return '<h3>' + esc(c.name) + '</h3><p class="sub" style="margin-bottom:14px">O que você quer fazer com este cartão?</p>' +
    '<div class="menu-acoes">' +
    '<button type="button" data-action="nova-compra">＋ Nova compra parcelada</button>' +
    '<button type="button" data-action="editar-cartao" data-id="' + c.id + '">✎ Editar cartão</button>' +
    '<button type="button" class="perigo" data-action="apagar-cartao" data-id="' + c.id + '">✕ Apagar cartão</button>' +
    '</div>' +
    '<div class="botoes"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button></div>';
}

function vParcelas() {
  let totalRestante = 0;
  let totalMes = 0;
  let ativas = 0;
  state.purchases.forEach(function (p) {
    const r = restanteCompra(p);
    totalRestante += r.valorRestante;
    if (r.restantes > 0) ativas += 1;
  });
  parcelasDoMes(state, mesSel).forEach(function (x) { totalMes += x.valor; });
  const lista = state.purchases.slice().sort(function (a, b) { return a.firstMonth < b.firstMonth ? -1 : 1; }).map(function (p) {
    const r = restanteCompra(p);
    const mensal = p.total / p.n;
    const pctPago = Math.round((r.pagos / p.n) * 100);
    const atual = parcelasDoMes(state, mesSel).find(function (x) { return x.purchase.id === p.id; });
    let linhas = '';
    for (let k = 0; k < p.n; k++) {
      const ch = chaveDeIndice(indiceMes(p.firstMonth) + k);
      const pago = (p.paidMonths || []).indexOf(ch) !== -1;
      const ehAtual = ch === mesSel;
      linhas += '<div class="linha"><div class="desc">Parcela ' + (k + 1) + ' de ' + p.n +
        '<small>' + esc(rotuloMes(ch)) + (ehAtual ? ' &bull; parcela deste mês' : '') + '</small></div>' +
        '<div class="acoes-linha"><span class="valor">' + fmt(mensal) + '</span>' +
        '<button type="button" class="btn ' + (pago ? 'btn-primary' : 'btn-ghost') + ' btn-sm" data-action="toggle-parcela" data-id="' + p.id + '" data-mes="' + ch + '">' + (pago ? '✓ Paga' : 'Marcar paga') + '</button></div></div>';
    }
    return '<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
      '<div><h3>' + esc(p.name) + '</h3><p class="sub">' + esc(p.category) + (p.cardId ? ' &bull; ' + esc(nomeCartao(p.cardId)) : ' &bull; sem cartão') + ' &bull; ' + fmt(mensal) + '/mês</p></div>' +
      '<div style="text-align:right"><div style="font-size:20px;font-weight:800">' + fmt(p.total) + '</div><div class="sub">total em ' + p.n + 'x</div></div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;text-align:center">' +
      '<div><div class="sub">Parcela atual</div><b>' + (atual ? atual.k + '/' + p.n : '—') + '</b></div>' +
      '<div><div class="sub">Pagas</div><b>' + r.pagos + '</b></div>' +
      '<div><div class="sub">Restantes</div><b>' + r.restantes + '</b></div>' +
      '<div><div class="sub">Término</div><b>' + esc(mesCurto(fimDaCompra(p))) + '</b></div></div>' +
      '<div class="barra"><i style="width:' + pctPago + '%"></i></div>' +
      '<div class="sub" style="margin-top:8px">Valor restante: <b>' + fmt(r.valorRestante) + '</b></div>' +
      '<div style="margin-top:10px;border-top:1px solid var(--border)">' + linhas + '</div>' +
      '<div class="acoes-linha" style="margin-top:12px"><button type="button" class="btn btn-ghost btn-sm" data-action="editar-compra" data-id="' + p.id + '">Editar</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-action="apagar-compra" data-id="' + p.id + '">Apagar compra</button></div></div>';
  }).join('');
  return '<div class="grid kpis">' +
    kpiHTML('Parcelas neste mês', fmt(totalMes), esc(rotuloMes(mesSel))) +
    kpiHTML('Total restante', fmt(totalRestante), 'Todas as compras parceladas') +
    kpiHTML('Compras ativas', String(ativas), state.purchases.length + ' compra(s) cadastrada(s)') +
    '</div>' +
    '<div class="sec-head"><h2>Compras parceladas</h2><div class="acoes"><button type="button" class="btn btn-primary" data-action="nova-compra">+ Nova compra parcelada</button></div></div>' +
    (lista || '<div class="card"><div class="vazio">Nenhuma compra parcelada.<br>Cadastre uma compra e veja as parcelas distribuídas nos meses automaticamente.<br><button type="button" class="btn btn-primary" data-action="nova-compra">+ Cadastrar compra</button></div></div>') +
    (lista ? '<div class="grid duas">' + lista + '</div>' : '');
}
function grupoMesHTML(titulo, itens, somaFn, icone) {
  const total = itens.reduce(function (s, x) { return s + somaFn(x); }, 0);
  let linhas = '';
  if (!itens.length) linhas = '<div class="vazio" style="padding:12px">Nada neste grupo.</div>';
  else linhas = itens.map(function (x) {
    if (x.purchase) {
      return '<div class="linha"><div class="desc">' + esc(x.purchase.name) + '<small>Parcela ' + x.k + ' de ' + x.purchase.n + (x.purchase.cardId ? ' &bull; ' + esc(nomeCartao(x.purchase.cardId)) : '') + (x.pago ? ' &bull; ✓ paga' : '') + '</small></div><span class="valor">' + fmt(x.valor) + '</span></div>';
    }
    const e = x.entry;
    return '<div class="linha"><div class="desc">' + esc(e.desc) + '<small>' + esc(dataBR(x.date)) + ' &bull; ' + esc(e.category) + (e.cardId ? ' &bull; ' + esc(nomeCartao(e.cardId)) : '') + (e.recurring ? ' &bull; 🔁 mensal' : '') + '</small></div>' +
      '<div class="acoes-linha"><span class="valor">' + fmt(x.valor) + '</span>' +
      '<button type="button" class="icon-mini" data-action="editar-lancamento" data-id="' + e.id + '" aria-label="Editar">✎</button>' +
      '<button type="button" class="icon-mini" data-action="apagar-lancamento" data-id="' + e.id + '" aria-label="Apagar">✕</button></div></div>';
  }).join('');
  return '<div class="card" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>' + icone + ' ' + titulo + '</h3><b>' + fmt(total) + '</b></div><div style="margin-top:8px">' + linhas + '</div></div>';
}
function vMes() {
  const c = compromissosDoMes(state, mesSel);
  const dispo = c.disponivel;
  return '<div class="grid kpis">' +
    kpiHTML('Receitas previstas', fmt(c.tReceitas), esc(rotuloMes(mesSel)), 'verde') +
    kpiHTML('Total comprometido', fmt(c.tComp), 'Fixas + parcelas + faturas + outras', 'vermelho') +
    kpiHTML('Disponível no mês', fmt(dispo), dispo < 0 ? 'Compromissos acima das receitas' : 'O que sobra depois dos compromissos', dispo < 0 ? 'vermelho' : 'verde') +
    '</div>' +
    '<div class="sec-head"><h2>Meu mês — ' + esc(rotuloMes(mesSel)) + '</h2><div class="acoes"><span class="tag">Use as setas no topo para navegar entre meses</span></div></div>' +
    grupoMesHTML('Receitas previstas', c.grupos.receitas, function (x) { return x.valor; }, '💰') +
    grupoMesHTML('Contas fixas', c.grupos.fixas, function (x) { return x.valor; }, '🏠') +
    grupoMesHTML('Assinaturas', c.grupos.assinaturas, function (x) { return x.valor; }, '🔁') +
    grupoMesHTML('Empréstimos e financiamentos', c.grupos.emprestimos, function (x) { return x.valor; }, '🏦') +
    grupoMesHTML('Compras parceladas', c.grupos.parcelas, function (x) { return x.valor; }, '▦') +
    grupoMesHTML('Faturas de cartões (compras avulsas)', c.grupos.faturas, function (x) { return x.valor; }, '▭') +
    grupoMesHTML('Outras despesas', c.grupos.outras, function (x) { return x.valor; }, '🛒');
}
let FILTROS = { tipo: 'todas', categoria: 'todas', busca: '' };
function vLancamentos() {
  const ocor = expandEntries(state, mesSel);
  const lista = ocor.filter(function (oc) {
    const e = oc.entry;
    if (FILTROS.tipo !== 'todas' && e.type !== FILTROS.tipo) return false;
    if (FILTROS.categoria !== 'todas' && e.category !== FILTROS.categoria) return false;
    if (FILTROS.busca && e.desc.toLowerCase().indexOf(FILTROS.busca.toLowerCase()) === -1) return false;
    return true;
  }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  const cats = (FILTROS.tipo === 'receita' ? CATEGORIAS_RECEITA : FILTROS.tipo === 'despesa' ? CATEGORIAS_DESPESA : CATEGORIAS_RECEITA.concat(CATEGORIAS_DESPESA));
  const catsUnicas = cats.filter(function (v, i, a) { return a.indexOf(v) === i; });
  let totR = 0, totD = 0;
  lista.forEach(function (oc) {
    if (oc.entry.type === 'receita') totR += oc.valor;
    if (oc.entry.type === 'despesa') totD += oc.valor;
  });
  return '<div class="sec-head"><h2>Receitas e despesas — ' + esc(rotuloMes(mesSel)) + '</h2>' +
    '<div class="acoes"><button type="button" class="btn btn-ghost" data-action="nova-transferencia">⇄ Transferência</button>' +
    '<button type="button" class="btn btn-primary" data-action="novo-lancamento" data-tipo="receita">+ Receita</button>' +
    '<button type="button" class="btn btn-primary" data-action="novo-lancamento" data-tipo="despesa">+ Despesa</button></div></div>' +
    '<div class="card" style="margin-bottom:14px"><div class="filtros">' +
    '<select id="filtroTipo"><option value="todas"' + (FILTROS.tipo === 'todas' ? ' selected' : '') + '>Todos os tipos</option><option value="receita"' + (FILTROS.tipo === 'receita' ? ' selected' : '') + '>Receitas</option><option value="despesa"' + (FILTROS.tipo === 'despesa' ? ' selected' : '') + '>Despesas</option><option value="transferencia"' + (FILTROS.tipo === 'transferencia' ? ' selected' : '') + '>Transferências</option></select>' +
    '<select id="filtroCategoria"><option value="todas">Todas as categorias</option>' + catsUnicas.map(function (ct) { return '<option' + (FILTROS.categoria === ct ? ' selected' : '') + '>' + ct + '</option>'; }).join('') + '</select>' +
    '<input id="filtroBusca" type="text" placeholder="Buscar por descrição..." value="' + esc(FILTROS.busca) + '">' +
    '</div></div>' +
    '<div class="card">' +
    (lista.length ? lista.map(function (oc) {
      const e = oc.entry;
      const sinal = e.type === 'receita' ? '+' : (e.type === 'despesa' ? '−' : '⇄');
      const cls = e.type === 'receita' ? 'pos' : (e.type === 'despesa' ? 'neg' : '');
      const onde = e.cardId ? 'Cartão: ' + esc(nomeCartao(e.cardId)) : (e.accountId ? esc(nomeConta(e.accountId)) : '') +
        (e.destAccountId ? ' → ' + esc(nomeConta(e.destAccountId)) : '');
      return '<div class="linha"><div class="desc">' + esc(e.desc) +
        '<small>' + esc(dataBR(oc.date)) + ' &bull; ' + esc(e.category) + (onde ? ' &bull; ' + onde : '') + (e.recurring ? ' &bull; 🔁 mensal' : '') + '</small></div>' +
        '<div class="acoes-linha"><span class="valor ' + cls + '">' + sinal + ' ' + fmt(oc.valor) + '</span>' +
        '<button type="button" class="icon-mini" data-action="editar-lancamento" data-id="' + e.id + '" aria-label="Editar">✎</button>' +
        '<button type="button" class="icon-mini" data-action="apagar-lancamento" data-id="' + e.id + '" aria-label="Apagar">✕</button></div></div>';
    }).join('') : '<div class="vazio">Nenhum lançamento neste mês com estes filtros.<br><button type="button" class="btn btn-primary" data-action="novo-lancamento" data-tipo="despesa">+ Adicionar lançamento</button></div>') +
    '<div class="total-linha" style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:12px;margin-top:6px"><span>Receitas: <b style="color:var(--emerald)">' + fmt(totR) + '</b></span><span>Despesas: <b style="color:var(--red)">' + fmt(totD) + '</b></span></div>' +
    '</div>';
}
function vRelatorios() {
  const N = REL_N;
  const meses = [];
  const recs = [];
  const desps = [];
  for (let i = N - 1; i >= 0; i--) {
    const ch = deslocarMes(mesSel, -i);
    meses.push(mesCurto(ch));
    const tt = totaisMes(state, ch);
    recs.push(tt.receitas);
    desps.push(tt.comprometido);
  }
  const cats = gastosPorCategoria(state, mesSel);
  // Evolução do saldo: fim de cada mês (últimos N meses)
  const evRot = [];
  const evVal = [];
  for (let i = N - 1; i >= 0; i--) {
    const ch = deslocarMes(mesSel, -i);
    const p = ch.split('-');
    const fim = ch + '-' + diaNoMes(Number(p[0]), Number(p[1]), 31);
    evRot.push(mesCurto(ch));
    evVal.push(saldoTotal(state, fim));
  }
  // Parcelas futuras por mês (próximos 12 meses)
  const fut = [];
  for (let i = 0; i < 12; i++) {
    const ch = deslocarMes(mesSel, i);
    let tot = 0;
    parcelasDoMes(state, ch).forEach(function (x) { tot += x.valor; });
    if (tot > 0) fut.push({ ch, tot });
  }
  // Anual
  const ano = mesSel.slice(0, 4);
  let linhasAno = '';
  for (let m = 1; m <= 12; m++) {
    const ch = ano + '-' + String(m).padStart(2, '0');
    const tt = totaisMes(state, ch);
    const fim = ch + '-' + diaNoMes(Number(ano), m, 31);
    linhasAno += '<tr><td>' + esc(MESES_PT[m - 1]) + '</td><td class="num" style="color:var(--emerald)">' + fmt(tt.receitas) + '</td><td class="num" style="color:var(--red)">' + fmt(tt.comprometido) + '</td><td class="num">' + fmt(saldoTotal(state, fim)) + '</td></tr>';
  }
  const usoCards = state.cards.map(function (c) {
    const f = faturaCartao(state, c.id, mesSel);
    return { c, f, pct: c.limit > 0 ? Math.min(100, (f.total / c.limit) * 100) : 0 };
  }).sort(function (a, b) { return b.f.total - a.f.total; });
  return '<div class="sec-head"><h2>Relatórios</h2><div class="acoes">' +
    '<button type="button" class="btn ' + (REL_N === 6 ? 'btn-primary' : 'btn-ghost') + ' btn-sm" data-action="rel-periodo" data-n="6">6 meses</button>' +
    '<button type="button" class="btn ' + (REL_N === 12 ? 'btn-primary' : 'btn-ghost') + ' btn-sm" data-action="rel-periodo" data-n="12">12 meses</button></div></div>' +
    '<div class="grid duas">' +
    '<div class="card"><h3>Gastos por mês</h3><p class="sub">Receitas x despesas + parcelas</p>' + svgBarras(meses, recs, desps, 'Receitas', 'Despesas + parcelas') + '</div>' +
    '<div class="card"><h3>Evolução do saldo</h3><p class="sub">Saldo total em contas no fim de cada mês</p>' + svgLinha(evRot, evVal) + '</div>' +
    '<div class="card"><h3>Gastos por categoria — ' + esc(rotuloMes(mesSel)) + '</h3><div style="margin-top:12px">' + svgDonut(cats) + '</div></div>' +
    '<div class="card"><h3>Utilização dos cartões — ' + esc(rotuloMes(mesSel)) + '</h3>' +
    (usoCards.length ? usoCards.map(function (x) {
      return '<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;font-size:14px"><b>' + esc(x.c.name) + '</b><span>' + Math.round(x.pct) + '% usado</span></div><div class="barra"><i class="' + (x.pct >= 100 ? 'estouro' : (x.pct >= limiteAlerta() ? 'amarelo' : '')) + '" style="width:' + x.pct + '%"></i></div><div class="sub" style="margin-top:5px">' + fmt(x.f.total) + ' de ' + fmt(x.c.limit) + '</div></div>';
    }).join('') : '<div class="vazio">Nenhum cartão cadastrado.</div>') + '</div>' +
    '</div>' +
    '<div class="grid duas" style="margin-top:16px">' +
    '<div class="card"><h3>Parcelas futuras</h3><p class="sub">Próximos 12 meses</p>' +
    (fut.length ? fut.map(function (f) { return '<div class="linha"><div class="desc">' + esc(rotuloMes(f.ch)) + '</div><span class="valor">' + fmt(f.tot) + '</span></div>'; }).join('') : '<div class="vazio">Sem parcelas futuras.</div>') + '</div>' +
    '<div class="card"><h3>Histórico anual — ' + ano + '</h3><div style="overflow-x:auto"><table class="tabela"><thead><tr><th>Mês</th><th style="text-align:right">Receitas</th><th style="text-align:right">Compromissos</th><th style="text-align:right">Saldo final</th></tr></thead><tbody>' + linhasAno + '</tbody></table></div></div>' +
    '</div>';
}
let REL_N = 6;

/* ================= LUNA AI ================= */
function normTexto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function mesDaFrase(texto, atual) {
  const t = normTexto(texto);
  if (t.indexOf('mes que vem') !== -1 || t.indexOf('proximo mes') !== -1) return deslocarMes(atual, 1);
  if (t.indexOf('mes passado') !== -1 || t.indexOf('mes anterior') !== -1) return deslocarMes(atual, -1);
  for (let i = 0; i < 12; i++) {
    const re = new RegExp('\\b' + MESES_PT[i] + '\\b');
    if (re.test(t)) {
      return atual.slice(0, 4) + '-' + String(i + 1).padStart(2, '0');
    }
  }
  return null;
}
function lunaLocal(pergunta) {
  const t = normTexto(pergunta);
  const ch = mesDaFrase(pergunta, mesSel) || mesSel;
  const tot = totaisMes(state, ch);
  const saldo = saldoTotal(state);
  const rot = rotuloMes(ch);
  // Simulação de compra
  const mValor = pergunta.match(/R\$\s*([\d.,]+)/i);
  const mParc = pergunta.match(/(\d{1,2})\s*(x|vezes|parcelas)/i);
  if ((t.indexOf('posso comprar') !== -1 || t.indexOf('consigo comprar') !== -1 || t.indexOf('vale a pena') !== -1) && mValor) {
    const valor = parseValorBR(mValor[1]);
    const n = mParc ? parseInt(mParc[1], 10) : 1;
    if (valor > 0 && n >= 1 && n <= 48) {
      const mensal = valor / n;
      const sobraApos = tot.sobra - mensal;
      let r = 'Simulando com os seus dados de ' + rot + ':\n';
      r += '• Valor: ' + fmt(valor) + ' em ' + n + 'x de ' + fmt(mensal) + '.\n';
      r += '• Hoje você tem ' + fmt(tot.sobra) + ' de sobra no mês.\n';
      r += '• Com essa parcela, a sobra ficaria em ' + fmt(sobraApos) + '.';
      r += sobraApos < 0 ? '\nFicaria no vermelho — melhor reduzir as parcelas ou esperar um mês com mais folga.' : '\nCabe no orçamento, mantendo a sobra positiva.';
      return r;
    }
  }
  if (t.indexOf('disponivel') !== -1 || t.indexOf('sobra') !== -1 || t.indexOf('posso gastar') !== -1) {
    return 'Em ' + rot + ':\n• Receitas: ' + fmt(tot.receitas) + '\n• Compromissos (despesas + parcelas): ' + fmt(tot.comprometido) + '\n• Disponível: ' + fmt(tot.sobra) + (tot.sobra < 0 ? '\nVocê está acima do orçamento neste mês.' : '\nÉ o que ainda dá para gastar sem estourar.');
  }
  if (t.indexOf('parcela') !== -1) {
    const lista = parcelasDoMes(state, ch);
    let r = 'Parcelas de ' + rot + ': ' + fmt(tot.parcelas) + ' no total (' + lista.length + ' parcela(s)).';
    lista.slice(0, 5).forEach(function (x) {
      r += '\n• ' + x.purchase.name + ' — ' + x.k + '/' + x.purchase.n + ': ' + fmt(x.valor) + (x.pago ? ' (paga)' : '');
    });
    let fut = 0;
    state.purchases.forEach(function (p) { fut += restanteCompra(p).valorRestante; });
    r += '\nTotal restante de todas as parcelas: ' + fmt(fut) + '.';
    return r;
  }
  if (t.indexOf('fatura') !== -1) {
    if (!state.cards.length) return 'Você ainda não cadastrou nenhum cartão.';
    let r = 'Faturas de ' + rot + ':';
    state.cards.forEach(function (c) {
      const f = faturaCartao(state, c.id, ch);
      r += '\n• ' + c.name + ': ' + fmt(f.total) + (f.pago ? ' (paga ✓)' : ' (em aberto, vencimento dia ' + c.dueDay + ')');
    });
    return r;
  }
  if (t.indexOf('cartao') !== -1 || t.indexOf('cartão') !== -1 || t.indexOf('limite') !== -1) {
    if (!state.cards.length) return 'Você ainda não cadastrou nenhum cartão. Cadastre em Cartões para eu analisar limites e uso.';
    let maior = null;
    let maiorPct = -1;
    let r = 'Cartões em ' + rot + ':';
    state.cards.forEach(function (c) {
      const f = faturaCartao(state, c.id, ch);
      const pct = c.limit > 0 ? Math.round((f.total / c.limit) * 100) : 0;
      if (pct > maiorPct) { maiorPct = pct; maior = c; }
      r += '\n• ' + c.name + ': usado ' + fmt(f.total) + ' de ' + fmt(c.limit) + ' (' + pct + '%) — disponível ' + fmt(c.limit - f.total) + '.';
    });
    if (maior) r += '\nMaior utilização: ' + maior.name + ' (' + maiorPct + '% do limite).';
    return r;
  }
  if (t.indexOf('gast') !== -1 || t.indexOf('gasto') !== -1) {
    for (let i = 0; i < CATEGORIAS_DESPESA.length; i++) {
      const cat = CATEGORIAS_DESPESA[i];
      if (t.indexOf(normTexto(cat)) !== -1) {
        const cats = gastosPorCategoria(state, ch);
        const ach = cats.find(function (x) { return x.categoria === cat; });
        return 'Em ' + rot + ', você gastou ' + fmt(ach ? ach.valor : 0) + ' com ' + cat + ' (despesas + parcelas da categoria).';
      }
    }
    return 'Em ' + rot + ', seus compromissos somam ' + fmt(tot.comprometido) + ': despesas ' + fmt(tot.despesas) + ' + parcelas ' + fmt(tot.parcelas) + '.';
  }
  if (t.indexOf('receita') !== -1 || t.indexOf('ganhei') !== -1 || t.indexOf('salario') !== -1 || t.indexOf('renda') !== -1) {
    return 'Em ' + rot + ', suas receitas somam ' + fmt(tot.receitas) + '.';
  }
  if (t.indexOf('saldo') !== -1) {
    let r = 'Saldo total em contas: ' + fmt(saldo) + '.';
    state.accounts.forEach(function (a) {
      r += '\n• ' + a.name + ': ' + fmt(saldoConta(state, a.id));
    });
    return r;
  }
  if (t.indexOf('economizar') !== -1 || t.indexOf('economia') !== -1 || t.indexOf('organizar') !== -1 || t.indexOf('dica') !== -1 || t.indexOf('planejamento') !== -1) {
    const cats = gastosPorCategoria(state, ch);
    let r = 'Olhando ' + rot + ':';
    if (cats.length) {
      r += '\n• Maior gasto: ' + cats[0].categoria + ' (' + fmt(cats[0].valor) + ').';
      if (cats[1]) r += '\n• Segundo: ' + cats[1].categoria + ' (' + fmt(cats[1].valor) + ').';
    }
    const ass = compromissosDoMes(state, ch).grupos.assinaturas.reduce(function (s, x) { return s + x.valor; }, 0);
    if (ass > 0) r += '\n• Assinaturas somam ' + fmt(ass) + ' no mês — revise as que você não usa.';
    r += '\n• Meta simples: tente deixar a sobra (' + fmt(tot.sobra) + ') positiva todo mês e guarde a diferença na conta poupança.';
    return r;
  }
  if (t.indexOf('resumo') !== -1 || t.indexOf('como estou') !== -1 || t.indexOf('situacao') !== -1 || t.indexOf('meses com muitas contas') !== -1) {
    let pior = null;
    let piorV = -Infinity;
    for (let i = -2; i <= 3; i++) {
      const c2 = deslocarMes(mesSel, i);
      const tt = totaisMes(state, c2);
      if (tt.comprometido > piorV) { piorV = tt.comprometido; pior = c2; }
    }
    return 'Resumo de ' + rot + ':\n• Saldo total: ' + fmt(saldo) + '\n• Receitas: ' + fmt(tot.receitas) + '\n• Compromissos: ' + fmt(tot.comprometido) + '\n• Disponível: ' + fmt(tot.sobra) + '\nMês com mais compromissos por perto: ' + rotuloMes(pior) + ' (' + fmt(piorV) + ').';
  }
  return 'Posso ajudar com os seus dados reais. Pergunte, por exemplo:\n• "Quanto ainda tenho disponível este mês?"\n• "Quanto vou pagar de parcelas em novembro?"\n• "Qual cartão está com maior utilização?"\n• "Quanto estou gastando com alimentação?"\n• "Posso comprar um celular de R$ 2.000 parcelado em 10 vezes?"';
}
/* ---------- Cadastro pela Luna (linguagem natural) ---------- */
const BANCOS_LUNA = [
  ['nubank', 'Nubank'], ['inter', 'Inter'], ['itau', 'Itaú'], ['bradesco', 'Bradesco'],
  ['santander', 'Santander'], ['caixa', 'Caixa'], ['banco do brasil', 'Banco do Brasil'],
  ['c6', 'C6'], ['neon', 'Neon'], ['next', 'Next'], ['picpay', 'PicPay'],
  ['mercado pago', 'Mercado Pago'], ['xp', 'XP'], ['original', 'Original'],
  ['safra', 'Safra'], ['sicredi', 'Sicredi'], ['btg', 'BTG'], ['will', 'Will'],
  ['digio', 'Digio'], ['pan', 'Pan']
];
function acharBancoLuna(t) {
  for (let i = 0; i < BANCOS_LUNA.length; i++) {
    if (t.indexOf(BANCOS_LUNA[i][0]) !== -1) return BANCOS_LUNA[i][1];
  }
  return null;
}
function valoresReais(t) {
  const out = [];
  const re = /r\$\s*([\d.,]+)|([\d.,]+)\s*re(ai|ia)s\b/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const v = parseValorBR(m[1] || m[2]);
    if (!isNaN(v) && v > 0) out.push({ valor: v, indice: m.index });
  }
  return out;
}
function valorApos(t, palavra) {
  const i = t.indexOf(palavra);
  if (i === -1) return null;
  const vals = valoresReais(t.slice(i));
  return vals.length ? vals[0].valor : null;
}
function extrairDia(t, padrao) {
  const m = t.match(padrao);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  return d >= 1 && d <= 31 ? d : null;
}
function extrairParcelas(t) {
  const m = t.match(/(\d{1,2})\s*(parcelas?|vezes|x)\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 48 ? n : null;
}
const MAPA_CATEGORIA = [
  ['assinatura|netflix|spotify|prime|streaming', 'Assinaturas'],
  ['mercado|supermercado|feira|padaria|lanche|restaurante', 'Alimentação'],
  ['aluguel|condominio|luz|energia|agua|internet|telefone', 'Moradia'],
  ['gasolina|combustivel|uber|onibus|estacionamento|mecanico|pedagio', 'Transporte'],
  ['farmacia|remedio|medico|dentista|saude', 'Saúde'],
  ['cinema|show|jogo|viagem|hotel', 'Lazer'],
  ['celular|roupa|sapato|eletronico|notebook|moveis', 'Compras']
];
function categoriaPorPalavras(t) {
  for (let i = 0; i < MAPA_CATEGORIA.length; i++) {
    if (new RegExp(MAPA_CATEGORIA[i][0]).test(t)) return MAPA_CATEGORIA[i][1];
  }
  return null;
}
function descricaoLivre(t) {
  let s = t.replace(/r\$\s*[\d.,]+|[\d.,]+\s*re(ai|ia)s\b/g, ' ');
  const lixo = ['gastei', 'paguei', 'comprei', 'recebi', 'ganhei', 'caiu', 'tenho', 'um', 'uma', 'o', 'a', 'e', 'no', 'na', 'nos', 'nas', 'em', 'de', 'do', 'da', 'dos', 'das', 'cartao', 'conta', 'parcela', 'parcelas', 'vezes', 'luna', 'cadastra', 'cadastrar', 'cria', 'criar', 'adiciona', 'novo', 'nova', 'com', 'por', 'pra', 'para', 'ja', 'em', 'que'];
  const tokensBanco = [];
  BANCOS_LUNA.forEach(function (b) {
    if (b[0].indexOf(' ') !== -1) {
      s = s.split(b[0]).join(' ');
    } else {
      tokensBanco.push(b[0]);
    }
  });
  const palavras = s.split(/\s+/).filter(function (w) {
    return w && lixo.indexOf(w) === -1 && tokensBanco.indexOf(w) === -1 && !/^\d+$/.test(w) && w !== 'x';
  });
  const desc = palavras.join(' ').trim();
  return desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : null;
}
function valorBareParcelado(t) {
  const m = t.match(/([\d.,]+)\s+em\s+\d{1,2}\s*(?:parcelas?|vezes|x)\b/);
  if (!m) return null;
  const v = parseValorBR(m[1]);
  return isNaN(v) || v <= 0 ? null : v;
}
function numeroSolto(t) {
  const re = /\b(\d[\d.,]*)\b/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const antes = t.slice(Math.max(0, m.index - 8), m.index);
    const depois = t.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (/dia\s*$/.test(antes)) continue;
    if (/^\s*(parcelas?|vezes|x)\b/.test(depois)) continue;
    const v = parseValorBR(m[1]);
    if (!isNaN(v) && v > 0) return v;
  }
  return null;
}
function recalcularFaltando(plano) {
  const f = [];
  if (plano.tipo === 'cartao' || plano.tipo === 'cartao_compra') {
    if (!plano.dados.banco) f.push('banco');
    if (!plano.dados.limit) f.push('limite');
    if (!plano.dados.closingDay) f.push('fechamento');
  }
  if (plano.tipo === 'conta') {
    if (!plano.dados.banco) f.push('banco');
  }
  if (plano.compra) {
    if (!plano.compra.valor) f.push('valorCompra');
    if (!plano.compra.n) f.push('parcelas');
  }
  if (plano.tipo === 'lancamento' && !plano.dados.valor) f.push('valor');
  plano.faltando = f;
  return f;
}
function parseCadastroLuna(texto, estado) {
  const t = normTexto(texto);
  const temAcao = /(tenho|cadastr|criei|criar|adiciona|novo|nova|gastei|comprei|paguei|limite|fecha|venc|recebi|ganhei)/.test(t);
  if (!temAcao) return null;
  const banco = acharBancoLuna(t);
  const temCartao = t.indexOf('cartao') !== -1;
  const n = extrairParcelas(t);
  const vals = valoresReais(t);
  if (temCartao) {
    const dados = {
      banco: banco || null,
      limit: valorApos(t, 'limite'),
      closingDay: extrairDia(t, /fech(?:amento)?[^0-9]{0,14}dia\s*(\d{1,2})/) || extrairDia(t, /fatura[^0-9]{0,14}dia\s*(\d{1,2})/),
      dueDay: extrairDia(t, /venc(?:imento)?[^0-9]{0,14}dia\s*(\d{1,2})/)
    };
    let compra = null;
    if (n || /(gastei|comprei|parcela)/.test(t)) {
      let valorCompra = valorApos(t, 'gastei') || valorApos(t, 'comprei') || valorApos(t, 'paguei') || valorBareParcelado(t);
      if (!valorCompra && vals.length) {
        const outros = vals.filter(function (v) { return v.valor !== dados.limit; });
        if (outros.length) valorCompra = outros[0].valor;
      }
      if (valorCompra || n) {
        compra = { valor: valorCompra || null, n: n || null, nome: null, categoria: categoriaPorPalavras(t) || 'Compras' };
      }
    }
    const existe = banco && estado && estado.cards && estado.cards.some(function (c) {
      return normTexto(c.name).indexOf(normTexto(banco)) !== -1 || normTexto(c.bank || '').indexOf(normTexto(banco)) !== -1;
    });
    if (existe) {
      if (!compra) return null;
      const planoExistente = { tipo: 'compra', dados: { banco }, compra, faltando: [] };
      recalcularFaltando(planoExistente);
      return planoExistente;
    }
    const plano = { tipo: compra ? 'cartao_compra' : 'cartao', dados, compra, faltando: [] };
    recalcularFaltando(plano);
    return plano;
  }
  if (n) {
    const valorCompra = valorApos(t, 'gastei') || valorApos(t, 'comprei') || valorApos(t, 'paguei') || valorBareParcelado(t) || (vals.length ? vals[0].valor : null);
    const plano = {
      tipo: 'compra',
      dados: { banco: banco || null },
      compra: { valor: valorCompra || null, n, nome: descricaoLivre(t), categoria: categoriaPorPalavras(t) || 'Compras' },
      faltando: []
    };
    recalcularFaltando(plano);
    return plano;
  }
  const ehReceita = /(recebi|ganhei|caiu)/.test(t);
  const ehDespesa = /(gastei|paguei|comprei)/.test(t);
  const valorAvulso = vals.length ? vals[0].valor : numeroSolto(t);
  if ((ehReceita || ehDespesa) && valorAvulso) {
    const desc = descricaoLivre(t);
    const plano = {
      tipo: 'lancamento',
      dados: {
        tipo: ehReceita ? 'receita' : 'despesa',
        valor: valorAvulso,
        desc: desc,
        categoria: categoriaPorPalavras(t) || (ehReceita ? 'Outros' : 'Outros'),
        banco: banco || null
      },
      compra: null,
      faltando: []
    };
    recalcularFaltando(plano);
    return plano;
  }
  if (t.indexOf('conta') !== -1 && banco && (vals.length || numeroSolto(t))) {
    const plano = { tipo: 'conta', dados: { banco, initial: vals.length ? vals[0].valor : numeroSolto(t) }, compra: null, faltando: [] };
    recalcularFaltando(plano);
    return plano;
  }
  return null;
}
function resumoPlano(plano) {
  const linhas = [];
  if (plano.tipo === 'cartao' || plano.tipo === 'cartao_compra') {
    linhas.push('Cartão ' + plano.dados.banco + ': limite ' + fmt(plano.dados.limit) + ', fechamento dia ' + plano.dados.closingDay + ', vencimento dia ' + (plano.dados.dueDay || Math.min(28, plano.dados.closingDay + 5)) + '.');
  }
  if (plano.tipo === 'compra' || plano.compra) {
    const c = plano.compra;
    const cartaoTxt = plano.dados.banco ? ' no cartão ' + plano.dados.banco : ' sem cartão';
    linhas.push('Compra parcelada: ' + fmt(c.valor) + ' em ' + c.n + 'x de ' + fmt(c.valor / c.n) + cartaoTxt + (c.nome ? ' (' + c.nome + ')' : '') + '.');
  }
  if (plano.tipo === 'lancamento') {
    const d = plano.dados;
    linhas.push((d.tipo === 'receita' ? 'Receita' : 'Despesa') + ' de ' + fmt(d.valor) + ' — ' + (d.desc || d.categoria) + ' (' + d.categoria + ')' + (d.banco ? ' no cartão ' + d.banco : '') + '.');
  }
  if (plano.tipo === 'conta') {
    linhas.push('Conta ' + plano.dados.banco + ' com saldo inicial ' + fmt(plano.dados.initial) + '.');
  }
  return linhas.join('\n');
}
const PERGUNTAS_FALTANDO = {
  banco: 'De qual banco é o cartão?',
  limite: 'Qual o limite do cartão?',
  fechamento: 'Qual o dia de fechamento da fatura?',
  valorCompra: 'Qual o valor da compra?',
  parcelas: 'Em quantas parcelas?',
  valor: 'Qual o valor?'
};
function perguntaPlano(plano) {
  if (plano.faltando.length) {
    const q = PERGUNTAS_FALTANDO[plano.faltando[0]] || 'Pode me passar o resto?';
    const ja = [];
    if (plano.dados.banco) ja.push('banco ' + plano.dados.banco);
    if (plano.dados.limit) ja.push('limite ' + fmt(plano.dados.limit));
    if (plano.dados.closingDay) ja.push('fechamento dia ' + plano.dados.closingDay);
    if (plano.compra && plano.compra.valor) ja.push('compra ' + fmt(plano.compra.valor));
    if (plano.compra && plano.compra.n) ja.push(plano.compra.n + ' parcelas');
    return 'Entendi até aqui' + (ja.length ? ': ' + ja.join(', ') : '') + '. ' + q;
  }
  return 'Entendi! Vou cadastrar:\n' + resumoPlano(plano) + '\n\nPosso salvar? Responde "sim".';
}
function tentarPreencherPendente(texto, plano) {
  const t = normTexto(texto);
  const vals = valoresReais(t);
  const solto = numeroSolto(t);
  const primeiroValor = vals.length ? vals[0].valor : solto;
  const dia = extrairDia(t, /dia\s*(\d{1,2})/);
  const banco = acharBancoLuna(t);
  const n = extrairParcelas(t);
  let mudou = false;
  if (plano.faltando.indexOf('banco') !== -1 && banco) { plano.dados.banco = banco; mudou = true; }
  if (plano.faltando.indexOf('limite') !== -1 && primeiroValor) { plano.dados.limit = primeiroValor; mudou = true; }
  if (plano.faltando.indexOf('fechamento') !== -1 && dia) { plano.dados.closingDay = dia; mudou = true; }
  if (plano.compra) {
    if (plano.faltando.indexOf('valorCompra') !== -1 && primeiroValor) { plano.compra.valor = primeiroValor; mudou = true; }
    if (plano.faltando.indexOf('parcelas') !== -1 && n) { plano.compra.n = n; mudou = true; }
  }
  if (plano.tipo === 'lancamento' && plano.faltando.indexOf('valor') !== -1 && primeiroValor) { plano.dados.valor = primeiroValor; mudou = true; }
  if (mudou) recalcularFaltando(plano);
  return mudou;
}
function montarSnapshot() {
  const t = totaisMes(state, mesSel);
  return {
    mes: rotuloMes(mesSel),
    saldoTotal: saldoTotal(state),
    contas: state.accounts.map(function (a) { return { nome: a.name, tipo: a.type, saldo: saldoConta(state, a.id) }; }),
    totaisMes: t,
    cartoes: state.cards.map(function (c) {
      const f = faturaCartao(state, c.id, mesSel);
      return { nome: c.name, banco: c.bank, limite: c.limit, usado: f.total, disponivel: c.limit - f.total, faturaPaga: f.pago, vencimento: c.dueDay };
    }),
    parcelasMes: parcelasDoMes(state, mesSel).map(function (x) { return { compra: x.purchase.name, parcela: x.k + '/' + x.purchase.n, valor: x.valor, paga: x.pago }; }),
    parcelasFuturasTotal: state.purchases.reduce(function (s, p) { return s + restanteCompra(p).valorRestante; }, 0),
    gastosPorCategoria: gastosPorCategoria(state, mesSel),
    ultimasMovimentacoes: state.entries.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 10).map(function (e) { return { desc: e.desc, tipo: e.type, valor: e.amount, categoria: e.category, data: e.date }; })
  };
}
function lerHistoricoLuna() {
  try {
    const h = JSON.parse(localStorage.getItem(LS_CHAT) || '[]');
    return Array.isArray(h) ? h.filter(function (m) { return m && typeof m.content === 'string'; }).slice(-30) : [];
  } catch (e) { return []; }
}
function salvarHistoricoLuna(h) {
  try { localStorage.setItem(LS_CHAT, JSON.stringify(h.slice(-30))); } catch (e) {}
}
function vLuna() {
  const modo = CONFIG.groqConfigured ? 'Groq conectada' : 'Modo local — respostas calculadas com seus dados';
  const sugestoes = [
    'Quanto ainda tenho disponível este mês?',
    'Quanto vou pagar de parcelas em novembro?',
    'Qual cartão está com maior utilização?',
    'Quanto estou gastando com alimentação?',
    'Posso comprar um celular de R$ 2.000 parcelado em 10 vezes?',
    'Cadastra meu cartão Nubank: limite R$ 3.500, fecha dia 8'
  ];
  return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
    '<div><h3>✦ Luna AI</h3><p class="sub">Sua assistente financeira. Ela responde com os seus dados reais — nunca inventa saldos.</p></div>' +
    '<span class="tag ' + (CONFIG.groqConfigured ? 'verde' : 'amarelo') + '">' + modo + '</span></div>' +
    '<div class="chat-box" style="margin-top:16px"><div class="chat-mensagens" id="chatMensagens"></div>' +
    '<div class="sugestoes">' + sugestoes.map(function (s) { return '<button type="button" data-action="luna-pergunta" data-q="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
    '<form class="chat-form" id="formLuna"><input id="campoLuna" type="text" placeholder="Pergunte sobre o seu dinheiro..." autocomplete="off" maxlength="500"><button type="submit" class="btn btn-primary" aria-label="Enviar">➤</button></form>' +
    '</div></div>';
}
function renderChatLuna() {
  const box = $('chatMensagens');
  if (!box) return;
  const h = lerHistoricoLuna();
  box.innerHTML = '';
  if (!h.length) {
    const d = document.createElement('div');
    d.className = 'msg bot';
    d.textContent = 'Oi, Luis! Sou a Luna AI. Pergunte sobre o seu dinheiro — quanto sobra no mês, parcelas, cartões, gastos por categoria — que eu respondo com os seus dados de verdade.';
    box.appendChild(d);
  } else {
    h.forEach(function (m) {
      const d = document.createElement('div');
      d.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot');
      d.textContent = m.content;
      box.appendChild(d);
    });
  }
  box.scrollTop = box.scrollHeight;
}
/* ---------- Execução do cadastro pela Luna ---------- */
let cadastroPendente = null;
function ehConfirmacao(texto) {
  const t = normTexto(texto).trim();
  const curtas = ['sim', 'isso', 'confirma', 'pode salvar', 'salva', 'certo', 'fechado', 'ok', 'manda', 'pode'];
  return curtas.some(function (w) { return t === w || t.indexOf(w + ' ') === 0 || t.indexOf(w + ',') === 0; });
}
function ehCancelamento(texto) {
  const t = normTexto(texto).trim();
  return /^(nao|cancela|esquece|deixa|para)\b/.test(t) && t.length < 30;
}
function acharCartaoExistente(banco) {
  if (!banco) return null;
  const alvo = normTexto(banco);
  return state.cards.find(function (c) {
    return normTexto(c.name).indexOf(alvo) !== -1 || normTexto(c.bank || '').indexOf(alvo) !== -1;
  }) || null;
}
async function executarCadastroPendente() {
  const plano = cadastroPendente;
  cadastroPendente = null;
  const feitos = [];
  let cardId = null;
  let cardNome = plano.dados.banco || null;
  if (plano.tipo === 'cartao' || plano.tipo === 'cartao_compra') {
    const existente = acharCartaoExistente(plano.dados.banco);
    if (existente) {
      cardId = existente.id;
      cardNome = existente.name;
      feitos.push('Usei o cartão ' + existente.name + ', que já estava cadastrado.');
    } else {
      const closing = plano.dados.closingDay;
      const card = {
        id: uid(), name: plano.dados.banco, bank: plano.dados.banco, brand: 'Outra',
        limit: plano.dados.limit, closingDay: closing,
        dueDay: plano.dados.dueDay || Math.min(28, closing + 5),
        bestDay: closing >= 28 ? 1 : closing + 1, color: '#0a9a68'
      };
      state.cards.push(card);
      await persistir(marcar('cards', card));
      cardId = card.id;
      feitos.push('Cartão ' + card.name + ' criado: limite ' + fmt(card.limit) + ', fechamento dia ' + closing + ', vencimento dia ' + card.dueDay + '.');
    }
  } else if (plano.dados.banco) {
    const existente = acharCartaoExistente(plano.dados.banco);
    if (existente) { cardId = existente.id; cardNome = existente.name; }
  }
  if (plano.compra) {
    const p = {
      id: uid(),
      name: plano.compra.nome || ('Compra' + (cardNome ? ' no cartão ' + cardNome : '')),
      total: plano.compra.valor, cardId: cardId, n: plano.compra.n,
      firstMonth: chaveMes(new Date()), category: plano.compra.categoria || 'Compras', paidMonths: []
    };
    state.purchases.push(p);
    await persistir(marcar('purchases', p));
    feitos.push('Compra parcelada salva: ' + fmt(p.total) + ' em ' + p.n + 'x de ' + fmt(p.total / p.n) + ' a partir de ' + rotuloMes(p.firstMonth) + '. Veja em Parcelamentos.');
  }
  if (plano.tipo === 'lancamento') {
    const d = plano.dados;
    const e = {
      id: uid(), type: d.tipo, desc: d.desc || (d.tipo === 'receita' ? 'Receita' : 'Despesa'),
      amount: d.valor, category: d.categoria, date: hojeISO(),
      accountId: null, cardId: d.tipo === 'despesa' ? cardId : null,
      kind: 'avulsa', recurring: false, invoiceMonth: null, destAccountId: null
    };
    state.entries.push(e);
    await persistir(marcar('entries', e));
    feitos.push((d.tipo === 'receita' ? 'Receita' : 'Despesa') + ' de ' + fmt(d.valor) + ' salva em Receitas e despesas.');
  }
  if (plano.tipo === 'conta') {
    const a = { id: uid(), name: plano.dados.banco, type: 'Conta corrente', initial: plano.dados.initial || 0 };
    state.accounts.push(a);
    await persistir(marcar('accounts', a));
    feitos.push('Conta ' + a.name + ' criada com saldo inicial ' + fmt(a.initial) + '. Veja em Minhas contas.');
  }
  salvarLocal();
  render();
  return 'Pronto! Salvei:\n• ' + feitos.join('\n• ');
}
async function lunaEnviar(texto) {
  const h = lerHistoricoLuna();
  h.push({ role: 'user', content: texto });
  salvarHistoricoLuna(h);
  renderChatLuna();
  const box = $('chatMensagens');
  const espera = document.createElement('div');
  espera.className = 'msg bot digitando';
  espera.textContent = 'Luna está analisando seus dados...';
  box.appendChild(espera);
  box.scrollTop = box.scrollHeight;
  let resposta = null;
  if (cadastroPendente) {
    if (ehConfirmacao(texto)) {
      espera.remove();
      resposta = await executarCadastroPendente();
    } else if (ehCancelamento(texto)) {
      cadastroPendente = null;
      espera.remove();
      resposta = 'Tudo bem, descartei esse cadastro. Se quiser, fala de novo que eu anoto.';
    } else if (tentarPreencherPendente(texto, cadastroPendente)) {
      espera.remove();
      resposta = perguntaPlano(cadastroPendente);
    } else {
      cadastroPendente = null;
    }
  }
  if (!resposta && !cadastroPendente) {
    const plano = parseCadastroLuna(texto, state);
    if (plano) {
      cadastroPendente = plano;
      espera.remove();
      resposta = perguntaPlano(plano);
    }
  }
  if (!resposta) {
    if (CONFIG.groqConfigured) {
      try {
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: h, snapshot: montarSnapshot() })
        });
        const d = await r.json().catch(function () { return {}; });
        if (r.ok && d.reply) resposta = d.reply;
      } catch (e) { resposta = null; }
    }
    if (!resposta) {
      await new Promise(function (res) { setTimeout(res, 350); });
      resposta = lunaLocal(texto);
      if (CONFIG.groqConfigured) resposta += '\n\n(Respondi com o motor local porque a Groq não respondeu agora.)';
    }
    espera.remove();
  }
  h.push({ role: 'assistant', content: resposta });
  salvarHistoricoLuna(h);
  renderChatLuna();
}

/* ================= CONFIGURAÇÕES / AUTH ================= */
function vConfig() {
  const p = state.profile;
  const supabaseOn = MODO === 'supabase';
  return '<div class="grid duas">' +
    '<div class="card"><div class="perfil-linha"><div class="avatar-grande">' + esc((p.name || 'L').slice(0, 1).toUpperCase()) + '</div>' +
    '<div><h3>' + esc(p.name || 'Usuário') + '</h3><p class="sub">' + (supabaseOn ? esc(SESSION.user.email) + ' &bull; conta na nuvem' : 'Conta local neste aparelho') + '</p></div></div>' +
    '<form id="formPerfil" style="margin-top:18px">' +
    '<div class="campo"><label>Seu nome</label><input id="fNomePerfil" type="text" maxlength="30" value="' + esc(p.name || '') + '"></div>' +
    '<div class="switch-linha"><div><b>Tema claro</b><div class="sub">Padrão do sistema é o tema escuro.</div></div>' +
    '<label class="switch"><input id="fTema" type="checkbox"' + (p.theme === 'light' ? ' checked' : '') + '><i></i></label></div>' +
    '<div class="switch-linha"><div><b>Alerta de limite do cartão</b><div class="sub">Avisar quando o uso passar desta % do limite.</div></div>' +
    '<select id="fAlerta" style="width:110px"><option' + (Number(p.alertLimit || 80) === 70 ? ' selected' : '') + '>70</option><option' + (Number(p.alertLimit || 80) === 80 ? ' selected' : '') + '>80</option><option' + (Number(p.alertLimit || 80) === 90 ? ' selected' : '') + '>90</option></select></div>' +
    '<div class="erro" id="erroForm"></div>' +
    '<button type="submit" class="btn btn-primary">Salvar perfil</button></form></div>' +
    '<div class="card"><h3>Dados e sincronização</h3>' +
    (supabaseOn
      ? '<p class="sub" style="margin:8px 0 14px">Seus dados estão salvos na nuvem (Supabase) e aparecem em qualquer aparelho depois do login.</p>' +
        '<button type="button" class="btn btn-ghost" data-action="logout">Sair da conta</button>' +
        '<form id="formSenha" style="margin-top:20px"><h3 style="margin-bottom:12px">Alterar senha</h3>' +
        '<div class="campo"><label>Nova senha (mínimo 6 caracteres)</label><input id="fNovaSenha" type="password" minlength="6" required></div>' +
        '<div class="erro" id="erroSenha"></div><button type="submit" class="btn btn-primary">Alterar senha</button></form>'
      : '<p class="sub" style="margin:8px 0 14px">Modo local: os dados ficam salvos só neste aparelho e navegador. Para sincronizar entre aparelhos e ter login, ative o Supabase:</p>' +
        '<div class="sub" style="line-height:1.8">1. Crie um projeto no Supabase (grátis).<br>2. Rode o arquivo <b>supabase.sql</b> no editor SQL do projeto.<br>3. No projeto da Vercel, adicione <b>SUPABASE_URL</b> e <b>SUPABASE_ANON_KEY</b>.<br>4. Reabra o sistema e crie sua conta.</div>') +
    '<div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">' +
    '<button type="button" class="btn btn-ghost" data-action="exportar">⬇ Exportar meus dados (JSON)</button></div>' +
    '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px">' +
    '<h3 style="color:var(--red)">Zona de perigo</h3><p class="sub" style="margin:6px 0 12px">Apaga TODOS os seus lançamentos, contas, cartões e parcelas. Não tem volta.</p>' +
    '<button type="button" class="btn btn-danger" data-action="apagar-dados">Apagar todos os meus dados</button></div></div>' +
    '</div>';
}
function vAuth() {
  return '<div class="auth-wrap"><div class="card">' +
    '<div class="logo" style="justify-content:center;margin-bottom:8px"><span class="logo-mark">F</span><span class="logo-name">FinanSmart <em>AI</em></span></div>' +
    '<p class="sub" style="text-align:center;margin-bottom:18px">Entre para ver seus dados em qualquer aparelho.</p>' +
    '<div class="tabs"><button type="button" id="tabLogin" class="ativo">Entrar</button><button type="button" id="tabSignup">Criar conta</button></div>' +
    '<form id="formAuth" data-modo="login">' +
    '<div class="campo"><label>E-mail</label><input id="fEmail" type="email" required placeholder="voce@email.com"></div>' +
    '<div class="campo"><label>Senha</label><input id="fSenhaAuth" type="password" minlength="6" required placeholder="Mínimo 6 caracteres"></div>' +
    '<div class="erro" id="erroForm"></div>' +
    '<button type="submit" class="btn btn-primary" style="width:100%" id="btnAuth">Entrar</button></form>' +
    '<div style="text-align:center;margin-top:14px"><button type="button" class="btn btn-ghost btn-sm" data-action="recuperar-senha">Esqueci minha senha</button></div>' +
    '<p class="sub" style="text-align:center;margin-top:14px">Sem o Supabase configurado, o sistema abre em modo local — sem login.</p>' +
    '</div></div>';
}

/* ================= ROTAS / INICIALIZAÇÃO ================= */
const TITULOS = {
  dashboard: ['Visão geral', 'Seu dinheiro, organizado.'],
  contas: ['Minhas contas', 'Bancos e dinheiro em espécie.'],
  cartoes: ['Cartões', 'Limites, faturas e vencimentos.'],
  parcelas: ['Parcelamentos', 'Compras divididas mês a mês.'],
  mes: ['Meu mês', 'Todos os compromissos do período.'],
  lancamentos: ['Receitas e despesas', 'Lançamentos do mês selecionado.'],
  relatorios: ['Relatórios', 'Evolução, categorias e comparações.'],
  luna: ['Luna AI', 'Sua assistente financeira inteligente.'],
  config: ['Configurações', 'Perfil, aparência e dados.']
};
const VIEWS = {
  dashboard: vDashboard, contas: vContas, cartoes: vCartoes, parcelas: vParcelas,
  mes: vMes, lancamentos: vLancamentos, relatorios: vRelatorios, luna: vLuna, config: vConfig
};
function rotaDaHash() {
  const h = (location.hash || '').replace('#/', '');
  return TITULOS[h] ? h : 'dashboard';
}
function render() {
  if (MODO === 'supabase' && !SESSION) {
    $('pageTitle').textContent = 'Bem-vindo ao FinanSmart AI';
    $('pageSub').textContent = 'Entre para acessar seus dados.';
    $('btnNovo').style.display = 'none';
    document.querySelectorAll('#nav a, #bottombar a').forEach(function (a) { a.classList.remove('ativo'); });
    $('view').innerHTML = vAuth();
    return;
  }
  rotaAtual = rotaDaHash();
  if (rotaAtual !== 'cartoes') { cartaoAberto = null; comprasExpandidas = {}; }
  document.querySelectorAll('#nav a, #bottombar a').forEach(function (a) {
    a.classList.toggle('ativo', a.getAttribute('data-route') === rotaAtual);
  });
  $('pageTitle').textContent = TITULOS[rotaAtual][0];
  $('pageSub').textContent = TITULOS[rotaAtual][1];
  $('mesLabel').textContent = rotuloMes(mesSel);
  $('btnNovo').style.display = '';
  $('view').innerHTML = VIEWS[rotaAtual]();
  document.body.classList.remove('menu-aberto');
  if (rotaAtual === 'luna') renderChatLuna();
  window.scrollTo(0, 0);
}
function renderMesTopo() {
  $('mesLabel').textContent = rotuloMes(mesSel);
  render();
}
function bindStatic() {
  $('btnMenu').addEventListener('click', function () { document.body.classList.toggle('menu-aberto'); });
  $('scrim').addEventListener('click', function () { document.body.classList.remove('menu-aberto'); });
  $('mesAnt').addEventListener('click', function () { mesSel = deslocarMes(mesSel, -1); renderMesTopo(); });
  $('mesProx').addEventListener('click', function () { mesSel = deslocarMes(mesSel, 1); renderMesTopo(); });
  $('btnNovo').addEventListener('click', function () { openModal(formLancamentoHTML('despesa')); });
  window.addEventListener('hashchange', render);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });
  $('modalRoot').addEventListener('click', function (e) {
    if (e.target.classList.contains('modal') || e.target.closest('[data-fechar]')) closeModal();
  });
  document.addEventListener('click', async function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const acao = el.getAttribute('data-action');
    const id = el.getAttribute('data-id');
    if (acao === 'ir') { location.hash = '#/' + el.getAttribute('data-rota'); return; }
    if (acao === 'nova-conta') { openModal(formContaHTML()); return; }
    if (acao === 'editar-conta') { const o = state.accounts.find(function (x) { return x.id === id; }); if (o) openModal(formContaHTML(o)); return; }
    if (acao === 'apagar-conta') {
      const emUso = state.entries.some(function (x) { return x.accountId === id || x.destAccountId === id; });
      if (emUso) { toast('Esta conta tem lançamentos. Apague os lançamentos antes.'); return; }
      if (!confirm('Apagar esta conta?')) return;
      state.accounts = state.accounts.filter(function (x) { return x.id !== id; });
      await removerDaNuvem('accounts', id);
      salvarLocal(); render(); toast('Conta apagada.');
      return;
    }
    if (acao === 'novo-cartao') { openModal(formCartaoHTML()); return; }
    if (acao === 'editar-cartao') { const o = state.cards.find(function (x) { return x.id === id; }); if (o) openModal(formCartaoHTML(o)); return; }
    if (acao === 'apagar-cartao') {
      const emUso = state.entries.some(function (x) { return x.cardId === id; }) || state.purchases.some(function (x) { return x.cardId === id; });
      if (emUso) { toast('Este cartão tem lançamentos ou parcelas. Apague eles antes.'); return; }
      if (!confirm('Apagar este cartão?')) return;
      state.cards = state.cards.filter(function (x) { return x.id !== id; });
      await removerDaNuvem('cards', id);
      salvarLocal(); render(); toast('Cartão apagado.');
      return;
    }
    if (acao === 'pagar-fatura') { openModal(formPagarFaturaHTML(id, mesSel)); return; }
    if (acao === 'abrir-cartao') { cartaoAberto = id; cartaoMes = mesSel; comprasExpandidas = {}; render(); return; }
    if (acao === 'voltar-cartoes') { cartaoAberto = null; comprasExpandidas = {}; render(); return; }
    if (acao === 'cartao-mes-ant') { cartaoMes = deslocarMes(cartaoMes || mesSel, -1); render(); return; }
    if (acao === 'cartao-mes-prox') { cartaoMes = deslocarMes(cartaoMes || mesSel, 1); render(); return; }
    if (acao === 'cartao-mes-chip') { cartaoMes = el.getAttribute('data-mes'); render(); return; }
    if (acao === 'toggle-cronograma') { comprasExpandidas[id] = !comprasExpandidas[id]; render(); return; }
    if (acao === 'pagar-fatura-cartao') { openModal(formPagarFaturaHTML(id, el.getAttribute('data-mes') || mesSel)); return; }
    if (acao === 'menu-cartao') { const o = state.cards.find(function (x) { return x.id === id; }); if (o) openModal(menuCartaoHTML(o)); return; }
    if (acao === 'nova-compra') { openModal(formCompraHTML()); return; }
    if (acao === 'editar-compra') { const o = state.purchases.find(function (x) { return x.id === id; }); if (o) openModal(formCompraHTML(o)); return; }
    if (acao === 'apagar-compra') {
      if (!confirm('Apagar esta compra parcelada inteira?')) return;
      state.purchases = state.purchases.filter(function (x) { return x.id !== id; });
      await removerDaNuvem('purchases', id);
      salvarLocal(); render(); toast('Compra apagada.');
      return;
    }
    if (acao === 'toggle-parcela') {
      const p = state.purchases.find(function (x) { return x.id === id; });
      if (!p) return;
      const mes = el.getAttribute('data-mes');
      p.paidMonths = p.paidMonths || [];
      const i = p.paidMonths.indexOf(mes);
      if (i === -1) p.paidMonths.push(mes); else p.paidMonths.splice(i, 1);
      await persistir(marcar('purchases', p));
      salvarLocal(); render();
      return;
    }
    if (acao === 'novo-lancamento') {
      const tipo = el.getAttribute('data-tipo') || 'despesa';
      const pre = { date: hojeISO() };
      const conta = el.getAttribute('data-conta');
      if (conta) pre.accountId = conta;
      openModal(formLancamentoHTML(tipo, pre));
      return;
    }
    if (acao === 'nova-transferencia') { openModal(formTransferenciaHTML()); return; }
    if (acao === 'editar-lancamento') {
      const o = state.entries.find(function (x) { return x.id === id; });
      if (!o) return;
      if (o.type === 'transferencia') openModal(formTransferenciaHTML(o));
      else openModal(formLancamentoHTML(o.type, o));
      return;
    }
    if (acao === 'apagar-lancamento') {
      if (!confirm('Apagar este lançamento?')) return;
      state.entries = state.entries.filter(function (x) { return x.id !== id; });
      await removerDaNuvem('entries', id);
      salvarLocal(); render(); toast('Lançamento apagado.');
      return;
    }
    if (acao === 'rel-periodo') { REL_N = Number(el.getAttribute('data-n')) || 6; render(); return; }
    if (acao === 'luna-pergunta') {
      const q = el.getAttribute('data-q');
      const campo = $('campoLuna');
      if (campo) { campo.value = q; campo.focus(); }
      lunaEnviar(q);
      return;
    }
    if (acao === 'logout') {
      try { await sbAuth('logout', {}); } catch (e) {}
      guardarSessao(null);
      state = estadoVazio();
      salvarLocal();
      render();
      return;
    }
    if (acao === 'recuperar-senha') {
      const email = ($('fEmail') && $('fEmail').value || '').trim();
      if (!email) { toast('Digite seu e-mail no campo acima.'); return; }
      try {
        await sbAuth('recover', { email });
        toast('E-mail de recuperação enviado. Verifique sua caixa de entrada.');
      } catch (err) { toast('Não consegui enviar: ' + err.message); }
      return;
    }
    if (acao === 'exportar') {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'finansmart-dados.json';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Dados exportados.');
      return;
    }
    if (acao === 'apagar-dados') {
      if (!confirm('Apagar TODOS os seus dados? Esta ação não tem volta.')) return;
      if (MODO === 'supabase') {
        try {
          const userId = SESSION.user.id;
          await Promise.all(['entries', 'purchases', 'cards', 'accounts'].map(function (t) {
            return sbFetch('/rest/v1/' + t + '?user_id=eq.' + userId, { method: 'DELETE', headers: sbHeaders() });
          }));
        } catch (err) { toast('Erro ao apagar na nuvem: ' + err.message); return; }
      }
      state = estadoVazio();
      salvarLocal();
      render();
      toast('Todos os dados foram apagados.');
      return;
    }
  });
  document.addEventListener('submit', async function (e) {
    const form = e.target;
    if (!form || !form.id) return;
    e.preventDefault();
    if (form.id === 'formLancamento') { await submitLancamento(form); return; }
    if (form.id === 'formTransferencia') { await submitTransferencia(form); return; }
    if (form.id === 'formConta') { await submitConta(form); return; }
    if (form.id === 'formCartao') { await submitCartao(form); return; }
    if (form.id === 'formCompra') { await submitCompra(form); return; }
    if (form.id === 'formPagarFatura') { await submitPagarFatura(form); return; }
    if (form.id === 'formPerfil') { await submitPerfil(form); return; }
    if (form.id === 'formSenha') { await submitSenha(form); return; }
    if (form.id === 'formAuth') { await submitAuth(form); return; }
    if (form.id === 'formLuna') {
      const campo = $('campoLuna');
      const texto = campo.value.trim();
      if (!texto) return;
      campo.value = '';
      lunaEnviar(texto);
      return;
    }
  });
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t.id === 'filtroTipo') { FILTROS.tipo = t.value; FILTROS.categoria = 'todas'; render(); return; }
    if (t.id === 'filtroCategoria') { FILTROS.categoria = t.value; render(); return; }
    if (t.id === 'tabLogin' || t.id === 'tabSignup') return;
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'filtroBusca') {
      FILTROS.busca = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const nb = $('filtroBusca');
      if (nb) { nb.focus(); nb.setSelectionRange(pos, pos); }
    }
  });
  document.addEventListener('click', function (e) {
    if (e.target.id === 'tabLogin' || e.target.id === 'tabSignup') {
      const login = e.target.id === 'tabLogin';
      $('tabLogin').classList.toggle('ativo', login);
      $('tabSignup').classList.toggle('ativo', !login);
      const f = $('formAuth');
      f.setAttribute('data-modo', login ? 'login' : 'signup');
      $('btnAuth').textContent = login ? 'Entrar' : 'Criar conta';
    }
  });
}
async function submitLancamento(form) {
  const tipo = form.getAttribute('data-tipo');
  const id = form.getAttribute('data-id');
  const desc = $('fDesc').value.trim();
  const valor = parseValorBR($('fValor').value);
  const data = $('fData').value;
  const categoria = $('fCategoria').value;
  if (!desc) { mostrarErro('erroForm', 'Informe a descrição.'); return; }
  if (isNaN(valor) || valor <= 0) { mostrarErro('erroForm', 'Informe um valor válido, ex.: 150,00.'); return; }
  if (!data) { mostrarErro('erroForm', 'Informe a data.'); return; }
  let obj;
  if (tipo === 'receita') {
    const recorrente = !!($('fRecorrente') && $('fRecorrente').checked);
    obj = { id: id || uid(), type: 'receita', desc, amount: valor, category: categoria, date: data, accountId: $('fConta').value || null, cardId: null, kind: recorrente ? 'fixa' : 'avulsa', recurring: recorrente, invoiceMonth: null, destAccountId: null };
  } else {
    const cardId = $('fCartao').value || null;
    const kind = $('fKind').value;
    obj = { id: id || uid(), type: 'despesa', desc, amount: valor, category: categoria, date: data, accountId: cardId ? null : ($('fConta').value || null), cardId, kind, recurring: kind !== 'avulsa', invoiceMonth: null, destAccountId: null };
  }
  const i = state.entries.findIndex(function (x) { return x.id === obj.id; });
  if (i === -1) state.entries.push(obj); else state.entries[i] = obj;
  await persistir(marcar('entries', obj));
  salvarLocal();
  closeModal(); render(); toast('Lançamento salvo.');
}
async function submitTransferencia(form) {
  const id = form.getAttribute('data-id');
  const desc = $('fDesc').value.trim();
  const valor = parseValorBR($('fValor').value);
  const data = $('fData').value;
  const conta = $('fConta').value;
  const dest = $('fDest').value || null;
  if (!desc) { mostrarErro('erroForm', 'Informe a descrição.'); return; }
  if (isNaN(valor) || valor <= 0) { mostrarErro('erroForm', 'Informe um valor válido.'); return; }
  if (!data) { mostrarErro('erroForm', 'Informe a data.'); return; }
  if (!conta) { mostrarErro('erroForm', 'Cadastre uma conta primeiro.'); return; }
  if (dest && dest === conta) { mostrarErro('erroForm', 'Origem e destino precisam ser diferentes.'); return; }
  const obj = { id: id || uid(), type: 'transferencia', desc, amount: valor, category: 'Outros', date: data, accountId: conta, cardId: null, kind: 'avulsa', recurring: false, invoiceMonth: null, destAccountId: dest };
  const i = state.entries.findIndex(function (x) { return x.id === obj.id; });
  if (i === -1) state.entries.push(obj); else state.entries[i] = obj;
  await persistir(marcar('entries', obj));
  salvarLocal();
  closeModal(); render(); toast('Transferência registrada.');
}
async function submitConta(form) {
  const id = form.getAttribute('data-id');
  const name = $('fNome').value.trim();
  const initial = parseValorBR($('fSaldo').value);
  if (!name) { mostrarErro('erroForm', 'Informe o nome da conta.'); return; }
  if (isNaN(initial) || initial < 0) { mostrarErro('erroForm', 'Informe um saldo inicial válido.'); return; }
  const obj = { id: id || uid(), name, type: $('fTipo').value, initial };
  const i = state.accounts.findIndex(function (x) { return x.id === obj.id; });
  if (i === -1) state.accounts.push(obj); else state.accounts[i] = obj;
  await persistir(marcar('accounts', obj));
  salvarLocal();
  closeModal(); render(); toast('Conta salva.');
}
async function submitCartao(form) {
  const id = form.getAttribute('data-id');
  const name = $('fNome').value.trim();
  const limit = parseValorBR($('fLimite').value);
  if (!name) { mostrarErro('erroForm', 'Informe o nome do cartão.'); return; }
  if (isNaN(limit) || limit <= 0) { mostrarErro('erroForm', 'Informe um limite válido.'); return; }
  const obj = {
    id: id || uid(), name, bank: $('fBanco').value.trim(), brand: $('fBandeira').value,
    limit, closingDay: Number($('fFech').value), dueDay: Number($('fVenc').value),
    bestDay: Number($('fMelhor').value), color: $('fCor').value
  };
  const i = state.cards.findIndex(function (x) { return x.id === obj.id; });
  if (i === -1) state.cards.push(obj); else state.cards[i] = obj;
  await persistir(marcar('cards', obj));
  salvarLocal();
  closeModal(); render(); toast('Cartão salvo.');
}
async function submitCompra(form) {
  const id = form.getAttribute('data-id');
  const name = $('fNome').value.trim();
  const total = parseValorBR($('fTotal').value);
  const n = parseInt($('fN').value, 10);
  const inicio = $('fInicio').value;
  if (!name) { mostrarErro('erroForm', 'Informe o nome da compra.'); return; }
  if (isNaN(total) || total <= 0) { mostrarErro('erroForm', 'Informe o valor total.'); return; }
  if (!n || n < 1 || n > 48) { mostrarErro('erroForm', 'Parcelas de 1 a 48.'); return; }
  if (!inicio) { mostrarErro('erroForm', 'Informe o mês da primeira parcela.'); return; }
  const anterior = state.purchases.find(function (x) { return x.id === id; });
  const obj = { id: id || uid(), name, total, cardId: $('fCartao').value || null, n, firstMonth: inicio, category: $('fCategoria').value, paidMonths: anterior ? (anterior.paidMonths || []) : [] };
  const i = state.purchases.findIndex(function (x) { return x.id === obj.id; });
  if (i === -1) state.purchases.push(obj); else state.purchases[i] = obj;
  await persistir(marcar('purchases', obj));
  salvarLocal();
  closeModal(); render(); toast('Compra parcelada salva. Parcelas de ' + fmt(total / n) + '/mês.');
}
async function submitPagarFatura(form) {
  const cardId = form.getAttribute('data-card');
  const ch = form.getAttribute('data-mes');
  const valor = parseValorBR($('fValor').value);
  const data = $('fData').value;
  const conta = $('fConta').value;
  if (isNaN(valor) || valor <= 0) { mostrarErro('erroForm', 'Informe um valor válido.'); return; }
  if (!data) { mostrarErro('erroForm', 'Informe a data.'); return; }
  if (!conta) { mostrarErro('erroForm', 'Escolha a conta de onde sai o pagamento.'); return; }
  const card = state.cards.find(function (c) { return c.id === cardId; });
  const obj = { id: uid(), type: 'transferencia', desc: 'Pagamento fatura ' + card.name + ' (' + rotuloMes(ch) + ')', amount: valor, category: 'Outros', date: data, accountId: conta, cardId, kind: 'avulsa', recurring: false, invoiceMonth: ch, destAccountId: null };
  state.entries.push(obj);
  await persistir(marcar('entries', obj));
  salvarLocal();
  closeModal(); render(); toast('Pagamento registrado. A fatura foi marcada como paga.');
}
async function submitPerfil(form) {
  const name = $('fNomePerfil').value.trim() || 'Luis';
  const theme = $('fTema').checked ? 'light' : 'dark';
  const alertLimit = Number($('fAlerta').value) || 80;
  state.profile.name = name;
  state.profile.theme = theme;
  state.profile.alertLimit = alertLimit;
  await persistir(marcar('profile', { id: 'perfil' }));
  salvarLocal();
  aplicarTema();
  atualizarBadgeModo();
  render();
  toast('Perfil salvo.');
}
async function submitSenha(form) {
  const nova = $('fNovaSenha').value;
  if (!nova || nova.length < 6) { mostrarErro('erroSenha', 'A senha precisa de ao menos 6 caracteres.'); return; }
  try {
    await sbFetch('/auth/v1/user', { method: 'PUT', headers: sbHeaders(), body: JSON.stringify({ password: nova }) });
    toast('Senha alterada.');
    closeModal();
    form.reset();
  } catch (err) {
    mostrarErro('erroSenha', 'Não consegui alterar: ' + err.message);
  }
}
async function submitAuth(form) {
  const modo = form.getAttribute('data-modo');
  const email = $('fEmail').value.trim();
  const senha = $('fSenhaAuth').value;
  const btn = $('btnAuth');
  btn.disabled = true;
  btn.textContent = 'Aguarde...';
  try {
    if (modo === 'signup') {
      const data = await sbAuth('signup', { email, password: senha });
      if (data.session) {
        guardarSessao({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: data.user });
      } else {
        mostrarErro('erroForm', 'Conta criada! Verifique seu e-mail para confirmar e depois entre.');
        btn.disabled = false;
        btn.textContent = 'Entrar';
        return;
      }
    } else {
      const data = await sbAuth('token?grant_type=password', { email, password: senha });
      guardarSessao({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
    }
    await sbCarregarTudo();
    if (!state.profile.name) state.profile.name = 'Luis';
    await persistir(marcar('profile', { id: 'perfil' }));
    aplicarTema();
    atualizarBadgeModo();
    render();
    toast('Bem-vindo ao FinanSmart AI!');
  } catch (err) {
    mostrarErro('erroForm', err.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : err.message);
    btn.disabled = false;
    btn.textContent = modo === 'signup' ? 'Criar conta' : 'Entrar';
  }
}
async function boot() {
  state = carregarLocal();
  try {
    const cfg = await fetch('/api/config').then(function (r) { return r.json(); });
    CONFIG.supabaseUrl = cfg.supabaseUrl || '';
    CONFIG.supabaseAnonKey = cfg.supabaseAnonKey || '';
    CONFIG.groqConfigured = !!cfg.groqConfigured;
    CONFIG.groqModel = cfg.groqModel || '';
  } catch (e) { /* sem backend: modo local */ }
  if (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) {
    MODO = 'supabase';
    SESSION = lerSessao();
    if (SESSION) {
      const ok = await sbValidarSessao();
      if (ok) {
        try { await sbCarregarTudo(); }
        catch (err) { toast('Não consegui carregar da nuvem — usando cópia local.'); state = carregarLocal(); }
      } else {
        guardarSessao(null);
      }
    }
  } else {
    MODO = 'local';
  }
  aplicarTema();
  atualizarBadgeModo();
  bindStatic();
  render();
}
boot();
