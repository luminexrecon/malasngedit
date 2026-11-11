// Request/response protocol between the UXP host and the WebView.
//
// WebView postMessage JSON-serialises every message and cannot transfer
// ArrayBuffers, so binary payloads travel as acknowledged base64 chunks ahead of
// the envelope that references them. Loaded by both sides: `require` in UXP and
// a classic <script> in the WebView.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Wire = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // A multiple of 3, so only the final chunk of a payload can carry padding.
  const CHUNK_SIZE = 3 * 1024 * 1024;

  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const PAD = 61;
  const ENC = new Uint8Array(64);
  const DEC = new Uint8Array(256);
  for (let i = 0; i < 64; i += 1) {
    ENC[i] = CHARS.charCodeAt(i);
    DEC[ENC[i]] = i;
  }

  function asciiToString(codes) {
    const STEP = 0x8000;
    const parts = [];
    for (let i = 0; i < codes.length; i += STEP) {
      parts.push(String.fromCharCode.apply(null, codes.subarray(i, i + STEP)));
    }
    return parts.join('');
  }

  function encode(bytes) {
    const n = bytes.length;
    const out = new Uint8Array(Math.ceil(n / 3) * 4);
    let o = 0;
    let i = 0;
    for (; i + 2 < n; i += 3) {
      const t = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out[o++] = ENC[t >> 18];
      out[o++] = ENC[(t >> 12) & 63];
      out[o++] = ENC[(t >> 6) & 63];
      out[o++] = ENC[t & 63];
    }
    if (n - i === 1) {
      const t = bytes[i] << 16;
      out[o++] = ENC[t >> 18];
      out[o++] = ENC[(t >> 12) & 63];
      out[o++] = PAD;
      out[o++] = PAD;
    } else if (n - i === 2) {
      const t = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out[o++] = ENC[t >> 18];
      out[o++] = ENC[(t >> 12) & 63];
      out[o++] = ENC[(t >> 6) & 63];
      out[o++] = PAD;
    }
    return asciiToString(out);
  }

  // Returns the number of decoded bytes. Writes past the end of `target` from a
  // padded final group are dropped by the typed array.
  function decodeInto(text, target, offset) {
    const n = text.length;
    if (n === 0) return 0;
    let pad = 0;
    if (text.charCodeAt(n - 1) === PAD) pad += 1;
    if (text.charCodeAt(n - 2) === PAD) pad += 1;
    let o = offset;
    for (let i = 0; i < n; i += 4) {
      const t =
        (DEC[text.charCodeAt(i)] << 18) |
        (DEC[text.charCodeAt(i + 1)] << 12) |
        (DEC[text.charCodeAt(i + 2)] << 6) |
        DEC[text.charCodeAt(i + 3)];
      target[o++] = (t >> 16) & 255;
      target[o++] = (t >> 8) & 255;
      target[o++] = t & 255;
    }
    return (n / 4) * 3 - pad;
  }

  function createPeer({ post, methods = {}, onProgress = () => {} }) {
    let nextCall = 1;
    let nextTransfer = 1;
    const calls = new Map();
    const acks = new Map();
    const inbound = new Map();

    async function sendBinary(bytes) {
      const tid = String(nextTransfer++);
      const total = bytes.length;
      const count = Math.max(1, Math.ceil(total / CHUNK_SIZE));
      for (let seq = 0; seq < count; seq += 1) {
        const start = seq * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, total);
        const acked = new Promise((resolve) => acks.set(`${tid}:${seq}`, resolve));
        post({ t: 'chunk', tid, seq, total, d: encode(bytes.subarray(start, end)) });
        await acked;
        onProgress({ direction: 'send', done: end, total });
      }
      return tid;
    }

    async function sendEnvelope(envelope, bin) {
      const refs = {};
      for (const name of Object.keys(bin || {})) refs[name] = await sendBinary(bin[name]);
      post(Object.assign({}, envelope, { bin: refs }));
    }

    function collectBinaries(refs) {
      const bin = {};
      for (const name of Object.keys(refs || {})) {
        const entry = inbound.get(refs[name]);
        if (!entry) throw new Error(`Binary "${name}" never arrived.`);
        inbound.delete(refs[name]);
        bin[name] = entry.bytes;
      }
      return bin;
    }

    async function handleRequest(message) {
      try {
        const handler = methods[message.method];
        if (!handler) throw new Error(`Unknown method: ${message.method}`);
        const reply = (await handler(message.params, collectBinaries(message.bin))) || {};
        await sendEnvelope({ t: 'res', id: message.id, ok: true, result: reply.result }, reply.bin);
      } catch (error) {
        post({ t: 'res', id: message.id, ok: false, error: (error && error.message) || String(error) });
      }
    }

    function receive(message) {
      if (!message || typeof message.t !== 'string') return;
      if (message.t === 'chunk') {
        let entry = inbound.get(message.tid);
        if (!entry) {
          entry = { bytes: new Uint8Array(message.total), received: 0 };
          inbound.set(message.tid, entry);
        }
        entry.received += decodeInto(message.d, entry.bytes, entry.received);
        onProgress({ direction: 'receive', done: entry.received, total: message.total });
        post({ t: 'ack', tid: message.tid, seq: message.seq });
      } else if (message.t === 'ack') {
        const key = `${message.tid}:${message.seq}`;
        const resolve = acks.get(key);
        if (resolve) {
          acks.delete(key);
          resolve();
        }
      } else if (message.t === 'req') {
        handleRequest(message);
      } else if (message.t === 'res') {
        const call = calls.get(message.id);
        if (!call) return;
        calls.delete(message.id);
        if (!message.ok) call.reject(new Error(message.error));
        else call.resolve({ result: message.result, bin: collectBinaries(message.bin) });
      }
    }

    function call(method, params, bin) {
      const id = nextCall++;
      return new Promise((resolve, reject) => {
        calls.set(id, { resolve, reject });
        sendEnvelope({ t: 'req', id, method, params }, bin).catch(reject);
      });
    }

    return { call, receive };
  }

  return { createPeer, encode, decodeInto, CHUNK_SIZE };
});
