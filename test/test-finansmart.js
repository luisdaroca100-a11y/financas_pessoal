'use strict';
/* Testes dos cálculos do FinanSmart AI — Node, sem dependências.
   Uso: node test/test-finansmart.js
   Extrai o bloco puro de app.js (entre __PURE_START__/__PURE_END__)
   e a região da Luna (normTexto..montarSnapshot) e testa com dados fixos. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const pureSrc = src.split('// __PURE_START__')[1].split('// __PURE_END__')[0];
const mod = { exports: {} };
new Function('module', 'exports', pureSrc)(mod, mod.exports);
const P = mod.exports;

let pass = 0;
function ok(nome, fn) {
  fn();
  pass++;
  console.log('  ok - ' + nome);
}

/* ---------- valores e meses ---------- */
ok('parseValorBR entende 1.234,56 / R$ / inteiro', () => {
  assert.strictEqual(P.parseValorBR('1.234,56'), 1234.56);
  assert.strictEqual(P.parseValorBR('R$ 2.000,00'), 2000);
  assert.strictEqual(P.parseValorBR('150'), 150);
  assert.strictEqual(P.parseValorBR('150,50'), 150.5);
  assert.strictEqual(P.parseValorBR('2.000'), 2000);
  assert.strictEqual(P.parseValorBR('1.5'), 1.5);
  assert.ok(Number.isNaN(P.parseValorBR('')));
});
ok('deslocarMes cruza virada de ano', () => {
  assert.strictEqual(P.deslocarMes('2026-12', 1), '2027-01');
  assert.strictEqual(P.deslocarMes('2026-01', -1), '2025-12');
  assert.strictEqual(P.deslocarMes('2026-10', 3), '2027-01');
});
ok('rotuloMes em pt-BR', () => {
  assert.strictEqual(P.rotuloMes('2026-10'), 'outubro de 2026');
});

/* ---------- fixture ---------- */
function fixture() {
  return {
    profile: { name: 'Luis', theme: 'dark', alertLimit: 80 },
    accounts: [
      { id: 'acc-inter', name: 'Inter', type: 'Conta corrente', initial: 1000 },
      { id: 'acc-cart', name: 'Carteira', type: 'Carteira (espécie)', initial: 200 }
    ],
    cards: [
      { id: 'card-nub', name: 'Nubank', bank: 'Nubank', brand: 'Mastercard', limit: 5000, closingDay: 10, dueDay: 15, bestDay: 11, color: '#0a9a68' }
    ],
    entries: [
      { id: 'e1', type: 'receita', desc: 'Salário', amount: 5000, category: 'Salário', date: '2026-10-01', accountId: 'acc-inter', cardId: null, kind: 'fixa', recurring: true, invoiceMonth: null, destAccountId: null },
      { id: 'e2', type: 'despesa', desc: 'Mercado', amount: 300, category: 'Alimentação', date: '2026-10-05', accountId: 'acc-cart', cardId: null, kind: 'avulsa', recurring: false, invoiceMonth: null, destAccountId: null },
      { id: 'e3', type: 'despesa', desc: 'Camisa', amount: 250, category: 'Compras', date: '2026-10-12', accountId: null, cardId: 'card-nub', kind: 'avulsa', recurring: false, invoiceMonth: null, destAccountId: null },
      { id: 'e4', type: 'despesa', desc: 'Netflix', amount: 40, category: 'Assinaturas', date: '2026-10-02', accountId: null, cardId: 'card-nub', kind: 'assinatura', recurring: true, invoiceMonth: null, destAccountId: null },
      { id: 'e5', type: 'despesa', desc: 'Aluguel', amount: 1200, category: 'Moradia', date: '2026-10-03', accountId: 'acc-inter', cardId: null, kind: 'fixa', recurring: true, invoiceMonth: null, destAccountId: null },
      { id: 'e6', type: 'despesa', desc: 'Futuro', amount: 500, category: 'Outros', date: '2026-12-01', accountId: 'acc-inter', cardId: null, kind: 'avulsa', recurring: false, invoiceMonth: null, destAccountId: null }
    ],
    purchases: [
      { id: 'p1', name: 'Celular', total: 1200, cardId: 'card-nub', n: 12, firstMonth: '2026-10', category: 'Compras', paidMonths: ['2026-10'] }
    ]
  };
}

