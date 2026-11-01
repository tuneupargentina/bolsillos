// Public testnet ids from the last local e2e run. Safe to commit.
window.BOLSILLOS = {
  network: 'testnet',
  rpc: 'https://rpc.testnet.near.org',
  house: 'b575-house.testnet',
  musdc: 'musdc.bolsillos-575ed7c9.testnet',
  explorerTx: (hash) => `https://testnet.nearblocks.io/txns/${hash}`,
  explorerAccount: (id) => `https://testnet.nearblocks.io/address/${id}`,
  demoTxs: [
    { labelKey: 'tx_deploy_musdc', hash: '9SHKVc3N7ouXyAQ32L5B3TLjPsdEqR7U1SfUxTXfRRzk' },
    { labelKey: 'tx_deploy_house', hash: '9XR955fJB6UF1R2qM77PDDhHjwoKdweMQSbLZtWHEbBv' },
    { labelKey: 'tx_set_pockets', hash: 'BRWKhV5J4fqQMxNsFtQtLs8B7JiLMyfzGhuk7hBHYJ49' },
    { labelKey: 'tx_pay200', hash: '4cV32ooGa8UxG7aaiXqRB4PLXE9cCVMbY1TdtrFUGdAF' },
    { labelKey: 'tx_mom_withdraw', hash: 'EfJUW7hQahEB7BcqRvMUeqdRJ8jQrutDhEhZkmMKWRmA' },
    { labelKey: 'tx_gasless', hash: '5Zx5SARwMeCwc17TtpMoePYNCsMBmobUpbwszfFXDr75' },
  ],
};
