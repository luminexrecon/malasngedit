(function (root) {
  'use strict';

  const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uSrc, uMask;
uniform vec3 uShadow, uHighlight;
uniform float uContrast, uMidpoint, uStrength, uTarget;
in vec2 vUv;
out vec4 o;
void main() {
  vec4 c = texture(uSrc, vUv);
  float m = texture(uMask, vUv).r;
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float t = clamp((lum - uMidpoint) * uContrast + 0.5, 0.0, 1.0);
  vec3 duo = mix(uShadow, uHighlight, smoothstep(0.0, 1.0, t));
  float weight = uTarget < 0.5 ? 1.0 : (uTarget < 1.5 ? m : 1.0 - m);
  o = vec4(mix(c.rgb, duo, uStrength * weight), c.a);
}`;

  root.Effects.register({
    id: 'duotone',
    name: 'Duotone',
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
        id: 'colors',
        label: 'Colors',
        params: [
          { id: 'shadow', label: 'Shadows', type: 'color', default: '#1b1464' },
          { id: 'highlight', label: 'Highlights', type: 'color', default: '#ffc9a3' },
        ],
      },
      {
        id: 'tone',
        label: 'Tone',
        params: [
          { id: 'contrast', label: 'Contrast', type: 'range', min: 0.2, max: 3, step: 0.01, default: 1.1 },
          { id: 'midpoint', label: 'Midpoint', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
        ],
      },
      {
        id: 'mix',
        label: 'Mix',
        params: [
          { id: 'strength', label: 'Strength', type: 'range', min: 0, max: 1, step: 0.01, default: 1 },
          { id: 'feather', label: 'Mask Feather', type: 'range', min: 0, max: 100, step: 1, default: 4 },
        ],
      },
    ],

    render(ctx, input, p) {
      const feathered = ctx.blur(ctx.mask, p.feather * ctx.scale);
      const output = ctx.acquire();
      ctx.draw(
        COMPOSITE,
        {
          uSrc: input,
          uMask: feathered,
          uShadow: root.Effects.hexToRgb(p.shadow),
          uHighlight: root.Effects.hexToRgb(p.highlight),
          uContrast: p.contrast,
          uMidpoint: p.midpoint,
          uStrength: p.strength,
          uTarget: root.Effects.targetCode(p.target),
        },
        output,
      );
      ctx.release(feathered);
      return output;
    },
  });
})(window);
