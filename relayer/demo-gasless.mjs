#!/usr/bin/env node
/**
 * End-to-end gasless withdraw demo for Mom.
 * Signs a meta-transaction as MOM and has RELAYER submit it.
 * Relayer gate: only accepts receiver_id === HOUSEHOLD.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KeyPair } from '@near-js/crypto';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { Account } from '@near-js/accounts';
import { actionCreators } from '@near-js/transactions';

const NETWORK = 'testnet';
const RPC = 'https://rpc.testnet.near.org';
const env = Object.fromEntries(
  readFileSync(new URL('../keys/accounts.env', import.meta.url), 'utf8')
    .trim().split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    })
);
const HOUSE = env.HOUSE;
const MOM = env.MOM;
const MOMDEST = env.MOMDEST;
const RELAYER = env.RELAYER;
const AMOUNT = process.env.AMOUNT || '1000000';

function loadKey(accountId) {
  const path = join(homedir(), '.near-credentials', NETWORK, `${accountId}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return KeyPair.fromString(raw.private_key || raw.secret_key);
}

const provider = new JsonRpcProvider({ url: RPC });
const momAccount = new Account(MOM, provider, new KeyPairSigner(loadKey(MOM)));
const relayerAccount = new Account(RELAYER, provider, new KeyPairSigner(loadKey(RELAYER)));

const args = { pocket_id: 'mom', amount: AMOUNT, recipient: MOMDEST };
console.log(`Signing meta-tx: ${MOM} -> ${HOUSE}.withdraw_pocket(${JSON.stringify(args)})`);

const actions = [
  actionCreators.functionCall(
    'withdraw_pocket',
    args,
    BigInt('100000000000000'),
    BigInt('0'),
  ),
];

// Prefer createSignedMetaTransaction; fall back to signedDelegate if shape differs.
let signedDelegate;
try {
  const raw = await momAccount.createSignedMetaTransaction(HOUSE, actions, 120);
  // near-js may return [bytes, SignedDelegate] or SignedDelegate directly
  signedDelegate = Array.isArray(raw) ? (raw.find((x) => x && x.delegateAction) || raw[1]) : raw;
  if (!signedDelegate?.delegateAction && raw?.signedDelegate) signedDelegate = raw.signedDelegate;
} catch (e) {
  console.warn('createSignedMetaTransaction failed, falling back to signedDelegate():', e.message);
  signedDelegate = await momAccount.signedDelegate({ actions, blockHeightTtl: 120, receiverId: HOUSE });
}

if (!signedDelegate?.delegateAction) {
  console.error('Unexpected signed meta-tx shape:', signedDelegate);
  process.exit(1);
}

const receiver = signedDelegate.delegateAction.receiverId;
if (receiver !== HOUSE) {
  console.error(`GATE REFUSE: receiver ${receiver} != ${HOUSE}`);
  process.exit(1);
}
console.log(`Gate OK. Relaying via ${RELAYER}...`);

const outcome = await relayerAccount.signAndSendTransaction({
  receiverId: MOM,
  actions: [actionCreators.signedDelegate(signedDelegate)],
});

const txHash = outcome.transaction.hash;
console.log('OK gasless withdraw');
console.log('tx:', txHash);
console.log('explorer:', `https://testnet.nearblocks.io/txns/${txHash}`);
console.log('nearblocks_alt:', `https://explorer.testnet.near.org/transactions/${txHash}`);
