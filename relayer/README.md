# Bolsillos relayer

Minimal meta-transaction relayer. Only relays `SignedDelegate` actions whose `receiver_id` equals the household contract.

```bash
cp ../keys/accounts.env.example ../keys/accounts.env   # if you have one
npm install
HOUSEHOLD_CONTRACT=b575-house.testnet RELAYER_ACCOUNT=b575-relayer.testnet node server.mjs
# or one-shot demo:
node demo-gasless.mjs
```

Credentials: legacy keychain at `~/.near-credentials/testnet/<account>.json`. Never commit keys.
