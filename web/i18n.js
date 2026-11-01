window.I18N = {
  en: {
    tagline: '("pockets"): every USDC payment splits itself into household pockets',
    refresh: 'Refresh',
    household: 'Household',
    contract: 'Contract',
    token: 'Token',
    owner: 'Owner',
    total: 'Total received',
    timelock: 'Timelock',
    pockets: 'Pockets',
    col_id: 'Id',
    col_share: 'Share',
    col_balance: 'Balance',
    col_owner: 'Owner',
    col_cap: 'Daily cap',
    col_allow: 'Allowlist',
    demo_title: 'Demo storyline',
    step1: 'Pay 200 mUSDC into the household → it splits 40/25/15/10/10 (spend / rent / mom / taxes / savings).',
    step2: 'Mom withdraws 10 mUSDC to her destination account (gasless via the relayer).',
    step3: 'The agent tries to drain savings and is blocked (not the pocket owner; FC key limited).',
    step4: 'Even the household owner cannot pull more than the savings daily cap.',
    demo_hint: 'Run bash scripts/e2e.sh to reproduce on testnet. Links below are from the last recorded run.',
    try_title: 'Try it',
    try1: 'Clone the repo and open this folder with any static server (python3 -m http.server 8080 in web/).',
    try2: 'Or open index.html directly — it reads public testnet RPC, no wallet needed to view.',
    try3: 'Toggle EN/ES with the button in the header (choice saved in localStorage).',
    footer: 'Built for the NEAR Hackathon · tracks: Real-World Money, Open Innovation, AI Security & Defense · sister project: Tune Up Research Desk',
    tx_deploy_musdc: 'Deploy mock USDC',
    tx_deploy_house: 'Deploy household',
    tx_set_pockets: 'Set pockets',
    tx_pay200: 'Pay 200 USDC (atomic split)',
    tx_mom_withdraw: 'Mom withdraw 10',
    tx_gasless: 'Mom gasless withdraw (relayer)',
    unlimited: 'unlimited',
    loading: 'Loading…',
    err: 'Could not load household from RPC',
  },
  es: {
    tagline: '("bolsillos"): cada cobro en USDC se reparte solo entre los bolsillos de la casa',
    refresh: 'Actualizar',
    household: 'Hogar',
    contract: 'Contrato',
    token: 'Token',
    owner: 'Dueño',
    total: 'Total recibido',
    timelock: 'Timelock',
    pockets: 'Bolsillos',
    col_id: 'Id',
    col_share: 'Porcentaje',
    col_balance: 'Saldo',
    col_owner: 'Dueño',
    col_cap: 'Tope diario',
    col_allow: 'Permitidos',
    demo_title: 'Historia del demo',
    step1: 'Entran 200 mUSDC al hogar → se reparten 40/25/15/10/10 (gastos / alquiler / mamá / monotributo / ahorro).',
    step2: 'Mamá retira 10 mUSDC a su cuenta destino (sin gas, vía el relayer).',
    step3: 'El agente intenta vaciar el ahorro y queda bloqueado (no es dueño del bolsillo; clave FC limitada).',
    step4: 'Ni el dueño del hogar puede sacar más que el tope diario del ahorro.',
    demo_hint: 'Corré bash scripts/e2e.sh para reproducirlo en testnet. Los links de abajo son de la última corrida.',
    try_title: 'Probalo',
    try1: 'Cloná el repo y abrí esta carpeta con cualquier server estático (python3 -m http.server 8080 en web/).',
    try2: 'O abrí index.html directo: lee el RPC público de testnet, no hace falta wallet para mirar.',
    try3: 'Cambiá EN/ES con el botón del encabezado (se guarda en localStorage).',
    footer: 'Hecho para el NEAR Hackathon · tracks: Real-World Money, Open Innovation, AI Security & Defense · proyecto hermano: Tune Up Research Desk',
    tx_deploy_musdc: 'Deploy del mock USDC',
    tx_deploy_house: 'Deploy del hogar',
    tx_set_pockets: 'Configurar bolsillos',
    tx_pay200: 'Pagar 200 USDC (split atómico)',
    tx_mom_withdraw: 'Retiro de Mamá 10',
    tx_gasless: 'Retiro de Mamá sin gas (relayer)',
    unlimited: 'sin tope',
    loading: 'Cargando…',
    err: 'No se pudo cargar el hogar desde el RPC',
  },
};

window.getLang = function getLang() {
  return localStorage.getItem('bolsillos.lang') || 'en';
};
window.setLang = function setLang(lang) {
  localStorage.setItem('bolsillos.lang', lang);
};
window.t = function t(key) {
  const lang = window.getLang();
  return (window.I18N[lang] && window.I18N[lang][key]) || window.I18N.en[key] || key;
};
window.applyI18n = function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.innerHTML = window.t(key);
  });
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = window.getLang() === 'en' ? 'ES' : 'EN';
  document.documentElement.lang = window.getLang();
};
