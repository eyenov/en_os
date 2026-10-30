/**
 * Launcher that makes Node's built-in fetch honour an HTTP(S) proxy.
 *
 * Node 24 reads HTTP_PROXY / HTTPS_PROXY when NODE_USE_ENV_PROXY=1 is present.
 * npm scripts cannot set that per-command in a portable way, so this wrapper
 * decides from the environment and spawns server.mjs with the right env.
 *
 *   YOUTUBE_PROXY=http://127.0.0.1:13480 npm start
 *   HTTPS_PROXY=http://127.0.0.1:13480 npm start
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let proxy = String(process.env.YOUTUBE_PROXY || process.env.HTTPS_PROXY || '').trim();
const configPath = path.join(ROOT, 'proxy.config.json');
if (!proxy && existsSync(configPath)) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    proxy = String(config.proxy || config.httpsProxy || '').trim();
  } catch {
    console.warn('[proxy] 忽略无法解析的 proxy.config.json');
  }
}
const nodeMajor = Number(process.versions.node.split('.')[0]);
const env = { ...process.env };

if (proxy) {
  env.HTTPS_PROXY = proxy;
  env.HTTP_PROXY = proxy;
  env.YOUTUBE_PROXY = proxy;
  if (!env.NO_PROXY) env.NO_PROXY = 'localhost,127.0.0.1,::1';
  // Node 24+ supports proxy-aware global fetch through this env switch.
  env.NODE_USE_ENV_PROXY = '1';
  console.log(`[proxy] outbound requests via ${proxy.replace(/\/\/[^@/]+@/, '//***@')}`);
  if (nodeMajor < 24) {
    console.warn('[proxy] 内置 fetch 的代理支持需要 Node 24+；当前版本可能不会走代理。');
  }
}

const child = spawn(process.execPath, ['server/server.mjs'], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
