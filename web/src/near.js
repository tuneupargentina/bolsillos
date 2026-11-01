import { setupWalletSelector, actionCreators } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { setupHereWallet } from '@near-wallet-selector/here-wallet';
import { setupIntearWallet } from '@near-wallet-selector/intear-wallet';
import { JsonRpcProvider } from '@near-js/providers';
import { CFG } from './config.js';

import '@near-wallet-selector/modal-ui/styles.css';

const { functionCall } = actionCreators;

let selector = null;
let modal = null;
let accountId = null;
let initError = null;
let connectWatchdog = null;
let modalObserver = null;
const CONNECT_TIMEOUT_MS = 90_000;
const provider = new JsonRpcProvider({ url: CFG.rpc });

const TGAS = (n) => BigInt(n) * 1_000_000_000_000n;
const ONE_YOCTO = 1n;

const CONNECTING_COPY =
  'Confirm the connection in the wallet tab / window that just opened (Meteor opens a web wallet — no extension required). If the wallet shows an error (e.g. zero balance), cancel here, fund the account, and try again.';

function clearConnectWatchdog() {
  if (connectWatchdog) {
    clearTimeout(connectWatchdog);
    connectWatchdog = null;
  }
}

function fireConnectTimeout() {
  window.dispatchEvent(
    new CustomEvent('bolsillos:connect-timeout', {
      detail: {
        message:
          'Wallet connection timed out or was cancelled. New testnet accounts need ~1 NEAR for the login key — use the faucet, then retry Connect.',
      },
    }),
  );
}

function startConnectWatchdog() {
  clearConnectWatchdog();
  connectWatchdog = setTimeout(() => {
    connectWatchdog = null;
    if (accountId) return;
    try {
      modal?.hide();
    } catch {
      /* ignore */
    }
    fireConnectTimeout();
  }, CONNECT_TIMEOUT_MS);
}

function ensureCancelButton(root) {
  const details = root.querySelector('.connecting-details');
  if (!details) return;
  let btn = details.querySelector('.bolsillos-cancel-connect');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bolsillos-cancel-connect';
    btn.textContent = 'Cancel / close';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelPendingConnect('Cancelled wallet connection.');
    });
    details.appendChild(btn);
  }
}

function patchConnectingUi() {
  const root = document.getElementById('near-wallet-selector-modal');
  if (!root) return;
  const msg = root.querySelector('.connecting-message span, .connecting-message');
  if (msg) {
    const text = msg.textContent || '';
    // Only rewrite the stock modal copy. CONNECTING_COPY itself contains
    // "Confirm the connection", so re-applying it on every mutation would
    // re-fire this observer and freeze the main thread (Meteor / Intear click).
    if (text !== CONNECTING_COPY && /extension window|Confirm the connection/i.test(text)) {
      msg.textContent = CONNECTING_COPY;
    }
  }
  if (root.querySelector('.connecting-wrapper')) {
    ensureCancelButton(root);
    // Keep watchdog armed while the spinner is visible.
    if (!connectWatchdog && !accountId) startConnectWatchdog();
  }
}

function watchModalDom() {
  if (modalObserver) return;
  const root = document.getElementById('near-wallet-selector-modal');
  if (!root) return;
  const observeOpts = { childList: true, subtree: true, characterData: true };
  modalObserver = new MutationObserver(() => {
    // Disconnect while we mutate so our own DOM writes cannot re-enter.
    modalObserver.disconnect();
    try {
      patchConnectingUi();
    } finally {
      modalObserver.observe(root, observeOpts);
    }
  });
  modalObserver.observe(root, observeOpts);
  patchConnectingUi();
}

export function cancelPendingConnect(reason) {
  clearConnectWatchdog();
  try {
    modal?.hide();
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent('bolsillos:connect-timeout', {
      detail: { message: reason || 'Cancelled wallet connection.' },
    }),
  );
}

export async function initSelector() {
  initError = null;
  try {
    // Meteor first: web wallet handoff works without an extension.
    // MyNearWallet last + deprecated — retired, may refuse new app connections.
    selector = await setupWalletSelector({
      network: 'testnet',
      debug: false,
      modules: [
        setupMeteorWallet(),
        setupIntearWallet(),
        setupHereWallet(),
        setupMyNearWallet({
          walletUrl: 'https://testnet.mynearwallet.com',
          deprecated: true,
        }),
      ],
    });

    modal = setupModal(selector, {
      contractId: CFG.house,
      theme: 'dark',
      description:
        'Bolsillos — NEAR testnet only. Prefer Meteor or Intear (web wallets). In Meteor, switch the network dropdown to Testnet (it defaults to Mainnet). HERE is for mobile. MyNearWallet is retired. New accounts need ~1 NEAR for the login key.',
    });

    const state = selector.store.getState();
    if (state.accounts.length > 0) {
      accountId = state.accounts[0].accountId;
    }

    selector.store.observable.subscribe((next) => {
      accountId = next.accounts[0]?.accountId ?? null;
      if (accountId) clearConnectWatchdog();
      window.dispatchEvent(new CustomEvent('bolsillos:account', { detail: { accountId } }));
    });

    // Modal root is injected on first show; also try now.
    queueMicrotask(watchModalDom);

    return { selector, modal, accountId };
  } catch (e) {
    initError = e;
    throw e;
  }
}

