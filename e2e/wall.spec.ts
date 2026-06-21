import { test, expect, type Page } from '@playwright/test';

// Each journey from TEST_PLAN §4. Assertions are on visible state (DOM/SVG attributes, text).

test.beforeEach(async ({ request, page }) => {
  await request.get('/api/_test/reset'); // isolate: server state back to a clean t0
  await page.goto('/');
  await expect(page.getByTestId('wall')).toBeVisible();
});

function box(page: Page, id: string) {
  return page.locator(`[data-testid="node-box"][data-node="${id}"]`);
}
function quartileHexes(page: Page, id: string, sev: string) {
  return box(page, id).locator(`[data-testid="quartile-hex"][data-sev="${sev}"]`);
}

test('1. wall renders folded — pill reads 48, exactly 5 problem boxes', async ({ page }) => {
  await expect(page.getByTestId('folded-pill')).toContainText('48 healthy nodes folded');
  await expect(page.getByTestId('node-box')).toHaveCount(5);
});

test('2. quartile colors — 7-30 shows 3 red + 1 green; 3-08 shows 1 amber + 3 green', async ({
  page,
}) => {
  await expect(quartileHexes(page, 'ip-10-0-7-30', 'crit')).toHaveCount(3);
  await expect(quartileHexes(page, 'ip-10-0-7-30', 'ok')).toHaveCount(1);
  await expect(quartileHexes(page, 'ip-10-0-3-08', 'warn')).toHaveCount(1);
  await expect(quartileHexes(page, 'ip-10-0-3-08', 'ok')).toHaveCount(3);
});

test('3. border independence — 9-12 crit border + 4 green hexes; 2-45 neutral border + a red hex', async ({
  page,
}) => {
  await expect(box(page, 'ip-10-0-9-12')).toHaveAttribute('data-health', 'crit');
  await expect(quartileHexes(page, 'ip-10-0-9-12', 'ok')).toHaveCount(4);
  await expect(quartileHexes(page, 'ip-10-0-9-12', 'crit')).toHaveCount(0);

  await expect(box(page, 'ip-10-0-2-45')).toHaveAttribute('data-health', 'ok');
  await expect(quartileHexes(page, 'ip-10-0-2-45', 'crit')).toHaveCount(1);
});

test('4. expand rollup → real per-pod honeycomb (20/12 then 17/3)', async ({ page }) => {
  await box(page, 'ip-10-0-7-30').click();
  const detail = page.getByTestId('node-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-node', 'ip-10-0-7-30');
  await expect(page.locator('[data-testid="pod-hex"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="pod-hex"][data-sev="crit"]')).toHaveCount(12);

  await page.getByTestId('back').click();
  await box(page, 'ip-10-0-4-91').click();
  await expect(page.locator('[data-testid="pod-hex"]')).toHaveCount(17);
  await expect(page.locator('[data-testid="pod-hex"][data-sev="crit"]')).toHaveCount(3);
});

test('5. pod detail — crash block is ABOVE logs and shows CrashLoopBackOff / 137 / OOMKilled, highlighted', async ({
  page,
}) => {
  await box(page, 'ip-10-0-4-91').click();
  await page
    .locator('[data-pod-name="payments-api-7f9c8b6d4-q2x9z"]')
    .click();

  const crash = page.getByTestId('crash-block');
  await expect(crash).toBeVisible();
  await expect(page.getByTestId('crash-title')).toContainText('CrashLoopBackOff');
  await expect(page.getByTestId('crash-title')).toContainText('137');
  await expect(page.getByTestId('crash-title')).toContainText('OOMKilled');

  // crash block renders ABOVE the live logs
  const crashY = (await crash.boundingBox())!.y;
  const logsY = (await page.getByTestId('live-logs').boundingBox())!.y;
  expect(crashY).toBeLessThan(logsY);

  // previous logs: tokens highlighted (crit red, warn amber)
  const prev = page.getByTestId('prev-logs');
  const critTexts = await prev.locator('.log-crit').allInnerTexts();
  const joinedCrit = critTexts.join(' ');
  expect(joinedCrit).toContain('panic');
  expect(joinedCrit).toContain('503');
  expect(joinedCrit).toContain('OOMKilled');
  expect(joinedCrit).toContain('exit code 137');
  const warnTexts = (await prev.locator('.log-warn').allInnerTexts()).join(' ');
  expect(warnTexts.toLowerCase()).toContain('error');
  expect(warnTexts.toLowerCase()).toContain('timeout');
});

test('6. healthy reveal — clicking the pill toggles the folded-node strip', async ({ page }) => {
  await expect(page.getByTestId('healthy-strip')).toHaveCount(0);
  await page.getByTestId('folded-pill').click();
  await expect(page.getByTestId('healthy-strip')).toBeVisible();
  await expect(page.getByTestId('healthy-tile')).toHaveCount(48);
  await page.getByTestId('folded-pill').click();
  await expect(page.getByTestId('healthy-strip')).toHaveCount(0);
});

