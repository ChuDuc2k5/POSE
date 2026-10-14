import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
const frontend = new URL('..', import.meta.url);
const backend = new URL('../../backend/', import.meta.url);
async function run(cwd, args, env) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Build failed (${code})`);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}
export async function startStack(port, providerEnv, options = {}) {
  const backendPort = options.backendPort ?? port + 2;
  const env = { ...process.env, REDIS_PORT: '6399', ...providerEnv, FRONTEND_URL: `http://localhost:${port}`, BACKEND_URL: `http://127.0.0.1:${backendPort}`, BACKEND_PORT: String(backendPort), NODE_ENV: 'production' };
  let api, app;
  try {
    if (options.build !== false) {
      await run(backend, ['node_modules/@nestjs/cli/bin/nest.js', 'build'], env);
      await run(frontend, ['node_modules/next/dist/bin/next', 'build'], { ...env, BACKEND_URL: options.buildBackendUrl ?? env.BACKEND_URL });
    }
    api = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    let output = '';
    for (const stream of [api.stdout,api.stderr]) stream.on('data', chunk => { output += chunk; });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (api.exitCode !== null) break;
      try { if ((await fetch(`${env.BACKEND_URL}/api/health`)).ok) { ready = true; break; } } catch {}
      await delay(100);
    }
    if (!ready) throw new Error(`Backend did not start: ${output}`);
    const args = options.standalone ? ['.next/standalone/frontend/server.js'] : ['node_modules/next/dist/bin/next','start','--port',String(port)];
    app = spawn(process.execPath, args, { cwd: frontend, env: { ...env, PORT: String(port), HOSTNAME: '127.0.0.1' }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    return { app, close: async () => { await stop(app); await stop(api); } };
  } catch (error) { await stop(app); await stop(api); throw error; }
}
