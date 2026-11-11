async page => {
  const out = {};
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });

  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const sample = async () => {
    await frames();
    return page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 96; c.height = 120;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(document.querySelector('#preview'), 0, 0, 96, 120);
      return Array.from(g.getImageData(0, 0, 96, 120).data);
    });
  };
  const same = (a, b) => a.every((v, i) => v === b[i]);
  const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
  const px = (s, x, y) => { const i = (y * 96 + x) * 4; return (s[i] + s[i + 1] + s[i + 2]) / 3; };
  // Where the shadow is: darkening of `withShadow` against `without`, as total and x centroid.
  const darkening = (without, withShadow, x0, x1) => {
    let total = 0; let cx = 0;
    for (let y = 0; y < 120; y += 1) for (let x = x0; x < x1; x += 1) {
      const d = px(without, x, y) - px(withShadow, x, y);
      if (d > 0) { total += d; cx += d * x; }
    }
    return { total: Math.round(total), cx: total ? Number((cx / total).toFixed(1)) : null };
  };
  const setRange = (id, v) => page.evaluate(([id, v]) => {
    const el = document.querySelector(`[data-param="${id}"]`);
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  const setColor = (v) => page.evaluate((v) => {
    const el = document.getElementById('p-lights.color');
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  const check = (name, ok, detail) => { out[name] = ok ? 'PASS' : ('FAIL ' + JSON.stringify(detail === undefined ? null : detail)); };
  const ready = () => page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));
  const PLACEMENT = '[id="p-lights.placement"]';
  const OLD = ['b:golden-hour', 'b:warm-cool', 'b:aura', 'b:neon-edge', 'b:cold-moon', 'b:studio-strip'];

  await page.goto('http://127.0.0.1:5177/');
  await ready();
  // Reference pictures recorded by `npm run test:ui -- --record`.
  const before = await page.evaluate(async () => {
    const data = await (await fetch('/__tests/ui/reference.json')).json();
    const decode = (text) => Array.from(atob(text), (c) => c.charCodeAt(0));
    return Object.fromEntries(Object.entries(data.presets).map(([key, text]) => [key, decode(text)]));
  });
  out.presetDiff = {};
  for (const key of OLD) { await page.selectOption('#presetSelect', key); out.presetDiff[key] = maxDiff(before[key], await sample()); }
  check('behind-only presets unchanged', Object.values(out.presetDiff).every((d) => d === 0), out.presetDiff);

  await page.selectOption('#presetSelect', 'b:golden-hour');
  const behind = await sample();
  check('shadow group hidden while every light is behind', (await page.locator('#p-castShadow').count()) === 0);

  // One white front light at the left, on the sample's dark background.
  await page.selectOption(PLACEMENT, 'front');
  check('shadow group appears for a front light', (await page.locator('#p-castShadow').count()) === 1);
  await page.check('#p-castShadow');
  check('softness control present', (await page.locator('[data-param="shadowSoftness"]').count()) === 1);
  await page.selectOption(PLACEMENT, 'behind');
  check('shadow does nothing for lights behind', same(behind, await sample()));
  check('switch kept while hidden', await page.evaluate(() => !document.querySelector('#p-castShadow')));
  await page.selectOption(PLACEMENT, 'front');
  check('switch still ticked when shown again', await page.isChecked('#p-castShadow'));
  await setColor('#ffffff');
  await setRange('lights.intensity', 1);
  await setRange('lights.x', 0.1);
  await setRange('lights.y', 0.3);
  await setRange('shadow', 0);
  const leftOff = await sample();
  await setRange('shadow', 1);
  const leftOn = await sample();
  const leftLeft = darkening(leftOff, leftOn, 0, 48);
  const leftRight = darkening(leftOff, leftOn, 48, 96);
  out.lightLeft = { leftHalf: leftLeft.total, rightHalf: leftRight.total };
  check('light at left casts shadow to the right', leftRight.total > leftLeft.total * 3 && leftRight.total > 300, out.lightLeft);
  // Darkest shadow pixel on the background, against the same pixel unshadowed.
  let deepest = 0;
  for (let y = 0; y < 120; y += 1) for (let x = 60; x < 96; x += 1) deepest = Math.max(deepest, px(leftOff, x, y) - px(leftOn, x, y));
  out.deepestShadow = Number(deepest.toFixed(1));
  check('shadow visible on dark background', deepest > 8, out.deepestShadow);
  check('shadow leaves the face alone', maxDiff(leftOff.slice((60 * 96 + 40) * 4, (60 * 96 + 56) * 4), leftOn.slice((60 * 96 + 40) * 4, (60 * 96 + 56) * 4)) === 0);

  await setRange('lights.x', 0.9);
  await setRange('shadow', 0);
  const rightOff = await sample();
  await setRange('shadow', 1);
  const rightOn = await sample();
  out.lightRight = { leftHalf: darkening(rightOff, rightOn, 0, 48).total, rightHalf: darkening(rightOff, rightOn, 48, 96).total };
  check('light at right casts shadow to the left', out.lightRight.leftHalf > out.lightRight.rightHalf * 3, out.lightRight);

  await setRange('lights.x', 0.1);
  await setRange('shadowDistance', 150);
  const near = darkening(leftOff, await sample(), 48, 96);
  await setRange('shadowDistance', 1200);
  const far = darkening(leftOff, await sample(), 48, 96);
  out.distance = { near: near.cx, far: far.cx };
  check('larger distance throws the shadow further', far.cx > near.cx + 2, out.distance);
  await setRange('shadowDistance', 400);

  await setRange('shadowSoftness', 0);
  const hard = await sample();
  await setRange('shadowSoftness', 200);
  const soft = await sample();
  check('softness changes the shadow edge', !same(hard, soft));
  await setRange('shadowSoftness', 40);

  // Two equal front lights, left and right: each shadow is half as dark,
  // because the other light still reaches it.
  await page.click('.item-add');
  await page.selectOption(PLACEMENT, 'front');
  await setColor('#ffffff');
  await setRange('lights.intensity', 1);
  await setRange('lights.x', 0.9);
  await setRange('lights.y', 0.3);
  await setRange('shadow', 0);
  const twoOff = await sample();
  await setRange('shadow', 1);
  const twoOn = await sample();
  const twoLeft = darkening(twoOff, twoOn, 0, 48).total;
  const twoRight = darkening(twoOff, twoOn, 48, 96).total;
  out.twoLights = { leftHalf: twoLeft, rightHalf: twoRight };
  check('two lights cast shadows on both sides', twoLeft > 150 && twoRight > 150, out.twoLights);

  await page.evaluate(() => { window.__applied = null; });
  const preview = await sample();
  await page.click('#apply');
  await page.waitForFunction(() => window.__applied && !document.querySelector('#apply').disabled, null, { timeout: 120000 });
  const applied = await page.evaluate(() => {
    const { params, pixels } = window.__applied;
    const full = document.createElement('canvas');
    full.width = params.width; full.height = params.height;
    full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), params.width, params.height), 0, 0);
    const c = document.createElement('canvas');
    c.width = 96; c.height = 120;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(full, 0, 0, 96, 120);
    return Array.from(g.getImageData(0, 0, 96, 120).data);
  });
  let sum = 0;
  for (let i = 0; i < preview.length; i += 4) for (let c = 0; c < 3; c += 1) sum += Math.abs(preview[i + c] - applied[i + c]);
  out.fullVsPreview = Number((sum / (preview.length * 0.75)).toFixed(2));
  check('full render matches preview with shadows', out.fullVsPreview < 3, out.fullVsPreview);

  // Pictures: one light at the upper left, then Gel Split as shipped.
  await page.locator('.item-row').nth(1).locator('[aria-label^="Remove"]').click();
  await setRange('lights.x', 0.12);
  await setRange('lights.y', 0.22);
  await setRange('shadow', 0.7);
  await frames();
  await page.locator('#frame').screenshot({ path: 'shadow-dark.png' });
  await page.selectOption('#presetSelect', 'b:gel-split');
  await frames();
  await page.locator('#frame').screenshot({ path: 'shadow-gel.png' });

  out.errors = errors;
  const failed = Object.entries(out).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  return JSON.stringify({ summary: `${Object.values(out).filter((v) => v === 'PASS').length} pass, ${failed.length} fail`, failed, presetDiff: out.presetDiff, lightLeft: out.lightLeft, lightRight: out.lightRight, deepestShadow: out.deepestShadow, distance: out.distance, twoLights: out.twoLights, fullVsPreview: out.fullVsPreview, errors });
}
