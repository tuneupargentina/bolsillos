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
let selectorReady = false;

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg) {
  const el = $('status-line');
  if (el) el.textContent = msg;
}

function setError(msg) {
  const el = $('error-line');
  if (!el) return;
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
  if (!el) return;
  if (!hash) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `${t('tx_ok')}: <a href="${CFG.explorerTx(hash)}" target="_blank" rel="noopener">${hash.slice(0, 12)}…</a>`;
  el.classList.remove('hidden');
}

/** Visible toast next to (or under) the control that triggered the action. */
function toast(anchorEl, message, kind = 'info') {
  const host =
    (anchorEl && (anchorEl.closest('.action') || anchorEl.closest('.controls') || anchorEl.parentElement)) ||
    $('status-card-host') ||
    document.body;
  let el = host.querySelector(':scope > .toast-msg');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast-msg';
    el.setAttribute('role', 'status');
    host.appendChild(el);
  }
  el.className = `toast-msg toast-${kind}`;
  el.textContent = message;
  el.classList.remove('hidden');
  // Also mirror into the top status/error so it is never missed.
  if (kind === 'error') {
    setError(message);
    setStatus(message);
  } else {
    setError('');
    setStatus(message);
  }
  clearTimeout(el._hide);
  el._hide = setTimeout(() => {
    el.classList.add('hidden');
  }, 8000);
  return el;
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
  if (!ul) return;
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
    toast(btn, t('working'), 'info');
    const outcome = await fn();
    const hash = txHashFromOutcome(outcome);
    if (hash) {
      setTxOk(hash);
      toast(btn, `${t('tx_ok')}: ${hash.slice(0, 10)}…`, 'ok');
    } else {
      toast(btn, t('tx_ok'), 'ok');
    }
    await loadHousehold();
    return outcome;
  } catch (e) {
    console.error(e);
    const msg = extractError(e);
    toast(btn, msg, 'error');
  } finally {
    if (btn) btn.disabled = prev;
  }
}

function requireWallet(anchor) {
  if (!getAccountId()) {
    const msg = t('need_wallet');
    toast(anchor || $('btn-connect'), msg, 'error');
    tryOpenConnect(anchor);
    return false;
  }
  return true;
}

function tryOpenConnect(anchor) {
  try {
    if (!selectorReady) {
      toast(anchor || $('btn-connect'), t('wallet_loading'), 'info');
      return;
    }
    openModal();
  } catch (e) {
    toast(anchor || $('btn-connect'), extractError(e), 'error');
  }
}

function wire() {
  $('lang-toggle').addEventListener('click', () => {
    const next = getLang() === 'en' ? 'es' : 'en';
    setLang(next);
    applyI18n();
    renderTxLinks();
    loadHousehold();
    toast($('lang-toggle'), next === 'es' ? 'Idioma: español' : 'Language: English', 'ok');
  });
  $('refresh').addEventListener('click', () => loadHousehold());
  $('btn-connect').addEventListener('click', () => tryOpenConnect($('btn-connect')));
  $('btn-disconnect').addEventListener('click', async () => {
    try {
      await signOut();
      updateAccountUi();
      loadHousehold();
      toast($('btn-disconnect'), t('disconnected'), 'ok');
    } catch (e) {
      toast($('btn-disconnect'), extractError(e), 'error');
    }
  });
  $('btn-load-house').addEventListener('click', () => {
    const v = $('house-input').value.trim();
    if (v) {
      currentHouse = v;
      loadHousehold();
    }
  });

  $('btn-mint').addEventListener('click', () => {
    if (!requireWallet($('btn-mint'))) return;
    withBusy($('btn-mint'), async () => {
      const atomic = usdcToAtomic($('mint-amount').value);
      return mintToMe(atomic);
    });
  });

  $('btn-pay').addEventListener('click', () => {
    if (!requireWallet($('btn-pay'))) return;
    withBusy($('btn-pay'), async () => {
      const atomic = usdcToAtomic($('pay-amount').value);
      return payHousehold(currentHouse, atomic);
    });
  });

  $('btn-withdraw').addEventListener('click', () => {
    if (!requireWallet($('btn-withdraw'))) return;
    withBusy($('btn-withdraw'), async () => {
      const atomic = usdcToAtomic($('wd-amount').value);
      const pocket = $('wd-pocket').value.trim();
      const recipient = $('wd-recipient').value.trim();
      return withdrawPocket(currentHouse, pocket, atomic, recipient);
    });
  });

  $('btn-propose').addEventListener('click', () => {
    if (!requireWallet($('btn-propose'))) return;
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
    if (!requireWallet($('btn-execute-proposal'))) return;
    withBusy($('btn-execute-proposal'), async () => executeRuleChange(currentHouse));
  });

  $('btn-create-hh').addEventListener('click', () => {
    if (!requireWallet($('btn-create-hh'))) return;
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
  window.addEventListener('bolsillos:connect-timeout', (ev) => {
    const msg = ev.detail?.message || t('connect_timeout');
    toast($('btn-connect'), msg, 'error');
  });
}

async function boot() {
  // Wire UI first so lang toggle / feedback work even if wallet init fails.
  applyI18n();
  wire();
  $('house-input').value = currentHouse;
  setStatus(t('status_ready'));

  try {
    await initSelector();
    selectorReady = true;
  } catch (e) {
    console.error('selector init', e);
    selectorReady = false;
    toast($('btn-connect'), `${t('wallet_init_fail')}: ${extractError(e)}`, 'error');
  }
  updateAccountUi();
  await loadHousehold();
}

boot().catch((e) => {
  console.error('boot failed', e);
  setError(extractError(e));
});
