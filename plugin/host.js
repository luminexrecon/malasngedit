// UXP side of the plugin. Everything that touches Photoshop lives here; the
// WebView (ui/) owns rendering and never talks to Photoshop directly.

const { app, core, imaging, action, constants } = require('photoshop');
const uxp = require('uxp');
const Wire = require('./ui/js/wire.js');

const PREVIEW_EDGE = 1200;

const fs = uxp.storage.localFileSystem;
const { formats } = uxp.storage;
const USER_DATA_FILE = 'user-data.json';

// The full-resolution mask is kept here so Apply does not rerun Select Subject.
const cache = { docId: null, mask: null, colorProfile: undefined };

const modal = (commandName, fn) => core.executeAsModal(fn, { commandName });

function requireDoc(docId) {
  const doc = app.activeDocument;
  if (!doc) throw new Error('No document is open. Open one, then press Reload.');
  if (docId !== undefined && doc.id !== docId) {
    throw new Error('The active document changed. Press Reload to continue.');
  }
  return doc;
}

function assertSupported(doc) {
  if (doc.mode !== constants.DocumentMode.RGB) {
    throw new Error('Only RGB is supported. Use Image > Mode > RGB Color, then press Reload.');
  }
  if (doc.bitsPerChannel !== constants.BitsPerChannelType.EIGHT) {
    throw new Error('Only 8-bit is supported. Use Image > Mode > 8 Bits/Channel, then press Reload.');
  }
}

async function readComposite(doc, targetSize) {
  const options = { documentID: doc.id, colorSpace: 'RGB', componentSize: 8 };
  if (targetSize) options.targetSize = targetSize;
  const { imageData } = await imaging.getPixels(options);
  // Copied because the view returned by getData dies with dispose().
  const data = new Uint8Array(await imageData.getData({ chunky: true }));
  const image = {
    width: imageData.width,
    height: imageData.height,
    components: imageData.components,
    colorProfile: imageData.colorProfile,
    data,
  };
  imageData.dispose();
  return image;
}

function toRGBA(image) {
  if (image.components === 4) return image.data;
  const count = image.width * image.height;
  const out = new Uint8Array(count * 4);
  for (let i = 0, s = 0, d = 0; i < count; i += 1, s += 3, d += 4) {
    out[d] = image.data[s];
    out[d + 1] = image.data[s + 1];
    out[d + 2] = image.data[s + 2];
    out[d + 3] = 255;
  }
  return out;
}

function downscaleMask(mask, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return mask;
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y += 1) {
    const y0 = Math.floor((y * srcH) / dstH);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / dstH));
    for (let x = 0; x < dstW; x += 1) {
      const x0 = Math.floor((x * srcW) / dstW);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / dstW));
      let sum = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) sum += mask[sy * srcW + sx];
      }
      out[y * dstW + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

async function readSelectionMask(doc) {
  const width = doc.width;
  const height = doc.height;
  const { imageData, sourceBounds } = await imaging.getSelection({
    documentID: doc.id,
    sourceBounds: { left: 0, top: 0, right: width, bottom: height },
  });
  const region = await imageData.getData({ chunky: true });
  const regionW = imageData.width;
  const regionH = imageData.height;
  // The selection comes back cropped to its own bounds.
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < regionH; y += 1) {
    const start = y * regionW;
    mask.set(region.subarray(start, start + regionW), (y + sourceBounds.top) * width + sourceBounds.left);
  }
  imageData.dispose();
  return mask;
}