test('7. live update + hysteresis — new problem appears instantly, folds back after recovery', async ({
  page,
  request,
}) => {
  const six77 = box(page, 'ip-10-0-6-77');
  await expect(six77).toHaveCount(0);

  await request.get('/api/_test/advance?to=t1'); // problem appears immediately
  await expect(six77).toBeVisible();
  await expect(page.getByTestId('folded-pill')).toContainText('47 healthy nodes folded');

  await request.get('/api/_test/advance?to=t2'); // recovered but within hysteresis window
  await expect(six77).toBeVisible();

  await request.get('/api/_test/advance?to=t3'); // past hysteresis → folds back
  await expect(six77).toHaveCount(0);
  await expect(page.getByTestId('folded-pill')).toContainText('48 healthy nodes folded');
});

test('8. read-only UI — no mutating control exists anywhere', async ({ page }) => {
  // open every level so any hidden control would be in the DOM
  await box(page, 'ip-10-0-4-91').click();
  await page.locator('[data-pod-name="payments-api-7f9c8b6d4-q2x9z"]').click();
  await expect(page.getByTestId('pod-detail')).toBeVisible();

  const forbidden = /\b(edit|scale|delete|restart|apply|cordon|drain|kill|terminate|rollout)\b/i;
  const buttons = await page.locator('button').allInnerTexts();
  for (const t of buttons) expect(t).not.toMatch(forbidden);

  // no form controls that could mutate
  await expect(page.locator('input, textarea, select, form')).toHaveCount(0);
});

test('10. node age badge — each box shows how long it has been in its state', async ({ page }) => {
  // 7h-old disk-pressure node vs the 3m-old crashing node (fixture stateAgeMs)
  await expect(box(page, 'ip-10-0-9-12').getByTestId('node-age')).toContainText('7h');
  await expect(box(page, 'ip-10-0-4-91').getByTestId('node-age')).toContainText('3m');
  await expect(box(page, 'ip-10-0-7-30').getByTestId('node-age')).toContainText('42m');
});

test('11. folded healthy tiles are clickable → zoom into that node', async ({ page }) => {
  await page.getByTestId('folded-pill').click();
  const tile = page.getByTestId('healthy-tile').first();
  const name = await tile.getAttribute('data-node');
  await tile.click();
  const detail = page.getByTestId('node-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-node', name!);
});

test('12. pod log window scrolls internally (does not grow the page)', async ({ page }) => {
  await box(page, 'ip-10-0-4-91').click();
  await page.locator('[data-pod-name="payments-api-7f9c8b6d4-q2x9z"]').click();
  const logs = page.getByTestId('live-logs');
  await expect(logs).toBeVisible();

  // the panel is a fixed-height, internally-scrollable window
  const style = await logs.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { overflowY: cs.overflowY, maxHeight: cs.maxHeight };
  });
  expect(style.overflowY).toBe('auto');
  expect(style.maxHeight).not.toBe('none');

  // after heartbeats accumulate, the window stays bounded but its content overflows (scrollable)
  await page.waitForTimeout(3500);
  const dims = await logs.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
  }));
  expect(dims.clientHeight).toBeLessThan(500);
  expect(dims.scrollHeight).toBeGreaterThan(dims.clientHeight);
});

test('13. theme switcher toggles light / dark / system', async ({ page }) => {
  const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await expect(page.getByTestId('theme-switcher')).toBeVisible();

  await page.getByTestId('theme-dark').click();
  expect(await theme()).toBe('dark');

  await page.getByTestId('theme-light').click();
  expect(await theme()).toBe('light');

  await page.getByTestId('theme-system').click();
  expect(['dark', 'light']).toContain(await theme());

  // switcher persists into deeper views
  await box(page, 'ip-10-0-7-30').click();
  await expect(page.getByTestId('node-detail')).toBeVisible();
  await expect(page.getByTestId('theme-switcher')).toBeVisible();
});

test('9. screenshots — wall, node-detail, pod-detail (artifacts)', async ({ page }) => {
  await page.screenshot({ path: 'e2e/__screens__/01-wall.png', fullPage: true });

  await box(page, 'ip-10-0-7-30').click();
  await expect(page.getByTestId('node-detail')).toBeVisible();
  await page.screenshot({ path: 'e2e/__screens__/02-node-detail.png', fullPage: true });

  await page.getByTestId('back').click();
  await box(page, 'ip-10-0-4-91').click();
  await page.locator('[data-pod-name="payments-api-7f9c8b6d4-q2x9z"]').click();
  await expect(page.getByTestId('crash-block')).toBeVisible();
  await page.screenshot({ path: 'e2e/__screens__/03-pod-detail.png', fullPage: true });
});
