// One-time login: opens a real browser window, you sign in, cookies are saved.
// Usage: node login.js
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync } from 'node:fs';
import readline from 'node:readline/promises';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
mkdirSync(new URL('./auth/', import.meta.url), { recursive: true });
const statePath = fileURLToPath(new URL('./auth/state.json', import.meta.url));

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: 'en-US', timezoneId: config.timezone });
const bb = await context.newPage();
// Sign in to Blackboard through Office 365 so the daily run can renew the session itself.
await bb.goto(`${config.blackboardUrl}${config.blackboardSsoPath}&redirectUrl=${encodeURIComponent(config.blackboardUrl + '/ultra/course')}`);
const mail = await context.newPage();
await mail.goto('https://outlook.office.com/mail/');

console.log('\nSign in to Blackboard AND Outlook in the browser window.');
console.log('Tick "Stay signed in" if Microsoft asks.');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('When both tabs show your courses / inbox, press Enter here... ');
rl.close();

await context.storageState({ path: statePath });
console.log(`Saved session to ${statePath}`);
await browser.close();