const methods = {
  async 'doc.snapshot'() {
    const doc = app.activeDocument;
    if (!doc) return { result: { noDocument: true } };
    assertSupported(doc);

    const scale = Math.min(1, PREVIEW_EDGE / Math.max(doc.width, doc.height));
    const targetSize =
      scale < 1
        ? { width: Math.round(doc.width * scale), height: Math.round(doc.height * scale) }
        : undefined;
    const image = await modal('Read image', () => readComposite(doc, targetSize));

    cache.docId = doc.id;
    cache.mask = null;
    cache.colorProfile = image.colorProfile;

    return {
      result: {
        docId: doc.id,
        title: doc.title,
        width: doc.width,
        height: doc.height,
        previewWidth: image.width,
        previewHeight: image.height,
      },
      bin: { pixels: toRGBA(image) },
    };
  },

  async 'doc.detectSubject'({ docId, previewWidth, previewHeight }) {
    const doc = requireDoc(docId);
    let mask = null;

    // Runs inside a suspended history state that is rolled back, so the user's
    // own selection and history are left exactly as they were.
    await modal('Detect subject', async (ctx) => {
      const suspension = await ctx.hostControl.suspendHistory({
        documentID: doc.id,
        name: 'Detect subject',
      });
      try {
        await action.batchPlay(
          [{ _obj: 'autoCutout', sampleAllLayers: true, _options: { dialogOptions: 'dontDisplay' } }],
          {},
        );
        if (doc.selection.bounds) mask = await readSelectionMask(doc);
      } finally {
        await ctx.hostControl.resumeHistory(suspension, false);
      }
    });

    if (!mask) throw new Error('No subject found. Try a photo with a clearer subject, or use Soft Glow or Duotone.');
    cache.mask = mask;

    return {
      result: { width: previewWidth, height: previewHeight },
      bin: { mask: downscaleMask(mask, doc.width, doc.height, previewWidth, previewHeight) },
    };
  },

  async 'doc.full'({ docId }) {
    const doc = requireDoc(docId);
    const image = await modal('Read full image', () => readComposite(doc));
    const bin = { pixels: image.data };
    if (cache.mask) bin.mask = cache.mask;
    return {
      result: { width: image.width, height: image.height, components: image.components },
      bin,
    };
  },

  async 'doc.apply'({ docId, width, height, name }, bin) {
    const doc = requireDoc(docId);

    await modal('Apply filters', async (ctx) => {
      const suspension = await ctx.hostControl.suspendHistory({ documentID: doc.id, name });
      let commit = false;
      try {
        const imageData = await imaging.createImageDataFromBuffer(bin.pixels, {
          width,
          height,
          components: 4,
          colorSpace: 'RGB',
          colorProfile: cache.colorProfile,
          chunky: true,
        });
        const layer = await doc.createPixelLayer({ name });
        await imaging.putPixels({
          documentID: doc.id,
          layerID: layer.id,
          imageData,
          replace: true,
          targetBounds: { left: 0, top: 0 },
        });
        imageData.dispose();
        if (doc.layers[0].id !== layer.id) {
          layer.move(doc.layers[0], constants.ElementPlacement.PLACEBEFORE);
        }
        commit = true;
      } finally {
        await ctx.hostControl.resumeHistory(suspension, commit);
      }
    });

    return { result: { ok: true } };
  },

  async 'presets.get'({ effectId }) {
    if (!/^[a-z0-9-]+$/.test(effectId)) throw new Error(`Invalid effect id: ${effectId}`);
    const root = await fs.getPluginFolder();
    const folder = await root.getEntry('presets');
    const file = await folder.getEntry(`${effectId}.json`);
    return { result: JSON.parse(await file.read({ format: formats.utf8 })) };
  },

  async 'user.load'() {
    const folder = await fs.getDataFolder();
    const entries = await folder.getEntries();
    const file = entries.find((entry) => entry.name === USER_DATA_FILE);
    if (!file) return { result: null };
    return { result: JSON.parse(await file.read({ format: formats.utf8 })) };
  },

  async 'user.save'(data) {
    const folder = await fs.getDataFolder();
    const file = await folder.createFile(USER_DATA_FILE, { overwrite: true });
    await file.write(JSON.stringify(data, null, 2), { format: formats.utf8 });
    return { result: { ok: true } };
  },
};

const webview = document.getElementById('ui');
const peer = Wire.createPeer({ post: (message) => webview.postMessage(message), methods });
window.addEventListener('message', (event) => peer.receive(event.data));
