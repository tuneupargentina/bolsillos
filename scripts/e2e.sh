#!/usr/bin/env bash
# Reproduce the Bolsillos demo storyline on NEAR testnet.
# Requires: near-cli-rs on PATH, keys/accounts.env, credentials in ~/.near-credentials/testnet/
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:${PATH}"
# shellcheck disable=SC1091
source "${REPO_ROOT}/keys/accounts.env"
LOGDIR="${REPO_ROOT}/pruebas"
mkdir -p "${LOGDIR}"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="${LOGDIR}/e2e-${TS}.log"
exec > >(tee -a "${LOG}") 2>&1

echo "=== Bolsillos e2e ${TS} ==="
echo "HOUSE=${HOUSE} MUSDC=${MUSDC}"

echo "--- 1) view pockets before ---"
near contract call-function as-read-only "${HOUSE}" list_pockets json-args '{}' network-config testnet now

echo "--- 2) mint 200 to payer ---"
near contract call-function as-transaction "${MUSDC}" mint \
  json-args "{\"account_id\":\"${PAYER}\",\"amount\":\"200000000\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as "${MUSDC}" network-config testnet sign-with-legacy-keychain send

echo "--- 3) pay 200 via ft_transfer_call (atomic split) ---"
near contract call-function as-transaction "${MUSDC}" ft_transfer_call \
  json-args "{\"receiver_id\":\"${HOUSE}\",\"amount\":\"200000000\",\"memo\":null,\"msg\":\"payroll\"}" \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as "${PAYER}" network-config testnet sign-with-legacy-keychain send

echo "--- 4) pockets after split ---"
near contract call-function as-read-only "${HOUSE}" list_pockets json-args '{}' network-config testnet now

echo "--- 5) Mom withdraw 1 USDC ---"
near contract call-function as-transaction "${HOUSE}" withdraw_pocket \
  json-args "{\"pocket_id\":\"mom\",\"amount\":\"1000000\",\"recipient\":\"${MOMDEST}\"}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as "${MOM}" network-config testnet sign-with-legacy-keychain send

echo "--- 6) gasless Mom withdraw 1 USDC via relayer ---"
( cd "${REPO_ROOT}/relayer" && AMOUNT=1000000 node demo-gasless.mjs )

echo "--- 7) agent drain blocked ---"
set +e
AGENT_OUT="$(near contract call-function as-transaction "${HOUSE}" withdraw_pocket \
  json-args "{\"pocket_id\":\"savings\",\"amount\":\"20000000\",\"recipient\":\"${HOUSE}\"}" \
  prepaid-gas '50 Tgas' attached-deposit '0 NEAR' \
  sign-as "${AGENT}" network-config testnet sign-with-legacy-keychain send 2>&1)"
AGENT_RC=$?
set -e
echo "${AGENT_OUT}"
if echo "${AGENT_OUT}" | grep -q 'only pocket owner can withdraw'; then
  echo "OK: agent blocked (contract panic)"
elif [[ ${AGENT_RC} -ne 0 ]]; then
  echo "OK: agent blocked (cli exit ${AGENT_RC})"
else
  echo "FAIL: agent drain unexpectedly succeeded"; exit 1
fi

echo "--- 8) agent advise ---"
node "${REPO_ROOT}/agent/advise.mjs"

echo "--- 9) momdest balance ---"
near contract call-function as-read-only "${MUSDC}" ft_balance_of \
  json-args "{\"account_id\":\"${MOMDEST}\"}" network-config testnet now

echo "=== e2e DONE · log ${LOG} ==="
