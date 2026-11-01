# Testnet e2e results (recorded)

Network: NEAR testnet. All accounts are faucet-funded throwaways. No mainnet, no real USDC.

## Accounts

| Role | Account |
|---|---|
| Mock USDC | `musdc.bolsillos-575ed7c9.testnet` |
| Household | `b575-house.testnet` |
| Payer | `b575-payer.testnet` |
| Mom | `b575-mom.testnet` |
| Mom destination | `b575-momdest.testnet` |
| Agent | `b575-agent.testnet` |
| Relayer | `b575-relayer.testnet` |

## Transactions

| Step | Tx |
|---|---|
| Deploy mock USDC | https://testnet.nearblocks.io/txns/9SHKVc3N7ouXyAQ32L5B3TLjPsdEqR7U1SfUxTXfRRzk |
| Deploy household | https://testnet.nearblocks.io/txns/9XR955fJB6UF1R2qM77PDDhHjwoKdweMQSbLZtWHEbBv |
| set_pockets 40/25/15/10/10 | https://testnet.nearblocks.io/txns/BRWKhV5J4fqQMxNsFtQtLs8B7JiLMyfzGhuk7hBHYJ49 |
| Pay 200 USDC (atomic split) | https://testnet.nearblocks.io/txns/4cV32ooGa8UxG7aaiXqRB4PLXE9cCVMbY1TdtrFUGdAF |
| Mom withdraw 10 | https://testnet.nearblocks.io/txns/EfJUW7hQahEB7BcqRvMUeqdRJ8jQrutDhEhZkmMKWRmA |
| Mom gasless withdraw (relayer) | https://testnet.nearblocks.io/txns/5Zx5SARwMeCwc17TtpMoePYNCsMBmobUpbwszfFXDr75 |

## Policy checks

- Agent `withdraw_pocket` on savings → panic `only pocket owner can withdraw`
- Owner withdraw 20 from savings (cap 1) → panic `exceeds daily cap`
- Momdest `ft_balance_of` after first withdraw → `"10000000"` (10 USDC)

Unit tests: contracts 16/16, mock-usdc 3/3.
