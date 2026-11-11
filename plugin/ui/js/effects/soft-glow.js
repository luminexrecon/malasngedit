(function (root) {
  'use strict';

  const EXTRACT = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform float uThreshold, uKnee;
in vec2 vUv;
out vec4 o;
void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  o = vec4(c * smoothstep(uThreshold - uKnee, uThreshold + uKnee, lum), 1.0);
}`;

  const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uSrc, uMask, uGlow, uSoft;
uniform vec3 uTint;
uniform float uIntensity, uTintAmt, uDiffuse, uTarget;
in vec2 vUv;
out vec4 o;
void main() {
  vec4 c = texture(uSrc, vUv);
  float m = texture(uMask, vUv).r;
  vec3 glow = texture(uGlow, vUv).rgb * mix(vec3(1.0), uTint, uTintAmt) * uIntensity;
  vec3 base = mix(c.rgb, texture(uSoft, vUv).rgb, uDiffuse);
  vec3 rgb = 1.0 - (1.0 - base) * (1.0 - clamp(glow, 0.0, 1.0));
  float weight = uTarget < 0.5 ? 1.0 : (uTarget < 1.5 ? m : 1.0 - m);
  o = vec4(mix(c.rgb, rgb, weight), c.a);
}`;

  root.Effects.register({
    id: 'soft-glow',
    name: 'Soft Glow',
    requiresMask: false,
    groups: [
      {
        id: 'mode',
        label: 'Mode',
        params: [
          { id: 'target', label: 'Apply to', type: 'select', default: 'all', options: root.Effects.TARGET_OPTIONS },
        ],
      },
      {
        id: 'glow',
        label: 'Glow',
        params: [
          { id: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 3, step: 0.01, default: 1 },
          { id: 'radius', label: 'Radius', type: 'range', min: 2, max: 300, step: 1, default: 60 },
          { id: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
          { id: 'knee', label: 'Softness', type: 'range', min: 0.01, max: 0.5, step: 0.01, default: 0.25 },
        ],
      },
      {
        id: 'color',
        label: 'Color',
        params: [
          { id: 'tint', label: 'Tint', type: 'color', default: '#ffe9d6' },
          { id: 'tintAmount', label: 'Tint Amount', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
        ],
      },
      {
        id: 'tone',
        label: 'Diffusion',
        params: [
          { id: 'diffuse', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, default: 0.2 },
          { id: 'diffuseRadius', label: 'Radius', type: 'range', min: 1, max: 80, step: 1, default: 14 },
        ],
      },
    ],

    render(ctx, input, p) {
      const { scale, mask } = ctx;

      const extracted = ctx.acquire();
      ctx.draw(EXTRACT, { uSrc: input, uThreshold: p.threshold, uKnee: p.knee }, extracted);
      const glow = ctx.blur(extracted, p.radius * scale);
      const soft = ctx.blur(input, p.diffuseRadius * scale);

      const output = ctx.acquire();
      ctx.draw(
        COMPOSITE,
        {
          uSrc: input,
          uMask: mask,
          uGlow: glow,
          uSoft: soft,
          uTint: root.Effects.hexToRgb(p.tint),
          uIntensity: p.intensity,
          uTintAmt: p.tintAmount,
          uDiffuse: p.diffuse,
          uTarget: root.Effects.targetCode(p.target),
        },
        output,
      );

      [extracted, glow, soft].forEach(ctx.release);
      return output;
    },
  });
})(window);
