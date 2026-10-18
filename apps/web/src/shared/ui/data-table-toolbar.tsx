import type { ReactNode } from 'react';

function DataTableToolbar({ search, filters }: { search?: ReactNode; filters?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {search ? <div className="min-w-48 flex-1 sm:max-w-sm">{search}</div> : null}
      {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
    </div>
  );
}

export { DataTableToolbar };
