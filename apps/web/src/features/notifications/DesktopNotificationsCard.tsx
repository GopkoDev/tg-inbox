import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/features/auth/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { ensureWorker, readState, turnOff, turnOn, type DesktopState } from './desktop';

const COUNT_KEEPS_WORKING = 'The count in the tab title and next to Inbox keeps working.';

const Heading = () => (
  <CardTitle>
    <h2>Desktop notifications</h2>
  </CardTitle>
);

/**
 * SCR-16's Desktop notifications card (this browser, US-02). Renders without any request: the
 * state comes from the browser and the stored flag. The browser is asked for permission only
 * from the button's click (OS-01). The flag is per account, so the card waits for the account.
 */
export function DesktopNotificationsCard({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const accountId = useAuthStore((s) => s.account?.id);
  if (!accountId) {
    return (
      <Card>
        <CardHeader>
          <Heading />
        </CardHeader>
        <CardContent>
          <Skeleton data-testid="desktop-notifications-skeleton" className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }
  return (
    <DesktopCardBody
      key={`${accountId}.${workspaceId}`}
      accountId={accountId}
      workspaceId={workspaceId}
      workspaceName={workspaceName}
    />
  );
}

function DesktopCardBody({
  accountId,
  workspaceId,
  workspaceName,
}: {
  accountId: string;
  workspaceId: string;
  workspaceName: string;
}) {
  const [state, setState] = useState<DesktopState>(() => readState(accountId, workspaceId));
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(false);

  // The member may allow or block the site in the browser's settings while the card is open:
  // re-read on coming back to the tab and on the browser's own permission change.
  useEffect(() => {
    const reread = () => {
      if (!askingRef.current) setState(readState(accountId, workspaceId));
    };
    document.addEventListener('visibilitychange', reread);
    window.addEventListener('focus', reread);
    let status: PermissionStatus | null = null;
    let gone = false;
    navigator.permissions
      ?.query({ name: 'notifications' })
      .then((s) => {
        if (gone) return;
        status = s;
        s.addEventListener('change', reread);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', reread);
      window.removeEventListener('focus', reread);
      status?.removeEventListener('change', reread);
    };
  }, [accountId, workspaceId]);

  // An opt-in that is on needs its worker: bring it back if the browser lost it.
  const on = state === 'on';
  useEffect(() => {
    if (!on) return;
    let gone = false;
    void ensureWorker().then((ok) => {
      if (!ok && !gone) setState('unavailable');
    });
    return () => {
      gone = true;
    };
  }, [on]);

  const onTurnOn = async () => {
    askingRef.current = true;
    setAsking(true);
    let next: DesktopState;
    try {
      next = await turnOn(accountId, workspaceId);
    } catch {
      next = 'unavailable';
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
    setState(next);
  };
  const onTurnOff = async () => {
    setState('off');
    await turnOff(accountId, workspaceId);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <Heading />
        <Badge variant={state === 'on' ? 'default' : 'outline'}>
          {state === 'on' ? 'On' : state === 'unavailable' ? 'Not available' : 'Off'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === 'off' && (
          <>
            <p>
              {`Get a notification on this computer when a customer writes in a conversation that is yours or unassigned and you're not looking at ${workspaceName}.`}
            </p>
            <Button className="w-full sm:w-auto" disabled={asking} onClick={() => void onTurnOn()}>
              {asking && <Loader2 className="animate-spin" aria-hidden />}
              Turn on desktop notifications
            </Button>
          </>
        )}
        {state === 'on' && (
          <>
            <p>
              {`On for ${workspaceName} in this browser. Notifications show the customer's name, never the message.`}
            </p>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => void onTurnOff()}>
              Turn off
            </Button>
          </>
        )}
        {state === 'blocked' && (
          <>
            <Alert>
              <AlertDescription>
                Desktop notifications are blocked for this site in your browser. To allow them, open
                the site settings from the icon next to the address bar, set Notifications to Allow,
                and come back here.
              </AlertDescription>
            </Alert>
            <p className="text-muted-foreground">{COUNT_KEEPS_WORKING}</p>
          </>
        )}
        {state === 'unavailable' && (
          <p>{`This browser can't show desktop notifications. ${COUNT_KEEPS_WORKING}`}</p>
        )}
      </CardContent>
    </Card>
  );
}
