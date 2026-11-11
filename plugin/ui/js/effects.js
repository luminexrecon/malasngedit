// Effect registry. An effect is a parameter schema (which drives the inspector)
// plus a render(ctx, input, params) function returning a pooled render target.
// Spatial parameters are in units of 1/1000 of the image's short side, so the
// preview and the full-resolution output match.

(function (root) {
  'use strict';

  const effects = new Map();

  function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }

  root.Effects = {
    register(definition) {
      effects.set(definition.id, definition);
    },
    get(id) {
      return effects.get(id);
    },
    list() {
      return Array.from(effects.values());
    },
    params(definition) {
      return definition.groups.flatMap((group) => group.params);
    },
    defaults(definition) {
      const values = {};
      // Cloned because list parameters hold objects that layers edit in place.
      for (const param of this.params(definition)) values[param.id] = JSON.parse(JSON.stringify(param.default));
      return values;
    },
    hexToRgb,
  };

  // Output weighting shared by the effects that can target part of the image.
  root.Effects.TARGET_OPTIONS = [
    { value: 'all', label: 'Whole image' },
    { value: 'subject', label: 'Subject only' },
    { value: 'background', label: 'Background only' },
  ];
  root.Effects.targetCode = (target) => ({ all: 0, subject: 1, background: 2 })[target];
})(window);
