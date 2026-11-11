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
  const stats = (a, b) => {
    let sum = 0; let max = 0; let n = 0;
    for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c += 1) { const d = Math.abs(a[i + c] - b[i + c]); sum += d; n += 1; if (d > max) max = d; }
    return { mean: Number((sum / n).toFixed(3)), max };
  };
  // Mean brightness of one half of the sample (x < 48 is the left half).
  const half = (s, left) => {
    let sum = 0; let n = 0;
    for (let y = 0; y < 120; y += 1) for (let x = left ? 0 : 48; x < (left ? 48 : 96); x += 1) { const i = (y * 96 + x) * 4; sum += s[i] + s[i + 1] + s[i + 2]; n += 3; }
    return sum / n;
  };
  const setRange = (id, v) => page.evaluate(([id, v]) => {
    const el = document.querySelector(`[data-param="${id}"]`);
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  const check = (name, ok, detail) => { out[name] = ok ? 'PASS' : ('FAIL ' + JSON.stringify(detail === undefined ? null : detail)); };

  await page.goto('http://127.0.0.1:5177/');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));

  // Reference pictures recorded by `npm run test:ui -- --record`.
  const baseline = await page.evaluate(async () => {
    const data = await (await fetch('/__tests/ui/reference.json')).json();
    const decode = (text) => Array.from(atob(text), (c) => c.charCodeAt(0));
    return Object.fromEntries(Object.entries(data.presets).map(([key, text]) => [key, decode(text)]));
  });
  out.presetChange = {};
  for (const key of Object.keys(baseline)) {
    await page.selectOption('#presetSelect', key);
    out.presetChange[key] = stats(baseline[key], await sample());
  }

  await page.selectOption('#presetSelect', 'b:golden-hour');
  const field = await page.evaluate(() => {
    const n = document.querySelector('[data-number="lights.spread"]');
    const label = document.querySelector('label[for="p-lights.spread"]').textContent;
    return { value: n.value, max: n.max, label };
  });
  check('spread shown in whole degrees', field.value === '157' && field.max === '360', field);

  const sweep = [];
  for (const deg of [0, 45, 90, 135, 180, 225, 270, 315, 360]) {
    await setRange('lights.spread', deg);
    const s = await sample();
    sweep.push({ deg, left: Number(half(s, true).toFixed(2)), right: Number(half(s, false).toFixed(2)) });
  }
  out.sweep = sweep;
  check('wider spread never darkens', sweep.every((p, i) => i === 0 || (p.left >= sweep[i - 1].left - 0.01 && p.right >= sweep[i - 1].right - 0.01)), sweep);
  check('360 lights the side away from the light', sweep[8].left > sweep[3].left + 1, [sweep[3].left, sweep[8].left]);

  // At 360 every edge is fully lit, so where the light sits must not matter.
  await setRange('lights.spread', 360);
  const ringRight = await sample();
  await setRange('lights.x', 0.05);
  await setRange('lights.y', 0.9);
  const ringLeft = await sample();
  out.ringPositionDiff = stats(ringRight, ringLeft);
  check('360 halo has no direction', out.ringPositionDiff.max <= 1, out.ringPositionDiff);

  await page.selectOption('#presetSelect', 'b:aura');
  check('aura preset loads 360', (await page.evaluate(() => document.querySelector('[data-number="lights.spread"]').value)) === '360');
  await frames();
  await page.screenshot({ path: 'ui-aura.png', scale: 'css' });

  await page.selectOption('#presetSelect', 'b:golden-hour');
  await setRange('lights.spread', 360);
  await frames();
  await page.screenshot({ path: 'ui-golden-360.png', scale: 'css' });

  out.errors = errors;
  const failed = Object.entries(out).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  return JSON.stringify({ summary: `${Object.values(out).filter((v) => v === 'PASS').length} pass, ${failed.length} fail`, failed, presetChange: out.presetChange, sweep: out.sweep, ringPositionDiff: out.ringPositionDiff, errors });
}
