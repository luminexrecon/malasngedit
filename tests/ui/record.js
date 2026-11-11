// Records the reference pictures the other tests compare against: every
// built-in Rim Light preset, and a scene with shadows from two front lights.
// Run through `npm run test:ui -- --record`, only after a change that is meant
// to alter the pictures.
async page => {
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // The same 96x120 sample the tests take, as base64 to keep the file small.
  const sample = async () => {
    await frames();
    return page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 96; c.height = 120;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(document.querySelector('#preview'), 0, 0, 96, 120);
      const bytes = g.getImageData(0, 0, 96, 120).data;
      let text = '';
      for (let i = 0; i < bytes.length; i += 4096) text += String.fromCharCode(...bytes.subarray(i, i + 4096));
      return btoa(text);
    });
  };
  const setRange = (id, v) => page.evaluate(([id, v]) => {
    const el = document.querySelector(`[data-param="${id}"]`);
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);

  await page.goto('http://127.0.0.1:5177/');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));

  const keys = await page.evaluate(() => [...document.querySelectorAll('#presetSelect option')].map((o) => o.value).filter((v) => v.startsWith('b:')));
  const presets = {};
  for (const key of keys) {
    await page.selectOption('#presetSelect', key);
    presets[key] = await sample();
  }

  // Must match shadowScene() in own.js.
  await page.selectOption('#presetSelect', 'b:gel-split');
  await page.check('#p-castShadow');
  await setRange('shadow', 1);
  await setRange('shadowSoftness', 0);
  await page.locator('.item-pick').nth(0).click();
  await page.selectOption('[id="p-lights.placement"]', 'front');
  const shadowScene = await sample();

  return JSON.stringify({ presets, shadowScene });
}
