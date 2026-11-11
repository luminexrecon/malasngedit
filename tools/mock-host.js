// Browser stand-in for plugin/host.js. It speaks the same wire protocol, with
// JSON round-tripping like the real WebView channel, and serves a procedurally
// drawn portrait so the whole flow can run without Photoshop.

(function () {
  'use strict';

  const FULL_W = 2400;
  const FULL_H = 3000;
  const PREVIEW_EDGE = 1200;

  function silhouette(ctx, w, h) {
    const cx = w * 0.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.02, h);
    ctx.bezierCurveTo(w * 0.04, h * 0.76, w * 0.24, h * 0.7, w * 0.4, h * 0.655);
    ctx.lineTo(w * 0.42, h * 0.54);
    ctx.lineTo(w * 0.58, h * 0.54);
    ctx.lineTo(w * 0.6, h * 0.655);
    ctx.bezierCurveTo(w * 0.76, h * 0.7, w * 0.96, h * 0.76, w * 0.98, h);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, h * 0.38, w * 0.2, h * 0.21, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function hair(ctx, w, h) {
    const cx = w * 0.5;
    const cy = h * 0.34;
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    ctx.lineCap = 'round';
    for (let i = 0; i < 900; i += 1) {
      const angle = Math.PI + random() * Math.PI;
      const rootX = cx + Math.cos(angle) * w * 0.19;
      const rootY = cy + Math.sin(angle) * h * 0.19;
      const length = w * (0.02 + random() * 0.05);
      const sway = (random() - 0.5) * 0.7;
      ctx.lineWidth = w * (0.0008 + random() * 0.0016);
      ctx.beginPath();
      ctx.moveTo(rootX, rootY);
      ctx.lineTo(rootX + Math.cos(angle + sway) * length, rootY + Math.sin(angle + sway) * length);
      ctx.stroke();
    }
  }

  function drawPortrait() {
    const image = document.createElement('canvas');
    image.width = FULL_W;
    image.height = FULL_H;
    const ctx = image.getContext('2d', { willReadFrequently: true });

    const backdrop = ctx.createLinearGradient(0, 0, FULL_W, FULL_H);
    backdrop.addColorStop(0, '#2c3e50');
    backdrop.addColorStop(1, '#11141c');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, FULL_W, FULL_H);

    for (let i = 0; i < 14; i += 1) {
      const x = (i * 677) % FULL_W;
      const y = (i * 1031) % FULL_H;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 260);
      glow.addColorStop(0, 'rgba(255,190,130,0.16)');
      glow.addColorStop(1, 'rgba(255,190,130,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 260, y - 260, 520, 520);
    }

    const skin = ctx.createLinearGradient(FULL_W * 0.25, 0, FULL_W * 0.75, 0);
    skin.addColorStop(0, '#6f4a38');
    skin.addColorStop(1, '#c9977c');
    ctx.fillStyle = skin;
    silhouette(ctx, FULL_W, FULL_H);

    const jacket = ctx.createLinearGradient(0, FULL_H * 0.65, 0, FULL_H);
    jacket.addColorStop(0, '#2b2f3a');
    jacket.addColorStop(1, '#14161d');
    ctx.fillStyle = jacket;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, FULL_H * 0.66, FULL_W, FULL_H);
    ctx.clip();
    silhouette(ctx, FULL_W, FULL_H);
    ctx.restore();

    ctx.strokeStyle = '#1b1512';
    ctx.fillStyle = '#1b1512';
    ctx.beginPath();
    ctx.ellipse(FULL_W * 0.5, FULL_H * 0.27, FULL_W * 0.2, FULL_H * 0.11, 0, Math.PI, 0);
    ctx.fill();
    hair(ctx, FULL_W, FULL_H);

    const mask = document.createElement('canvas');
    mask.width = FULL_W;
    mask.height = FULL_H;
    const maskCtx = mask.getContext('2d', { willReadFrequently: true });
    maskCtx.fillStyle = '#000';
    maskCtx.fillRect(0, 0, FULL_W, FULL_H);
    maskCtx.fillStyle = '#fff';
    maskCtx.strokeStyle = '#fff';
    silhouette(maskCtx, FULL_W, FULL_H);
    maskCtx.beginPath();
    maskCtx.ellipse(FULL_W * 0.5, FULL_H * 0.27, FULL_W * 0.2, FULL_H * 0.11, 0, Math.PI, 0);
    maskCtx.fill();
    hair(maskCtx, FULL_W, FULL_H);

    return { image, mask };
  }

  function scaled(source, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }

  function redChannel(rgba) {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < out.length; i += 1) out[i] = rgba[i * 4];
    return out;
  }

  function dropAlpha(rgba) {
    const count = rgba.length / 4;
    const out = new Uint8Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      out[i * 3] = rgba[i * 4];
      out[i * 3 + 1] = rgba[i * 4 + 1];
      out[i * 3 + 2] = rgba[i * 4 + 2];
    }
    return out;
  }

  const DOC_ID = 1;
  let art = null;
  let detected = false;
  let userData = null;
  const portrait = () => art || (art = drawPortrait());

  // Failure switches for exercising the UI's error paths from the console.
  window.__mock = { noDocument: false, noSubject: false };

  const methods = {
    async 'doc.snapshot'() {
      if (window.__mock.noDocument) return { result: { noDocument: true } };
      const scale = PREVIEW_EDGE / Math.max(FULL_W, FULL_H);
      const previewWidth = Math.round(FULL_W * scale);
      const previewHeight = Math.round(FULL_H * scale);
      detected = false;
      return {
        result: { docId: DOC_ID, title: 'sample-portrait.psd', width: FULL_W, height: FULL_H, previewWidth, previewHeight },
        bin: { pixels: new Uint8Array(scaled(portrait().image, previewWidth, previewHeight)) },
      };
    },
    async 'doc.detectSubject'({ previewWidth, previewHeight }) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (window.__mock.noSubject) throw new Error('No subject was found in this image.');
      detected = true;
      return {
        result: { width: previewWidth, height: previewHeight },
        bin: { mask: redChannel(scaled(portrait().mask, previewWidth, previewHeight)) },
      };
    },
    async 'doc.full'() {
      const bin = { pixels: dropAlpha(scaled(portrait().image, FULL_W, FULL_H)) };
      if (detected) bin.mask = redChannel(scaled(portrait().mask, FULL_W, FULL_H));
      return { result: { width: FULL_W, height: FULL_H, components: 3 }, bin };
    },
    async 'doc.apply'(params, bin) {
      window.__applied = { params, pixels: bin.pixels };
      return { result: { ok: true } };
    },
    async 'presets.get'({ effectId }) {
      const response = await fetch(`/__presets/${effectId}.json`);
      if (!response.ok) throw new Error(`Missing presets for ${effectId}`);
      return { result: await response.json() };
    },
    async 'user.load'() {
      return { result: userData };
    },
    async 'user.save'(data) {
      userData = data;
      return { result: { ok: true } };
    },
  };

  const roundTrip = (message) => JSON.parse(JSON.stringify(message));

  const peer = window.Wire.createPeer({
    methods,
    post: (message) => {
      const copy = roundTrip(message);
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: copy })), 0);
    },
  });

  window.uxpHost = {
    postMessage(message) {
      const copy = roundTrip(message);
      setTimeout(() => peer.receive(copy), 0);
    },
  };
})();
