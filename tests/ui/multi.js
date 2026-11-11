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
  const setRange = (id, v) => page.evaluate(([id, v]) => {
    const el = document.querySelector(`[data-param="${id}"]`);
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  const value = (id) => page.evaluate((id) => Number(document.querySelector(`[data-param="${id}"]`).value), id);
  const handles = () => page.locator('.light-handle').count();
  const rows = () => page.locator('.item-row').count();
  const presetLabel = () => page.evaluate(() => { const s = document.querySelector('#presetSelect'); return s.options[s.selectedIndex].text; });
  const check = (name, ok, detail) => { out[name] = ok ? 'PASS' : ('FAIL ' + JSON.stringify(detail === undefined ? null : detail)); };
  const pick = (n) => page.click(`.item-row:nth-child(n) .item-pick >> nth=${n}`);
  const pickLight = (n) => page.locator('.item-pick').nth(n).click();
  const corner = (s) => (s[8] + s[9] + s[10]) / 3;

  await page.goto('http://127.0.0.1:5177/');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));

  // Reference pictures recorded by `npm run test:ui -- --record`.
  const baseline = await page.evaluate(async () => {
    const data = await (await fetch('/__tests/ui/reference.json')).json();
    const decode = (text) => Array.from(atob(text), (c) => c.charCodeAt(0));
    return Object.fromEntries(Object.entries(data.presets).map(([key, text]) => [key, decode(text)]));
  });
  for (const key of Object.keys(baseline)) {
    await page.selectOption('#presetSelect', key);
    const diff = maxDiff(baseline[key], await sample());
    check(`regression ${key}`, diff <= 1, diff);
  }

  await page.selectOption('#presetSelect', 'b:golden-hour');
  const single = await sample();
  check('one light by default', (await handles()) === 1 && (await rows()) === 1, [await handles(), await rows()]);

  await page.click('.item-add');
  const two = await sample();
  check('add creates second light', (await handles()) === 2 && (await rows()) === 2);
  check('new light is active', (await value('lights.x')) === 0.05, await value('lights.x'));
  check('new light changes image', !same(single, two));
  check('add marks Custom', (await presetLabel()) === 'Custom');

  await page.locator('.item-row').nth(1).locator('[aria-pressed]').click();
  check('light off equals single light', same(single, await sample()));
  check('off handle dimmed', await page.locator('.light-handle').nth(1).evaluate((n) => n.classList.contains('is-off')));
  await page.locator('.item-row').nth(1).locator('[aria-pressed]').click();
  check('light on restores', same(two, await sample()));

  await page.fill('#p-lights\\.color', '#00ff00').catch(() => {});
  await page.evaluate(() => {
    const el = document.getElementById('p-lights.color');
    el.value = '#00ff00'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const green = await sample();
  check('color changes image', !same(two, green));
  const swatch = await page.locator('.item-swatch').nth(1).evaluate((n) => n.style.backgroundColor);
  const handleColor = await page.locator('.light-handle').nth(1).evaluate((n) => n.style.backgroundColor);
  check('swatch and handle follow color', swatch === 'rgb(0, 255, 0)' && handleColor === swatch, [swatch, handleColor]);

  await pickLight(0);
  check('accordion switches light', (await value('lights.x')) === 0.95, await value('lights.x'));
  check('only active light shows fields', (await page.locator('.item-fields').count()) === 1);

  const frame = await page.locator('#frame').boundingBox();
  const h2 = await page.locator('.light-handle').nth(1).boundingBox();
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.2, frame.y + frame.height * 0.6, { steps: 5 });
  await page.mouse.up();
  check('dragging selects that light', Math.abs((await value('lights.x')) - 0.2) < 0.02, await value('lights.x'));
  check('dragging moves y too', Math.abs((await value('lights.y')) - 0.6) < 0.02, await value('lights.y'));
  await pickLight(0);
  check('other light untouched by drag', (await value('lights.x')) === 0.95 && (await value('lights.y')) === 0.2, [await value('lights.x'), await value('lights.y')]);

  await page.locator('.light-handle').nth(1).focus();
  await page.keyboard.press('ArrowRight');
  check('arrow key selects and moves light', Math.abs((await value('lights.x')) - 0.21) < 0.015, await value('lights.x'));

  await page.locator('.item-row').nth(1).locator('[aria-label^="Remove"]').click();
  check('remove light', (await handles()) === 1);
  check('removing returns to single light', same(single, await sample()));
  check('last light cannot be removed', await page.locator('.item-row').first().locator('[aria-label^="Remove"]').isDisabled());

  for (let i = 0; i < 5; i += 1) await page.click('.item-add');
  check('six lights allowed', (await handles()) === 6);
  check('add disabled at max', await page.isDisabled('.item-add'));
  const six = await sample();
  check('six lights render', !same(single, six));

  await page.selectOption('#presetSelect', 'b:golden-hour');
  check('preset resets light list', (await handles()) === 1);
  check('preset restores image', same(single, await sample()));

  await setRange('lights.intensity', 2.2);
  await page.selectOption('#presetSelect', 'b:golden-hour');
  check('editing never mutates preset', same(single, await sample()));

  await page.click('.item-add');
  await page.click('#addFilter');
  await page.click('#menu button:has-text("Rim Light")');
  check('second rim layer starts with one light', (await handles()) === 1);
  await setRange('lights.intensity', 2.5);
  await page.locator('.stack-name').first().click();
  check('layers do not share lights', (await handles()) === 2 && (await page.locator('.stack-name').count()) === 2, await handles());
  await page.locator('.stack-item').nth(1).locator('[aria-label^="Remove"]').click();

  await page.selectOption('#presetSelect', 'b:warm-cool');
  check('two-light preset loads', (await handles()) === 2);
  const warmCool = await sample();
  await page.click('#stackSave');
  await page.fill('#stackNameInput', 'Duo');
  await page.press('#stackNameInput', 'Enter');
  await setRange('lights.intensity', 0.1);
  await page.click('#stackMenu');
  await page.click('#menu button:has-text("Duo")');
  check('saved stack unaffected by later edits', same(warmCool, await sample()));

  await page.selectOption('#presetSelect', 'b:golden-hour');
  await page.click('#compare');
  const original = await sample();
  await page.click('#compare');
  await page.click('.item-add');
  const oneFilterTwoLights = await sample();
  out.oneFilterDim = Number((corner(oneFilterTwoLights) / corner(original)).toFixed(2));
  check('one filter darkens once', Math.abs(out.oneFilterDim - 0.75) < 0.05, out.oneFilterDim);
  await page.click('#addFilter');
  await page.click('#menu button:has-text("Rim Light")');
  const twoFilters = await sample();
  out.twoFilterDim = Number((corner(twoFilters) / corner(original)).toFixed(2));
  await page.locator('.stack-item').nth(1).locator('[aria-label^="Remove"]').click();

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
  out.fullVsPreviewTwoLights = Number((sum / (preview.length * 0.75)).toFixed(2));
  check('full render matches preview with two lights', out.fullVsPreviewTwoLights < 3, out.fullVsPreviewTwoLights);

  await page.selectOption('#presetSelect', 'b:warm-cool');
  await frames();
  await page.setViewportSize({ width: 1040, height: 760 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'ui-multi.png', scale: 'css' });

  out.errors = errors;
  const failed = Object.entries(out).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  out.summary = `${Object.values(out).filter((v) => v === 'PASS').length} pass, ${failed.length} fail`;
  return JSON.stringify({ summary: out.summary, failed, errors, oneFilterDim: out.oneFilterDim, twoFilterDim: out.twoFilterDim, fullVsPreviewTwoLights: out.fullVsPreviewTwoLights });
}
