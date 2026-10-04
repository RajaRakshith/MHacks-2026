// Load watchdog-bridge/.env first, then the repo-root .env (shared with spacetimedb/ and worker/).
// Values already set win, so the bridge's own .env overrides the root one.
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

for (const rel of ['../.env', '../../.env']) {
  dotenv.config({ path: fileURLToPath(new URL(rel, import.meta.url)), quiet: true });
}
