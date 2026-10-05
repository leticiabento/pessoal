'use strict';

// ---------- Configuração ----------
const STORAGE_KEY = 'pessoal:financas:v1';

const CATS = {
  renda:         { label: 'Renda',          color: '#8fd3d1' },
  essenciais:    { label: 'Essenciais',     color: '#f4a7b9' },
  naoEssenciais: { label: 'Não Essenciais', color: '#b9a7e8' },
  economias:     { label: 'Economias',      color: '#f7c59f' },
  dividas:       { label: 'Dívidas',        color: '#f6dd8a' },
};
const ALLOC_CATS = ['essenciais', 'naoEssenciais', 'economias', 'dividas'];
// Economias são dinheiro guardado, não gasto.
const SPEND_CATS = ['essenciais', 'naoEssenciais', 'dividas'];
const DEFAULT_PCT = { essenciais: 55, naoEssenciais: 10, economias: 20, dividas: 15 };
const PALETTE = ['#8fd3d1', '#f4a7b9', '#b9a7e8', '#f7c59f', '#f6dd8a', '#a7d8a9', '#9fc4f0', '#f2b5d4', '#c9e4a6', '#e6c3a5'];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v) => brl.format(v || 0);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const sum = (arr, fn) => arr.reduce((acc, x) => acc + fn(x), 0);

// ---------- Estado ----------
function emptyMonth() {
  return {
    pct: { ...DEFAULT_PCT },
    renda: [], essenciais: [], naoEssenciais: [], economias: [], dividas: [],
    cartoes: [],
    transacoes: [],
  };
}

function seedMonth() {
  const m = emptyMonth();
  const it = (nome, orcamento, extra = {}) => ({ id: uid(), nome, orcamento, pago: false, ...extra });
  m.renda = [it('Salário', 0, { dia: 5 }), it('Freelancer', 0, { dia: 15 })];
  m.essenciais = ['Aluguel', 'Supermercado', 'Luz', 'Água', 'Internet', 'Transporte'].map((n) => it(n, 0));
  m.naoEssenciais = ['Delivery', 'Streaming', 'Lazer'].map((n) => it(n, 0));
  m.economias = ['Reserva de emergência', 'Viagem'].map((n) => it(n, 0));
  m.dividas = [it('Empréstimo', 0, { dia: 10 })];
  m.cartoes = [{ id: uid(), nome: 'Cartão principal', anteriores: 0, pago: false }];
  return m;
}

// ---------- Servidor (API PHP + MySQL) ----------
const API_URL = 'api/index.php';

async function api(action, { method = 'GET', body } = {}) {
  const headers = { 'X-Requested-With': 'fetch' };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_URL}?action=${action}`, {
    method, headers, credentials: 'same-origin', cache: 'no-store',
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch (e) { /* resposta sem JSON */ }
  if (!res.ok) {
    const err = new Error(json.error || `Erro ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const state = { months: {} };
let version = 0;     // versão dos dados no servidor, evita sobrescrever alterações de outro aparelho
let ready = false;   // sessão autenticada e dados carregados
let dirty = false;   // há alterações locais ainda não enviadas
let saving = false;
let saveTimer = null;
let retryTimer = null;

function setStatus(text, kind = '') {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = text;
  el.className = `save-status ${kind}`;
}

