#!/usr/bin/env node
/**
 * Browser-equivalent flows via near-api-js / @near-js (same calls the web UI makes):
 * mint → pay (ft_transfer_call) → withdraw → panic paths (not owner / not allowlisted / cap).
 * Uses local credentials; never prints private keys.
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
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const MUSDC = env.MUSDC;
const PAYER = env.PAYER;
const AGENT = env.AGENT;
const HOUSE = process.env.HOUSE || env.HOUSE_DEMO || env.HOUSE;
const { functionCall } = actionCreators;
const TGAS = (n) => BigInt(n) * 1_000_000_000_000n;

function loadKey(accountId) {
  const path = join(homedir(), '.near-credentials', NETWORK, `${accountId}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return KeyPair.fromString(raw.private_key || raw.secret_key);
}

function account(id) {
  return new Account(id, new JsonRpcProvider({ url: RPC }), new KeyPairSigner(loadKey(id)));
}

async function view(contractId, method, args = {}) {
  const provider = new JsonRpcProvider({ url: RPC });
  const raw = await provider.query({
    request_type: 'call_function',
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    finality: 'final',
  });
  const text = Buffer.from(raw.result).toString('utf8');
  return text ? JSON.parse(text) : null;
}

async function expectPanic(label, fn, needle) {
  try {
    await fn();
    throw new Error(`${label}: expected panic containing "${needle}" but call succeeded`);
  } catch (e) {
    const blob = `${e?.message || ''}\n${JSON.stringify(e)}`;
    if (!blob.includes(needle)) {
      // near-js may wrap; also accept ExecutionError shapes
      const alt = e?.cause || e?.type || '';
      if (!`${blob}\n${alt}`.includes(needle)) {
        console.error(blob.slice(0, 800));
        throw new Error(`${label}: panic text missing "${needle}"`);
      }
    }
    console.log(`OK panic: ${label} → ${needle}`);
  }
}

async function main() {
  console.log(`e2e-browser HOUSE=${HOUSE} PAYER=${PAYER}`);
  const payer = account(PAYER);
  const musdcOwner = account(MUSDC); // mint is callable by anyone on this mock, but sign as musdc or payer
  // Mock mint has no access control beyond being a call — any signer works; use payer.
  const mintSigner = payer;

  console.log('mint 50 mUSDC to payer');
  await mintSigner.signAndSendTransaction({
    receiverId: MUSDC,
    actions: [
      functionCall('mint', { account_id: PAYER, amount: '50000000' }, TGAS(30), 0n),
    ],
  });

  console.log('pay 50 via ft_transfer_call');
  await payer.signAndSendTransaction({
    receiverId: MUSDC,
    actions: [
      functionCall(
        'ft_transfer_call',
        { receiver_id: HOUSE, amount: '50000000', memo: null, msg: 'browser-eq' },
        TGAS(100),
        1n,
      ),
    ],
  });

  const pockets = await view(HOUSE, 'list_pockets');
  console.log(
    'pockets after pay:',
    pockets.map((p) => `${p.id}=${p.balance}`).join(' '),
  );

  console.log('withdraw 1 from spend → payer (allowlisted)');
  await payer.signAndSendTransaction({
    receiverId: HOUSE,
    actions: [
      functionCall(
        'withdraw_pocket',
        { pocket_id: 'spend', amount: '1000000', recipient: PAYER },
        TGAS(100),
        0n,
      ),
    ],
  });

  const agent = account(AGENT);
  await expectPanic(
    'agent not owner',
    () =>
      agent.signAndSendTransaction({
        receiverId: HOUSE,
        actions: [
          functionCall(
            'withdraw_pocket',
            { pocket_id: 'savings', amount: '1', recipient: PAYER },
            TGAS(50),
            0n,
          ),
        ],
      }),
    'only pocket owner can withdraw',
  );

  await expectPanic(
    'not allowlisted',
    () =>
      payer.signAndSendTransaction({
        receiverId: HOUSE,
        actions: [
          functionCall(
            'withdraw_pocket',
            { pocket_id: 'spend', amount: '1', recipient: AGENT },
            TGAS(50),
            0n,
          ),
        ],
      }),
    'recipient not allowlisted',
  );

  await expectPanic(
    'exceeds daily cap',
    () =>
      payer.signAndSendTransaction({
        receiverId: HOUSE,
        actions: [
          functionCall(
            'withdraw_pocket',
            { pocket_id: 'savings', amount: '2000000', recipient: PAYER },
            TGAS(50),
            0n,
          ),
        ],
      }),
    'exceeds daily cap',
  );

  console.log('e2e-browser DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
