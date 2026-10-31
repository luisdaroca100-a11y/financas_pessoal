'use strict';
/* Smoke test de DOM do FinanSmart AI — Node, sem dependências.
   Uso: node test/smoke-dom.js
   Sobe o app.js com um DOM falso, navega pelas 9 telas e envia
   dois formulários, conferindo o HTML gerado e a persistência. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function fakeEl() {
  const listeners = {};
  const el = {
    children: [],
    style: {},
    dataset: {},
    _attrs: {},
    _text: '',
    _html: '',
    value: '',
    checked: false,
    disabled: false,
    className: '',
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; }
    },
    setAttribute(k, v) { el._attrs[k] = v; },
    getAttribute(k) { return el._attrs[k] || null; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    appendChild(c) { el.children.push(c); return c; },
    remove() {},
    closest() { return null; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    focus() {},
    click() {},
    reset() {},
    setSelectionRange() {},
    scrollTop: 0
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = String(v); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); }
  });
  el._listeners = listeners;
  return el;
}

const els = {};
const docListeners = {};
const winListeners = {};
const store = {};
global.document = {
  getElementById(id) { return els[id] || (els[id] = fakeEl()); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  createElement() { return fakeEl(); },
  addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
  body: fakeEl(),
  documentElement: fakeEl()
};
global.window = {
  addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
  scrollTo() {}
};
global.location = { hash: '#/dashboard' };
global.localStorage = {
  getItem(k) { return store[k] || null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};
global.fetch = async () => ({ json: async () => ({}) });
global.confirm = () => true;

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
eval(src);

const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  await tick(); await tick(); await tick();
  const view = () => els.view.innerHTML;

  const rotas = [
    ['dashboard', 'Receitas x despesas'],
    ['contas', 'Nenhuma conta cadastrada'],
    ['cartoes', 'Nenhum cartão cadastrado'],
    ['parcelas', 'Nenhuma compra parcelada'],
    ['mes', 'Meu mês'],
    ['lancamentos', 'Nenhum lançamento'],
    ['relatorios', 'Gastos por mês'],
    ['luna', 'Luna AI'],
    ['config', 'Dados e sincronização']
  ];
  for (const [rota, marca] of rotas) {
    global.location.hash = '#/' + rota;
    (winListeners.hashchange || []).forEach((fn) => fn());
    await tick();
    const html = view();
    assert.ok(html.includes(marca), 'rota ' + rota + ' sem marca "' + marca + '"');
    assert.ok(!html.includes('undefined'), 'rota ' + rota + ' contém "undefined"');
    assert.ok(!html.includes('NaN'), 'rota ' + rota + ' contém "NaN"');
    assert.ok(!html.includes('[object Object]'), 'rota ' + rota + ' contém [object Object]');
    console.log('  ok - tela /' + rota);
  }

  const F = (id) => document.getElementById(id);
  // Formulário: nova conta
  F('fNome').value = 'Inter';
  F('fTipo').value = 'Conta corrente';
  F('fSaldo').value = '1.000,00';
  const formConta = { id: 'formConta', getAttribute: () => '' };
  for (const fn of (docListeners.submit || [])) {
    await fn({ target: formConta, preventDefault() {} });
  }
  await tick();
  let dados = JSON.parse(store.finansmart_v1);
  assert.strictEqual(dados.accounts.length, 1);
  assert.strictEqual(dados.accounts[0].name, 'Inter');
  assert.strictEqual(dados.accounts[0].initial, 1000);
  console.log('  ok - formulário de conta persiste (saldo inicial 1000)');

  // Formulário: receita de 5000 hoje
  const hoje = new Date().toISOString().slice(0, 10);
  F('fDesc').value = 'Salário';
  F('fValor').value = '5.000,00';
  F('fData').value = hoje;
  F('fCategoria').value = 'Salário';
  F('fConta').value = dados.accounts[0].id;
  F('fRecorrente').checked = false;
  const formLanc = { id: 'formLancamento', getAttribute: (n) => (n === 'data-tipo' ? 'receita' : '') };
  for (const fn of (docListeners.submit || [])) {
    await fn({ target: formLanc, preventDefault() {} });
  }
  await tick();
  dados = JSON.parse(store.finansmart_v1);
  assert.strictEqual(dados.entries.length, 1);
  assert.strictEqual(dados.entries[0].amount, 5000);
  console.log('  ok - formulário de receita persiste (5000)');

  // Dashboard reflete: saldo 6000 e receita 5000
  global.location.hash = '#/dashboard';
  (winListeners.hashchange || []).forEach((fn) => fn());
  await tick();
  const dash = view();
  assert.ok(dash.includes('R$\u00a06.000,00'), 'dashboard sem saldo 6000');
  assert.ok(dash.includes('R$\u00a05.000,00'), 'dashboard sem receita 5000');
  console.log('  ok - dashboard reflete saldo e receita');

  // Tela de contas mostra a conta e o saldo atualizado
  global.location.hash = '#/contas';
  (winListeners.hashchange || []).forEach((fn) => fn());
  await tick();
  assert.ok(view().includes('Inter'), 'contas sem "Inter"');
  assert.ok(view().includes('R$\u00a06.000,00'), 'contas sem saldo 6000');
  console.log('  ok - tela de contas mostra saldo atualizado');

  console.log('\nSmoke DOM: todas as telas renderizaram, 2 formulários OK.');
})().catch((e) => {
  console.error('FALHOU:', e);
  process.exit(1);
});
