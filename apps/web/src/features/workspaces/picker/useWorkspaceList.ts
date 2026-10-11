import type { WorkspaceSummary, WorkspaceSummaryPage } from '@tg/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listMyWorkspaces } from '../api';
import { useGuard } from '../guard';

export type ListStatus = 'loading' | 'ready' | 'error';

type Loaded = { page: WorkspaceSummaryPage } | { failed: true } | { handled: true };

/** The operator's workspaces, paged (`after=next_cursor`); 401 goes through the shared guard. */
export function useWorkspaceList(autoLoad = true) {
  const guard = useGuard();
  const [items, setItems] = useState<WorkspaceSummary[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (after: string | undefined): Promise<Loaded> => {
      try {
        return { page: await listMyWorkspaces(after) };
      } catch (error) {
        try {
          await guard(error);
          return { handled: true };
        } catch {
          return { failed: true };
        }
      }
    },
    [guard],
  );

  const apply = useCallback((result: Loaded, append: boolean, mine: number) => {
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if ('page' in result) {
      setItems((prev) => (append ? [...prev, ...result.page.items] : result.page.items));
      setCursor(result.page.has_next ? result.page.next_cursor : null);
      setStatus('ready');
    } else if ('failed' in result) {
      setStatus('error');
    }
  }, []);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    setStatus('loading');
    return load(undefined).then((r) => apply(r, false, mine));
  }, [load, apply]);

  const more = useCallback(() => {
    if (cursor === null) return Promise.resolve();
    const mine = ++seq.current;
    setLoadingMore(true);
    return load(cursor).then((r) => apply(r, true, mine));
  }, [cursor, load, apply]);

  useEffect(() => {
    if (!autoLoad) return;
    const mine = ++seq.current;
    void load(undefined).then((r) => apply(r, false, mine));
  }, [autoLoad, load, apply]);

  return { items, status, hasMore: cursor !== null, loadingMore, reload, more };
}
