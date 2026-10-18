import { useState, type ReactNode } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';

/**
 * A memory *data* router whose single splat route renders `children` (typically `<Routes>` plus
 * test helpers). The workspace frame reads `useMatches()`, which needs a data router.
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
