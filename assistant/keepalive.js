// Touches Blackboard so its 3-hour idle timeout never fires, then saves the
// refreshed cookies (Blackboard rewrites its session cookie on every request).
// Usage: node keepalive.js   (exit code 2 = signed out)
import { request } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
const statePath = fileURLToPath(new URL('./auth/state.json', import.meta.url));

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
if (!res.ok()) process.exit(2);
await api.storageState({ path: statePath });
await api.dispose();