/* ---------- fechamento do cartão ---------- */
ok('compra após o fechamento cai na fatura do mês seguinte', () => {
  const card = fixture().cards[0];
  assert.strictEqual(P.invoiceMonthFor('2026-10-12', card), '2026-11');
  assert.strictEqual(P.invoiceMonthFor('2026-10-10', card), '2026-10');
  assert.strictEqual(P.invoiceMonthFor('2026-10-02', card), '2026-10');
});
ok('expandEntries não duplica e respeita o fechamento', () => {
  const st = fixture();
  const out = P.expandEntries(st, '2026-10').map((o) => o.entry.id).sort();
  assert.deepStrictEqual(out, ['e1', 'e2', 'e4', 'e5']);
  const nov = P.expandEntries(st, '2026-11').map((o) => o.entry.id).sort();
  assert.deepStrictEqual(nov, ['e1', 'e3', 'e4', 'e5']);
});

/* ---------- parcelas ---------- */
ok('parcelas distribuídas: 1200 em 12x de 100, término em set/2027', () => {
  const st = fixture();
  const out = P.parcelasDoMes(st, '2026-10');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].valor, 100);
  assert.strictEqual(out[0].k, 1);
  assert.strictEqual(out[0].pago, true);
  const nov = P.parcelasDoMes(st, '2026-11');
  assert.strictEqual(nov[0].k, 2);
  assert.strictEqual(nov[0].pago, false);
  assert.strictEqual(P.fimDaCompra(st.purchases[0]), '2027-09');
  assert.deepStrictEqual(P.restanteCompra(st.purchases[0]), { pagos: 1, restantes: 11, valorRestante: 1100 });
  assert.strictEqual(P.parcelasDoMes(st, '2027-10').length, 0);
});

/* ---------- fatura ---------- */
ok('fatura = avulsas + parcelas; pagamento marca como paga', () => {
  const st = fixture();
  const fatOut = P.faturaCartao(st, 'card-nub', '2026-10');
  assert.strictEqual(fatOut.avulsas, 40);
  assert.strictEqual(fatOut.parcelas, 100);
  assert.strictEqual(fatOut.total, 140);
  assert.strictEqual(fatOut.pago, false);
  st.entries.push({ id: 'e7', type: 'transferencia', desc: 'Pagamento fatura', amount: 140, category: 'Outros', date: '2026-10-14', accountId: 'acc-inter', cardId: 'card-nub', kind: 'avulsa', recurring: false, invoiceMonth: '2026-10', destAccountId: null });
  const fatPaga = P.faturaCartao(st, 'card-nub', '2026-10');
  assert.strictEqual(fatPaga.pago, true);
  assert.strictEqual(fatPaga.faltam, 0);
});

