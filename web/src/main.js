import './styles.css';
import { CFG, usdcToAtomic, fmtUsdc, fmtCap } from './config.js';
import { applyI18n, getLang, setLang, t } from './i18n.js';
import {
  initSelector,
  openModal,
  signOut,
  getAccountId,
  viewCall,
  extractError,
  mintToMe,
  payHousehold,
  withdrawPocket,
  proposeRuleChange,
  executeRuleChange,
  createHousehold,
  txHashFromOutcome,
} from './near.js';

let currentHouse = CFG.house;
let lastHousehold = null;

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg) {
  $('status-line').textContent = msg;
}

function setError(msg) {
  const el = $('error-line');
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setTxOk(hash) {
  const el = $('tx-line');
  if (!hash) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `${t('tx_ok')}: <a href="${CFG.explorerTx(hash)}" target="_blank" rel="noopener">${hash.slice(0, 12)}…</a>`;
  el.classList.remove('hidden');
}

function updateAccountUi() {
  const id = getAccountId();
  const badge = $('account-badge');
  const btnIn = $('btn-connect');
  const btnOut = $('btn-disconnect');
  if (id) {
    badge.textContent = id;
    badge.classList.remove('hidden');
    btnIn.classList.add('hidden');
    btnOut.classList.remove('hidden');
    if (!$('wd-recipient').value) $('wd-recipient').value = id;
  } else {
    badge.classList.add('hidden');
    btnIn.classList.remove('hidden');
    btnOut.classList.add('hidden');
  }
}

function renderTxLinks() {
  const ul = $('tx-links');
  ul.innerHTML = '';
  for (const tx of CFG.demoTxs) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = CFG.explorerTx(tx.hash);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `${t(tx.labelKey)} — ${tx.hash.slice(0, 8)}…`;
    li.appendChild(a);
    ul.appendChild(li);
  }
}

async function loadHousehold() {
  setError('');
  $('house-id').textContent = currentHouse;
  $('token-id').textContent = CFG.musdc;
  $('house-input').value = currentHouse;
  try {
    const h = await viewCall(currentHouse, 'get_household');
    lastHousehold = h;
    $('owner-id').textContent = h.owner;
    $('total-recv').textContent = fmtUsdc(h.total_received);
    const secs = h.timelock_seconds ?? Math.round(Number(h.timelock_ns || 0) / 1e9);
    $('timelock').textContent = `${secs}s`;

    const tbody = document.querySelector('#pockets-table tbody');
    tbody.innerHTML = '';
    for (const p of h.pockets) {
      const tr = document.createElement('tr');
      const mine = getAccountId() && p.owner === getAccountId();
      tr.innerHTML = `
        <td><strong>${p.id}</strong>${mine ? ' ★' : ''}</td>
        <td>${(p.share_bps / 100).toFixed(1)}%</td>
        <td class="badge-ok">${fmtUsdc(p.balance)}</td>
        <td><a href="${CFG.explorerAccount(p.owner)}" target="_blank" rel="noopener">${p.owner}</a></td>
        <td>${fmtCap(p.daily_cap, t('unlimited'))}</td>
        <td>${(p.allowlist || []).join(', ')}</td>
        <td></td>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = t('use_pocket');
      btn.addEventListener('click', () => {
        $('wd-pocket').value = p.id;
        if (getAccountId()) $('wd-recipient').value = getAccountId();
      });
      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    }

    const acct = getAccountId();
    if (acct) {
      try {
        const bal = await viewCall(CFG.musdc, 'ft_balance_of', { account_id: acct });
        $('my-musdc').textContent = fmtUsdc(bal);
      } catch {
        $('my-musdc').textContent = '—';
      }
    } else {
      $('my-musdc').textContent = '—';
    }
  } catch (e) {
    console.error(e);
    $('owner-id').textContent = t('err');
    setError(extractError(e));
  }
  renderTxLinks();
}

async function withBusy(btn, fn) {
  setError('');
  setTxOk(null);
  const prev = btn?.disabled;
  if (btn) btn.disabled = true;
  try {
    const outcome = await fn();
    const hash = txHashFromOutcome(outcome);
    if (hash) setTxOk(hash);
    await loadHousehold();
    return outcome;
  } catch (e) {
    console.error(e);
    setError(extractError(e));
  } finally {
    if (btn) btn.disabled = prev;
  }
}

function requireWallet() {
  if (!getAccountId()) {
    setError(t('need_wallet'));
    openModal();
    return false;
  }
  return true;
}

function wire() {
  $('lang-toggle').addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'es' : 'en');
    applyI18n();
    renderTxLinks();
    loadHousehold();
  });
  $('refresh').addEventListener('click', () => loadHousehold());
  $('btn-connect').addEventListener('click', () => openModal());
  $('btn-disconnect').addEventListener('click', async () => {
    await signOut();
    updateAccountUi();
    loadHousehold();
  });
  $('btn-load-house').addEventListener('click', () => {
    const v = $('house-input').value.trim();
    if (v) {
      currentHouse = v;
      loadHousehold();
    }
  });

  $('btn-mint').addEventListener('click', () => {
    if (!requireWallet()) return;
    withBusy($('btn-mint'), async () => {
      const atomic = usdcToAtomic($('mint-amount').value);
      return mintToMe(atomic);
    });
  });

  $('btn-pay').addEventListener('click', () => {
    if (!requireWallet()) return;
    withBusy($('btn-pay'), async () => {
      const atomic = usdcToAtomic($('pay-amount').value);
      return payHousehold(currentHouse, atomic);
    });
  });

  $('btn-withdraw').addEventListener('click', () => {
    if (!requireWallet()) return;
    withBusy($('btn-withdraw'), async () => {
      const atomic = usdcToAtomic($('wd-amount').value);
      const pocket = $('wd-pocket').value.trim();
      const recipient = $('wd-recipient').value.trim();
      return withdrawPocket(currentHouse, pocket, atomic, recipient);
    });
  });

  $('btn-propose').addEventListener('click', () => {
    if (!requireWallet()) return;
    withBusy($('btn-propose'), async () => {
      let pockets;
      const raw = $('propose-json').value.trim();
      if (raw) {
        pockets = JSON.parse(raw);
      } else if (lastHousehold?.pockets) {
        pockets = lastHousehold.pockets.map((p) => ({
          id: p.id,
          share_bps: p.share_bps,
          owner: p.owner,
          allowlist: p.allowlist,
          daily_cap: String(p.daily_cap?.toString?.() ?? p.daily_cap ?? '0'),
        }));
      } else {
        throw new Error('no pockets to propose');
      }
      return proposeRuleChange(currentHouse, pockets);
    });
  });

  $('btn-execute-proposal').addEventListener('click', () => {
    if (!requireWallet()) return;
    withBusy($('btn-execute-proposal'), async () => executeRuleChange(currentHouse));
  });

  $('btn-create-hh').addEventListener('click', () => {
    if (!requireWallet()) return;
    withBusy($('btn-create-hh'), async () => {
      const name = $('factory-name').value.trim().toLowerCase();
      const outcome = await createHousehold(name, CFG.musdc);
      currentHouse = `${name}.${CFG.factory}`;
      $('house-input').value = currentHouse;
      return outcome;
    });
  });

  window.addEventListener('bolsillos:account', () => {
    updateAccountUi();
    loadHousehold();
  });
}

async function boot() {
  applyI18n();
  wire();
  $('house-input').value = currentHouse;
  try {
    await initSelector();
  } catch (e) {
    console.error('selector init', e);
    setError(extractError(e));
  }
  updateAccountUi();
  await loadHousehold();
}

boot();
