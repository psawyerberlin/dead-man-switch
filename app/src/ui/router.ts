// Hash router: `#/path?query`. Fixed routes plus two families with a parameter (`#/write/<step>`, `#/guide/<place>`).
export type RouteId = 'home' | 'write' | 'mine' | 'checkin' | 'open' | 'open-demo' | 'drill' | 'drill-report' | 'guide' | 'privacy' | 'about' | 'not-found';

/** Every route of the shell, by hash. */
export const ROUTES: Readonly<Record<string, RouteId>> = {
  '#/': 'home',
  '#/write': 'write',
  '#/mine': 'mine',
  '#/checkin': 'checkin',
  '#/open': 'open',
  '#/open/demo': 'open-demo',
  '#/drill': 'drill',
  '#/drill/report': 'drill-report',
  '#/guide': 'guide',
  '#/privacy': 'privacy',
  '#/about': 'about',
};

/** Routes whose last segment is a parameter (`#/drill/report` is an exact route and wins over `#/drill/<step>`). */
const FAMILIES: readonly [prefix: string, id: RouteId][] = [['#/write/', 'write'], ['#/drill/', 'drill'], ['#/guide/', 'guide']];

export interface Route {
  id: RouteId;
  /** the hash path without the query, e.g. `#/write/rhythm` */
  path: string;
  /** `rhythm` in `#/write/rhythm`, `cloud_drive` in `#/guide/cloud_drive` */
  param: string | null;
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  let raw = hash.startsWith('#') ? hash : `#${hash}`;
  if (raw === '#' || raw === '') raw = '#/';
  const q = raw.indexOf('?');
  let path = q < 0 ? raw : raw.slice(0, q);
  const query = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1));
  if (path.length > 2 && path.endsWith('/')) path = path.slice(0, -1);
  const exact = ROUTES[path];
  if (exact) return { id: exact, path, param: null, query };
  for (const [prefix, id] of FAMILIES) {
    const rest = path.startsWith(prefix) ? path.slice(prefix.length) : '';
    if (/^[a-z0-9_-]+$/.test(rest)) return { id, path, param: rest, query };
  }
  return { id: 'not-found', path, param: null, query };
}

/** Calls `onRoute` now and on every hash change; returns the function that stops listening. */
export function startRouter(onRoute: (r: Route) => void, win: Window = window): () => void {
  const fire = (): void => onRoute(parseHash(win.location.hash));
  win.addEventListener('hashchange', fire);
  fire();
  return () => win.removeEventListener('hashchange', fire);
}
