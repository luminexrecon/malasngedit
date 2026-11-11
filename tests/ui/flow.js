async page => {
  const out = {};
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });

  const settled = () => page.waitForFunction(() => {
    const s = document.querySelector('#status');
    return !document.querySelector('#apply').matches('.x') && (s.textContent.includes('subject') || s.classList.contains('is-error') || s.textContent === 'No document');
  });
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
  const setRange = (id, v) => page.evaluate(([id, v]) => {
    const el = document.querySelector(`[data-param="${id}"]`);
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  const rangeValue = (id) => page.evaluate((id) => Number(document.querySelector(`[data-param="${id}"]`).value), id);
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.stack-name')].map((n) => n.textContent));
  const presetLabel = () => page.evaluate(() => { const s = document.querySelector('#presetSelect'); return s.options[s.selectedIndex].text; });
  const check = (name, ok, detail) => { out[name] = ok ? 'PASS' : ('FAIL ' + (detail === undefined ? '' : JSON.stringify(detail))); };

  await page.goto('http://127.0.0.1:5177/');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));

  out.renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });

  const base = await sample();

  await setRange('lights.intensity', 2.5);
  const brighter = await sample();
  check('slider changes image', !same(base, brighter));
  check('slider marks preset Custom', (await presetLabel()) === 'Custom', await presetLabel());

  await page.selectOption('#presetSelect', 'b:neon-edge');
  check('preset applies values', (await rangeValue('lights.intensity')) === 1.2, await rangeValue('lights.intensity'));
  check('preset label', (await presetLabel()) === 'Neon Edge');
  await page.selectOption('#presetSelect', 'b:golden-hour');
  check('returning to preset restores image', same(base, await sample()));

  await page.click('.card[data-effect="soft-glow"]');
  check('gallery swaps selected layer', JSON.stringify(await rows()) === '["Soft Glow"]', await rows());
  check('inspector follows effect', (await page.textContent('#effectName')) === 'Soft Glow');
  check('light handle hidden for soft glow', await page.locator('.light-handle').count().then((n) => n === 0));
  await page.click('.card[data-effect="rim-light"]');

  await page.click('#addFilter');
  await page.click('#menu button:has-text("Duotone")');
  check('add filter stacks', JSON.stringify(await rows()) === '["Rim Light","Duotone"]', await rows());
  const stacked = await sample();
  check('second filter changes image', !same(base, stacked));

  await page.click('.stack-item:nth-child(2) [aria-pressed]');
  check('toggling off restores image', same(base, await sample()));
  await page.click('.stack-item:nth-child(2) [aria-pressed]');
  check('toggling on restores stack', same(stacked, await sample()));

  await setRange('contrast', 2.2);
  await page.click('.stack-item:nth-child(2) [aria-label^="Reset"]');
  check('reset restores layer', same(stacked, await sample()));

  await page.click('#stackSave');
  await page.fill('#stackNameInput', 'My Look');
  await page.press('#stackNameInput', 'Enter');
  await page.click('.stack-item:nth-child(2) [aria-label^="Remove"]');
  check('remove layer', JSON.stringify(await rows()) === '["Rim Light"]', await rows());
  check('removing restores image', same(base, await sample()));
  await page.click('#stackMenu');
  await page.click('#menu button:has-text("My Look")');
  check('saved stack loads', JSON.stringify(await rows()) === '["Rim Light","Duotone"]', await rows());
  check('saved stack reproduces image', same(stacked, await sample()));
  await page.click('.stack-item:nth-child(2) [aria-label^="Remove"]');
  await page.click('.stack-name');

  await setRange('lights.intensity', 1.7);
  await page.click('#presetAdd');
  await page.fill('#presetNameInput', 'Mine <b>1</b>');
  await page.press('#presetNameInput', 'Enter');
  await frames();
  check('user preset saved', (await presetLabel()) === 'Mine <b>1</b>', await presetLabel());
  check('user preset deletable', await page.isEnabled('#presetRemove'));
  await page.click('#presetRemove');
  check('user preset deleted', (await presetLabel()) === 'Custom', await presetLabel());
  check('builtin preset not deletable', await (async () => {
    await page.selectOption('#presetSelect', 'b:golden-hour');
    return page.isDisabled('#presetRemove');
  })());

  await page.click('#presetAdd');
  await page.press('#presetNameInput', 'Escape');
  check('escape closes name row', await page.isHidden('#presetNameRow'));

  await page.click('#compare');
  const original = await sample();
  check('compare shows different image', !same(base, original));
  check('compare hides handle', await page.locator('.light-handle').count().then((n) => n === 0));
  await page.click('#compare');
  check('compare off restores', same(base, await sample()));

  const box = await page.locator('#frame').boundingBox();
  const handle = await page.locator('.light-handle').first().boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.3, { steps: 6 });
  await page.mouse.up();
  const lx = await rangeValue('lights.x');
  const ly = await rangeValue('lights.y');
  check('handle drag moves light', Math.abs(lx - 0.1) < 0.02 && Math.abs(ly - 0.3) < 0.02, [lx, ly]);
  check('handle drag marks Custom', (await presetLabel()) === 'Custom');
  const moved = await sample();
  check('handle drag changes image', !same(base, moved));
  const movedThumb = moved;

  const fitW = (await page.locator('#frame').boundingBox()).width;
  await page.click('#zoomIn');
  const zoomedW = (await page.locator('#frame').boundingBox()).width;
  check('zoom in', Math.abs(zoomedW / fitW - 1.25) < 0.01, [fitW, zoomedW]);
  await page.click('#zoomFit');
  check('fit restores', Math.abs((await page.locator('#frame').boundingBox()).width - fitW) < 1);

  await page.click('#galleryToggle');
  check('gallery hides', await page.isHidden('.gallery'));
  const grown = (await page.locator('#frame').boundingBox());
  await page.click('#galleryToggle');
  check('gallery shows', await page.isVisible('.gallery'));
  out.fitAfterGalleryHidden = Math.round(grown.width);

  await page.selectOption('#presetSelect', 'b:golden-hour');
  const finalPreview = await sample();
  const t0 = Date.now();
  await page.click('#apply');
  await page.waitForFunction(() => window.__applied && !document.querySelector('#apply').disabled, null, { timeout: 120000 });
  out.applyMs = Date.now() - t0;
  const applied = await page.evaluate(() => {
    const { params, pixels } = window.__applied;
    const full = document.createElement('canvas');
    full.width = params.width; full.height = params.height;
    const f = full.getContext('2d');
    f.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), params.width, params.height), 0, 0);
    const c = document.createElement('canvas');
    c.width = 96; c.height = 120;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(full, 0, 0, 96, 120);
    return { params, length: pixels.length, data: Array.from(g.getImageData(0, 0, 96, 120).data) };
  });
  check('apply output size', applied.length === 2400 * 3000 * 4, applied.length);
  check('apply layer name', applied.params.name === 'Rim Light', applied.params.name);
  let diff = 0; let maxDiff = 0;
  for (let i = 0; i < finalPreview.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs(finalPreview[i + c] - applied.data[i + c]);
      diff += d; if (d > maxDiff) maxDiff = d;
    }
  }
  out.previewVsFull = { meanAbsDiff: Number((diff / (finalPreview.length * 0.75)).toFixed(2)), maxDiff };
  check('full render matches preview', diff / (finalPreview.length * 0.75) < 3, out.previewVsFull);

  await page.evaluate(() => { window.__mock.noSubject = true; });
  await page.click('#reload');
  await page.waitForFunction(() => document.querySelector('#status').classList.contains('is-error'));
  check('no subject shows error', (await page.textContent('#status')).includes('No subject'), await page.textContent('#status'));
  check('layer flagged needs subject', (await rows())[0].includes('needs subject'), await rows());
  check('apply disabled without renderable layer', await page.isDisabled('#apply'));
  check('handle hidden without mask', await page.locator('.light-handle').count().then((n) => n === 0));
  await page.click('.card[data-effect="soft-glow"]');
  check('mask-free effect still usable', await page.isEnabled('#apply'));

  await page.evaluate(() => { window.__mock.noSubject = false; window.__mock.noDocument = true; });
  await page.click('#reload');
  await page.waitForFunction(() => !document.querySelector('#empty').hidden);
  check('no document shows empty state', await page.isVisible('#empty'));
  check('apply disabled without document', await page.isDisabled('#apply'));

  await page.evaluate(() => { window.__mock.noDocument = false; });
  await page.click('#reload');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));
  check('recovers after reload', await page.isVisible('#frame'));

  out.errors = errors;
  const failed = Object.entries(out).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  out.summary = `${Object.values(out).filter((v) => v === 'PASS').length} pass, ${failed.length} fail`;
  return JSON.stringify(out, null, 1);
}
