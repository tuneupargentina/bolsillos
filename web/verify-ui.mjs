import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8080/';
const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 220) : ''}`);
}

async function closeWalletModal(page) {
  await page.evaluate(() => {
    const root = document.getElementById('near-wallet-selector-modal');
    if (root) {
      root.style.display = 'none';
      const btn = root.querySelector('.bolsillos-cancel-connect');
      if (btn) btn.click();
    }
    document.querySelectorAll('.nws-modal-wrapper, .nws-modal').forEach((el) => {
      const host = el.closest('#near-wallet-selector-modal') || el;
      host.style.display = 'none';
    });
  });
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);

const houseId = await page.locator('#house-id').textContent();
ok('page loaded', true, `house-id=${houseId}`);
ok('no pageerror', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
ok(
  'no severe console errors',
  !consoleErrors.some((e) => /Cannot read|is not defined|Failed to fetch dynamically/i.test(e)),
  consoleErrors.slice(0, 3).join(' | ') || 'none',
);

const fav = await page.evaluate(async () => {
  const r = await fetch('./favicon.svg');
  return { status: r.status };
});
ok('favicon 200', fav.status === 200, JSON.stringify(fav));

const judge = await page.locator('[data-i18n="judge_note"]').innerHTML();
ok(
  'judge faucet note visible',
  /near-faucet\.io|docs\.near\.org\/getting-started\/faucet/i.test(judge) && /1 NEAR|~1 NEAR/i.test(judge),
  judge.slice(0, 180),
);

await page.locator('#btn-connect').click();
await page.waitForTimeout(1500);
const modalHtml = await page.evaluate(() => {
  const el = document.querySelector('#near-wallet-selector-modal');
  return el ? el.innerText : '';
});
const modalVisible = await page.locator('#near-wallet-selector-modal .nws-modal').isVisible().catch(() => false);

// Order: Meteor should appear before MyNearWallet in the list text.
const meteorIdx = modalHtml.search(/Meteor/i);
const mnwIdx = modalHtml.search(/MyNearWallet|My Near Wallet/i);
const hereIdx = modalHtml.search(/HERE|Here Wallet/i);
ok('connect opens wallet modal', modalVisible || meteorIdx >= 0, modalHtml.slice(0, 200));
ok('modal lists Meteor', meteorIdx >= 0);
ok('modal lists HERE', hereIdx >= 0);
ok(
  'Meteor listed before MyNearWallet (or MNW absent)',
  meteorIdx >= 0 && (mnwIdx < 0 || meteorIdx < mnwIdx),
  `meteor@${meteorIdx} mnw@${mnwIdx}`,
);

// Deprecated badge / retired copy in page
const walletsHint = await page.locator('[data-i18n="wallets_hint"]').innerHTML();
ok(
  'page copy: Meteor web tab, MNW retired',
  /Meteor/i.test(walletsHint) && /web wallet tab|pestaña web/i.test(walletsHint) && /retired|retirada/i.test(walletsHint),
  walletsHint.slice(0, 200),
);

await closeWalletModal(page);

await page.locator('#btn-mint').click({ force: true });
await page.waitForTimeout(600);
const toastText = await page.evaluate(() => {
  const toasts = [...document.querySelectorAll('.toast-msg')].map((e) => e.textContent);
  const status = document.getElementById('status-line')?.textContent || '';
  const err = document.getElementById('error-line')?.textContent || '';
  return { toasts, status, err };
});
ok(
  'disconnected Mint shows connect-first message',
  /connect|conect|wallet|billetera/i.test(JSON.stringify(toastText)),
  JSON.stringify(toastText),
);

await closeWalletModal(page);

const beforeH2 = await page.locator('h2[data-i18n="household"]').textContent();
const beforeBtn = await page.locator('#lang-toggle').textContent();
await page.locator('#lang-toggle').click({ force: true });
await page.waitForTimeout(500);
const afterH2 = await page.locator('h2[data-i18n="household"]').textContent();
const afterBtn = await page.locator('#lang-toggle').textContent();
const afterConnect = await page.locator('#btn-connect').textContent();
const afterJudge = await page.locator('[data-i18n="judge_note"]').textContent();
ok(
  'lang toggle flips label',
  beforeBtn.trim() !== afterBtn.trim() && /EN|ES/.test(afterBtn),
  `${beforeBtn} → ${afterBtn}`,
);
ok(
  'ES changes headings + judge note',
  beforeH2 !== afterH2 && /Hogar|jueces|faucet/i.test(afterH2 + afterConnect + afterJudge),
  `h2: ${beforeH2} → ${afterH2}; judge: ${afterJudge.slice(0, 80)}`,
);

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log('\n--- SUMMARY ---');
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('Failures:');
  for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  process.exit(1);
}
process.exit(0);
