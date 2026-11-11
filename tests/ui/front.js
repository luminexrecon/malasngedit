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
  const lum = (s, x0, x1, y0, y1) => {
    let sum = 0; let n = 0;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { const i = (y * 96 + x) * 4; sum += s[i] + s[i + 1] + s[i + 2]; n += 3; }
    return sum / n;
  };
  const setRange = (id, v) => page.evaluate(([id, v]) => {
    const el = document.querySelector(`[data-param="${id}"]`);
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  const visible = (id) => page.locator(`[data-param="${id}"]`).count();
  const check = (name, ok, detail) => { out[name] = ok ? 'PASS' : ('FAIL ' + JSON.stringify(detail === undefined ? null : detail)); };
  const ready = () => page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));
  const PRESETS = ['b:golden-hour', 'b:warm-cool', 'b:aura', 'b:neon-edge', 'b:cold-moon', 'b:studio-strip'];
  const PLACEMENT = '[id="p-lights.placement"]';

  // Lights behind the subject must render exactly as the recorded reference.
  await page.goto('http://127.0.0.1:5177/');
  await ready();
  const before = await page.evaluate(async () => {
    const data = await (await fetch('/__tests/ui/reference.json')).json();
    const decode = (text) => Array.from(atob(text), (c) => c.charCodeAt(0));
    return Object.fromEntries(Object.entries(data.presets).map(([key, text]) => [key, decode(text)]));
  });
  out.presetDiff = {};
  for (const key of PRESETS) { await page.selectOption('#presetSelect', key); out.presetDiff[key] = maxDiff(before[key], await sample()); }
  check('behind-only presets unchanged', Object.values(out.presetDiff).every((d) => d === 0), out.presetDiff);

  await page.selectOption('#presetSelect', 'b:warm-cool');
  check('old preset lights read as behind', (await page.inputValue(PLACEMENT)) === 'behind');

  await page.selectOption('#presetSelect', 'b:golden-hour');
  const single = await sample();
  await page.click('.item-add');
  const twoBehind = await sample();
  check('new light starts behind', (await page.inputValue(PLACEMENT)) === 'behind' && (await visible('lights.spread')) === 1 && (await visible('lights.radius')) === 0);

  await page.selectOption(PLACEMENT, 'front');
  const front = await sample();
  check('front swaps spread for radius', (await visible('lights.spread')) === 0 && (await visible('lights.radius')) === 1);
  check('focus returns to placement', await page.evaluate(() => document.activeElement && document.activeElement.id === 'p-lights.placement'));
  check('row tagged in front', (await page.locator('.item-row').nth(1).locator('.item-tag').textContent()) === 'In front');
  const sizes = await page.locator('.light-handle').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().width));
  check('front handle drawn larger', sizes[1] > sizes[0], sizes);
  check('front handle labelled', (await page.locator('.light-handle').nth(1).getAttribute('aria-label')) === 'Move Light 2, in front');
  check('front light changes image', !same(twoBehind, front));

  // Light 2 starts at the left (x 0.05), so the left of the subject gains more.
  const gainLeft = lum(front, 20, 40, 40, 110) - lum(single, 20, 40, 40, 110);
  const gainRight = lum(front, 56, 76, 40, 110) - lum(single, 56, 76, 40, 110);
  out.subjectGain = { left: Number(gainLeft.toFixed(2)), right: Number(gainRight.toFixed(2)) };
  check('front light brightens the side facing it', gainLeft > gainRight + 1 && gainRight >= 0, out.subjectGain);

  await page.check('#p-castShadow');
  await setRange('shadow', 0);
  const noShadow = await sample();
  await setRange('shadow', 1);
  const fullShadow = await sample();
  out.shadow = { backgroundDarker: Number((lum(noShadow, 80, 96, 0, 120) - lum(fullShadow, 80, 96, 0, 120)).toFixed(2)), faceDiff: maxDiff(noShadow.slice((60 * 96 + 40) * 4, (60 * 96 + 56) * 4), fullShadow.slice((60 * 96 + 40) * 4, (60 * 96 + 56) * 4)) };
  check('shadow darkens background away from light', out.shadow.backgroundDarker > 0.3, out.shadow);
  check('shadow leaves the subject alone', out.shadow.faceDiff === 0, out.shadow);
  await setRange('shadow', 0.6);

  await setRange('lights.radius', 300);
  const tight = await sample();
  await setRange('lights.radius', 1500);
  const wide = await sample();
  check('larger radius reaches further', lum(wide, 48, 96, 0, 120) > lum(tight, 48, 96, 0, 120), [lum(tight, 48, 96, 0, 120), lum(wide, 48, 96, 0, 120)]);
  await setRange('lights.radius', 700);

  await page.selectOption(PLACEMENT, 'behind');
  check('switching back restores behind light', same(twoBehind, await sample()));
  await page.selectOption(PLACEMENT, 'front');

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
  out.fullVsPreviewFront = Number((sum / (preview.length * 0.75)).toFixed(2));
  check('full render matches preview with a front light', out.fullVsPreviewFront < 3, out.fullVsPreviewFront);

  await page.setViewportSize({ width: 1040, height: 760 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'ui-front.png', scale: 'css' });

  out.errors = errors;
  const failed = Object.entries(out).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  return JSON.stringify({ summary: `${Object.values(out).filter((v) => v === 'PASS').length} pass, ${failed.length} fail`, failed, presetDiff: out.presetDiff, subjectGain: out.subjectGain, shadow: out.shadow, fullVsPreviewFront: out.fullVsPreviewFront, errors });
}
