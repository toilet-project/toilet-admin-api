// Owns and stops only its disposable synthetic H2 server and browser test process.
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const java = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java.exe') : 'java';
const children = new Set();
const stop = () => { for (const child of children) if (child.exitCode === null) child.kill(); };
process.on('exit', stop); process.on('SIGTERM', () => { stop(); process.exit(1); });
const timer = setTimeout(() => { stop(); process.exit(1); }, 120000);
const launch = (command, args, env = process.env) => {
  const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child); child.on('exit', () => children.delete(child)); return child;
};
(async () => {
  const server = launch(java, ['-Xmx192m', '-Duser.timezone=UTC', '-cp', readFileSync(resolve(root, 'build/analytics-preview-classpath.txt'), 'utf8').trim(), 'com.example.toiletadmin.analytics.service.AnalyticsPreviewServer', '8191', '120']);
  await new Promise((done, fail) => {
    server.stdout.on('data', data => { if (String(data).includes('SYNTHETIC_PREVIEW_READY')) done(); });
    server.stderr.on('data', data => process.stderr.write(data));
    server.on('error', fail); server.on('exit', code => fail(new Error('Synthetic server exited: ' + code)));
  });
  const test = launch(process.execPath, [resolve(__dirname, 'analytics-explorer-browser.cjs')], { ...process.env, ANALYTICS_PREVIEW_ORIGIN: 'http://127.0.0.1:8191' });
  test.stdout.pipe(process.stdout); test.stderr.pipe(process.stderr);
  process.exitCode = await new Promise((done, fail) => { test.on('error', fail); test.on('exit', done); });
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => { clearTimeout(timer); stop(); });
