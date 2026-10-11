import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Skeleton } from '@/shared/ui/skeleton';
import { resolveWorkspace } from './resolve';

/** Entry point `/`: runs the AC-07 resolution; no session sends the person to sign-in. */
export function LandingRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    resolveWorkspace((to) => void navigate(to, { replace: true })).catch(
      () => void navigate('/sign-in', { replace: true }),
    );
  }, [navigate]);
  return <Skeleton className="m-4 h-9 w-48" />;
}
