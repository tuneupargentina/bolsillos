#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:${PATH}"
( cd "${ROOT}/contracts" && cargo near build non-reproducible-wasm )
( cd "${ROOT}/mock-usdc" && cargo near build non-reproducible-wasm )
mkdir -p "${ROOT}/res"
cp "${ROOT}/contracts/target/near/bolsillos.wasm" "${ROOT}/res/"
cp "${ROOT}/mock-usdc/target/near/mock_usdc.wasm" "${ROOT}/res/"
echo "Built res/bolsillos.wasm and res/mock_usdc.wasm"
