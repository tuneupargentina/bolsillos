# Bolsillos: cada cobro en USDC se reparte solo entre los bolsillos de la casa

> **[Read in English](README.md)** · Estado: prototipo de hackathon · **solo NEAR testnet** (faucet, USDC mock, sin valor real) · nada en mainnet.

Bolsillos es una política de plata hogareña en NEAR. Cuando llega un cobro en USDC, el contrato lo **reparte de forma atómica** en bolsillos con nombre (gastos, alquiler, mamá, monotributo/impuestos, ahorro). Cada bolsillo tiene **dueño**, **destinatarios permitidos** y un **tope diario** opcional. La familia gasta con una **clave de function-call**; un **relayer** paga el gas para que nadie compre NEAR. Un **agente** del hogar lee saldos y propone cambios de reglas (timelock 24h) pero **no** puede mover fondos fuera de la política.

**Tracks del hackathon:** `realworld`, `open`, `security`.

**Aviso Q-015.** Este es un segundo proyecto independiente de la misma persona que envió [Tune Up Research Desk](https://github.com/tuneupargentina/tuneup-research-desk). No comparten código, cuentas ni contratos. Research Desk = recibos on-chain con SHA-256 de informes. Bolsillos = split hogareño de USDC entrante + gasto acotado.

## Hacé X → ves Y

| Hacé esto | Deberías ver |
|---|---|
| `cd contracts && cargo test` | **16 passed** |
| `cd mock-usdc && cargo test` | **3 passed** |
| Abrí `web/index.html` (o `python3 -m http.server 8080` en `web/`) | Saldos en vivo desde el RPC público; botón **ES/EN** |
| Link del explorer “Pay 200 USDC” | `EVENT_JSON` `split` con `amount` `200000000` |
| Mamá `withdraw_pocket` 10 → `b575-momdest.testnet` | Evento de retiro; `ft_balance_of` = `10000000` |
| `node relayer/demo-gasless.mjs` | El relayer manda la meta-tx; el explorer muestra al relayer como signer |
| El agente llama `withdraw_pocket` en `savings` | Panic: `only pocket owner can withdraw` |
| El dueño saca 20 del ahorro (tope 1) | Panic: `exceeds daily cap` |
| `bash scripts/e2e.sh` | Log completo en `pruebas/e2e-*.log` |

## Cómo funciona

1. El dueño llama `set_pockets` con shares en basis points que suman **10000**.
2. Cualquiera manda USDC mock al hogar con `ft_transfer_call`. `ft_on_transfer` acredita cada bolsillo en **un** receipt.
3. El dueño de un bolsillo llama `withdraw_pocket`. Chequeos: dueño, allowlist, saldo y tope diario.
4. El relayer solo acepta `SignedDelegate` cuyo `receiver_id` es el contrato del hogar.
5. El agente puede `propose_rule_change`; el dueño aplica después del timelock.

## Cuentas y transacciones en testnet

Mismas tablas que en [README.md](README.md#testnet-deployment) (ids y links idénticos).

## Camino a mainnet (solo documentado)

No desplegado. No se usó la seed de `tuneup.near`. USDC nativo de Circle en NEAR + quotes `dry: true` de NEAR Intents 1Click. Detalle en el README en inglés.

## Limitaciones honestas

USDC mock · relayer confiable · timelock corto en el demo · la web es visor · el polvo del split va al último bolsillo · un hogar por contrato en este MVP.

## Licencia

MIT · Copyright (c) 2026 Luis A. Santangelo / Tune Up