function save() {
  if (!ready) return;
  dirty = true;
  setStatus('Alterações não salvas…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}

async function flush() {
  clearTimeout(saveTimer);
  clearTimeout(retryTimer);
  retryTimer = null;
  if (saving || !dirty) return;
  saving = true;
  dirty = false;
  setStatus('Salvando…');
  try {
    const res = await api('state', { method: 'PUT', body: { version, data: JSON.stringify(state) } });
    version = res.version;
    setStatus(dirty ? 'Alterações não salvas…' : 'Salvo ✓', dirty ? '' : 'ok');
  } catch (e) {
    dirty = true;
    if (e.status === 409) {
      dirty = false;
      alert('Os dados foram alterados em outro aparelho. Vou carregar a versão mais recente: refaça a última alteração, por favor.');
      await pull();
    } else if (e.status === 401) {
      setStatus('Sessão expirada', 'err');
      showLogin();
    } else {
      setStatus('Erro ao salvar, tentando de novo…', 'err');
      retryTimer = setTimeout(flush, 5000);
    }
  } finally {
    saving = false;
  }
  if (dirty && ready && !retryTimer) flush();
}

async function pull() {
  const res = await api('state');
  version = res.version;
  state.months = res.data ? (JSON.parse(res.data).months || {}) : {};
  dirty = false;
  setStatus(version ? 'Salvo ✓' : '', 'ok');
  render();
  return res;
}

function showLogin(message = '') {
  ready = false;
  document.getElementById('login').hidden = false;
  document.getElementById('login-error').textContent = message;
  document.getElementById('login-password').focus();
}

async function afterLogin() {
  document.getElementById('login').hidden = true;
  if (dirty) {
    // Sessão expirou com alterações pendentes: envia antes de recarregar.
    ready = true;
    await flush();
    return;
  }
  const res = await pull();
  ready = true;
  if (res.version === 0) migrateLocalData();
}

// Versões anteriores salvavam só no navegador: oferece enviar esses dados ao servidor.
const LEGACY_KEY = 'pessoal:financas:v1';
function migrateLocalData() {
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch (e) { /* sem dados */ }
  if (!legacy || !legacy.months || !Object.keys(legacy.months).length) return;
  if (!confirm('Encontrei dados salvos neste navegador. Enviar para o servidor?')) return;
  state.months = { ...state.months, ...legacy.months };
  save();
  render();
}

async function boot() {
  try {
    const res = await api('session');
    if (res.authenticated) await afterLogin();
    else showLogin();
  } catch (e) {
    showLogin(`Não foi possível conectar ao servidor (${e.message}).`);
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('login-password');
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  document.getElementById('login-error').textContent = '';
  try {
    await api('login', { method: 'POST', body: { password: input.value } });
    input.value = '';
    await afterLogin();
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener('visibilitychange', () => {
  // Ao voltar para a aba, busca o que foi alterado em outro aparelho.
  if (document.visibilityState === 'visible' && ready && !dirty && !saving) {
    pull().catch((e) => { if (e.status === 401) showLogin(); });
  }
});

window.addEventListener('beforeunload', (e) => {
  if (dirty || saving) { e.preventDefault(); e.returnValue = ''; }
});

const today = new Date();
let currentKey = monthKey(today.getFullYear(), today.getMonth());

function monthKey(y, m) { return `${y}-${String(m + 1).padStart(2, '0')}`; }
function shiftKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d.getFullYear(), d.getMonth());
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function month() {
  if (!state.months[currentKey]) {
    state.months[currentKey] = Object.keys(state.months).length ? emptyMonth() : seedMonth();
    save();
  }
  return state.months[currentKey];
}

// ---------- Cálculos ----------
function itemReal(m, cat, id) {
  return sum(m.transacoes.filter((t) => t.categoria === cat && t.itemId === id), (t) => num(t.valor));
}
function catReal(m, cat) { return sum(m.transacoes.filter((t) => t.categoria === cat), (t) => num(t.valor)); }
function catBudget(m, cat) { return sum(m[cat], (i) => num(i.orcamento)); }

function totals(m) {
  const rendaReal = catReal(m, 'renda');
  const rendaOrc = catBudget(m, 'renda');
  const base = rendaReal || rendaOrc;
  const gastos = m.transacoes.filter((t) => SPEND_CATS.includes(t.categoria));
  const gastoTotal = sum(gastos, (t) => num(t.valor));
  const gastoVista = sum(gastos.filter((t) => t.forma !== 'cartao'), (t) => num(t.valor));
  const gastoCartao = gastoTotal - gastoVista;
  const economias = catReal(m, 'economias');
  return {
    rendaReal, rendaOrc, base, gastoTotal, gastoVista, gastoCartao, economias,
    saldo: rendaReal - gastoTotal - economias,
    alocar: Object.fromEntries(ALLOC_CATS.map((c) => [c, base * num(m.pct[c]) / 100])),
  };
}

// ---------- Renderização ----------
const charts = {};

function render() {
  const m = month();
  const t = totals(m);
  document.getElementById('month-label').textContent = monthLabel(currentKey);
  renderKpis(t);
  renderDistribuicao(m);
  renderFluxo(m, t);
  ['renda', ...ALLOC_CATS].forEach((c) => renderCategoria(m, c, t));
  renderFaturas(m);
  renderTxForm(m);
  renderTransacoes(m);
  renderCharts(m);
}

function renderKpis(t) {
  const items = [
    ['Entradas', t.rendaReal],
    ['Gasto total', t.gastoTotal],
    ['Gasto à vista', t.gastoVista],
    ['Gasto no cartão', t.gastoCartao],
    ['Economias', t.economias],
    ['Saldo', t.saldo],
  ];
  document.getElementById('kpis').innerHTML = items.map(([l, v]) => `
    <div class="kpi"><div class="label">${l}</div>
    <div class="value ${l === 'Saldo' ? (v < 0 ? 'neg' : 'pos') : ''}">${fmt(v)}</div></div>`).join('');
}

function renderDistribuicao(m) {
  const total = sum(ALLOC_CATS, (c) => num(m.pct[c]));
  document.getElementById('distribuicao').innerHTML = ALLOC_CATS.map((c) => `
    <div class="dist-row">
      <span><span class="dot" style="background:${CATS[c].color}"></span>${CATS[c].label}</span>
      <span><input type="number" min="0" max="100" step="1" value="${num(m.pct[c])}" data-pct="${c}" aria-label="% ${CATS[c].label}"> %</span>
    </div>`).join('') +
    `<div class="dist-total ${total === 100 ? 'pos' : 'neg'}">Total: ${total}%${total === 100 ? '' : ' (o ideal é 100%)'}</div>`;
}

function renderFluxo(m, t) {
  const rows = [['renda', t.rendaReal, t.rendaOrc], ...ALLOC_CATS.map((c) => [c, catReal(m, c), catBudget(m, c)])];
  const out = (i) => sum(ALLOC_CATS, (c) => i === 0 ? catReal(m, c) : catBudget(m, c));
  const difReal = t.rendaReal - out(0);
  const difOrc = t.rendaOrc - out(1);
  document.getElementById('fluxo').innerHTML = `
    <div class="table-scroll"><table>
      <thead><tr><th>Tipo</th><th class="num">Real</th><th class="num">Orçamento</th></tr></thead>
      <tbody>${rows.map(([c, r, o]) => `
        <tr><td><span class="dot" style="background:${CATS[c].color}"></span>${CATS[c].label}</td>
        <td class="num">${fmt(r)}</td><td class="num">${fmt(o)}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr><td>Diferença</td>
        <td class="num ${difReal < 0 ? 'neg' : 'pos'}">${fmt(difReal)}</td>
        <td class="num ${difOrc < 0 ? 'neg' : 'pos'}">${fmt(difOrc)}</td></tr></tfoot>
    </table></div>`;
}

function pctCell(real, orc, isRenda) {
  if (!orc) return '<span class="pct">–</span>';
  const p = Math.round(real / orc * 100);
  const over = !isRenda && p > 100;
  return `<span class="pct ${over ? 'over' : ''}">${p}%</span>`;
}

function renderCategoria(m, cat, t) {
  const isRenda = cat === 'renda';
  const hasDia = cat === 'renda' || cat === 'dividas';
  const diaLabel = isRenda ? 'Receb. (dia)' : 'Venc. (dia)';
  const title = isRenda ? CATS[cat].label : `${CATS[cat].label} (${num(m.pct[cat])}%)`;
  const totalReal = catReal(m, cat);
  const totalOrc = catBudget(m, cat);
  const rows = m[cat].map((i) => {
    const real = itemReal(m, cat, i.id);
    return `<tr>
      ${isRenda ? '' : `<td><input type="checkbox" ${i.pago ? 'checked' : ''} data-edit="${cat}|${i.id}|pago" aria-label="Pago"></td>`}
      <td><input value="${esc(i.nome)}" data-edit="${cat}|${i.id}|nome" aria-label="Nome" class="name"></td>
      ${hasDia ? `<td><input type="number" min="1" max="31" value="${i.dia ?? ''}" data-edit="${cat}|${i.id}|dia" aria-label="Dia"></td>` : ''}
      <td class="num">${fmt(real)}</td>
      <td class="num">${pctCell(real, num(i.orcamento), isRenda)}</td>
      <td><input type="number" step="0.01" min="0" value="${num(i.orcamento) || ''}" placeholder="0,00" data-edit="${cat}|${i.id}|orcamento" aria-label="Orçamento"></td>
      <td><button class="del" data-del="${cat}|${i.id}" title="Remover">×</button></td>
    </tr>`;
  }).join('');

  document.getElementById(`sec-${cat}`).innerHTML = `
    <div class="cat-head"><h2>${title}</h2>
      ${isRenda ? '' : `<span class="alocar">Alocar: ${fmt(t.alocar[cat])}</span>`}</div>
    <div class="table-scroll"><table>
      <thead><tr>
        ${isRenda ? '' : '<th>Pago</th>'}<th>Nome</th>${hasDia ? `<th>${diaLabel}</th>` : ''}
        <th class="num">Real</th><th class="num">%</th><th class="num">Orçamento</th><th></th>
      </tr></thead>
      <tbody>${rows || ''}</tbody>
      <tfoot><tr>
        ${isRenda ? '' : '<td></td>'}<td>Total</td>${hasDia ? '<td></td>' : ''}
        <td class="num">${fmt(totalReal)}</td><td class="num">${pctCell(totalReal, totalOrc, isRenda)}</td>
        <td class="num">${fmt(totalOrc)}</td><td></td>
      </tr></tfoot>
    </table></div>
    ${!isRenda && totalOrc > t.alocar[cat] && t.alocar[cat] > 0 ? `<p class="pct over">Orçamento acima do valor a alocar em ${fmt(totalOrc - t.alocar[cat])}.</p>` : ''}
    <button class="btn small" data-add="${cat}">+ adicionar</button>`;
}

function cardCurrent(m, id) {
  return sum(m.transacoes.filter((t) => t.forma === 'cartao' && t.cartaoId === id), (t) => num(t.valor));
}

function renderFaturas(m) {
  const rows = m.cartoes.map((c) => {
    const atual = cardCurrent(m, c.id);
    return `<tr>
      <td><input type="checkbox" ${c.pago ? 'checked' : ''} data-edit="cartoes|${c.id}|pago" aria-label="Pago"></td>
      <td><input value="${esc(c.nome)}" data-edit="cartoes|${c.id}|nome" aria-label="Cartão" class="name"></td>
      <td><input type="number" step="0.01" min="0" value="${num(c.anteriores) || ''}" placeholder="0,00" data-edit="cartoes|${c.id}|anteriores" aria-label="Parcelas de meses anteriores"></td>
      <td class="num">${fmt(atual)}</td>
      <td class="num">${fmt(atual + num(c.anteriores))}</td>
      <td><button class="del" data-del="cartoes|${c.id}" title="Remover">×</button></td>
    </tr>`;
  }).join('');
  const tot = (fn) => sum(m.cartoes, fn);
  document.getElementById('sec-faturas').innerHTML = `
    <div class="cat-head"><h2>Controle das faturas</h2></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Pago</th><th>Cartão</th><th class="num">Meses anteriores</th><th class="num">Atual</th><th class="num">Fatura</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td></td><td>Total</td>
        <td class="num">${fmt(tot((c) => num(c.anteriores)))}</td>
        <td class="num">${fmt(tot((c) => cardCurrent(m, c.id)))}</td>
        <td class="num">${fmt(tot((c) => cardCurrent(m, c.id) + num(c.anteriores)))}</td><td></td></tr></tfoot>
    </table></div>
    <button class="btn small" data-add="cartoes">+ adicionar cartão</button>`;
}

function renderTxForm(m) {
  const form = document.getElementById('form-transacao');
  const catSel = form.categoria;
  const prevCat = catSel.value || 'essenciais';
  catSel.innerHTML = Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  catSel.value = prevCat;
  form.forma.disabled = prevCat === 'renda';
  fillItemSelect(m);
  const prevCard = form.cartaoId.value;
  form.cartaoId.innerHTML = m.cartoes.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('') || '<option value="">Sem cartões</option>';
  if (m.cartoes.some((c) => c.id === prevCard)) form.cartaoId.value = prevCard;
  form.cartaoId.hidden = form.forma.value !== 'cartao';
  if (!form.data.value || !form.data.value.startsWith(currentKey)) {
    const isCurrent = currentKey === monthKey(today.getFullYear(), today.getMonth());
    form.data.value = isCurrent ? today.toISOString().slice(0, 10) : `${currentKey}-01`;
  }
}

function fillItemSelect(m) {
  const form = document.getElementById('form-transacao');
  const items = m[form.categoria.value] || [];
  const prev = form.itemId.value;
  form.itemId.innerHTML = items.map((i) => `<option value="${i.id}">${esc(i.nome || '(sem nome)')}</option>`).join('') || '<option value="">Cadastre um item</option>';
  if (items.some((i) => i.id === prev)) form.itemId.value = prev;
}

function renderTransacoes(m) {
  const nameOf = (t) => {
    if (t.categoria === 'renda' || ALLOC_CATS.includes(t.categoria)) {
      const it = m[t.categoria].find((i) => i.id === t.itemId);
      return it ? it.nome : '(item removido)';
    }
    return '';
  };
  const cardName = (id) => (m.cartoes.find((c) => c.id === id) || {}).nome || '';
  const list = [...m.transacoes].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const table = document.getElementById('tabela-transacoes');
  if (!list.length) {
    table.innerHTML = '<tr><td class="empty">Nenhuma transação neste mês ainda. Lance entradas e gastos acima: os valores "Real" de cada seção são calculados a partir daqui.</td></tr>';
    return;
  }
  table.innerHTML = `
    <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Item</th><th>Pagamento</th><th class="num">Valor</th><th></th></tr></thead>
    <tbody>${list.map((t) => `<tr>
      <td>${t.data ? t.data.split('-').reverse().join('/') : ''}</td>
      <td>${esc(t.descricao)}</td>
      <td><span class="tag" style="background:${CATS[t.categoria].color}">${CATS[t.categoria].label}</span></td>
      <td>${esc(nameOf(t))}</td>
      <td>${t.categoria === 'renda' ? '–' : t.forma === 'cartao' ? `💳 ${esc(cardName(t.cartaoId))}` : 'À vista'}</td>
      <td class="num ${t.categoria === 'renda' ? 'pos' : ''}">${fmt(num(t.valor))}</td>
      <td><button class="del" data-del-tx="${t.id}" title="Remover">×</button></td>
    </tr>`).join('')}</tbody>`;
}

function chart(id, config) {
  if (typeof Chart === 'undefined') return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}

function donut(id, labels, data, colors) {
  const has = data.some((v) => v > 0);
  chart(id, {
    type: 'doughnut',
    data: {
      labels: has ? labels : ['Sem dados'],
      datasets: [{ data: has ? data : [1], backgroundColor: has ? colors : ['#ece7e2'], borderWidth: 0 }],
    },
    options: {
      cutout: '62%',
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: 'Nunito' } } },
        tooltip: {
          enabled: has,
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return `${ctx.label}: ${fmt(ctx.parsed)} (${total ? Math.round(ctx.parsed / total * 100) : 0}%)`;
            },
          },
        },
      },
    },
  });
}

function renderCharts(m) {
  donut('chart-renda', m.renda.map((i) => i.nome), m.renda.map((i) => itemReal(m, 'renda', i.id)), PALETTE);
  donut('chart-caixa', ALLOC_CATS.map((c) => CATS[c].label), ALLOC_CATS.map((c) => catReal(m, c)), ALLOC_CATS.map((c) => CATS[c].color));
  donut('chart-naoessenciais', m.naoEssenciais.map((i) => i.nome), m.naoEssenciais.map((i) => itemReal(m, 'naoEssenciais', i.id)), PALETTE.slice(2).concat(PALETTE));
  const cats = ['renda', ...ALLOC_CATS];
  chart('chart-fluxo', {
    type: 'bar',
    data: {
      labels: cats.map((c) => CATS[c].label),
      datasets: [
        { label: 'Real', data: cats.map((c) => catReal(m, c)), backgroundColor: cats.map((c) => CATS[c].color), borderRadius: 6 },
        { label: 'Orçamento', data: cats.map((c) => catBudget(m, c)), backgroundColor: '#ddd6ec', borderRadius: 6 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => fmt(v) } }, x: { grid: { display: false } } },
    },
  });
}

// ---------- Eventos ----------
document.addEventListener('change', (e) => {
  if (!ready) return;
  const el = e.target;
  const m = month();
  if (el.dataset.edit) {
    const [cat, id, field] = el.dataset.edit.split('|');
    const item = m[cat].find((i) => i.id === id);
    if (!item) return;
    if (field === 'pago') item.pago = el.checked;
    else if (field === 'nome') item.nome = el.value.trim();
    else item[field] = el.value === '' ? '' : num(el.value);
    save(); render();
  } else if (el.dataset.pct) {
    m.pct[el.dataset.pct] = num(el.value);
    save(); render();
  } else if (el.name === 'categoria' && el.form?.id === 'form-transacao') {
    fillItemSelect(m);
    el.form.forma.disabled = el.value === 'renda';
  } else if (el.name === 'forma' && el.form?.id === 'form-transacao') {
    el.form.cartaoId.hidden = el.value !== 'cartao';
  } else if (el.id === 'import-file' && el.files[0]) {
    importBackup(el.files[0]);
    el.value = '';
  }
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el || !ready) return;
  const m = month();
  if (el.dataset.add) {
    const cat = el.dataset.add;
    m[cat].push(cat === 'cartoes'
      ? { id: uid(), nome: 'Novo cartão', anteriores: 0, pago: false }
      : { id: uid(), nome: 'Novo item', orcamento: 0, pago: false });
    save(); render();
  } else if (el.dataset.del) {
    const [cat, id] = el.dataset.del.split('|');
    const used = m.transacoes.some((t) => (t.itemId === id && t.categoria === cat) || t.cartaoId === id);
    if (used && !confirm('Há transações ligadas a este item. Remover mesmo assim? (as transações continuam salvas)')) return;
    m[cat] = m[cat].filter((i) => i.id !== id);
    save(); render();
  } else if (el.dataset.delTx) {
    m.transacoes = m.transacoes.filter((t) => t.id !== el.dataset.delTx);
    save(); render();
  } else if (el.dataset.action === 'prev-month' || el.dataset.action === 'next-month') {
    currentKey = shiftKey(currentKey, el.dataset.action === 'prev-month' ? -1 : 1);
    render();
  } else if (el.dataset.action === 'copy-prev') {
    copyFromPrevious();
  } else if (el.dataset.action === 'export') {
    exportBackup();
  } else if (el.dataset.action === 'logout') {
    logout();
  }
});

document.getElementById('form-transacao').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!ready) return;
  const f = e.target;
  const m = month();
  if (!f.itemId.value) { alert('Cadastre um item nesta categoria antes de lançar.'); return; }
  const isRenda = f.categoria.value === 'renda';
  const forma = isRenda ? 'vista' : f.forma.value;
  if (forma === 'cartao' && !f.cartaoId.value) { alert('Cadastre um cartão em "Controle das faturas".'); return; }
  m.transacoes.push({
    id: uid(),
    data: f.data.value,
    descricao: f.descricao.value.trim(),
    categoria: f.categoria.value,
    itemId: f.itemId.value,
    valor: num(f.valor.value),
    forma,
    cartaoId: forma === 'cartao' ? f.cartaoId.value : null,
  });
  f.descricao.value = '';
  f.valor.value = '';
  save(); render();
  f.valor.focus();
});

function copyFromPrevious() {
  const prevKey = Object.keys(state.months).filter((k) => k < currentKey).sort().pop();
  if (!prevKey) { alert('Não há mês anterior com dados para copiar.'); return; }
  const m = month();
  if ((m.transacoes.length || ALLOC_CATS.some((c) => m[c].length)) &&
      !confirm(`Substituir categorias, orçamentos e cartões deste mês pelos de ${monthLabel(prevKey)}? As transações deste mês são mantidas.`)) return;
  const prev = state.months[prevKey];
  const clone = (arr) => arr.map((i) => ({ ...i, pago: false }));
  // Mantém os mesmos ids para que as transações já lançadas continuem ligadas aos itens.
  ['renda', ...ALLOC_CATS].forEach((c) => { m[c] = clone(prev[c]); });
  m.cartoes = clone(prev.cartoes).map((c) => ({ ...c, anteriores: 0 }));
  m.pct = { ...prev.pct };
  save(); render();
}

async function logout() {
  if (dirty) await flush();
  try { await api('logout', { method: 'POST' }); } catch (e) { /* segue para a tela de login */ }
  state.months = {};
  version = 0;
  setStatus('');
  showLogin();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `financas-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data.months !== 'object') throw new Error('formato inválido');
      if (!confirm('Importar este backup vai substituir todos os dados atuais. Continuar?')) return;
      state.months = data.months;
      save(); render();
    } catch (err) {
      alert('Arquivo de backup inválido.');
    }
  };
  reader.readAsText(file);
}

boot();
