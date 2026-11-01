#!/usr/bin/env bash
# Fresh demo storyline for video capture (testnet). Small Mom withdraw so cap stays for over-cap beat.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:${PATH}"
# shellcheck disable=SC1091
source "${REPO_ROOT}/keys/accounts.env"
OUT="${REPO_ROOT}/pruebas/demo-capture"
mkdir -p "${OUT}"
HASHES="${OUT}/tx_hashes.txt"
: > "${HASHES}"

extract_tx() {
  local label="$1"
  local blob="$2"
  local tx
  tx="$(echo "${blob}" | grep -Eo 'Transaction ID: [A-Za-z0-9]+' | awk '{print $3}' | tail -1)"
  if [[ -z "${tx}" ]]; then
    tx="$(echo "${blob}" | grep -Eo 'https://explorer\.testnet\.near\.org/transactions/[A-Za-z0-9]+' | awk -F/ '{print $NF}' | tail -1)"
  fi
  if [[ -z "${tx}" ]]; then
    tx="$(echo "${blob}" | grep -Eo '"transaction_outcome"[:\s]*\{[^}]*"id":\s*"[A-Za-z0-9]+"' | head -1 | grep -Eo '[A-Za-z0-9]{40,}' | head -1 || true)"
  fi
  echo "${label}=${tx:-UNKNOWN}" | tee -a "${HASHES}"
  echo ">>> ${label} TX: ${tx:-UNKNOWN}"
  echo ">>> explorer: https://testnet.nearblocks.io/txns/${tx:-UNKNOWN}"
}

echo "=============================================="
echo " Bolsillos demo — live NEAR testnet"
echo " HOUSE=${HOUSE}"
echo "=============================================="
echo

echo "--- Beat: mint 200 mUSDC to payer ---"
MINT_OUT="$(near contract call-function as-transaction "${MUSDC}" mint \
  json-args "{\"account_id\":\"${PAYER}\",\"amount\":\"200000000\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as "${MUSDC}" network-config testnet sign-with-legacy-keychain send 2>&1)" || true
echo "${MINT_OUT}" | tail -40
extract_tx MINT "${MINT_OUT}"
echo

echo "--- Beat: pay 200 USDC → atomic split into 5 pockets ---"
PAY_OUT="$(near contract call-function as-transaction "${MUSDC}" ft_transfer_call \
  json-args "{\"receiver_id\":\"${HOUSE}\",\"amount\":\"200000000\",\"memo\":null,\"msg\":\"payroll\"}" \
  prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as "${PAYER}" network-config testnet sign-with-legacy-keychain send 2>&1)" || true
echo "${PAY_OUT}" | tail -55
extract_tx PAY_SPLIT "${PAY_OUT}"
echo

echo "--- Beat: pockets after split ---"
near contract call-function as-read-only "${HOUSE}" list_pockets json-args '{}' network-config testnet now
echo

echo "--- Beat: Mom gasless withdraw 1 USDC via relayer (no NEAR in Mom wallet for gas) ---"
GAS_OUT="$(cd "${REPO_ROOT}/relayer" && AMOUNT=1000000 node demo-gasless.mjs 2>&1)" || true
echo "${GAS_OUT}"
# demo-gasless prints tx hash / explorer link
GAS_TX="$(echo "${GAS_OUT}" | grep -Eo 'https://(testnet\.)?nearblocks\.io/txns/[A-Za-z0-9]+|https://explorer\.testnet\.near\.org/transactions/[A-Za-z0-9]+|[A-Za-z0-9]{43,44}' | head -1)"
GAS_TX="${GAS_TX##*/}"
echo "GASLESS=${GAS_TX}" | tee -a "${HASHES}"
echo ">>> GASLESS TX: ${GAS_TX}"
echo ">>> explorer: https://testnet.nearblocks.io/txns/${GAS_TX}"
echo

echo "--- Beat: agent tries to drain savings → expect panic ---"
set +e
AGENT_OUT="$(near contract call-function as-transaction "${HOUSE}" withdraw_pocket \
  json-args "{\"pocket_id\":\"savings\",\"amount\":\"20000000\",\"recipient\":\"${HOUSE}\"}" \
  prepaid-gas '50 Tgas' attached-deposit '0 NEAR' \
  sign-as "${AGENT}" network-config testnet sign-with-legacy-keychain send 2>&1)"
AGENT_RC=$?
set -e
echo "${AGENT_OUT}" | tail -50
if echo "${AGENT_OUT}" | grep -qi 'only pocket owner can withdraw'; then
  echo "OK: agent blocked — only pocket owner can withdraw"
else
  echo "NOTE: agent call exit=${AGENT_RC} (expected failure)"
fi
echo

echo "--- Beat: over-cap withdraw from savings (cap 1 USDC, try 2) → expect panic ---"
set +e
CAP_OUT="$(near contract call-function as-transaction "${HOUSE}" withdraw_pocket \
  json-args "{\"pocket_id\":\"savings\",\"amount\":\"2000000\",\"recipient\":\"${HOUSE}\"}" \
  prepaid-gas '50 Tgas' attached-deposit '0 NEAR' \
  sign-as "${HOUSE}" network-config testnet sign-with-legacy-keychain send 2>&1)"
CAP_RC=$?
set -e
echo "${CAP_OUT}" | tail -50
if echo "${CAP_OUT}" | grep -qi 'exceeds daily cap'; then
  echo "OK: over-cap blocked — exceeds daily cap"
else
  echo "NOTE: over-cap call exit=${CAP_RC} (expected failure)"
fi
echo

echo "=============================================="
echo " Demo storyline complete. Hashes:"
cat "${HASHES}"
echo "=============================================="
