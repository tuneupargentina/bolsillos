#!/usr/bin/env node
/**
 * HTTP meta-tx relayer for Bolsillos.
 * POST /relay  body = SignedDelegate JSON
 * Gate: delegateAction.receiverId MUST equal HOUSEHOLD_CONTRACT.
 * GET  /health
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KeyPair } from '@near-js/crypto';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { Account } from '@near-js/accounts';
import { actionCreators, SignedDelegate, DelegateAction, Signature } from '@near-js/transactions';

const HOUSE = process.env.HOUSEHOLD_CONTRACT;
const RELAYER = process.env.RELAYER_ACCOUNT;
const NETWORK = process.env.NEAR_NETWORK || 'testnet';
const PORT = Number(process.env.PORT || 8787);
const RPC = process.env.NEAR_RPC || `https://rpc.${NETWORK}.near.org`;

if (!HOUSE || !RELAYER) { console.error('Set HOUSEHOLD_CONTRACT and RELAYER_ACCOUNT'); process.exit(1); }
if (NETWORK !== 'testnet' || !HOUSE.endsWith('.testnet')) {
  console.error('Refusing non-testnet'); process.exit(1);
}

function loadKey(accountId) {
  const path = join(homedir(), '.near-credentials', NETWORK, `${accountId}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return KeyPair.fromString(raw.private_key || raw.secret_key);
}

const provider = new JsonRpcProvider({ url: RPC });
const account = new Account(RELAYER, provider, new KeyPairSigner(loadKey(RELAYER)));

function receiverOf(sd) {
  const da = sd.delegateAction || sd.delegate_action;
  if (!da) throw new Error('missing delegateAction');
  return da.receiverId || da.receiver_id;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, household: HOUSE, relayer: RELAYER, network: NETWORK }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/relay') { res.writeHead(404); res.end('not found'); return; }
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    const parsed = JSON.parse(body);
    const receiver = receiverOf(parsed);
    if (receiver !== HOUSE) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `refusing receiver_id ${receiver}; only ${HOUSE}` }));
      return;
    }
    // Rehydrate if needed; near-js accepts plain JSON for signedDelegate action in many versions.
    const signedDelegate = parsed.delegateAction ? parsed : parsed;
    const sender = (parsed.delegateAction || parsed.delegate_action).senderId
      || (parsed.delegateAction || parsed.delegate_action).sender_id;
    const outcome = await account.signAndSendTransaction({
      receiverId: sender,
      actions: [actionCreators.signedDelegate(signedDelegate)],
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tx: outcome.transaction.hash }));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`Bolsillos relayer :${PORT} household=${HOUSE} relayer=${RELAYER}`);
});
