import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { Destination } from '@tg/shared';
import { useDestinationsStore } from '@/features/posts/destinations-store';
import { ConnectCodeDialog } from '@/features/posts/settings/ConnectCodeDialog';
import { DestinationsCard } from '@/features/posts/settings/DestinationsCard';
import { RemoveDestinationDialog } from '@/features/posts/settings/RemoveDestinationDialog';
import { TimeZoneField } from '@/features/posts/settings/TimeZoneField';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

/** SCR-33 Settings — Channels & groups (owner manages, operator reads). */
export function ChannelsSettingsPage() {
  const { workspaceId = '' } = useParams();
  const guard = useShellGuard();
  const isOwner = useWorkspaceStore((s) => s.current?.role === 'owner');
  const { status, items, timeZone, scheduledTotal } = useDestinationsStore();
  const [connecting, setConnecting] = useState(false);
  const [removing, setRemoving] = useState<Destination | null>(null);

  useEffect(() => {
    const store = useDestinationsStore.getState();
    void store.load(workspaceId, guard);
    return store.watch(workspaceId, guard);
  }, [workspaceId, guard]);

  const reload = () => void useDestinationsStore.getState().load(workspaceId, guard);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Channels &amp; groups</h1>
        {isOwner && status === 'ready' && items.length > 0 && (
          <Button onClick={() => setConnecting(true)}>Connect a channel or group</Button>
        )}
      </div>
      {!isOwner && status === 'ready' && (
        <p className="text-sm text-muted-foreground">
          Only a business owner can connect channels and groups or change the time zone
        </p>
      )}
      {(status === 'idle' || status === 'loading') && items.length === 0 && (
        <Card>
          <CardContent>
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      )}
      {status === 'error' && (
        <Alert variant="destructive">
          <AlertDescription>Couldn't load channels and groups</AlertDescription>
          <Button size="sm" onClick={reload}>
            Retry
          </Button>
        </Alert>
      )}
      {status === 'ready' && items.length === 0 && (
        <Card>
          <CardContent className="space-y-3">
            <h2 className="font-medium">No channels or groups yet</h2>
            <p className="text-sm text-muted-foreground">
              Add the bot to your channel as an admin who can post messages, or to your group, then
              connect it here.
            </p>
            {isOwner && (
              <Button onClick={() => setConnecting(true)}>Connect a channel or group</Button>
            )}
          </CardContent>
        </Card>
      )}
      {status === 'ready' && items.length > 0 && (
        <DestinationsCard items={items} onRemove={isOwner ? setRemoving : undefined} />
      )}
      {status === 'ready' && (
        <TimeZoneField
          workspaceId={workspaceId}
          timeZone={timeZone}
          scheduledTotal={scheduledTotal}
          canEdit={isOwner}
          onSaved={reload}
        />
      )}
      {connecting && (
        <ConnectCodeDialog
          workspaceId={workspaceId}
          onClose={() => {
            setConnecting(false);
            reload();
          }}
        />
      )}
      {removing && (
        <RemoveDestinationDialog
          workspaceId={workspaceId}
          destination={removing}
          onClose={() => setRemoving(null)}
          onRemoved={reload}
        />
      )}
    </div>
  );
}
