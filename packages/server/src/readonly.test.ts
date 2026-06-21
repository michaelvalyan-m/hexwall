// Read-only guard (FUNCTIONAL_SPEC §9 / TEST_PLAN §3): the route table must contain NO mutating
// cluster route. We assert no POST/PUT/PATCH/DELETE method is ever registered.

import { describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { buildCanonicalFixture } from './providers/fixtures';
import { MockProvider } from './providers/mockProvider';
import { ManualClock } from './providers/provider';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function routesFor(opts: { serveWeb?: boolean; enableTestHooks?: boolean }) {
  const clock = new ManualClock(0);
  const mock = new MockProvider({ fixture: buildCanonicalFixture(), clock });
  const server = buildServer({ provider: mock, clock, ...opts });
  return server.getRoutes();
}

describe('read-only route guard', () => {
  it('default server registers no mutating HTTP method', () => {
    const routes = routesFor({});
    expect(routes.length).toBeGreaterThan(0);
    const mutating = routes.filter((r) => MUTATING.has(r.method.toUpperCase()));
    expect(mutating).toEqual([]);
  });

  it('with test hooks + web serving still registers no mutating method', () => {
    const routes = routesFor({ enableTestHooks: true, serveWeb: true });
    const mutating = routes.filter((r) => MUTATING.has(r.method.toUpperCase()));
    expect(mutating).toEqual([]);
    // the test hook is a GET
    expect(routes.some((r) => r.url === '/api/_test/advance' && r.method === 'GET')).toBe(true);
  });

  it('exposes the documented read endpoints', () => {
    const urls = new Set(routesFor({ enableTestHooks: true }).map((r) => r.url));
    for (const u of [
      '/api/snapshot',
      '/api/stream',
      '/api/node/:name',
      '/api/pod/:ns/:name',
      '/api/pod/:ns/:name/logs',
      '/api/healthy',
      '/api/cell/*',
    ]) {
      expect(urls.has(u)).toBe(true);
    }
  });
});
