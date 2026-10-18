import { MessagesSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

type AuthLayoutProps = {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Applied to the column; pass `max-w-md` for a wider one. */
  className?: string;
};

/** Centred single-column layout for the entry screens: product mark, heading, description, content. */
export function AuthLayout({ title, description, children, className }: AuthLayoutProps) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 py-6">
      <div className={cn('flex w-full max-w-sm flex-col gap-6', className)}>
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-8 items-center justify-center rounded-md">
            <MessagesSquare className="size-6" aria-hidden="true" />
            <span className="sr-only">tg-inbox</span>
          </div>
          <h1 className="text-xl font-bold">{title}</h1>
          {description && <div className="text-muted-foreground text-sm">{description}</div>}
        </div>
        {children}
      </div>
    </main>
  );
}
