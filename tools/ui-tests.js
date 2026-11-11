// Runs the browser tests in tests/ui against the dev server, using playwright-cli
// (npm install -g @playwright/cli). Pictures the tests save land in tests/ui/out.
//   npm run test:ui                  every test
//   npm run test:ui -- own shadow    only those
//   npm run test:ui -- perf          speed with six lights (prints timings)
//   npm run test:ui -- --record      re-record tests/ui/reference.json
// Record only after a change that is meant to alter the pictures: the tests
// check that presets still match that file.

const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const UI = path.resolve(__dirname, '..', 'tests', 'ui');
const OUT = path.join(UI, 'out');
const URL = 'http://127.0.0.1:5177/';
const ALL = ['flow', 'multi', 'spread', 'layout', 'front', 'shadow', 'toggle', 'own'];

const args = process.argv.slice(2);
const record = args.includes('--record');
const chosen = args.filter((arg) => !arg.startsWith('--'));

const cli = (command) => execSync(`playwright-cli ${command}`, { cwd: OUT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// run-code --raw prints the script's return value, a JSON string, as JSON.
const run = (name) => JSON.parse(JSON.parse(cli(`--raw run-code --filename="${path.join(UI, `${name}.js`)}"`)));

function waitForServer(tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      http
        .get(URL, (response) => {
          response.resume();
          resolve();
        })
        .on('error', () => {
          if (left) setTimeout(() => attempt(left - 1), 100);
          else reject(new Error(`dev server did not answer at ${URL}`));
        });
    };
    attempt(tries);
  });
}

function report(name, result) {
  if (!result.summary) {
    console.log(`${name}: ${JSON.stringify(result)}`);
    return true;
  }
  const failed = result.failed || Object.entries(result).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  const errors = result.errors || [];
  console.log(`${name.padEnd(7)} ${result.summary}${errors.length ? `, ${errors.length} page errors` : ''}`);
  for (const [check, detail] of failed) console.log(`  ${check}: ${detail}`);
  for (const error of errors) console.log(`  ${error}`);
  return !failed.length && !errors.length;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // If a dev server is already running, this one exits and the tests use that.
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'ignore' });
  let ok = true;
  try {
    await waitForServer();
    cli(`open ${URL}`);
    if (record) {
      cli('resize 1040 660');
      const data = run('record');
      fs.writeFileSync(path.join(UI, 'reference.json'), `${JSON.stringify(data)}\n`);
      console.log(`recorded ${Object.keys(data.presets).length} presets and the shadow scene`);
      return;
    }
    for (const name of chosen.length ? chosen : ALL) {
      cli('resize 1040 660');
      ok = report(name, run(name)) && ok;
    }
  } finally {
    try {
      cli('close');
    } catch {
      // The browser may never have opened.
    }
    server.kill();
  }
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
