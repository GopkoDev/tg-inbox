import { useState, type ReactNode } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';

/**
 * A memory *data* router whose single splat route renders `children` (typically `<Routes>` plus
 * test helpers). The workspace frame reads `useMatches()`, which needs a data router.
 *
 * The router is created once, at mount: `children` (and `initialEntries`) are fixed from then on, so
 * a re-render with different children does not change what the route renders. Mount a new
 * `InDataRouter` (or use `createMemoryRouter(routes)` with `router.navigate`) to change them.
 */
export function InDataRouter({
  initialEntries,
  children,
}: {
  initialEntries: string[];
  children: ReactNode;
}) {
  const [router] = useState(() =>
    createMemoryRouter([{ path: '*', element: children }], { initialEntries }),
  );
  return <RouterProvider router={router} />;
}
