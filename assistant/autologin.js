// Headless sign-in with BB_USER / BB_PASS (GitHub secrets). Used by keepalive.js when the saved
// session has expired. Signs in to Blackboard, then Outlook, and saves the cookies to statePath.
// Only the host/step is ever logged — never page content, URLs with tokens, or credentials.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const MS_HOST = /login\.(microsoftonline|live)\.com|login\.microsoft\.com/;

async function visible(page, sel) {
  return page.locator(sel).first().isVisible().catch(() => false);
}

// One step of whatever login page we're on. Returns a short label, or null if nothing matched.
async function step(page, user, pass) {
  const host = new URL(page.url()).host;
  if (MS_HOST.test(host)) {
    if (await visible(page, 'input[name="passwd"]')) {
      await page.fill('input[name="passwd"]', pass);
      await page.click('#idSIButton9');
      return 'ms-password';
    }
    if (await visible(page, 'input[name="loginfmt"]')) {
      await page.fill('input[name="loginfmt"]', user);
      await page.click('#idSIButton9');
      return 'ms-email';
    }
    if (await visible(page, '#KmsiCheckboxField, #KmsiDescription')) {
      await page.check('#KmsiCheckboxField').catch(() => {});
      await page.click('#idSIButton9'); // "Stay signed in? Yes"
      return 'ms-stay';
    }
    const tile = page.locator(`[data-test-id="${user}"], div[role="button"]:has-text("${user}")`).first();
    if (await tile.isVisible().catch(() => false)) { await tile.click(); return 'ms-tile'; }
    return null;
  }
  // Blackboard's own login form
  if (await visible(page, '#user_id') && await visible(page, '#password')) {
    await page.fill('#user_id', user);
    await page.fill('#password', pass);
    await page.click('#entry-login, input[type="submit"], button[type="submit"]');
    return 'bb-form';
  }
  // Landing page offering SSO
  const sso = page.getByRole('link', { name: /microsoft|office ?365|sso|single sign|stamford|sign in|log ?in/i }).first();
  if (await sso.isVisible().catch(() => false)) { await sso.click(); return 'sso-link'; }
  return null;
}

async function signIn(page, url, isDone, user, pass, label) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 12; i++) {
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    if (await isDone(page)) return;
    const did = await step(page, user, pass);
    console.log(`autologin ${label}: step ${i + 1} ${did ?? 'waiting'} @ ${new URL(page.url()).host}`);
    await page.waitForTimeout(did ? 2500 : 4000);
  }
  if (!(await isDone(page))) throw new Error(`${label} login did not complete (stopped at ${new URL(page.url()).host})`);
}

export async function autoLogin({ statePath, blackboardUrl, timezone }) {
  const user = process.env.BB_USER, pass = process.env.BB_PASS;
  if (!user || !pass) throw new Error('BB_USER / BB_PASS not set');
  const browser = await chromium.launch({ headless: true });
  try {
    // Start from the old cookies if present (may already hold Microsoft SSO), otherwise fresh.
    const context = await browser.newContext({
      ...(existsSync(statePath) ? { storageState: statePath } : {}),
      locale: 'en-US', timezoneId: timezone,
    });
    const page = await context.newPage();
    const bbHost = new URL(blackboardUrl).host;
    await signIn(page, blackboardUrl, async p => {
      if (new URL(p.url()).host !== bbHost) return false;
      const r = await context.request.get(blackboardUrl.replace(/\/+$/, '') + '/learn/api/public/v1/users/me',
        { headers: { Accept: 'application/json' } }).catch(() => null);
      return !!r && r.ok();
    }, user, pass, 'blackboard');
    // Outlook is best-effort: a failure here must not lose a good Blackboard session.
    try {
      await signIn(page, 'https://outlook.office.com/mail/',
        async p => /outlook\.(office|office365|live)\.com$/.test(new URL(p.url()).host) && /\/mail\//.test(p.url()) &&
          await visible(p, '[role="tree"], [aria-label*="Message list" i], div[role="listbox"]'),
        user, pass, 'outlook');
    } catch (e) { console.log(`autologin outlook: ${String(e.message).split('\n')[0]}`); }
    await context.storageState({ path: statePath });
  } finally {
    await browser.close();
  }
}
