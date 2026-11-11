// Runs a filter stack over an image, for the preview canvas or for export.

(function (root) {
  'use strict';

  class Engine {
    constructor(canvas) {
      this.canvas = canvas;
      this.core = new root.GLCore(canvas);
      this.preview = null;
      this.mask = null;
      // Stands in for a missing mask so effects never have to branch on it.
      this.solidMask = this.core.upload({
        width: 1,
        height: 1,
        components: 1,
        data: new Uint8Array([255]),
      });
    }

    setPreview(image) {
      if (this.preview) this.core.free(this.preview);
      this.preview = this.core.upload(image);
      this.canvas.width = image.width;
      this.canvas.height = image.height;
      this.setMask(null);
    }

    setMask(mask) {
      if (this.mask) this.core.free(this.mask);
      this.mask = mask ? this.core.upload(mask) : null;
    }

    // Returns the source itself when no effect ran, so callers release through
    // _finish rather than directly.
    _run(stack, source, mask, w, h) {
      const { core } = this;
      const ctx = {
        w,
        h,
        scale: Math.min(w, h) / 1000,
        mask: mask || this.solidMask,
        acquire: (kind) => core.acquire(w, h, kind),
        release: (target) => core.release(target),
        draw: (fragment, uniforms, target) => core.draw(fragment, uniforms, target),
        blur: (image, radius) => core.blur(image, radius),
      };

      let current = source;
      for (const layer of stack) {
        if (!layer.enabled) continue;
        const effect = root.Effects.get(layer.effectId);
        if (effect.requiresMask && !mask) continue;
        const output = effect.render(ctx, current, layer.params);
        if (current !== source) core.release(current);
        current = output;
      }
      return current;
    }

    _finish(result, source) {
      if (result !== source) this.core.release(result);
    }

    draw(stack) {
      if (!this.preview) return;
      const { w, h } = this.preview;
      const result = this._run(stack, this.preview, this.mask, w, h);
      this.core.present(result);
      this._finish(result, this.preview);
    }

    renderThumbnail(stack, w, h) {
      const result = this._run(stack, this.preview, this.mask, w, h);
      const pixels = this.core.read(result, w, h);
      this._finish(result, this.preview);
      return pixels;
    }

    renderFull(stack, image, mask) {
      const { core } = this;
      const source = core.upload(image);
      const fullMask = mask ? core.upload(mask) : null;
      try {
        const result = this._run(stack, source, fullMask, image.width, image.height);
        const pixels = core.read(result, image.width, image.height);
        this._finish(result, source);
        return pixels;
      } finally {
        core.free(source);
        if (fullMask) core.free(fullMask);
        core.trim();
      }
    }
  }

  root.Engine = Engine;
})(window);
