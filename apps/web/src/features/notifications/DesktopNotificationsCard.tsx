import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '@/features/auth/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { readState, turnOff, turnOn, type DesktopState } from './desktop';

const COUNT_KEEPS_WORKING = 'The count in the tab title and next to Inbox keeps working.';

/**
 * SCR-16's Desktop notifications card (this browser, US-02). Renders without any request: the
 * state comes from the browser and the stored flag. The browser is asked for permission only
 * from the button's click (OS-01).
 */
export function DesktopNotificationsCard({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const accountId = useAuthStore((s) => s.account?.id ?? '');
  const [state, setState] = useState<DesktopState>(() => readState(accountId, workspaceId));
  const [asking, setAsking] = useState(false);

  const onTurnOn = async () => {
    setAsking(true);
    const next = await turnOn(accountId, workspaceId);
    setAsking(false);
    setState(next);
  };
  const onTurnOff = async () => {
    setState('off');
    await turnOff(accountId, workspaceId);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>
          <h2>Desktop notifications</h2>
        </CardTitle>
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
