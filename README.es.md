# Bolsillos: cada cobro en USDC se reparte solo entre los bolsillos de la casa

> **[Read in English](README.md)** · Estado: prototipo de hackathon · **solo NEAR testnet** (faucet, USDC mock, sin valor real) · nada en mainnet.

Bolsillos es una política de plata hogareña en NEAR. Cuando llega un cobro en USDC, el contrato lo **reparte de forma atómica** en bolsillos con nombre (gastos, alquiler, mamá, monotributo/impuestos, ahorro). Cada bolsillo tiene **dueño**, **destinatarios permitidos** y un **tope diario** opcional. La familia gasta con una **clave de function-call**; un **relayer** paga el gas para que nadie compre NEAR. Un **agente** del hogar lee saldos y propone cambios de reglas (timelock 24h) pero **no** puede mover fondos fuera de la política. Una **factory** deploya un hogar nuevo por casa como `<nombre>.<factory>.testnet`.

**Tracks del hackathon:** `realworld`, `open`, `security`.

**Aviso Q-015.** Este es un segundo proyecto independiente de la misma persona que envió [Tune Up Research Desk](https://github.com/tuneupargentina/tuneup-research-desk). No comparten código, cuentas ni contratos. Research Desk = recibos on-chain con SHA-256 de informes. Bolsillos = split hogareño de USDC entrante + gasto acotado.

## Probalo en 2 minutos

1. Abrí la UI estática: `cd web/dist && python3 -m http.server 8080` → http://127.0.0.1:8080 (o `cd web && npm install && npm run dev`).
2. Tocá **Conectar wallet** → preferí **Meteor Wallet** (abre una **pestaña web**; la extensión es opcional). **HERE** está para mobile. **MyNearWallet** aparece al final como *retirada* y puede rechazar conexiones nuevas.
3. **Nota para jueces:** una cuenta nueva de testnet necesita **~1 NEAR** para la clave de login. Preferí el [faucet oficial de la docs](https://docs.near.org/getting-started/faucet); [near-faucet.io](https://near-faucet.io/) es respaldo (a veces falla). En **Meteor**, cambiá el dropdown de red a **Testnet** (por defecto Mainnet). Confirmá en la **pestaña** de la wallet.
4. **Minteá** 200 mUSDC a tu cuenta → **Pagá al hogar** → mirá cómo se actualizan los bolsillos. O **Creá un hogar** con la factory (`<nombre>.b575-factory.testnet`, ~3 NEAR). Retirá de un bolsillo tuyo a un destinatario allowlisted; los panics del contrato (`exceeds daily cap`, `only pocket owner can withdraw`, `recipient not allowlisted`) se muestran en la UI.
5. Cambiá a **EN** si preferís inglés. El retiro sin gas queda en CLI: `cd relayer && node demo-gasless.mjs` (los secretos del relayer nunca van al browser).

## Hacé X → ves Y

| Hacé esto | Deberías ver |
|---|---|
| `cd contracts && cargo test` | **16 passed** |
| `cd mock-usdc && cargo test` | **4 passed** |
| `cd factory && cargo test` | **7 passed** |
| Serví `web/dist/` o `npm run dev` en `web/` | Bolsillos en vivo + Wallet Selector (Meteor / Intear / HERE; MNW retirada) |
| Link del explorer “Pay 200 USDC” | `EVENT_JSON` `split` con `amount` `200000000` |
| Mamá `withdraw_pocket` 10 → `b575-momdest.testnet` | Evento de retiro; crece el `ft_balance_of` |
| `node relayer/demo-gasless.mjs` | El relayer manda la meta-tx; el explorer muestra al relayer como signer |
| El agente llama `withdraw_pocket` en `savings` | Panic: `only pocket owner can withdraw` |
| El dueño saca 20 del ahorro (tope 1) | Panic: `exceeds daily cap` |
| Factory `create_household` | Subcuenta `<nombre>.b575-factory.testnet` con el caller como dueño |
| `bash scripts/e2e.sh` | Log completo + factory + flujos near-api-js en `pruebas/e2e-*.log` |

## Cómo funciona

1. El dueño llama `set_pockets` con shares en basis points que suman **10000**.
2. Cualquiera manda USDC mock al hogar con `ft_transfer_call`. `ft_on_transfer` acredita cada bolsillo en **un** receipt.
3. El dueño de un bolsillo llama `withdraw_pocket`. Chequeos: dueño, allowlist, saldo y tope diario.
4. El relayer solo acepta `SignedDelegate` cuyo `receiver_id` es el contrato del hogar.
5. El agente puede `propose_rule_change`; el dueño ejecuta con `execute_rule_change` después del timelock.
6. La factory `create_household` crea `<nombre>.<factory>`, deploya el wasm y llama `new` con el caller como dueño (~3 NEAR).

## Cuentas y transacciones en testnet

Mismas tablas que en [README.md](README.md#testnet-deployment) (ids y links idénticos), incluyendo factory `b575-factory.testnet` y `demo.b575-factory.testnet`.

## Wallets (testnet)

Verificadas para jueces (nov 2026): **Meteor** (principal — pestaña web; **pasá el dropdown a Testnet**, por defecto Mainnet), **Intear** (wallet web mantenida), **HERE** (mobile), **MyNearWallet** (última, *retirada*).

**Cuentas nuevas necesitan ~1 NEAR** para la clave de login. Preferí el [faucet oficial de la docs](https://docs.near.org/getting-started/faucet); [near-faucet.io](https://near-faucet.io/) es respaldo. La web no sponsorea el login.

El retiro sin gas **no** está en la web.

## Camino a mainnet (solo documentado)

No desplegado. No se usó la seed de `tuneup.near`. USDC nativo de Circle en NEAR + quotes `dry: true` de NEAR Intents 1Click. Detalle en el README en inglés.

## Limitaciones honestas

USDC mock (faucet self-mint) · relayer confiable · gasless solo por CLI · timelock corto en el demo · polvo del split al último bolsillo · MNW retirada · cuentas nuevas necesitan ~1 NEAR (faucet) · la factory pide ~3 NEAR por create.

## Librerías y asistencia de IA

Librerías de terceros (no se usa código ni librerías previas de Tune Up):

| Parte | Librerías |
| --- | --- |
| Contratos (`contracts/`, `factory/`, `mock-usdc/`, Rust) | `near-sdk` 5.29.1, `near-contract-standards` 5.29.1 (NEP-141) |
| Relayer (`relayer/`) y scripts (`scripts/`) | `@near-js/*` 2.3 (accounts, crypto, providers, signers, transactions, types, utils, keystores-node) |
| Web (`web/`) | `@near-js/providers`, `@near-js/utils`, NEAR Wallet Selector 10.1 (core, modal-ui, Meteor, Intear, HERE, MyNearWallet), `buffer`, `process`; build: Vite 6, `vite-plugin-node-polyfills`; pruebas de UI: Playwright |

**Asistencia de IA.** El código, las pruebas, el video de demo y la documentación se redactaron con asistentes de
programación con IA y el equipo de Tune Up los revisó, ejecutó y probó. **Base previa:** todo el código de este
repositorio se escribió durante el hackathon (primer commit 2026-11-01).

## Licencia

MIT · Copyright (c) 2026 Luis A. Santangelo / Tune Up
