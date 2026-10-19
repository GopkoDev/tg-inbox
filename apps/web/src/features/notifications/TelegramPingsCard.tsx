import { Loader2 } from 'lucide-react';
import type { IssuedConnectLink } from '@tg/shared';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link } from 'react-router';
import { formatBotClock, formatBotDay } from '@/features/bot/settings/format';
import { NotFoundCard } from '@/pages/NotFoundPage';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { ConnectTelegramDialog } from './ConnectTelegramDialog';
import { useNotificationsStore } from './store';

const NOT_LOADED = "Couldn't load your Telegram settings";
const NEEDS_BOT = 'Telegram pings need a working bot that receives messages.';

type Pings = 'on' | 'paused' | 'not_reachable';

const PINGS_BADGE: Record<
  Pings,
  { text: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  on: { text: 'Connected', variant: 'default' },
  paused: { text: 'Pings paused', variant: 'secondary' },
  not_reachable: { text: 'Not reachable', variant: 'destructive' },
};

function Spinner() {
  return <Loader2 className="animate-spin" aria-hidden />;
}

const HeadingRef = createContext<RefObject<HTMLHeadingElement | null> | null>(null);

function CardShell({ badge, children }: { badge?: ReactNode; children: ReactNode }) {
  const heading = useContext(HeadingRef);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>
          <h2 ref={heading} tabIndex={-1} className="outline-none">
            Telegram pings
          </h2>
        </CardTitle>
        {badge}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

/**
 * SCR-16's Telegram pings card: the caller's own link in this workspace and what it needs. A
 * `201` from Connect Telegram opens SCR-17 over it.
 */
export function TelegramPingsCard({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const guard = useShellGuard();
  const [issued, setIssued] = useState<IssuedConnectLink | null>(null);
  const connectButton = useRef<HTMLButtonElement>(null);
  const disconnectButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // A connect that succeeded unmounts Connect Telegram: focus goes to Disconnect, else the title.
  const returnFocus = () =>
    (connectButton.current ?? disconnectButton.current ?? heading.current)?.focus();
  return (
    <HeadingRef.Provider value={heading}>
      <PingsCard
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        onIssued={setIssued}
        connectButton={connectButton}
        disconnectButton={disconnectButton}
      />
      {issued && (
        <ConnectTelegramDialog
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          issued={issued}
          guard={guard}
          onClose={() => setIssued(null)}
          returnFocus={returnFocus}
        />
      )}
    </HeadingRef.Provider>
  );
}

function PingsCard({
  workspaceId,
  workspaceName,
  onIssued,
  connectButton,
  disconnectButton,
}: {
  workspaceId: string;
  workspaceName: string;
  onIssued: (link: IssuedConnectLink) => void;
  connectButton: RefObject<HTMLButtonElement | null>;
  disconnectButton: RefObject<HTMLButtonElement | null>;
}) {
  const guard = useShellGuard();
  const settings = useNotificationsStore((s) => s.settings);
  const status = useNotificationsStore((s) => s.status);
  const action = useNotificationsStore((s) => s.action);
  const notice = useNotificationsStore((s) => s.notice);
  const limitUntil = useNotificationsStore((s) => s.limitUntil);
  const mine = useNotificationsStore((s) => s.workspaceId === workspaceId);

  useEffect(() => {
    void useNotificationsStore.getState().load(workspaceId, guard);
    return useNotificationsStore.getState().watch(workspaceId, guard);
  }, [workspaceId, guard]);

  // The link limit lifts at `retry_at`: the alert goes and Connect is enabled again.
  useEffect(() => {
    if (!limitUntil) return;
    const wait = Math.max(0, new Date(limitUntil).getTime() - Date.now());
    const timer = setTimeout(() => useNotificationsStore.getState().clearLimit(workspaceId), wait);
    return () => clearTimeout(timer);
  }, [limitUntil, workspaceId]);

  if (!mine || (status === 'loading' && !settings)) {
    return (
      <CardShell>
        <div className="space-y-2" data-testid="telegram-pings-skeleton">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-40" />
        </div>
      </CardShell>
    );
  }
  if (status === 'not_found') return <NotFoundCard />;
  if (status === 'error' || !settings) {
    return (
      <CardShell>
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            {NOT_LOADED}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void useNotificationsStore.getState().load(workspaceId, guard)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </CardShell>
    );
  }

  const connect = async () => {
    const outcome = await useNotificationsStore.getState().connect(workspaceId, guard);
    if (outcome.kind === 'issued') onIssued(outcome.link);
  };
  const busy = action !== 'idle';
  const isOwner = settings.caller_role === 'owner';
  const openBotSettings = (
    <Button asChild variant="outline" className="w-full sm:w-auto">
      <Link to={`/w/${workspaceId}/settings/bot`}>Open bot settings</Link>
    </Button>
  );
  const alerts = (
    <>
      {limitUntil && (
        <Alert>
          <AlertDescription>
            Connect links are limited to 5 per 10 minutes — try again at{' '}
            {formatBotClock(limitUntil)}.
          </AlertDescription>
        </Alert>
      )}
      {notice === 'already_connected' && (
        <Alert>
          <AlertDescription>
            You&apos;re already connected — disconnect first to connect another Telegram account.
          </AlertDescription>
        </Alert>
      )}
      {notice === 'connect_failed' && (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t create a connect link — try again.</AlertDescription>
        </Alert>
      )}
      {notice === 'disconnect_failed' && (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t disconnect — try again.</AlertDescription>
        </Alert>
      )}
    </>
  );

  if (settings.telegram.state === 'connected') {
    const { display_name, linked_at, pings } = settings.telegram;
    const badge = PINGS_BADGE[pings];
    return (
      <CardShell
        badge={
          <Badge variant={badge.variant} data-variant={badge.variant}>
            {badge.text}
          </Badge>
        }
      >
        <p>
          {`Connected as ${display_name} since ${formatBotDay(linked_at)}, ${formatBotClock(linked_at)}.`}
        </p>
        {pings === 'on' && (
          <p className="text-muted-foreground text-sm">
            You&apos;ll get a ping in Telegram when customers wait and you&apos;re away from the
            panel.
          </p>
        )}
        {pings === 'paused' && (
          <>
            <p className="text-muted-foreground text-sm">
              Pings paused — the bot is not working. They start again when it works.
            </p>
            {isOwner ? (
              openBotSettings
            ) : (
              <p className="text-muted-foreground text-sm">Ask a business owner to fix the bot.</p>
            )}
          </>
        )}
        {pings === 'not_reachable' && (
          <p className="text-muted-foreground text-sm">
            Not reachable — you blocked the bot in Telegram. Unblock it, or disconnect.
          </p>
        )}
        {alerts}
        <Button
          ref={disconnectButton}
          variant="outline"
          className="w-full sm:w-auto"
          disabled={busy}
          aria-busy={action === 'disconnecting'}
          onClick={() => void useNotificationsStore.getState().disconnect(workspaceId, guard)}
        >
          {action === 'disconnecting' && <Spinner />}
          Disconnect
        </Button>
      </CardShell>
    );
  }

  const badge = (
    <Badge variant="outline" data-variant="outline">
      Not connected
    </Badge>
  );
  if (!settings.can_connect) {
    return (
      <CardShell badge={badge}>
        <p className="text-muted-foreground text-sm">
          {NEEDS_BOT}
          {isOwner ? '' : ' Ask a business owner to fix the bot.'}
        </p>
        {alerts}
        {isOwner && openBotSettings}
      </CardShell>
    );
  }
  return (
    <CardShell badge={badge}>
      <p className="text-muted-foreground text-sm">
        Get a message from the {workspaceName} bot in your own Telegram when a customer has waited 5
        minutes and you&apos;re away from the panel. Pings never include the customer&apos;s message
        or name.
      </p>
      {alerts}
      <Button
        ref={connectButton}
        className="w-full sm:w-auto"
        disabled={busy || limitUntil !== null}
        aria-busy={action === 'connecting'}
        onClick={() => void connect()}
      >
        {action === 'connecting' && <Spinner />}
        Connect Telegram
      </Button>
    </CardShell>
  );
}
