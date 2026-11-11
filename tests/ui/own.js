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
  const darkening = (without, withShadow, x0, x1) => {
    let total = 0;
    for (let y = 0; y < 120; y += 1) for (let x = x0; x < x1; x += 1) total += Math.max(0, px(without, x, y) - px(withShadow, x, y));
    return Math.round(total);
  };
  const setRange = (id, v) => page.evaluate(([id, v]) => {
    const el = document.querySelector(`[data-param="${id}"]`);
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  const value = (id) => page.evaluate((id) => Number(document.querySelector(`[data-param="${id}"]`).value), id);
  const setColor = (v) => page.evaluate((v) => {
    const el = document.getElementById('p-lights.color');
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  const exists = (id) => page.locator(`[id="${id}"]`).count().then((n) => n === 1);
  const tick = (id) => page.check(`[id="${id}"]`);
  const untick = (id) => page.uncheck(`[id="${id}"]`);
  const note = (label) => page.locator('.group-head', { hasText: label }).locator('.group-note').textContent();
  const check = (name, ok, detail) => { out[name] = ok ? 'PASS' : ('FAIL ' + JSON.stringify(detail === undefined ? null : detail)); };
  const ready = () => page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));
  const PLACEMENT = '[id="p-lights.placement"]';
  const OLD = ['b:golden-hour', 'b:warm-cool', 'b:aura', 'b:neon-edge', 'b:cold-moon', 'b:studio-strip'];

  // Front-light scene with shadows from both lights, built the same way on any version.
  const shadowScene = async () => {
    await page.selectOption('#presetSelect', 'b:gel-split');
    await page.check('#p-castShadow');
    await setRange('shadow', 1);
    await setRange('shadowSoftness', 0);
    await page.locator('.item-pick').nth(0).click();
    await page.selectOption(PLACEMENT, 'front');
    return sample();
  };

  // 1. Unchanged pictures: behind-only presets and a two-shadow scene against
  // the reference recorded by `npm run test:ui -- --record`.
  await page.goto('http://127.0.0.1:5177/');
  await ready();
  const { oldPictures, prevShadow } = await page.evaluate(async () => {
    const data = await (await fetch('/__tests/ui/reference.json')).json();
    const decode = (text) => Array.from(atob(text), (c) => c.charCodeAt(0));
    return {
      oldPictures: Object.fromEntries(Object.entries(data.presets).map(([key, text]) => [key, decode(text)])),
      prevShadow: decode(data.shadowScene),
    };
  });
  out.presetDiff = {};
  for (const key of OLD) { await page.selectOption('#presetSelect', key); out.presetDiff[key] = maxDiff(oldPictures[key], await sample()); }
  check('behind-only presets unchanged', Object.values(out.presetDiff).every((d) => d === 0), out.presetDiff);
  out.shadowSceneDiff = maxDiff(prevShadow, await shadowScene());
  check('shadow scene unchanged', out.shadowSceneDiff <= 1, out.shadowSceneDiff);

  // 2. Own edge on a single light.
  await page.selectOption('#presetSelect', 'b:golden-hour');
  const single = await sample();
  check('behind light offers own edge, bloom, glow', (await exists('p-lights.ownEdge')) && (await exists('p-lights.ownBloom')) && (await exists('p-lights.ownGlow')) && !(await exists('p-lights.ownShadow')));
  check('own controls hidden until ticked', !(await exists('p-lights.rim')));
  await tick('p-lights.ownEdge');
  check('ticking shows the light its own edge controls', await exists('p-lights.rim'));
  check('own copy starts from shared values', (await value('lights.rim')) === (await value('rim')) && (await value('lights.rimWidth')) === (await value('rimWidth')));
  out.ownSeedDiff = maxDiff(single, await sample());
  check('ticking alone barely changes the picture', out.ownSeedDiff <= 2, out.ownSeedDiff);
  check('edge group names the light', (await note('Edge')) === 'Light 1 uses its own', await note('Edge'));
  check('focus stays on the switch', await page.evaluate(() => document.activeElement && document.activeElement.id === 'p-lights.ownEdge'));
  const beforeOwnEdit = await sample();
  await setRange('lights.rimWidth', 90);
  check('own edit changes the picture', !same(beforeOwnEdit, await sample()));
  check('own edit leaves the shared value', (await value('rimWidth')) === 28);
  const ownEdited = await sample();
  await setRange('rim', 1.8);
  check('shared edit no longer reaches the light', same(ownEdited, await sample()));
  await setRange('rim', 0.7);
  await untick('p-lights.ownEdge');
  check('unticking returns to the shared settings', same(single, await sample()));
  check('edge note cleared', (await note('Edge')) === '');

  // 3. Two lights: Light 2 silenced through its own settings stays silent
  // whatever the shared settings do.
  await page.click('.item-add');
  await tick('p-lights.ownEdge');
  await setRange('lights.contact', 0);
  await setRange('lights.rim', 0);
  await tick('p-lights.ownGlow');
  await setRange('lights.glow', 0);
  out.silencedDiff = maxDiff(single, await sample());
  check('light with zeroed own settings adds nothing', out.silencedDiff <= 2, out.silencedDiff);
  await setRange('rim', 1.6);
  await setRange('glow', 1.2);
  const withLight2 = await sample();
  await page.locator('.item-row').nth(1).locator('[aria-pressed]').click();
  const withoutLight2 = await sample();
  out.sharedEditDiff = maxDiff(withLight2, withoutLight2);
  check('shared edits do not revive it', out.sharedEditDiff <= 2, out.sharedEditDiff);
  await page.locator('.item-row').nth(1).locator('[aria-pressed]').click();
  await page.locator('.item-pick').nth(1).click();
  await tick('p-lights.ownBloom');
  await setRange('lights.bloomRadius', 180);
  check('notes list each group', (await note('Edge')) === 'Light 2 uses its own' && (await note('Bloom')) === 'Light 2 uses its own' && (await note('Back Glow')) === 'Light 2 uses its own');

  // 4. Shadows per front light.
  await page.selectOption('#presetSelect', 'b:golden-hour');
  await page.selectOption(PLACEMENT, 'front');
  await setColor('#ffffff');
  await setRange('lights.intensity', 1);
  await setRange('lights.x', 0.1);
  await setRange('lights.y', 0.3);
  check('front light offers own shadow only', (await exists('p-lights.ownShadow')) && !(await exists('p-lights.ownEdge')));
  await page.click('.item-add');
  await page.selectOption(PLACEMENT, 'front');
  await setColor('#ffffff');
  await setRange('lights.intensity', 1);
  await setRange('lights.x', 0.9);
  await setRange('lights.y', 0.3);
  const noShadows = await sample();
  await tick('p-lights.ownShadow');
  check('own shadow starts off like the shared one', !(await page.isChecked('[id="p-lights.castShadow"]')));
  await tick('p-lights.castShadow');
  await setRange('lights.shadow', 1);
  const light2Shadow = await sample();
  out.light2Only = { left: darkening(noShadows, light2Shadow, 0, 48), right: darkening(noShadows, light2Shadow, 48, 96) };
  check('only light 2 casts, to the left', out.light2Only.left > 300 && out.light2Only.left > out.light2Only.right * 3, out.light2Only);
  check('shadow group names the light', (await note('Shadow')) === 'Light 2 uses its own', await note('Shadow'));
  await page.check('#p-castShadow');
  await setRange('shadow', 1);
  const both = await sample();
  out.bothShadows = { left: darkening(noShadows, both, 0, 48), right: darkening(noShadows, both, 48, 96) };
  check('shared switch adds light 1 shadow to the right', out.bothShadows.right > out.light2Only.right + 300, out.bothShadows);
  await setRange('lights.shadowSoftness', 0);
  const hard = await sample();
  await setRange('lights.shadowSoftness', 250);
  check('softness per light', !same(hard, await sample()));

  // 5. Full resolution with own settings on both kinds of light.
  await page.selectOption('#presetSelect', 'b:warm-cool');
  await page.locator('.item-pick').nth(1).click();
  await tick('p-lights.ownEdge');
  await setRange('lights.rimWidth', 70);
  await tick('p-lights.ownBloom');
  await setRange('lights.bloomRadius', 120);
  await page.click('.item-add');
  await page.selectOption(PLACEMENT, 'front');
  await tick('p-lights.ownShadow');
  await tick('p-lights.castShadow');
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
  check('full render matches preview with own settings', out.fullVsPreview < 3, out.fullVsPreview);

  await page.setViewportSize({ width: 1040, height: 900 });
  await page.locator('.item-pick').nth(1).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'ui-own.png', scale: 'css' });

  out.errors = errors;
  const failed = Object.entries(out).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  return JSON.stringify({ summary: `${Object.values(out).filter((v) => v === 'PASS').length} pass, ${failed.length} fail`, failed, presetDiff: out.presetDiff, shadowSceneDiff: out.shadowSceneDiff, ownSeedDiff: out.ownSeedDiff, silencedDiff: out.silencedDiff, sharedEditDiff: out.sharedEditDiff, light2Only: out.light2Only, bothShadows: out.bothShadows, fullVsPreview: out.fullVsPreview, errors });
}