/* ---------- saldos e totais ---------- */
ok('saldo da conta ignora lançamentos futuros e compras no cartão', () => {
  const st = fixture();
  assert.strictEqual(P.saldoConta(st, 'acc-inter', '2026-10-31'), 4800);
  assert.strictEqual(P.saldoConta(st, 'acc-cart', '2026-10-31'), -100);
  assert.strictEqual(P.saldoTotal(st, '2026-10-31'), 4700);
});
ok('totais do mês sem dupla contagem (parcela não é despesa cheia)', () => {
  const st = fixture();
  const t = P.totaisMes(st, '2026-10');
  assert.strictEqual(t.receitas, 5000);
  assert.strictEqual(t.despesas, 1540);
  assert.strictEqual(t.parcelas, 100);
  assert.strictEqual(t.comprometido, 1640);
  assert.strictEqual(t.sobra, 3360);
  assert.strictEqual(t.faturas, 140);
});
ok('gastos por categoria somam despesas + parcelas', () => {
  const st = fixture();
  const cats = P.gastosPorCategoria(st, '2026-10');
  const map = {};
  cats.forEach((c) => { map[c.categoria] = c.valor; });
  assert.strictEqual(map['Moradia'], 1200);
  assert.strictEqual(map['Alimentação'], 300);
  assert.strictEqual(map['Assinaturas'], 40);
  assert.strictEqual(map['Compras'], 100);
});
ok('compromissos do mês: grupos sem sobreposição somam o comprometido', () => {
  const st = fixture();
  const c = P.compromissosDoMes(st, '2026-10');
  const soma = ['fixas', 'assinaturas', 'emprestimos', 'parcelas', 'faturas', 'outras']
    .reduce((s, g) => s + c.grupos[g].reduce((a, x) => a + x.valor, 0), 0);
  assert.strictEqual(soma, c.tComp);
  assert.strictEqual(c.tComp, 1640);
  assert.strictEqual(c.disponivel, 3360);
});
ok('recorrente se repete nos meses seguintes', () => {
  const st = fixture();
  const t = P.totaisMes(st, '2026-12');
  assert.strictEqual(t.receitas, 5000);
  assert.strictEqual(t.despesas, 1200 + 40 + 500);
});

/* ---------- Luna local ---------- */
const CATEGORIAS_DESPESA = ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Lazer', 'Compras', 'Assinaturas', 'Outros'];
const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const lunaSrc = src.slice(src.indexOf('function normTexto'), src.indexOf('function montarSnapshot'));
function lunaPara(state, mesSel) {
  const ctx = Object.assign({}, P, { state, mesSel, CATEGORIAS_DESPESA, MESES_PT });
  const keys = Object.keys(ctx);
  const fn = new Function(...keys, lunaSrc + '\nreturn lunaLocal;');
  return fn(...keys.map((k) => ctx[k]));
}
ok('Luna: sobra do mês com número real', () => {
  const luna = lunaPara(fixture(), '2026-10');
  const r = luna('Quanto ainda tenho disponível este mês?');
  assert.ok(r.includes('3.360,00'), r);
});
ok('Luna: parcelas de novembro', () => {
  const luna = lunaPara(fixture(), '2026-10');
  const r = luna('Quanto vou pagar de parcelas em novembro?');
  assert.ok(r.includes('100,00'), r);
});
ok('Luna: maior utilização de cartão', () => {
  const luna = lunaPara(fixture(), '2026-10');
  const r = luna('Qual cartão está com maior utilização?');
  assert.ok(r.includes('Nubank'), r);
  assert.ok(r.includes('140,00'), r);
  assert.ok(r.includes('outubro de 2026'), r);
});
ok('Luna: "maior" não vira mês de maio', () => {
  const luna = lunaPara(fixture(), '2026-10');
  const r = luna('Qual é o maior gasto do mês?');
  assert.ok(!r.includes('maio de'), r);
});
ok('Luna: gasto com alimentação', () => {
  const luna = lunaPara(fixture(), '2026-10');
  const r = luna('Quanto estou gastando com alimentação?');
  assert.ok(r.includes('300,00'), r);
});
ok('Luna: simulação de compra parcelada', () => {
  const luna = lunaPara(fixture(), '2026-10');
  const r = luna('Posso comprar um celular de R$ 2.000 parcelado em 10 vezes?');
  assert.ok(r.includes('200,00'), r);
  assert.ok(r.includes('3.160,00'), r);
});
ok('Luna: pergunta fora do escopo lista capacidades, sem inventar', () => {
  const luna = lunaPara(fixture(), '2026-10');
  const r = luna('Qual é a previsão do tempo?');
  assert.ok(r.includes('Posso ajudar'), r);
  assert.ok(!r.includes('3.360'), r);
});

console.log('\n' + pass + ' testes PASS.');