export function getInitError() {
  return initError;
}

export function openModal() {
  if (!modal) {
    const msg = initError
      ? `Wallet selector failed to start: ${extractError(initError)}`
      : 'Wallet selector is not ready yet. Wait a moment and try again.';
    throw new Error(msg);
  }
  modal.show();
  watchModalDom();
  startConnectWatchdog();
  // Patch after React paints the connecting route.
  setTimeout(patchConnectingUi, 50);
  setTimeout(patchConnectingUi, 300);
}

export async function signOut() {
  clearConnectWatchdog();
  if (!selector) return;
  const wallet = await selector.wallet();
  await wallet.signOut();
  accountId = null;
}

export function getAccountId() {
  return accountId;
}

export async function viewCall(contractId, method, args = {}) {
  const raw = await provider.query({
    request_type: 'call_function',
    account_id: contractId,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
    finality: 'final',
  });
  const bytes = raw.result;
  if (!bytes || bytes.length === 0) return null;
  const text = new TextDecoder().decode(Uint8Array.from(bytes));
  return text ? JSON.parse(text) : null;
}

/** Pull a readable panic / failure message out of a Wallet Selector / RPC error. */
export function extractError(err) {
  if (!err) return 'Unknown error';
  const msg = err.message || String(err);
  const candidates = [
    err?.kind?.ExecutionError,
    err?.type,
    err?.cause?.name,
    err?.data?.result?.status?.Failure?.ActionError?.kind?.FunctionCallError?.ExecutionError,
  ].filter(Boolean);
  const blob = [msg, ...candidates, JSON.stringify(err)].join('\n');
  const panic =
    blob.match(/Smart contract panicked[:\s]+(.+?)(?:\\n|"|$)/i) ||
    blob.match(/ExecutionError["':\s]+([^"}\n]+)/i) ||
    blob.match(
      /(only pocket owner can withdraw|recipient not allowlisted|exceeds daily cap|not the household owner|household name already taken|insufficient deposit|shares must sum|Wallet selector|does not have enough balance)/i,
    );
  if (panic) return (panic[1] || panic[0]).trim();
  if (msg.length > 280) return `${msg.slice(0, 280)}…`;
  return msg;
}

async function send(receiverId, actions) {
  if (!accountId) throw new Error('not signed in');
  const wallet = await selector.wallet();
  return wallet.signAndSendTransaction({
    receiverId,
    actions,
  });
}

export async function mintToMe(amountAtomic) {
  return send(CFG.musdc, [
    functionCall('mint', { account_id: accountId, amount: amountAtomic }, TGAS(30), 0n),
  ]);
}

export async function payHousehold(houseId, amountAtomic, memo = 'web-pay') {
  return send(CFG.musdc, [
    functionCall(
      'ft_transfer_call',
      {
        receiver_id: houseId,
        amount: amountAtomic,
        memo,
        msg: memo,
      },
      TGAS(100),
      ONE_YOCTO,
    ),
  ]);
}

export async function withdrawPocket(houseId, pocketId, amountAtomic, recipient) {
  return send(houseId, [
    functionCall(
      'withdraw_pocket',
      { pocket_id: pocketId, amount: amountAtomic, recipient },
      TGAS(100),
      0n,
    ),
  ]);
}

export async function proposeRuleChange(houseId, pockets) {
  return send(houseId, [
    functionCall('propose_rule_change', { pockets }, TGAS(50), 0n),
  ]);
}

export async function executeRuleChange(houseId) {
  return send(houseId, [
    functionCall('execute_rule_change', {}, TGAS(50), 0n),
  ]);
}

export async function createHousehold(name, tokenId, timelockNs = 60_000_000_000) {
  return send(CFG.factory, [
    functionCall(
      'create_household',
      { name, token_id: tokenId, timelock_ns: timelockNs },
      TGAS(100),
      BigInt(CFG.factoryDepositYocto),
    ),
  ]);
}

export function txHashFromOutcome(outcome) {
  if (!outcome) return null;
  if (typeof outcome === 'string') return outcome;
  if (outcome.transaction_outcome?.id) return outcome.transaction_outcome.id;
  if (outcome.transaction?.hash) return outcome.transaction.hash;
  if (Array.isArray(outcome) && outcome[0]?.transaction?.hash) return outcome[0].transaction.hash;
  return null;
}
