import { Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';
import { REPLY_LIMIT, canSendReply, isTooLong, secondsUntil } from './reply';
import { useInboxStore, type SendResult } from './store';
import { TeammateRepliedDialog } from './TeammateRepliedDialog';

interface Teammate {
  id: string;
  displayName: string;
  positionAt: string;
}

const NO_DRAFT = { text: '', clientKey: '', lastSeenReplyId: null };

/** SCR-02's reply box (mount it with `key={conversationId}`: transient state is per conversation): not optimistic — it locks while `sendReply` is in flight, and a refusal keeps the text. */
export function ReplyComposer({
  workspaceId,
  conversationId,
}: {
  workspaceId: string;
  conversationId: string;
}) {
  const draft = useInboxStore((s) => s.drafts[conversationId]) ?? NO_DRAFT;
  const bot = useInboxStore((s) => s.bot);
  const isOwner = useWorkspaceStore((s) => s.current?.role === 'owner');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [teammate, setTeammate] = useState<Teammate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (!retryAt) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (secondsUntil(retryAt, t) === 0) setRetryAt(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const unavailable = bot !== null && !bot.can_reply;
  const tooLong = isTooLong(draft.text);
  const seconds = retryAt ? secondsUntil(retryAt, now) : 0;
  const limited = retryAt !== null && seconds > 0;
  const canSend = canSendReply(draft.text) && !sending && !unavailable && !limited;

  function apply(result: SendResult) {
    switch (result.kind) {
      case 'limited':
        setRetryAt(result.retryAt);
        setNow(Date.now());
        break;
      case 'teammate':
        setTeammate(result.reply);
        break;
      case 'rejected':
        setRejected(result.message);
        break;
      case 'failed':
        setFailed(true);
        break;
      default:
        break;
    }
  }

  async function submit() {
    if (!canSend) return;
    setFailed(false);
    setRejected(null);
    setSending(true);
    const result = await useInboxStore.getState().sendReply(workspaceId, conversationId);
    setSending(false);
    if (result.kind === 'busy') return;
    apply(result);
  }

  async function sendAnyway() {
    setConfirming(true);
    setConfirmFailed(false);
    const result = await useInboxStore
      .getState()
      .sendReply(workspaceId, conversationId, { confirmTeammate: true });
    setConfirming(false);
    if (result.kind === 'failed' || result.kind === 'rejected') {
      setConfirmFailed(true);
      return;
    }
    setTeammate(null);
    apply(result);
  }

  function keepEditing() {
    if (teammate) useInboxStore.getState().keepEditing(conversationId, teammate.id);
    setTeammate(null);
    setConfirmFailed(false);
    setTimeout(() => field.current?.focus(), 0);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void submit();
  }

  if (unavailable) {
    const needsToken = bot.state === 'needs_token';
    return (
      <div className="space-y-2 border-t p-3">
        <Alert>
          <AlertDescription className="space-y-1">
            <p>
              {needsToken
                ? "Replies can't be sent — the bot is not working and needs a new token."
                : "Replies can't be sent — the bot is disconnected."}
            </p>
            <p>They can be sent again once the bot works.</p>
            {isOwner ? (
              <Button asChild variant="link" className="h-auto p-0">
                <Link to={`/w/${workspaceId}/settings/bot`}>Open bot settings</Link>
              </Button>
            ) : (
              <p>Ask a business owner to fix the bot.</p>
            )}
          </AlertDescription>
        </Alert>
        <div className="flex items-end gap-2">
          <Textarea
            ref={field}
            aria-label="Reply"
            value={draft.text}
            rows={1}
            disabled
            className="max-h-40 min-h-10 resize-none"
            onChange={() => undefined}
          />
          <Button type="button" disabled>
            Send
          </Button>
        </div>
      </div>
    );
  }

  const problem = tooLong ? `Replies are limited to ${REPLY_LIMIT} characters` : rejected;

  return (
    <div className="space-y-2 border-t p-3">
      <div className="flex items-end gap-2">
        <Textarea
          ref={field}
          aria-label="Reply"
          placeholder="Write a reply…"
          value={draft.text}
          rows={1}
          readOnly={sending}
          className="max-h-40 min-h-10 resize-none"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? messageId : undefined}
          onChange={(e) => {
            setRejected(null);
            useInboxStore.getState().setDraftText(conversationId, e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <Button type="button" disabled={!canSend} onClick={() => void submit()}>
          {sending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Send
        </Button>
      </div>
      {problem ? (
        <p
          id={messageId}
          role={rejected && !tooLong ? 'alert' : undefined}
          className="text-destructive text-sm"
        >
          {problem}
        </p>
      ) : null}
      {limited ? (
        <p role="status" className="text-sm text-muted-foreground">
          {`Replies are limited to 30 per minute — you can send again in ${seconds} second${seconds === 1 ? '' : 's'}`}
        </p>
      ) : null}
      {failed ? (
        <p role="status" className="text-destructive text-sm">
          Your reply was not sent — check your connection and send again
        </p>
      ) : null}
      <TeammateRepliedDialog
        open={teammate !== null}
        author={teammate?.displayName ?? ''}
        positionAt={teammate?.positionAt ?? new Date().toISOString()}
        pending={confirming}
        failed={confirmFailed}
        onKeepEditing={keepEditing}
        onSendAnyway={() => void sendAnyway()}
      />
    </div>
  );
}
