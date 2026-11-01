#!/usr/bin/env node
/**
 * Household agent (read + propose only).
 * - Reads pocket balances via public RPC (no keys).
 * - Suggests share_bps from a declared monthly rent heuristic.
 * - Warns when a pocket is low.
 * - Optionally proposes a rule change with --propose (needs AGENT FC key via near-cli).
 * - Demonstrates it cannot withdraw: --try-drain (expected to fail).
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = Object.fromEntries(
  readFileSync(new URL('../keys/accounts.env', import.meta.url), 'utf8')
    .trim().split('\n').map((l) => l.split('='))
);
const HOUSE = process.env.HOUSE || env.HOUSE;
const AGENT = process.env.AGENT || env.AGENT;
const RPC = 'https://rpc.testnet.near.org';

async function view(method, args = {}) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'dontcare', method: 'query',
      params: {
        request_type: 'call_function', finality: 'final',
        account_id: HOUSE, method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      },
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  const raw = Buffer.from(j.result.result).toString('utf8');
  return raw ? JSON.parse(raw) : null;
}

function fmt(u6) {
  return (Number(u6) / 1e6).toFixed(2);
}

const household = await view('get_household');
console.log('=== Bolsillos agent ===');
console.log(`household: ${HOUSE}`);
console.log(`total received: ${fmt(household.total_received)} mUSDC`);
for (const p of household.pockets) {
  const low = Number(p.balance) < 5_000_000 && p.id !== 'taxes';
  console.log(
    `  ${p.id.padEnd(8)} bal=${fmt(p.balance).padStart(8)}  share=${(p.share_bps / 100).toFixed(1)}%  owner=${p.owner}` +
      (low ? '  ⚠ LOW' : '')
  );
}

// Heuristic: if rent share * assumed income < declared rent, bump rent.
const declaredRent = Number(process.env.DECLARED_RENT_USDC || 50); // USDC
const assumedIncome = Number(process.env.ASSUMED_INCOME_USDC || 200);
const rentPocket = household.pockets.find((p) => p.id === 'rent');
const rentShare = rentPocket ? rentPocket.share_bps / 10000 : 0;
const expectedRent = assumedIncome * rentShare;
console.log(`\nHeuristic: declared rent ${declaredRent} USDC, assumed income ${assumedIncome}, current rent share covers ~${expectedRent.toFixed(2)}`);
if (expectedRent + 0.01 < declaredRent) {
  const neededBps = Math.min(5000, Math.ceil((declaredRent / assumedIncome) * 10000));
  console.log(`Suggestion: raise rent share_bps toward ${neededBps} (via propose_rule_change + timelock).`);
} else {
  console.log('Suggestion: current rent share looks adequate.');
}

if (process.argv.includes('--try-drain')) {
  console.log('\nAttempting unauthorized savings drain (expected FAIL)...');
  const r = spawnSync('near', [
    'contract', 'call-function', 'as-transaction', HOUSE, 'withdraw_pocket',
    'json-args', JSON.stringify({ pocket_id: 'savings', amount: '20000000', recipient: HOUSE }),
    'prepaid-gas', '50 Tgas', 'attached-deposit', '0 NEAR',
    'sign-as', AGENT, 'network-config', 'testnet', 'sign-with-legacy-keychain', 'send',
  ], { encoding: 'utf8' });
  console.log(r.stdout || '');
  console.error(r.stderr || '');
  console.log(r.status === 0 ? 'UNEXPECTED SUCCESS' : 'Blocked as expected (agent is not savings owner / FC key limited).');
  process.exit(r.status === 0 ? 1 : 0);
}
