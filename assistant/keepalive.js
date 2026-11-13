// Touches Blackboard so its 3-hour idle timeout never fires, then saves the
// refreshed cookies (Blackboard rewrites its session cookie on every request).
// Usage: node keepalive.js   (exit code 2 = signed out)
import { request } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { autoLogin } from './autologin.js';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
const statePath = fileURLToPath(new URL('./auth/state.json', import.meta.url));

async function check() {
  const api = await request.newContext({ storageState: statePath, baseURL: config.blackboardUrl });
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await api.get('/learn/api/public/v1/users/me', { headers: { Accept: 'application/json' } });
      break;
    } catch (e) {
      if (attempt >= 4) throw new Error(String(e.message).split('\n')[0]);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
  console.log(`blackboard ${res.status()}`);
  const ok = res.ok();
  if (ok) await api.storageState({ path: statePath });
  await api.dispose();
  return ok;
}

if (!(await check())) {
  // Session expired: sign in again with the stored credentials (BB_USER / BB_PASS secrets).
  if (!process.env.BB_USER || !process.env.BB_PASS) process.exit(2);
  console.log('session expired, signing in again');
  try {
    execSync('npx playwright install --with-deps chromium', { stdio: 'ignore' });
    await autoLogin({ statePath, blackboardUrl: config.blackboardUrl, timezone: config.timezone });
  } catch (e) {
    console.log(`auto login failed: ${String(e.message).split('\n')[0]}`);
    process.exit(2);
  }
  if (!(await check())) process.exit(2);
  console.log('auto login ok');
}
