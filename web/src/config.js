/** Public testnet ids from the last local e2e run. Safe to commit. */
export const CFG = {
  network: 'testnet',
  rpc: 'https://rpc.testnet.near.org',
  house: 'b575-house.testnet',
  musdc: 'musdc.bolsillos-575ed7c9.testnet',
  factory: 'b575-factory.testnet',
  houseDemo: 'demo.b575-factory.testnet',
  /** ~3 NEAR for factory create_household (covers wasm storage + buffer). */
  factoryDepositYocto: '3000000000000000000000000',
  explorerTx: (hash) => `https://testnet.nearblocks.io/txns/${hash}`,
  explorerAccount: (id) => `https://testnet.nearblocks.io/address/${id}`,
  demoTxs: [
    { labelKey: 'tx_deploy_musdc', hash: '9SHKVc3N7ouXyAQ32L5B3TLjPsdEqR7U1SfUxTXfRRzk' },
    { labelKey: 'tx_deploy_house', hash: '9XR955fJB6UF1R2qM77PDDhHjwoKdweMQSbLZtWHEbBv' },
    { labelKey: 'tx_set_pockets', hash: 'BRWKhV5J4fqQMxNsFtQtLs8B7JiLMyfzGhuk7hBHYJ49' },
    { labelKey: 'tx_pay200', hash: '4cV32ooGa8UxG7aaiXqRB4PLXE9cCVMbY1TdtrFUGdAF' },
    { labelKey: 'tx_mom_withdraw', hash: 'EfJUW7hQahEB7BcqRvMUeqdRJ8jQrutDhEhZkmMKWRmA' },
    { labelKey: 'tx_gasless', hash: '5Zx5SARwMeCwc17TtpMoePYNCsMBmobUpbwszfFXDr75' },
    { labelKey: 'tx_factory_deploy', hash: 'AdMDv5abNKUqrDSPsgHhRovv9vn6yZpkocgwhwETqBPg' },
    { labelKey: 'tx_factory_create', hash: '67JCfsZCbjo3EgcDT9qU6MmSuQKazPa5Yy54tR2EXJSh' },
  ],
  /**
   * Wallets verified for judges on testnet (Nov 2026):
   * - Meteor Wallet (browser extension) — primary; MNW migration path.
   * - MyNearWallet testnet redirect (https://testnet.mynearwallet.com) — still works;
   *   sunset began 2026-10-31, use while available.
   * - HERE Wallet — listed for mobile / QR; optional.
   * Gasless withdraw is CLI-only (relayer private key never in the browser).
   */
  walletsNote:
    'Meteor (primary) + MyNearWallet testnet + HERE. Gasless = CLI relayer only.',
};

export function usdcToAtomic(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error('amount must be a positive number');
  // 6 decimals; avoid float drift for whole numbers
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 1e6);
  return String(BigInt(whole) * 1_000_000n + BigInt(frac));
}

export function fmtUsdc(raw) {
  const n = BigInt(raw || '0');
  const whole = n / 1000000n;
  const frac = (n % 1000000n).toString().padStart(6, '0').replace(/0+$/, '') || '0';
  return frac === '0' ? `${whole} USDC` : `${whole}.${frac} USDC`;
}

export function fmtCap(raw, unlimitedLabel) {
  if (!raw || raw === '0') return unlimitedLabel;
  if (String(raw).startsWith('340282366920938')) return unlimitedLabel;
  return fmtUsdc(raw);
}
