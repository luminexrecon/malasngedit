(function (root) {
  'use strict';

  const MAX_LIGHTS = 6;
  // How far in from the outline (1/1000 of the short side) the surface that
  // front lights fall on curves away, like a pillow inflated from the mask.
  const SHAPE_RADIUS = 80;
  const DEFAULT_RADIUS = 700;
  // A flat surface gets half the light at 0.766 times the light's height (cos^3 falloff).
  const HALF_LIGHT = 0.766;
  // One blurred mask per front light, so lights can differ in shadow softness.
  const SHADOW_SLOTS = Array.from({ length: MAX_LIGHTS }, (_, i) => `uShadowMask${i}`);

  const LIGHT_UNIFORMS = `
const float PI = 3.14159265;
uniform float uAspect, uCount;
uniform vec2 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
// Half of the lit arc, in radians: PI lights the whole outline.
uniform float uLightSpread[${MAX_LIGHTS}];
// 1 for a light in front of the subject, 0 for one behind it.
uniform float uLightFront[${MAX_LIGHTS}];
// Height of a front light above the subject, in short sides.
uniform float uLightHeight[${MAX_LIGHTS}];
// Share of the cast shadow's darkness each front light carries; 0 for lights behind.
uniform float uLightShade[${MAX_LIGHTS}];
// Shadow amount each front light casts (0 when it casts none), and how far
// behind the subject the background sits for it, in short sides.
uniform float uLightShadow[${MAX_LIGHTS}];
uniform float uLightDepth[${MAX_LIGHTS}];

// Each edge is lit by how far its outward direction turns away from the light,
// with softness (radians) feathering both ends of the arc. The second term is
// the far end wrapping round behind the subject: at 360 degrees the two ends
// meet there and sum to exactly 1, so the halo has no seam.
// A light placed exactly on a pixel must not produce NaN: it would spread through
// the blurs that follow.
float facing(int i, vec2 uv, vec2 outward, float softness) {
  vec2 toLight = (uLightPos[i] - uv) * vec2(uAspect, 1.0);
  float distance = length(toLight);
  if (distance < 1e-5) return 1.0;
  float angle = acos(clamp(dot(outward, toLight / distance), -1.0, 1.0));
  float halfArc = uLightSpread[i];
  return smoothstep(-softness, softness, halfArc - angle)
       + smoothstep(-softness, softness, angle + halfArc - 2.0 * PI);
}`;

  // Glow behind the subject: falls off with distance outside the outline and,
  // like the rim, only appears on the side facing each light. Needs uGlow and
  // uGlowTexel declared by the shader.
  const BACK_GLOW = `
vec3 backGlow(vec2 uv, float m) {
  float spill = texture(uGlow, uv).r;
  vec2 e = uGlowTexel;
  vec2 g = vec2(
    texture(uGlow, uv + vec2(e.x, 0.0)).r - texture(uGlow, uv - vec2(e.x, 0.0)).r,
    texture(uGlow, uv + vec2(0.0, e.y)).r - texture(uGlow, uv - vec2(0.0, e.y)).r);
  float len = length(g);
  if (len <= 1e-6) return vec3(0.0);
  vec2 outward = -g / len;
  vec3 back = vec3(0.0);
  for (int i = 0; i < int(uCount); i++) {
    if (uLightFront[i] > 0.5) continue;
    back += uLightColor[i] * facing(i, uv, outward, 0.6);
  }
  return back * pow(clamp(spill * 2.0, 0.0, 1.0), 1.5) * (1.0 - m);
}`;

  // Facing is derived from the gradient of a blurred mask: where the outward
  // normal points at a light, that stretch of edge is lit by it.
  const BANDS = `#version 300 es
precision highp float;
uniform sampler2D uSrc, uMask, uNormal, uContact, uRim;
uniform vec2 uNormalTexel;
uniform float uDetail, uContactAmt, uRimAmt;
in vec2 vUv;
out vec4 o;
${LIGHT_UNIFORMS}

void main() {
  float m = texture(uMask, vUv).r;

  // Inside the subject a blurred mask stays near 1 and only falls away close to
  // the edge, so m * (1 - blur) is a band hugging the inner side of the outline.
  float contact = pow(clamp(m * (1.0 - texture(uContact, vUv).r) * 2.0, 0.0, 1.0), 1.5);
  float rim = clamp(m * (1.0 - texture(uRim, vUv).r) * 2.0, 0.0, 1.0);
  rim *= rim;

  // Breaks the soft rim up along hair and fabric instead of a flat airbrushed band.
  float lum = dot(texture(uSrc, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
  rim *= mix(1.0, smoothstep(0.02, 0.65, lum) + 0.15, uDetail);

  vec2 e = uNormalTexel;
  vec2 g = vec2(
    texture(uNormal, vUv + vec2(e.x, 0.0)).r - texture(uNormal, vUv - vec2(e.x, 0.0)).r,
    texture(uNormal, vUv + vec2(0.0, e.y)).r - texture(uNormal, vUv - vec2(0.0, e.y)).r);
  float len = length(g);

  vec3 lit = vec3(0.0);
  if (len >= 1e-5) {
    vec2 outward = -g / len;
    for (int i = 0; i < int(uCount); i++) {
      if (uLightFront[i] > 0.5) continue;
      lit += uLightColor[i] * facing(i, vUv, outward, 0.45);
    }
  }
  o = vec4(lit * (contact * uContactAmt + rim * uRimAmt), 1.0);
}`;

  // Adds one light that has its own edge, bloom or glow settings to the light
  // gathered from earlier such lights.
  const ACCUM = `#version 300 es
precision highp float;
uniform sampler2D uPrev, uMask, uBands, uBloom, uGlow;
uniform vec2 uGlowTexel;
uniform float uHasPrev, uBloomAmt, uGlowAmt;
in vec2 vUv;
out vec4 o;
${LIGHT_UNIFORMS}
${BACK_GLOW}

void main() {
  float m = texture(uMask, vUv).r;
  vec3 light = texture(uBands, vUv).rgb + texture(uBloom, vUv).rgb * uBloomAmt;
  light += backGlow(vUv, m) * uGlowAmt;
  if (uHasPrev > 0.5) light += texture(uPrev, vUv).rgb;
  o = vec4(light, 1.0);
}`;

  const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uSrc, uMask, uBands, uBloom, uGlow, uShape, uExtra;
uniform sampler2D ${SHADOW_SLOTS.join(', ')};
uniform vec2 uGlowTexel, uShapeStep, uToShort;
uniform float uBloomAmt, uGlowAmt, uBackground, uSubject, uDodge, uHasFront, uExtraAmt;
in vec2 vUv;
out vec4 o;
${LIGHT_UNIFORMS}
${BACK_GLOW}

// How steeply the pillow surface tilts at the outline.
const float ROUNDNESS = 3.0;

// Samplers cannot be indexed by a loop variable, so each slot is picked by hand.
float blockedBy(int i, vec2 uv) {
${SHADOW_SLOTS.map((name, i) => `  if (i == ${i}) return texture(${name}, uv).r;`).join('\n')}
  return 0.0;
}

void main() {
  vec4 c = texture(uSrc, vUv);
  float m = texture(uMask, vUv).r;

  // The scene is dimmed once here, however many lights there are.
  vec3 base = c.rgb * mix(uBackground, uSubject, m);

  // Lights in front fall on the subject's surface rather than its outline. They
  // multiply the photo's own colour, as real light on skin and cloth does. The
  // background sits further back, so it gets a weaker, wider share, and the
  // subject casts a shadow onto it on the side away from each light.
  if (uHasFront > 0.5) {
    vec2 s = uShapeStep;
    vec2 g = vec2(
      texture(uShape, vUv + vec2(s.x, 0.0)).r - texture(uShape, vUv - vec2(s.x, 0.0)).r,
      texture(uShape, vUv + vec2(0.0, s.y)).r - texture(uShape, vUv - vec2(0.0, s.y)).r);
    vec3 n = normalize(vec3(-g * ROUNDNESS, 1.0));
    vec3 onSubject = vec3(0.0);
    vec3 onBackground = vec3(0.0);
    float shade = 0.0;
    for (int i = 0; i < int(uCount); i++) {
      if (uLightFront[i] < 0.5) continue;
      float z = uLightHeight[i];
      vec2 d = (uLightPos[i] - vUv) * uToShort;
      // Irradiance falls with angle and squared distance, scaled so a flat
      // surface straight under the light receives exactly the light's colour.
      vec3 toLight = vec3(d, z);
      float r2 = dot(toLight, toLight);
      onSubject += uLightColor[i] * max(dot(n, toLight * inversesqrt(r2)), 0.0) * z * z / r2;

      float depth = uLightDepth[i];
      float zb = z + depth;
      float rb2 = dot(d, d) + zb * zb;
      // The subject point whose shadow lands here lies on the line to the light,
      // so the shadow falls on the far side and grows with the background's distance.
      float blocked = blockedBy(i, mix(vUv, uLightPos[i], depth / zb));
      float amount = uLightShadow[i];
      onBackground += uLightColor[i] * zb * inversesqrt(rb2) * z * z / rb2 * (1.0 - amount * blocked);
      shade += uLightShade[i] * amount * blocked;
    }
    // The shadow also takes away light the background already had, so it shows
    // on dark backgrounds too. Where only one of several lights is blocked, the
    // others fill it in, which is why each light carries only its share.
    base *= 1.0 - min(shade, 1.0) * (1.0 - m);
    base += c.rgb * mix(onBackground, onSubject, m);
  }

  vec3 light = texture(uBands, vUv).rgb + texture(uBloom, vUv).rgb * uBloomAmt;
  light += backGlow(vUv, m) * uGlowAmt;
  // Lights with their own edge, bloom or glow settings were rendered separately.
  light += texture(uExtra, vUv).rgb * uExtraAmt;

  vec3 rgb = uDodge > 0.5 ? base + light : 1.0 - (1.0 - base) * (1.0 - clamp(light, 0.0, 1.0));
  o = vec4(rgb, c.a);
}`;

  // Starting points for each added light, so a new one is visible straight away
  // instead of landing on top of an existing light.
  const NEW_LIGHTS = [
    { color: '#7fb4ff', x: 0.05, y: 0.25 },
    { color: '#ff7fb4', x: 0.5, y: -0.15 },
    { color: '#9dffb0', x: 0.95, y: 0.75 },
    { color: '#ffe27f', x: 0.05, y: 0.75 },
    { color: '#c8a2ff', x: 0.5, y: 1.1 },
  ];

  function isFront(light) {
    return light.placement === 'front';
  }

  const isBehind = (light) => !isFront(light);

  // Shared settings. Each group can also be copied into a single light (see OWN_GROUPS).
  const EDGE = [
    { id: 'contact', label: 'Contact', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
    { id: 'contactWidth', label: 'Contact Width', type: 'range', min: 0.5, max: 12, step: 0.1, default: 2.5 },
    { id: 'rim', label: 'Rim', type: 'range', min: 0, max: 2, step: 0.01, default: 0.7 },
    { id: 'rimWidth', label: 'Rim Width', type: 'range', min: 2, max: 120, step: 1, default: 28 },
    { id: 'detail', label: 'Detail', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  ];
  const BLOOM = [
    { id: 'bloom', label: 'Amount', type: 'range', min: 0, max: 3, step: 0.01, default: 0.8 },
    { id: 'bloomRadius', label: 'Radius', type: 'range', min: 2, max: 200, step: 1, default: 40 },
  ];
  const GLOW = [
    { id: 'glow', label: 'Amount', type: 'range', min: 0, max: 2, step: 0.01, default: 0.35 },
    { id: 'glowRadius', label: 'Radius', type: 'range', min: 10, max: 400, step: 1, default: 120 },
  ];
  // Cast by lights in front of the subject onto the background, on the side
  // away from each light. Off unless switched on.
  const SHADOW = [
    { id: 'castShadow', label: 'Cast shadow', type: 'toggle', default: false },
    { id: 'shadow', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, when: (s) => s.castShadow },
    // How far behind the subject the background sits, in 1/1000 of the short side.
    { id: 'shadowDistance', label: 'Distance', type: 'range', min: 20, max: 2000, step: 10, default: 400, when: (s) => s.castShadow },
    { id: 'shadowSoftness', label: 'Softness', type: 'range', min: 0, max: 300, step: 1, default: 40, when: (s) => s.castShadow },
  ];

  // Groups a light can take its own copy of. Scene is not among them: it dims
  // the one photo once, which no single light can do differently.
  const OWN_GROUPS = [
    { flag: 'ownEdge', label: 'Own edge', params: EDGE, applies: isBehind },
    { flag: 'ownBloom', label: 'Own bloom', params: BLOOM, applies: isBehind },
    { flag: 'ownGlow', label: 'Own back glow', params: GLOW, applies: isBehind },
    { flag: 'ownShadow', label: 'Own shadow', params: SHADOW, applies: isFront },
  ];
  const ownGroup = (flag) => OWN_GROUPS.find((group) => group.flag === flag);
  const owns = (light, group) => Boolean(light[group.flag]) && group.applies(light);
  // Lights whose edge, bloom or glow differ from the shared ones get a pass of their own.
  const hasOwnLook = (light) => ['ownEdge', 'ownBloom', 'ownGlow'].some((flag) => owns(light, ownGroup(flag)));

  // The settings a light renders with: the shared ones, except for the groups
  // it has its own copy of.
  function settings(p, light) {
    const result = { ...p };
    for (const group of OWN_GROUPS) {
      if (!owns(light, group)) continue;
      for (const param of group.params) if (light[param.id] !== undefined) result[param.id] = light[param.id];
    }
    return result;
  }

  // A light's switch for each group, followed by its copy of that group's
  // controls. Switching on seeds the copy from the shared values, so the
  // picture does not jump.
  const OWN_FIELDS = OWN_GROUPS.flatMap((group) => [
    {
      id: group.flag,
      label: group.label,
      type: 'toggle',
      default: false,
      when: group.applies,
      seed(item, shared) {
        for (const param of group.params) item[param.id] = shared[param.id];
      },
    },
    ...group.params.map((param) => ({
      ...param,
      nested: true,
      when: (item) => owns(item, group) && (!param.when || param.when(item)),
    })),
  ]);

  // Header note on a shared group naming the lights that use their own copy.
  function ownNote(flag) {
    const group = ownGroup(flag);
    return (p) => {
      const numbers = p.lights.flatMap((light, i) => (owns(light, group) ? [i + 1] : []));
      if (!numbers.length) return '';
      if (numbers.length === 1) return `Light ${numbers[0]} uses its own`;
      return `Lights ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]} use their own`;
    };
  }

  function lightUniforms(lights, aspect, p) {
    const active = lights.filter((light) => light.enabled);
    const position = new Array(MAX_LIGHTS * 2).fill(0);
    const color = new Array(MAX_LIGHTS * 3).fill(0);
    const spread = new Array(MAX_LIGHTS).fill(0);
    const front = new Array(MAX_LIGHTS).fill(0);
    const height = new Array(MAX_LIGHTS).fill(1);
    const shade = new Array(MAX_LIGHTS).fill(0);
    const shadow = new Array(MAX_LIGHTS).fill(0);
    const depth = new Array(MAX_LIGHTS).fill(0);
    const softness = new Array(MAX_LIGHTS).fill(null);
    // A front light's strength, taken from its brightest channel so a saturated
    // colour casts as firm a shadow as white.
    const strength = (light) => light.intensity * Math.max(...root.Effects.hexToRgb(light.color));
    const frontTotal = active.filter(isFront).reduce((sum, light) => sum + strength(light), 0);
    active.forEach((light, i) => {
      const [r, g, b] = root.Effects.hexToRgb(light.color);
      position[i * 2] = light.x;
      position[i * 2 + 1] = light.y;
      color[i * 3] = r * light.intensity;
      color[i * 3 + 1] = g * light.intensity;
      color[i * 3 + 2] = b * light.intensity;
      spread[i] = (light.spread / 360) * Math.PI;
      // Lights saved before placement existed are behind the subject.
      front[i] = isFront(light) ? 1 : 0;
      height[i] = (light.radius === undefined ? DEFAULT_RADIUS : light.radius) / 1000 / HALF_LIGHT;
      if (!isFront(light)) return;
      // Shares add up to 1 once the front lights together reach full strength;
      // weaker lights cast proportionally fainter shadows.
      shade[i] = strength(light) / Math.max(1, frontTotal);
      const s = settings(p, light);
      depth[i] = s.shadowDistance / 1000;
      if (s.castShadow) {
        shadow[i] = s.shadow;
        softness[i] = s.shadowSoftness;
      }
    });
    return {
      uniforms: {
        uAspect: aspect,
        uCount: active.length,
        uLightPos: position,
        uLightColor: color,
        uLightSpread: spread,
        uLightFront: front,
        uLightHeight: height,
        uLightShade: shade,
        uLightShadow: shadow,
        uLightDepth: depth,
      },
      softness,
    };
  }

  root.Effects.register({
    id: 'rim-light',
    name: 'Rim Light',
    requiresMask: true,
    groups: [
      {
        id: 'mode',
        label: 'Mode',
        params: [
          {
            id: 'blend',
            label: 'Blend',
            type: 'select',
            default: 'screen',
            options: [
              { value: 'screen', label: 'Screen' },
              { value: 'dodge', label: 'Linear Dodge' },
            ],
          },
        ],
      },
      {
        id: 'lights',
        label: 'Lights',
        params: [
          {
            id: 'lights',
            type: 'list',
            itemLabel: 'Light',
            max: MAX_LIGHTS,
            swatch: 'color',
            handle: { x: 'x', y: 'y' },
            // `default` on a field fills in items saved before that field existed;
            // `when` shows a field only for items it applies to.
            fields: [
              {
                id: 'placement',
                label: 'Placement',
                type: 'select',
                default: 'behind',
                options: [
                  { value: 'behind', label: 'Behind subject' },
                  { value: 'front', label: 'In front of subject' },
                ],
                tag: { front: 'In front' },
              },
              { id: 'color', label: 'Color', type: 'color' },
              { id: 'intensity', label: 'Intensity', type: 'range', min: 0, max: 3, step: 0.01 },
              { id: 'x', label: 'Position X', type: 'range', min: -0.25, max: 1.25, step: 0.01 },
              { id: 'y', label: 'Position Y', type: 'range', min: -0.25, max: 1.25, step: 0.01 },
              // Degrees of outline the light reaches at half strength; 360 rings the subject.
              { id: 'spread', label: 'Spread (°)', type: 'range', min: 0, max: 360, step: 1, when: isBehind },
              // Distance from the light, in 1/1000 of the short side, at which it falls to half.
              { id: 'radius', label: 'Radius', type: 'range', min: 50, max: 2000, step: 10, default: DEFAULT_RADIUS, when: isFront },
              ...OWN_FIELDS,
            ],
            default: [{ enabled: true, placement: 'behind', color: '#ffd9a8', intensity: 1, x: 0.95, y: 0.2, spread: 157, radius: DEFAULT_RADIUS }],
            newItem(items) {
              const start = NEW_LIGHTS[(items.length - 1) % NEW_LIGHTS.length];
              return {
                enabled: true,
                placement: 'behind',
                color: start.color,
                intensity: 0.8,
                x: start.x,
                y: start.y,
                spread: 157,
                radius: DEFAULT_RADIUS,
              };
            },
          },
        ],
      },
      { id: 'edge', label: 'Edge', note: ownNote('ownEdge'), params: EDGE },
      { id: 'bloom', label: 'Bloom', note: ownNote('ownBloom'), params: BLOOM },
      { id: 'glow', label: 'Back Glow', note: ownNote('ownGlow'), params: GLOW },
      // Only shown once a light is in front, since lights behind cast no shadow.
      { id: 'shadow', label: 'Shadow', note: ownNote('ownShadow'), when: (p) => p.lights.some(isFront), params: SHADOW },
      {
        id: 'scene',
        label: 'Scene',
        params: [
          { id: 'background', label: 'Background', type: 'range', min: 0, max: 1, step: 0.01, default: 0.75 },
          { id: 'subject', label: 'Subject', type: 'range', min: 0, max: 1.2, step: 0.01, default: 0.92 },
        ],
      },
    ],

    render(ctx, input, p) {
      const { scale, mask } = ctx;
      const aspect = ctx.w / ctx.h;

      // Blurred copies of the mask, shared by every pass that asks for the same radius.
      const blurredMasks = new Map();
      const blurredMask = (radius) => {
        if (!blurredMasks.has(radius)) blurredMasks.set(radius, ctx.blur(mask, radius));
        return blurredMasks.get(radius);
      };

      const drawBands = (uniforms, s) => {
        const normal = blurredMask(Math.max(3, s.rimWidth * scale * 0.5));
        const contact = blurredMask(s.contactWidth * scale);
        const rim = blurredMask(s.rimWidth * scale);
        const bands = ctx.acquire();
        ctx.draw(
          BANDS,
          {
            ...uniforms,
            uSrc: input,
            uMask: mask,
            uNormal: normal,
            uContact: contact,
            uRim: rim,
            uNormalTexel: [1 / normal.w, 1 / normal.h],
            uDetail: s.detail,
            uContactAmt: s.contact,
            uRimAmt: s.rim,
          },
          bands,
        );
        return bands;
      };
      // Blurring spreads the same energy thinner, so compensate with radius.
      const bloomAmount = (s) => s.bloom * (1 + s.bloomRadius / Math.max(s.rimWidth, 1) * 0.5);

      const own = p.lights.filter((light) => light.enabled && hasOwnLook(light));
      const shared = p.lights.filter((light) => !own.includes(light));
      const lights = lightUniforms(shared, aspect, p);

      // One blur covers every shared light, because the bands are already coloured.
      const bands = drawBands(lights.uniforms, p);
      const bloom = ctx.blur(bands, p.bloomRadius * scale);
      const glow = blurredMask(p.glowRadius * scale);

      let extra = null;
      for (const light of own) {
        const s = settings(p, light);
        const single = lightUniforms([light], aspect, s).uniforms;
        const lightBands = drawBands(single, s);
        const lightBloom = ctx.blur(lightBands, s.bloomRadius * scale);
        const lightGlow = blurredMask(s.glowRadius * scale);
        const next = ctx.acquire();
        ctx.draw(
          ACCUM,
          {
            ...single,
            uPrev: extra || mask,
            uHasPrev: extra ? 1 : 0,
            uMask: mask,
            uBands: lightBands,
            uBloom: lightBloom,
            uGlow: lightGlow,
            uGlowTexel: [1 / lightGlow.w, 1 / lightGlow.h],
            uBloomAmt: bloomAmount(s),
            uGlowAmt: s.glow,
          },
          next,
        );
        ctx.release(lightBands);
        ctx.release(lightBloom);
        if (extra) ctx.release(extra);
        extra = next;
      }

      const hasFront = shared.some((light) => light.enabled && isFront(light));
      const shapePx = SHAPE_RADIUS * scale;
      const shadowMasks = {};
      SHADOW_SLOTS.forEach((name, i) => {
        const softness = lights.softness[i];
        shadowMasks[name] = softness === null ? mask : blurredMask(softness * scale);
      });
      const short = Math.min(ctx.w, ctx.h);

      const output = ctx.acquire();
      ctx.draw(
        COMPOSITE,
        {
          ...lights.uniforms,
          ...shadowMasks,
          uSrc: input,
          uMask: mask,
          uBands: bands,
          uBloom: bloom,
          uGlow: glow,
          uGlowTexel: [1 / glow.w, 1 / glow.h],
          uShape: hasFront ? blurredMask(shapePx) : mask,
          uShapeStep: [(shapePx * 0.5) / ctx.w, (shapePx * 0.5) / ctx.h],
          uToShort: [ctx.w / short, ctx.h / short],
          uHasFront: hasFront ? 1 : 0,
          uExtra: extra || mask,
          uExtraAmt: extra ? 1 : 0,
          uBloomAmt: bloomAmount(p),
          uGlowAmt: p.glow,
          uBackground: p.background,
          uSubject: p.subject,
          uDodge: p.blend === 'dodge' ? 1 : 0,
        },
        output,
      );

      ctx.release(bands);
      ctx.release(bloom);
      if (extra) ctx.release(extra);
      blurredMasks.forEach((target) => ctx.release(target));
      return output;
    },
  });
})(window);
