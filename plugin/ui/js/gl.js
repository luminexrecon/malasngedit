// Thin WebGL2 layer: programs, a render-target pool and the shared blur.

(function (root) {
  'use strict';

  const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const COPY = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 o;
void main() { o = texture(uTex, vUv); }`;

  // uFlip is only set when drawing to the canvas: images are stored top-down
  // (row 0 at v = 0), while the default framebuffer is bottom-up.
  const OUTPUT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uFlip;
in vec2 vUv;
out vec4 o;
float noise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
void main() {
  vec2 uv = vec2(vUv.x, uFlip > 0.5 ? 1.0 - vUv.y : vUv.y);
  vec4 c = texture(uTex, uv);
  // Half-LSB dither keeps long glow falloffs from banding at 8 bits.
  c.rgb += (noise(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}`;

  const DOWNSAMPLE = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 o;
void main() {
  o = 0.25 * (texture(uTex, vUv + uTexel * vec2(-1.0, -1.0))
            + texture(uTex, vUv + uTexel * vec2( 1.0, -1.0))
            + texture(uTex, vUv + uTexel * vec2(-1.0,  1.0))
            + texture(uTex, vUv + uTexel * vec2( 1.0,  1.0)));
}`;

  const GAUSSIAN = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uSigma;
in vec2 vUv;
out vec4 o;
void main() {
  int radius = int(ceil(uSigma * 3.0));
  vec4 sum = texture(uTex, vUv);
  float weight = 1.0;
  for (int i = 1; i <= radius; i++) {
    float f = float(i);
    float g = exp(-0.5 * f * f / (uSigma * uSigma));
    sum += g * (texture(uTex, vUv + uDir * f) + texture(uTex, vUv - uDir * f));
    weight += 2.0 * g;
  }
  o = sum / weight;
}`;

  const MAX_DIRECT_SIGMA = 5;

  class GLCore {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });
      if (!gl) throw new Error('WebGL2 is not available.');

      this.canvas = canvas;
      this.gl = gl;
      this.floatTargets = Boolean(gl.getExtension('EXT_color_buffer_float'));
      this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      this.programs = new Map();
      this.pool = new Map();

      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);

      gl.bindVertexArray(gl.createVertexArray());
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }

    _compile(type, source) {
      const { gl } = this;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    }

    _program(fragment) {
      let program = this.programs.get(fragment);
      if (program) return program;

      const { gl } = this;
      const handle = gl.createProgram();
      gl.attachShader(handle, this._compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(handle, this._compile(gl.FRAGMENT_SHADER, fragment));
      gl.bindAttribLocation(handle, 0, 'aPos');
      gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
        throw new Error(`Program link failed: ${gl.getProgramInfoLog(handle)}`);
      }

      const uniforms = [];
      const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i += 1) {
        const info = gl.getActiveUniform(handle, i);
        uniforms.push({
          name: info.name.replace(/\[0\]$/, ''), // arrays are reported as "uName[0]"
          type: info.type,
          size: info.size,
          location: gl.getUniformLocation(handle, info.name),
        });
      }

      program = { handle, uniforms };
      this.programs.set(fragment, program);
      return program;
    }

    _texture(width, height, internal, format, type, data) {
      const { gl } = this;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }

    upload({ width, height, components, data }) {
      const { gl } = this;
      if (width > this.maxSize || height > this.maxSize) {
        throw new Error(`Image exceeds this GPU's ${this.maxSize}px limit. Resize it, then press Reload.`);
      }
      const formats = {
        1: [gl.R8, gl.RED],
        3: [gl.RGB8, gl.RGB],
        4: [gl.RGBA8, gl.RGBA],
      };
      const [internal, format] = formats[components];
      const tex = this._texture(width, height, internal, format, gl.UNSIGNED_BYTE, data);
      return { tex, w: width, h: height };
    }

    free(image) {
      this.gl.deleteTexture(image.tex);
    }

    acquire(w, h, kind = 'hdr') {
      const key = `${w}x${h}:${kind}`;
      const free = this.pool.get(key);
      if (free && free.length) return free.pop();

      const { gl } = this;
      const float = kind === 'hdr' && this.floatTargets;
      const tex = float
        ? this._texture(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
        : this._texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo, w, h, key };
    }

    release(target) {
      if (!this.pool.has(target.key)) this.pool.set(target.key, []);
      this.pool.get(target.key).push(target);
    }

    // Drops pooled targets. Called after a full-resolution render, whose targets
    // would otherwise hold on to a large share of GPU memory.
    trim() {
      const { gl } = this;
      for (const list of this.pool.values()) {
        for (const target of list) {
          gl.deleteFramebuffer(target.fbo);
          gl.deleteTexture(target.tex);
        }
      }
      this.pool.clear();
    }

    draw(fragment, uniforms, target) {
      const { gl } = this;
      const program = this._program(fragment);
      gl.useProgram(program.handle);

      let unit = 0;
      for (const { name, type, size, location } of program.uniforms) {
        const value = uniforms[name];
        if (value === undefined) throw new Error(`Missing uniform: ${name}`);
        switch (type) {
          case gl.SAMPLER_2D:
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, value.tex);
            gl.uniform1i(location, unit);
            unit += 1;
            break;
          case gl.FLOAT:
            if (size > 1) gl.uniform1fv(location, value);
            else gl.uniform1f(location, value);
            break;
          case gl.FLOAT_VEC2:
            gl.uniform2fv(location, value);
            break;
          case gl.FLOAT_VEC3:
            gl.uniform3fv(location, value);
            break;
          default:
            throw new Error(`Unsupported uniform type for ${name}`);
        }
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
      gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Separable Gaussian. Large radii run on a downsampled copy, so the cost stays
    // flat with radius; the caller samples the (smaller) result with bilinear
    // filtering. Returns a pooled target the caller must release.
    blur(source, radius) {
      let sigma = Math.max(radius, 0);
      if (sigma < 0.35) {
        const copy = this.acquire(source.w, source.h);
        this.draw(COPY, { uTex: source }, copy);
        return copy;
      }

      let current = source;
      let owned = null;
      let w = source.w;
      let h = source.h;
      while (sigma > MAX_DIRECT_SIGMA && Math.min(w, h) > 8) {
        w = Math.max(2, w >> 1);
        h = Math.max(2, h >> 1);
        const next = this.acquire(w, h);
        this.draw(DOWNSAMPLE, { uTex: current, uTexel: [1 / current.w, 1 / current.h] }, next);
        if (owned) this.release(owned);
        current = next;
        owned = next;
        sigma /= 2;
      }

      const horizontal = this.acquire(w, h);
      this.draw(GAUSSIAN, { uTex: current, uDir: [1 / w, 0], uSigma: sigma }, horizontal);
      const vertical = this.acquire(w, h);
      this.draw(GAUSSIAN, { uTex: horizontal, uDir: [0, 1 / h], uSigma: sigma }, vertical);
      this.release(horizontal);
      if (owned) this.release(owned);
      return vertical;
    }

    present(image) {
      this.draw(OUTPUT, { uTex: image, uFlip: 1 }, null);
    }

    read(image, w, h) {
      const { gl } = this;
      const target = this.acquire(w, h, 'ldr');
      this.draw(OUTPUT, { uTex: image, uFlip: 0 }, target);
      const pixels = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      this.release(target);
      return pixels;
    }
  }

  root.GLCore = GLCore;
})(window);
