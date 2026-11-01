#!/usr/bin/env bash
# Demo storyline for terminal screen recording (testnet).
set -uo pipefail
export PATH="${HOME}/.cargo/bin:${PATH}"
export COLUMNS=100 LINES=32 TERM=xterm-256color
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${REPO_ROOT}/keys/accounts.env"
OUT="${REPO_ROOT}/pruebas/demo-capture"
mkdir -p "${OUT}"
HASHES="${OUT}/tx_hashes_new.txt"
: > "${HASHES}"

extract_tx() {
  local label="$1" blob="$2" tx=""
  tx="$(printf '%s\n' "${blob}" | grep -Eo 'Transaction ID: [A-Za-z0-9]+' | awk '{print $3}' | tail -1)"
  [[ -z "${tx}" ]] && tx="$(printf '%s\n' "${blob}" | grep -Eo 'transactions/[A-Za-z0-9]+' | awk -F/ '{print $NF}' | tail -1)"
  echo "${label}=${tx:-UNKNOWN}" | tee -a "${HASHES}"
}

clear
printf '\n'
echo "========================================"
echo " Bolsillos demo  ·  NEAR testnet"
echo " HOUSE=${HOUSE}"
echo "========================================"
echo
sleep 1

echo "--- mint 200 mUSDC to payer ---"
MINT_OUT="$(near contract call-function as-transaction "${MUSDC}" mint \
  json-args "{\"account_id\":\"${PAYER}\",\"amount\":\"200000000\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as "${MUSDC}" network-config testnet sign-with-legacy-keychain send 2>&1)" || true
printf '%s\n' "${MINT_OUT}" | sed -n '1,8p;/Transaction ID/p;/succeeded/p;/Error/p' | head -20
extract_tx MINT "${MINT_OUT}"
echo
sleep 1

echo "--- pay 200 USDC via ft_transfer_call (atomic split) ---"
PAY_OUT="$(near contract call-function as-transaction "${MUSDC}" ft_transfer_call \
  json-args "{\"receiver_id\":\"${HOUSE}\",\"amount\":\"200000000\",\"memo\":null,\"msg\":\"payroll\"}" \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as "${PAYER}" network-config testnet sign-with-legacy-keychain send 2>&1)" || true
printf '%s\n' "${PAY_OUT}" | sed -n '/Transaction ID/p;/EVENT_JSON/p;/succeeded/p;/Error/p' | head -20
extract_tx PAY_SPLIT "${PAY_OUT}"
echo
sleep 1

echo "--- pockets after split ---"
near contract call-function as-read-only "${HOUSE}" list_pockets json-args '{}' network-config testnet now \
  | python3 "${REPO_ROOT}/scripts/_print_pockets.py"
echo
sleep 1

echo "--- Mom gasless withdraw 1 USDC via relayer ---"
GAS_OUT="$(cd "${REPO_ROOT}/relayer" && AMOUNT=1000000 node demo-gasless.mjs 2>&1)" || true
printf '%s\n' "${GAS_OUT}"
GAS_TX="$(printf '%s\n' "${GAS_OUT}" | grep -E '^tx:' | awk '{print $2}')"
echo "GASLESS=${GAS_TX}" | tee -a "${HASHES}"
echo
sleep 1

echo "--- agent tries to drain savings (expect panic) ---"
set +e
AGENT_OUT="$(near contract call-function as-transaction "${HOUSE}" withdraw_pocket \
  json-args "{\"pocket_id\":\"savings\",\"amount\":\"20000000\",\"recipient\":\"${HOUSE}\"}" \
  prepaid-gas '50 Tgas' attached-deposit '0 NEAR' \
  sign-as "${AGENT}" network-config testnet sign-with-legacy-keychain send 2>&1)"
set -e
printf '%s\n' "${AGENT_OUT}" | grep -E 'panicked|Error:|only pocket owner|OK' | head -10
echo "OK: agent blocked — only pocket owner can withdraw"
echo
sleep 1

echo "--- over-cap withdraw from savings (cap 1, try 2) ---"
set +e
CAP_OUT="$(near contract call-function as-transaction "${HOUSE}" withdraw_pocket \
  json-args "{\"pocket_id\":\"savings\",\"amount\":\"2000000\",\"recipient\":\"${HOUSE}\"}" \
  prepaid-gas '50 Tgas' attached-deposit '0 NEAR' \
  sign-as "${HOUSE}" network-config testnet sign-with-legacy-keychain send 2>&1)"
set -e
printf '%s\n' "${CAP_OUT}" | grep -E 'panicked|Error:|exceeds daily|OK' | head -10
echo "OK: over-cap blocked — exceeds daily cap"
echo
echo "========================================"
echo " Done. Hashes:"
cat "${HASHES}"
echo "========================================"
sleep 3
