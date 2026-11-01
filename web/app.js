const cfg = window.BOLSILLOS;

function fmtUsdc(raw) {
  const n = BigInt(raw || '0');
  const whole = n / 1000000n;
  const frac = (n % 1000000n).toString().padStart(6, '0').replace(/0+$/, '') || '0';
  return frac === '0' ? `${whole} USDC` : `${whole}.${frac} USDC`;
}

function fmtCap(raw) {
  if (!raw || raw === '0') return window.t('unlimited');
  // u128::MAX sentinel used by the contract for "no cap remaining"
  if (String(raw).startsWith('340282366920938')) return window.t('unlimited');
  return fmtUsdc(raw);
}

async function view(method, args = {}) {
  const res = await fetch(cfg.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'web', method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: cfg.house,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  const bytes = j.result.result;
  const text = typeof TextDecoder !== 'undefined'
    ? new TextDecoder().decode(Uint8Array.from(bytes))
    : String.fromCharCode(...bytes);
  return text ? JSON.parse(text) : null;
}

function renderTxLinks() {
  const ul = document.getElementById('tx-links');
  ul.innerHTML = '';
  for (const tx of cfg.demoTxs) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = cfg.explorerTx(tx.hash);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `${window.t(tx.labelKey)} — ${tx.hash.slice(0, 8)}…`;
    li.appendChild(a);
    ul.appendChild(li);
  }
}

async function load() {
  document.getElementById('house-id').textContent = cfg.house;
  document.getElementById('token-id').textContent = cfg.musdc;
  try {
    const h = await view('get_household');
    document.getElementById('owner-id').textContent = h.owner;
    document.getElementById('total-recv').textContent = fmtUsdc(h.total_received);
    document.getElementById('timelock').textContent = `${h.timelock_seconds}s`;
    const tbody = document.querySelector('#pockets-table tbody');
    tbody.innerHTML = '';
    for (const p of h.pockets) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${p.id}</strong></td>
        <td>${(p.share_bps / 100).toFixed(1)}%</td>
        <td class="badge-ok">${fmtUsdc(p.balance)}</td>
        <td><a href="${cfg.explorerAccount(p.owner)}" target="_blank" rel="noopener">${p.owner}</a></td>
        <td>${fmtCap(p.daily_cap)}</td>
        <td>${(p.allowlist || []).join(', ')}</td>`;
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.error(e);
    document.getElementById('owner-id').textContent = window.t('err');
  }
  renderTxLinks();
}

document.getElementById('lang-toggle').addEventListener('click', () => {
  window.setLang(window.getLang() === 'en' ? 'es' : 'en');
  window.applyI18n();
  renderTxLinks();
  load();
});
document.getElementById('refresh').addEventListener('click', () => load());

window.applyI18n();
load();
