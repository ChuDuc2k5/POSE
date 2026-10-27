// Shared lifecycle helpers for the M07 HTTP/UI scripts; not a standalone test.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
export async function stopProcess(child, { graceful = false, tree = false } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const killTree = () =>
    new Promise((resolve) => {
      const kill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      kill.once('error', resolve);
      kill.once('exit', resolve);
    });
  if (tree && process.platform === 'win32') await killTree();
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (graceful && child.connected) child.send('stop');
  else child.kill('SIGTERM');
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  if (process.platform === 'win32') await killTree();
  else child.kill('SIGKILL');
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  throw Error(`Test process ${child.pid} did not stop.`);
}
