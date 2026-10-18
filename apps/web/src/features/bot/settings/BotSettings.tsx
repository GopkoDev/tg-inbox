import { ErrorCode, type BotIdentity, type BotSettings as Settings } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { NotFoundCard } from '@/pages/NotFoundPage';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { botRefusal, reconnectBot } from '../api';
import { useBotStore } from '../store';
import { formatBotTime } from './format';

/** The dialog slots SCR-03 / SCR-04 / SCR-05 fill (T25, T26). */
export interface BotSettingsActions {
  /** Opens SCR-03; `notice` is a server message to show in it (reconnect → needs token). */
  onPasteToken?: (notice?: string) => void;
  /** Opens SCR-05 for the bot shown. */
  onDisconnect?: (bot: BotIdentity) => void;
  /** Opens SCR-04 for a reconnect that needs the takeover confirmation (the server message). */
  onTakeoverWarning?: (bot: BotIdentity, message: string) => void;
}

type Connected = Exclude<Settings, { state: 'not_connected' }>;

const BADGE: Record<Connected['state'], { text: string; destructive: boolean }> = {
  connected: { text: 'Connected', destructive: false },
  needs_token: { text: 'Not working — needs a new token', destructive: true },
  taken_over: { text: 'Not receiving messages', destructive: true },
};

const SOMETHING_WRONG = 'Something went wrong';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 sm:justify-start">
      <dt className="text-muted-foreground sm:w-48">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function BotSkeleton() {
  return (
    <Card className="max-w-xl" data-testid="bot-skeleton">
      <CardContent className="space-y-3">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-48" />
      </CardContent>
    </Card>
  );
}

/** SCR-02 body: the stored bot state, its facts and the state's way out. */
export function BotSettings({
  workspaceId,
  onPasteToken,
  onDisconnect,
  onTakeoverWarning,
}: { workspaceId: string } & BotSettingsActions) {
  const guard = useShellGuard();
  const navigate = useNavigate();
  const { settings, status, notice, load, replace, setNotice } = useBotStore();
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    void useBotStore.getState().load(workspaceId, guard);
  }, [workspaceId, guard]);

  const reconnect = async () => {
    setReconnecting(true);
    setNotice(workspaceId, null);
    try {
      replace(workspaceId, await reconnectBot(workspaceId, { confirm_takeover: false }));
    } catch (error) {
      const refusal = botRefusal(error);
      if (refusal?.code === ErrorCode.TAKEOVER_CONFIRMATION_REQUIRED && refusal.bot) {
        onTakeoverWarning?.(refusal.bot, refusal.message);
      } else if (refusal?.code === ErrorCode.BOT_NEEDS_NEW_TOKEN && refusal.settings) {
        replace(workspaceId, refusal.settings);
        onPasteToken?.(refusal.message);
      } else if (refusal?.code === ErrorCode.NOTHING_TO_RECONNECT && refusal.settings) {
        replace(workspaceId, refusal.settings, { tone: 'info', text: refusal.message });
      } else if (refusal?.code === ErrorCode.TELEGRAM_UNAVAILABLE) {
        setNotice(workspaceId, { tone: 'error', text: refusal.message });
      } else if (error instanceof ApiError && error.code === ErrorCode.OWNER_ONLY) {
        void load(workspaceId, guard);
      } else {
        try {
          await guard(error, workspaceId);
        } catch {
          setNotice(workspaceId, { tone: 'error', text: SOMETHING_WRONG });
        }
      }
    } finally {
      setReconnecting(false);
    }
  };

  if (status === 'not_found') return <NotFoundCard />;
  if (status === 'owners_only') {
    return (
      <Card className="max-w-xl">
        <CardContent className="space-y-3">
          <p>Only business owners manage the bot</p>
          <Button onClick={() => void navigate(`/w/${workspaceId}`)}>Back to home</Button>
        </CardContent>
      </Card>
    );
  }
  if (status === 'error') {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertDescription className="flex items-center justify-between gap-2">
          {SOMETHING_WRONG}
          <Button size="sm" variant="outline" onClick={() => void load(workspaceId, guard)}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (status === 'loading' || !settings) return <BotSkeleton />;

  return (
    <div className="max-w-xl space-y-3">
      {notice && (
        <Alert variant={notice.tone === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}
      {settings.state === 'not_connected' ? (
        <Card>
          <CardContent className="space-y-3">
            <p className="font-medium">No bot is connected</p>
            <p className="text-muted-foreground text-sm">
              Paste the token of your bot from BotFather; messages your customers send to it will
              arrive here
            </p>
            <Button className="w-full sm:w-auto" onClick={() => onPasteToken?.(undefined)}>
              Connect bot
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ConnectedCard
          settings={settings}
          reconnecting={reconnecting}
          onReconnect={() => void reconnect()}
          onPasteToken={() => onPasteToken?.(undefined)}
          onDisconnect={() => onDisconnect?.(settings.bot)}
        />
      )}
    </div>
  );
}

function ConnectedCard({
  settings,
  reconnecting,
  onReconnect,
  onPasteToken,
  onDisconnect,
}: {
  settings: Connected;
  reconnecting: boolean;
  onReconnect: () => void;
  onPasteToken: () => void;
  onDisconnect: () => void;
}) {
  const { bot, state } = settings;
  const badge = BADGE[state];
  const handle = `@${bot.username}`;
  const empty = settings.last_message_received_at === null && settings.contacts_count === 0;
  const pasteLabel =
    state === 'connected'
      ? 'New token'
      : state === 'needs_token'
        ? 'Paste new token'
        : 'Paste token again';

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{bot.name}</p>
            <Badge variant={badge.destructive ? 'destructive' : 'default'}>{badge.text}</Badge>
          </div>
          <a
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            href={`https://t.me/${bot.username}`}
            target="_blank"
            rel="noreferrer"
          >
            {handle}
          </a>
        </div>
        {state === 'needs_token' && (
          <Alert variant="destructive">
            <AlertDescription>
              Messages are not arriving. Paste a new token of {handle} from BotFather. Everything
              captured so far is kept.
            </AlertDescription>
          </Alert>
        )}
        {state === 'taken_over' && (
          <Alert variant="destructive">
            <AlertDescription>
              Another service took over this bot&apos;s messages. Reconnect to receive them here
              again; messages the other service received are not recovered.
            </AlertDescription>
          </Alert>
        )}
        <dl className="space-y-1 text-sm" data-testid="bot-facts">
          <Fact label="Last message received">
            {settings.last_message_received_at
              ? formatBotTime(settings.last_message_received_at)
              : 'none yet'}
          </Fact>
          <Fact label="Contacts captured">{settings.contacts_count}</Fact>
          <Fact label="Checked with Telegram">{formatBotTime(settings.last_checked_at)}</Fact>
        </dl>
        {empty && state === 'connected' && (
          <p className="text-muted-foreground text-sm">Write to {handle} in Telegram to test</p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          {state === 'taken_over' && (
            <Button disabled={reconnecting} onClick={onReconnect}>
              {reconnecting && <Loader2 className="animate-spin" data-testid="reconnect-spinner" />}
              Reconnect
            </Button>
          )}
          <Button
            variant={state === 'needs_token' ? 'default' : 'outline'}
            disabled={reconnecting}
            onClick={onPasteToken}
          >
            {pasteLabel}
          </Button>
          <Button
            className="text-destructive sm:ml-auto"
            variant="ghost"
            disabled={reconnecting}
            onClick={onDisconnect}
          >
            Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
