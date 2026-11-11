// Builds the release from dev/: release/plugin, a clean copy for Photoshop;
// release/<name>-<label>.ccx, which testers install by double-click; and
// release/<name>-<label>.zip, the file to upload to the GitHub Releases page.
// release/ is output only: change dev/ and run `npm run release` again.
// The label and identity come from dev/release.json.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DEV = path.resolve(__dirname, '..');
const SOURCE = path.join(DEV, 'plugin');
const RELEASE = path.resolve(DEV, '..', 'release');
const TARGET = path.join(RELEASE, 'plugin');
const INSPECTOR = ' uxpAllowInspector="true"';

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

// Testers see verXX.YYYY. The manifest only takes numbers, so it gets YY.XX.0:
// year first, then the release number, which keeps every later release higher
// (ver02.2026 above ver01.2026, ver01.2027 above ver15.2026).
function manifestVersion(label) {
  const match = /^ver(\d{2})\.(20\d{2})$/.exec(label);
  if (!match) fail(`"release" in release.json must look like ver01.2026, not "${label}".`);
  const number = Number(match[1]);
  if (number < 1) fail('the release number starts at 01.');
  return `${Number(match[2]) - 2000}.${number}.0`;
}

function listFiles(dir, prefix = '') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full, relative) : [{ relative, full }];
    });
}

// Builds a zip from { relative, data } entries. A .ccx is such a zip with
// manifest.json at its root. Entries use forward slashes and a fixed date, so
// the same source always produces the same file.
function zip(files) {
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const { relative, data } of files) {
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const name = Buffer.from(relative, 'utf8');
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    parts.push(local, name, body);
    directory.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}

if (typeof zlib.crc32 !== 'function') fail('needs Node 20.15 or newer.');

const config = JSON.parse(fs.readFileSync(path.join(DEV, 'release.json'), 'utf8'));
for (const key of ['name', 'id', 'release']) {
  if (typeof config[key] !== 'string' || !config[key]) fail(`release.json needs "${key}".`);
}
const version = manifestVersion(config.release);

// 1. Clean copy. Only release/plugin is replaced; anything else in release/
// (a README, a .git folder) is left alone.
fs.rmSync(TARGET, { recursive: true, force: true });
fs.cpSync(SOURCE, TARGET, { recursive: true });

// 2. Identity. The release id differs from dev's, so both can be installed at once.
const manifestPath = path.join(TARGET, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
// Creative Cloud rejects a .ccx whose host is a list.
if (Array.isArray(manifest.host)) fail('manifest.json "host" must be one object, not a list.');
manifest.id = config.id;
manifest.name = config.name;
manifest.version = version;
for (const entry of manifest.entrypoints) entry.label = { default: config.name };
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// 3. Testers get no DevTools inspector.
const hostPage = path.join(TARGET, 'index.html');
const html = fs.readFileSync(hostPage, 'utf8');
if (!html.includes(INSPECTOR)) fail('plugin/index.html no longer has the inspector attribute; update tools/release.js.');
fs.writeFileSync(hostPage, html.replace(INSPECTOR, ''));

// 4. The .ccx testers double-click.
const files = listFiles(TARGET).map(({ relative, full }) => ({ relative, data: fs.readFileSync(full) }));
const ccxName = `${config.name}-${config.release}.ccx`;
const ccxPath = path.join(RELEASE, ccxName);
const ccx = zip(files);
fs.writeFileSync(ccxPath, ccx);

// 5. The zip for the GitHub Releases page: the .ccx, the same plugin unpacked
// (for UXP Developer Tool if the .ccx will not install), and install notes.
const notes = fs
  .readFileSync(path.join(__dirname, 'CARA-INSTAL.txt'), 'utf8')
  .replaceAll('{{name}}', config.name)
  .replaceAll('{{label}}', config.release)
  .replaceAll('{{ccx}}', ccxName);
const bundlePath = path.join(RELEASE, `${config.name}-${config.release}.zip`);
const bundle = zip([
  { relative: ccxName, data: ccx },
  { relative: 'CARA-INSTAL.txt', data: Buffer.from(notes, 'utf8') },
  ...files.map(({ relative, data }) => ({ relative: `plugin/${relative}`, data })),
]);
fs.writeFileSync(bundlePath, bundle);

const shown = (file) => path.relative(path.dirname(DEV), file);
console.log(`${config.name} ${config.release} (manifest version ${version}, id ${config.id})`);
console.log(`  ${shown(TARGET)}  ${files.length} files`);
console.log(`  ${shown(ccxPath)}  ${(ccx.length / 1024).toFixed(1)} KB`);
console.log(`  ${shown(bundlePath)}  ${(bundle.length / 1024).toFixed(1)} KB, for the Releases page`);
