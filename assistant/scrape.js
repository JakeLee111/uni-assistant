// Reads Blackboard + Outlook with the saved session and writes ../data/latest.json.
// Session comes from auth/state.json, or from env AUTH_STATE_B64 (cloud).
// Usage: node scrape.js
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
const BB = config.blackboardUrl.replace(/\/+$/, '');
const statePath = fileURLToPath(new URL('./auth/state.json', import.meta.url));
const outDir = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(outDir, { recursive: true });

function loadState() {
  if (process.env.AUTH_STATE_B64) return JSON.parse(Buffer.from(process.env.AUTH_STATE_B64, 'base64').toString());
  if (existsSync(statePath)) return JSON.parse(readFileSync(statePath));
  return null;
}

const result = { scrapedAt: new Date().toISOString(), signedOut: [], errors: [], blackboard: {}, outlook: {} };
const state = loadState();
if (!state) {
  result.signedOut.push('blackboard', 'outlook');
  finish();
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: state, locale: 'en-US', timezoneId: config.timezone });

await scrapeBlackboard().catch(e => result.errors.push(`blackboard: ${oneLine(e)}`));
await scrapeOutlook().catch(e => result.errors.push(`outlook: ${oneLine(e)}`));
// Keep the refreshed cookies for the next local run.
if (!process.env.AUTH_STATE_B64) await context.storageState({ path: statePath });
await browser.close();
finish();

// Error messages can include request headers (cookies) — keep only the first line.
function oneLine(e) { return String(e.message).split('\n')[0]; }

function finish() {
  writeFileSync(outDir + 'latest.json', JSON.stringify(result, null, 2));
  console.log(`signedOut=${JSON.stringify(result.signedOut)} errors=${result.errors.length}`);
  process.exit(0);
}

// Blackboard's own REST API, called with the browser's session cookies.
async function bbGet(path) {
  let res;
  // Retry network hiccups (DNS, resets) a few times before giving up.
  for (let attempt = 1; ; attempt++) {
    try {
      res = await context.request.get(BB + path, { headers: { Accept: 'application/json' } });
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
  if (res.status() === 401 || res.status() === 403) throw Object.assign(new Error(`auth ${res.status()} ${path}`), { auth: true });
  if (!res.ok()) throw new Error(`${res.status()} ${path}`);
  return res.json();
}

async function bbAll(path) {
  const items = [];
  let next = path;
  while (next && items.length < 500) {
    const page = await bbGet(next);
    items.push(...(page.results ?? []));
    next = page.paging?.nextPage;
  }
  return items;
}

async function scrapeBlackboard() {
  let me;
  try {
    me = await bbGet('/learn/api/public/v1/users/me').catch(async e => {
      if (!e.auth) throw e;
      await renewBlackboardSession();
      return bbGet('/learn/api/public/v1/users/me');
    });
  } catch (e) {
    if (e.auth) { result.signedOut.push('blackboard'); return; }
    throw e;
  }
  const memberships = await bbAll(`/learn/api/public/v1/users/${me.id}/courses?expand=course&limit=100`);
  const now = Date.now();
  // Course IDs start with "<year>_<term>_", e.g. 2026_2_CSC353_... — keep only the latest term.
  const all = memberships.map(m => m.course).filter(c => c && c.availability?.available !== 'No');
  const termOf = c => (c.courseId.match(/^(\d{4})_(\d)_/) ?? []).slice(1).join('_');
  const latestTerm = all.map(termOf).filter(Boolean).sort().at(-1);
  const courses = all.filter(c => termOf(c) === latestTerm);
  result.blackboard.term = latestTerm;


  result.blackboard.courses = [];
  for (const c of courses) {
    const course = { id: c.id, courseId: c.courseId, name: c.name };
    course.announcements = (await bbAll(`/learn/api/public/v1/courses/${c.id}/announcements?limit=50`)
      .catch(e => (result.errors.push(`${c.courseId} announcements: ${oneLine(e)}`), [])))
      .map(a => ({ title: a.title, body: strip(a.body), created: a.created, modified: a.modified }))
      .filter(a => Date.parse(a.modified ?? a.created) > now - 30 * 864e5);
    course.gradeColumns = (await bbAll(`/learn/api/public/v2/courses/${c.id}/gradebook/columns?limit=200`)
      .catch(e => (result.errors.push(`${c.courseId} columns: ${oneLine(e)}`), [])))
      .map(g => ({ name: g.name, due: g.grading?.due, created: g.created, pointsPossible: g.score?.possible, contentId: g.contentId }));
    course.contents = await bbAll(`/learn/api/public/v1/courses/${c.id}/contents?recursive=true&limit=200`)
      .then(items => items.map(i => ({ title: i.title, type: i.contentHandler?.id, created: i.created, modified: i.modified })))
      .catch(e => (result.errors.push(`${c.courseId} contents: ${oneLine(e)}`), []));
    result.blackboard.courses.push(course);
  }
}

// Blackboard sessions expire after ~3h idle. Opening Blackboard in the browser
// re-runs the Microsoft single sign-on using the saved Microsoft cookies.
async function renewBlackboardSession() {
  const page = await context.newPage();
  const back = encodeURIComponent(BB + '/ultra/course');
  await page.goto(`${BB}${config.blackboardSsoPath}&redirectUrl=${back}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 20 && !page.url().startsWith(BB + '/ultra'); i++) await page.waitForTimeout(3000);
  await page.close();
}

// Outlook web: read the inbox list (sender, subject, preview, time).
async function scrapeOutlook() {
  const page = await context.newPage();
  await page.goto('https://outlook.office.com/mail/inbox', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  if (/login\.microsoftonline|login\.live/.test(page.url())) { result.signedOut.push('outlook'); return; }
  const rows = page.locator('[role="listbox"] [role="option"]');
  await rows.first().waitFor({ timeout: 30000 });
  // The list is virtualized: scroll it and collect rows as they render.
  const seen = new Map();
  const box = await page.locator('[role="listbox"]').first().boundingBox();
  for (let i = 0; i < 12 && seen.size < 80; i++) {
    for (const r of await rows.evaluateAll(els => els.map(el => ({
      label: el.getAttribute('aria-label'),
      text: el.innerText.replace(/\s+\n/g, '\n').trim(),
    })))) seen.set(r.label, r);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1200);
  }
  result.outlook.inbox = [...seen.values()];
}

function strip(html = '') {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
}
