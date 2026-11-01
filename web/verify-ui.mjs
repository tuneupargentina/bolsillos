import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8080/';
const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 220) : ''}`);
}

async function closeWalletModal(page) {
  // Wallet Selector modal-ui: hide via DOM / Escape / close button
  await page.evaluate(() => {
    const root = document.getElementById('near-wallet-selector-modal');
    if (root) {
      root.style.display = 'none';
      root.classList.remove('open');
      const overlay = root.querySelector('.nws-modal-overlay');
      if (overlay) overlay.click();
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
ok('no pageerror (Buffer/handlers)', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
ok(
  'no severe console errors',
  !consoleErrors.some((e) => /Cannot read|is not defined|Failed to fetch dynamically/i.test(e)),
  consoleErrors.slice(0, 3).join(' | ') || 'none',
);

const fav = await page.evaluate(async () => {
  const r = await fetch('./favicon.svg');
  return { status: r.status, type: r.headers.get('content-type') };
});
ok('favicon 200', fav.status === 200, JSON.stringify(fav));

await page.locator('#btn-connect').click();
await page.waitForTimeout(1500);
const modalVisible = await page.locator('#near-wallet-selector-modal .nws-modal').isVisible().catch(() => false);
const modalHtml = await page.evaluate(() => {
  const el = document.querySelector('#near-wallet-selector-modal') || document.querySelector('.nws-modal');
  return el ? el.innerText.slice(0, 800) : '';
});
const hasMNW = /MyNearWallet|My Near Wallet|mynearwallet/i.test(modalHtml);
const hasMeteor = /Meteor/i.test(modalHtml);
const hasHere = /HERE|Here Wallet/i.test(modalHtml);
ok('connect opens wallet modal', modalVisible || hasMNW, `visible=${modalVisible}; ${modalHtml.slice(0, 160)}`);
ok('modal lists MyNearWallet', hasMNW, modalHtml.slice(0, 220));
ok('modal lists Meteor', hasMeteor);
ok('modal lists HERE', hasHere);

await closeWalletModal(page);

// Disconnected action feedback (may reopen modal via tryOpenConnect — that is intentional UX)
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
const afterTag = await page.locator('[data-i18n="tagline"]').textContent();
ok(
  'lang toggle flips label',
  beforeBtn.trim() !== afterBtn.trim() && /EN|ES/.test(afterBtn),
  `${beforeBtn} → ${afterBtn}`,
);
ok(
  'ES changes headings/buttons',
  beforeH2 !== afterH2 || /Hogar|Conectar|billetera|bolsillo/i.test(afterH2 + afterConnect + afterTag),
  `h2: ${beforeH2} → ${afterH2}; connect: ${afterConnect}; tag: ${afterTag?.slice(0, 60)}`,
);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const persisted = await page.locator('#lang-toggle').textContent();
const persistedH2 = await page.locator('h2[data-i18n="household"]').textContent();
const persistedTag = await page.locator('[data-i18n="tagline"]').textContent();
ok(
  'lang persisted after reload',
  /EN/.test(persisted) && /Hogar|bolsillo|billetera/i.test(persistedH2 + persistedTag),
  `toggle=${persisted} h2=${persistedH2}`,
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
