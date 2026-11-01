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

## Storyline transactions (first successful run)

| Step | Tx |
|---|---|
| Deploy mock USDC | https://testnet.nearblocks.io/txns/9SHKVc3N7ouXyAQ32L5B3TLjPsdEqR7U1SfUxTXfRRzk |
| Deploy household | https://testnet.nearblocks.io/txns/9XR955fJB6UF1R2qM77PDDhHjwoKdweMQSbLZtWHEbBv |
| set_pockets 40/25/15/10/10 | https://testnet.nearblocks.io/txns/BRWKhV5J4fqQMxNsFtQtLs8B7JiLMyfzGhuk7hBHYJ49 |
| Pay 200 USDC (atomic split) | https://testnet.nearblocks.io/txns/4cV32ooGa8UxG7aaiXqRB4PLXE9cCVMbY1TdtrFUGdAF |
| Mom withdraw 10 | https://testnet.nearblocks.io/txns/EfJUW7hQahEB7BcqRvMUeqdRJ8jQrutDhEhZkmMKWRmA |
| Mom gasless withdraw (relayer) | https://testnet.nearblocks.io/txns/5Zx5SARwMeCwc17TtpMoePYNCsMBmobUpbwszfFXDr75 |

## Latest full `scripts/e2e.sh` pass

- Timestamp: 2026-11-01 19:11 America/Buenos_Aires
- Gasless tx: https://testnet.nearblocks.io/txns/CxL3yU4MDJvxBNWrdTwV6C248Rx4ZTcy2C5EbDYiRVkU
- Agent drain: panic `only pocket owner can withdraw`
- Unit tests: contracts **16/16**, mock-usdc **3/3**
- `check_secretos.py`: LIMPIO

Note: Mom pocket `daily_cap` is 20 USDC/day; repeated e2e runs on the same UTC day should withdraw ≤ remaining_today (script uses 1+1 USDC).
