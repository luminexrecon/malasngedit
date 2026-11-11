const test = require('node:test');
const assert = require('node:assert/strict');
const Wire = require('../plugin/ui/js/wire.js');

// Connects two peers through a JSON round trip, like the real WebView channel.
function pair(methods) {
  let a;
  let b;
  const link = (getTarget) => (message) => {
    const copy = JSON.parse(JSON.stringify(message));
    setImmediate(() => getTarget().receive(copy));
  };
  a = Wire.createPeer({ post: link(() => b) });
  b = Wire.createPeer({ post: link(() => a), methods });
  return a;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  let x = 123456789;
  for (let i = 0; i < length; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    bytes[i] = x & 255;
  }
  return bytes;
}

test('base64 matches the standard encoding at every padding length', () => {
  for (let length = 0; length <= 7; length += 1) {
    const bytes = randomBytes(length);
    assert.equal(Wire.encode(bytes), Buffer.from(bytes).toString('base64'));
  }
});

test('decodeInto reverses encode', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 1000, 1001, 1002]) {
    const bytes = randomBytes(length);
    const out = new Uint8Array(length);
    const written = Wire.decodeInto(Wire.encode(bytes), out, 0);
    assert.equal(written, length);
    assert.deepEqual(out, bytes);
  }
});

const SIZES = {
  empty: 0,
  'one byte': 1,
  'one below a chunk': Wire.CHUNK_SIZE - 1,
  'exactly one chunk': Wire.CHUNK_SIZE,
  'one above a chunk': Wire.CHUNK_SIZE + 1,
  'two and a half chunks': Math.floor(Wire.CHUNK_SIZE * 2.5) + 2,
};

for (const [label, size] of Object.entries(SIZES)) {
  test(`binary payload survives both directions: ${label}`, async () => {
    const peer = pair({
      echo: async (params, bin) => ({ result: { seen: bin.data.length }, bin: { data: bin.data } }),
    });
    const bytes = randomBytes(size);
    const { result, bin } = await peer.call('echo', {}, { data: bytes });
    assert.equal(result.seen, size);
    assert.deepEqual(bin.data, bytes);
  });
}

test('several binaries in one message stay separate', async () => {
  const peer = pair({
    two: async (params, bin) => ({ bin: { first: bin.b, second: bin.a } }),
  });
  const a = randomBytes(10);
  const b = randomBytes(Wire.CHUNK_SIZE + 5);
  const { bin } = await peer.call('two', {}, { a, b });
  assert.deepEqual(bin.first, b);
  assert.deepEqual(bin.second, a);
});

test('handler errors reject the call with their message', async () => {
  const peer = pair({
    boom: async () => {
      throw new Error('kaboom');
    },
  });
  await assert.rejects(peer.call('boom'), /kaboom/);
});

test('unknown methods reject', async () => {
  await assert.rejects(pair({}).call('nope'), /Unknown method/);
});
