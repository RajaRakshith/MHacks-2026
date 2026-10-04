// Stable ngrok tunnel for the Twilio webhook.
// Claim a free static domain once: https://dashboard.ngrok.com/domains
// Then set NGROK_DOMAIN=your-name.ngrok-free.app in the repo-root .env
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const domain = (process.env.NGROK_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
if (!domain) {
  console.error(`Set NGROK_DOMAIN in ${envPath}
Claim a free static domain at https://dashboard.ngrok.com/domains
Example: NGROK_DOMAIN=watchdog-demo.ngrok-free.app`);
  process.exit(1);
}

const port = process.env.PORT || '8080';
const url = `https://${domain}`;
console.log(`Twilio voice webhook (leave this in the console permanently):
  ${url}/twilio/voice?userId=${process.env.DEFAULT_USER_ID || 'demo-user'}
`);
const child = spawn('ngrok', ['http', '--url', url, port], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
