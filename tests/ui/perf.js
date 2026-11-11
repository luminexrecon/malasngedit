async page => {
  const setRange = (id, v) => page.evaluate(([id, v]) => {
    const el = document.querySelector(`[data-param="${id}"]`);
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  // Average time per preview frame while a slider is dragged: 40 input events,
  // each waited out to the next painted frame, so slow renders lengthen it.
  const dragMs = () => page.evaluate(async () => {
    const el = document.querySelector('[data-param="background"]');
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    await frame(); await frame();
    const t0 = performance.now();
    for (let i = 0; i < 40; i += 1) {
      el.value = 0.4 + (i % 10) * 0.03;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await frame();
    }
    await frame();
    return (performance.now() - t0) / 41;
  });
  const applyMs = async () => {
    await page.evaluate(() => { window.__applied = null; });
    const t0 = Date.now();
    await page.click('#apply');
    await page.waitForFunction(() => window.__applied && !document.querySelector('#apply').disabled, null, { timeout: 180000 });
    return Date.now() - t0;
  };

  await page.goto('http://127.0.0.1:5177/');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));
  await page.selectOption('#presetSelect', 'b:golden-hour');
  for (let i = 0; i < 5; i += 1) await page.click('.item-add');

  const result = { sharedDrag: [], ownDrag: [], sharedApply: [], ownApply: [] };
  for (let r = 0; r < 3; r += 1) result.sharedDrag.push(await dragMs());
  for (let r = 0; r < 2; r += 1) result.sharedApply.push(await applyMs());

  // Every light takes its own edge, bloom and glow, each at a different radius,
  // so no blurred mask can be shared between them.
  for (let i = 0; i < 6; i += 1) {
    await page.locator('.item-pick').nth(i).click();
    await page.check('[id="p-lights.ownEdge"]');
    await setRange('lights.rimWidth', 20 + i * 15);
    await setRange('lights.contactWidth', 1 + i);
    await page.check('[id="p-lights.ownBloom"]');
    await setRange('lights.bloomRadius', 30 + i * 25);
    await page.check('[id="p-lights.ownGlow"]');
    await setRange('lights.glowRadius', 80 + i * 40);
  }
  for (let r = 0; r < 3; r += 1) result.ownDrag.push(await dragMs());
  for (let r = 0; r < 2; r += 1) result.ownApply.push(await applyMs());

  const round = (list) => list.map((v) => Math.round(v * 10) / 10);
  return JSON.stringify({
    previewMsPerFrame: { shared: round(result.sharedDrag), ownAll6: round(result.ownDrag) },
    apply2400x3000Ms: { shared: result.sharedApply, ownAll6: result.ownApply },
  });
}
