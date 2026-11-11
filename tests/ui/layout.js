async page => {
  const out = {};
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const check = (name, ok, detail) => { out[name] = ok ? 'PASS' : ('FAIL ' + JSON.stringify(detail === undefined ? null : detail)); };
  const box = (sel) => page.locator(sel).boundingBox();

  await page.setViewportSize({ width: 1040, height: 660 });
  await page.goto('http://127.0.0.1:5177/');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('subject detected'));

  const gallery = await box('.gallery');
  const viewer = await box('.viewer');
  const inspector = await box('.inspector');
  check('gallery left of preview', gallery.x === 0 && gallery.x + gallery.width <= viewer.x + 1, [gallery, viewer]);
  check('preview left of inspector', viewer.x + viewer.width <= inspector.x + 1, [viewer, inspector]);
  check('inspector at right edge', Math.abs(inspector.x + inspector.width - 1040) < 1, inspector);

  const toggle = await box('#galleryToggle');
  const zoom = await box('.zoom');
  check('gallery toggle on gallery side', toggle.x < viewer.x + 40, toggle);
  check('zoom on the other side', zoom.x + zoom.width > viewer.x + viewer.width - 40, zoom);
  const frame = await box('#frame');
  check('frame centred in viewer', Math.abs((frame.x + frame.width / 2) - (viewer.x + viewer.width / 2)) < 2, [frame, viewer]);

  await page.screenshot({ path: 'ui-layout.png', scale: 'css' });

  await page.click('#galleryToggle');
  const hiddenViewer = await box('.viewer');
  check('hidden gallery gives preview the left edge', hiddenViewer.x === 0, hiddenViewer);
  check('inspector stays right when gallery hidden', Math.abs((await box('.inspector')).x + (await box('.inspector')).width - 1040) < 1);
  const hiddenToggle = await box('#galleryToggle');
  check('toggle stays reachable when hidden', hiddenToggle.x < 40, hiddenToggle);
  await page.screenshot({ path: 'ui-layout-hidden.png', scale: 'css' });
  await page.click('#galleryToggle');

  // Tab order follows the visual left-to-right order: gallery cards come before the preview tools.
  await page.locator('.card').first().focus();
  const order = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, select, input, [tabindex]')].filter((n) => !n.disabled && n.offsetParent);
    const first = (sel) => els.indexOf(document.querySelector(sel));
    return { card: first('.card'), toggle: first('#galleryToggle'), zoom: first('#zoomOut'), preset: first('#presetSelect') };
  });
  check('tab order gallery, preview, inspector', order.card < order.toggle && order.toggle < order.zoom && order.zoom < order.preset, order);

  await page.setViewportSize({ width: 760, height: 440 });
  await page.waitForTimeout(150);
  const small = await box('.viewer');
  check('preview still usable at minimum panel size', small.width >= 250, small);
  await page.screenshot({ path: 'ui-layout-min.png', scale: 'css' });

  out.errors = errors;
  const failed = Object.entries(out).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL'));
  return JSON.stringify({ summary: `${Object.values(out).filter((v) => v === 'PASS').length} pass, ${failed.length} fail`, failed, errors });
}
