import { setupWalletSelector, actionCreators } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupHereWallet } from '@near-wallet-selector/here-wallet';
import { JsonRpcProvider } from '@near-js/providers';
import { CFG } from './config.js';

import '@near-wallet-selector/modal-ui/styles.css';

const { functionCall } = actionCreators;

let selector = null;
let modal = null;
let accountId = null;
const provider = new JsonRpcProvider({ url: CFG.rpc });

const TGAS = (n) => BigInt(n) * 1_000_000_000_000n;
const ONE_YOCTO = 1n;

export async function initSelector() {
  selector = await setupWalletSelector({
    network: 'testnet',
    debug: false,
    modules: [
      setupMeteorWallet(),
      setupMyNearWallet({
        walletUrl: 'https://testnet.mynearwallet.com',
      }),
      setupHereWallet(),
    ],
  });

  modal = setupModal(selector, {
    contractId: CFG.house,
    theme: 'dark',
    description: 'Bolsillos — testnet only. Prefer Meteor; MyNearWallet testnet still works during sunset.',
  });

  const state = selector.store.getState();
  if (state.accounts.length > 0) {
    accountId = state.accounts[0].accountId;
  }

  selector.store.observable.subscribe((next) => {
    accountId = next.accounts[0]?.accountId ?? null;
    window.dispatchEvent(new CustomEvent('bolsillos:account', { detail: { accountId } }));
  });

  return { selector, modal, accountId };
}

export function openModal() {
  modal?.show();
}

export async function signOut() {
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
  // Common near / selector shapes
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
    blob.match(/(only pocket owner can withdraw|recipient not allowlisted|exceeds daily cap|not the household owner|household name already taken|insufficient deposit|shares must sum)/i);
  if (panic) return (panic[1] || panic[0]).trim();
  if (msg.length > 280) return `${msg.slice(0, 280)}…`;
  return msg;
}

async function send(receiverId, actions) {
  if (!accountId) throw new Error('not signed in');
  const wallet = await selector.wallet();
  const outcome = await wallet.signAndSendTransaction({
    receiverId,
    actions,
  });
  return outcome;
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
