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
  const setRange = (id, v) => page.evaluate(([id, v]) => {
    const el = document.querySelector(`[data-param="${id}"]`);
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  const shadowSliders = () => page.locator('[data-param="shadow"], [data-param="shadowDistance"], [data-param="shadowSoftness"]').count();
  const checked = () => page.isChecked('#p-castShadow');
  const check = (name, ok, detail) => { out[name] = ok ? 'PASS' : ('FAIL ' + JSON.stringify(detail === undefined ? null : detail)); };
  const TOGGLE = '#p-castShadow';

  await page.goto('http://127.0.0.1:5177/');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));

  await page.selectOption('#presetSelect', 'b:gel-split');
  check('shadow off by default', !(await checked()) && (await shadowSliders()) === 0, [await checked(), await shadowSliders()]);
  const off = await sample();

  await page.check(TOGGLE);
  const on = await sample();
  check('ticking shows the shadow sliders', (await shadowSliders()) === 3);
  check('ticking adds the shadow', !same(off, on));
  check('focus stays on the checkbox', await page.evaluate(() => document.activeElement && document.activeElement.id === 'p-castShadow'));
  check('ticking marks preset Custom', await page.evaluate(() => { const s = document.querySelector('#presetSelect'); return s.options[s.selectedIndex].text === 'Custom'; }));

  await setRange('shadow', 0);
  check('off matches amount 0', same(off, await sample()));
  await setRange('shadow', 0.5);

  await page.keyboard.press('Space');
  await frames();
  check('space unticks', !(await checked()) && (await shadowSliders()) === 0);
  check('unticking removes the shadow', same(off, await sample()));

  await page.locator('#p-castShadow ~ *, label[for="p-castShadow"]').first().click();
  check('clicking the label ticks', await checked());

  // The switch is part of the layer, so a saved stack brings it back.
  await page.click('#stackSave');
  await page.fill('#stackNameInput', 'With shadow');
  await page.press('#stackNameInput', 'Enter');
  await page.selectOption('#presetSelect', 'b:gel-split');
  check('preset resets the switch', !(await checked()));
  await page.click('#stackMenu');
  await page.click('#menu button:has-text("With shadow")');
  check('saved stack keeps the switch', (await checked()) && same(on, await sample()));

  await page.selectOption('#presetSelect', 'b:gel-split');
  await page.check(TOGGLE);
  await frames();
  await page.setViewportSize({ width: 1040, height: 900 });
  await page.waitForTimeout(150);
  await page.evaluate(() => { const p = document.querySelector('#params'); p.scrollTop = p.scrollHeight; });
  await page.screenshot({ path: 'ui-shadow-toggle.png', scale: 'css' });

  out.errors = errors;
  const failed = Object.entries(out).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  return JSON.stringify({ summary: `${Object.values(out).filter((v) => v === 'PASS').length} pass, ${failed.length} fail`, failed, errors });
}
