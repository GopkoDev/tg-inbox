import type { ThreadReply } from '@tg/shared';
import { AlertTriangle, Check, Clock, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { secondsUntil } from './reply';
import { SendAgainDialog, type SendAgainProblem } from './SendAgainDialog';
import { useInboxStore, type ResendResult } from './store';

const ACCOUNT_GONE = "Not delivered — the customer's Telegram account no longer exists";

const FAILURE_TEXT: Record<NonNullable<ThreadReply['failure_reason']>, string> = {
  customer_blocked: 'Not delivered — the customer blocked the bot',
  customer_account_gone: ACCOUNT_GONE,
  chat_not_found: ACCOUNT_GONE,
  bot_not_working: 'Not delivered — the bot is not working',
  author_access_removed: "Not delivered — the author's access was removed",
  telegram_not_accepted: 'Not delivered — Telegram did not accept it',
  delivery_interrupted: 'Not delivered — sending was interrupted',
};

const RETRYABLE = new Set<ThreadReply['failure_reason']>([
  'telegram_not_accepted',
  'delivery_interrupted',
]);

/**
 * The delivery state under a reply bubble (SCR-02 reply rows): the state line, the one safe
 * next step (Try again / Send again → SCR-05) and the feedback of a refused resend.
 */
export function ReplyDeliveryState({
  reply,
  workspaceId,
}: {
  reply: ThreadReply;
  workspaceId: string;
}) {
  const takenOver = useInboxStore((s) => s.bot?.state === 'taken_over');
  const resendReply = useInboxStore((s) => s.resendReply);
  const [pending, setPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [problem, setProblem] = useState<SendAgainProblem>(null);
  const [failed, setFailed] = useState(false);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (secondsUntil(retryAt, t) === 0) setRetryAt(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const seconds = retryAt ? secondsUntil(retryAt, now) : 0;

  const resend = async (confirmDuplicateRisk: boolean): Promise<ResendResult> => {
    setPending(true);
    setFailed(false);
    setProblem(null);
    setRetryAt(null);
    const result = await resendReply(workspaceId, reply.conversation_id, reply.id, {
      confirmDuplicateRisk,
    });
    setPending(false);
    return result;
  };

  const tryAgain = async () => {
    const result = await resend(false);
    if (result.kind === 'limited') {
      setNow(Date.now());
      setRetryAt(result.retryAt);
    } else if (result.kind === 'failed' || result.kind === 'confirmation_required') setFailed(true);
  };

  const sendAgain = async () => {
    const result = await resend(true);
    switch (result.kind) {
      case 'confirmation_required':
        setProblem('confirmation');
        return;
      case 'failed':
        setProblem('failed');
        return;
      case 'limited':
        setNow(Date.now());
        setRetryAt(result.retryAt);
        break;
      default:
        break;
    }
    setDialogOpen(false);
  };

  let line;
  switch (reply.state) {
    case 'sending':
      line = (
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" aria-hidden />
          Sending
        </span>
      );
      break;
    case 'sent':
      line = (
        <span className="inline-flex items-center gap-1">
          <Check className="size-3" aria-hidden />
          Sent
        </span>
      );
      break;
    case 'not_confirmed':
      line = <span>Not confirmed — it may or may not have reached the customer</span>;
      break;
    case 'not_delivered':
      line = (
        <span>{reply.failure_reason ? FAILURE_TEXT[reply.failure_reason] : 'Not delivered'}</span>
      );
      break;
  }

  return (
    <div className="mt-1 flex flex-col gap-1 text-xs" data-testid="reply-delivery">
      {line}
      {reply.failure_reason === 'customer_blocked' ? (
        <span>They can be reached again only after they unblock the bot and write to it</span>
      ) : null}
      {takenOver ? (
        <span className="inline-flex items-center gap-1">
          <AlertTriangle className="size-3" aria-hidden />
          New customer messages are not arriving
        </span>
      ) : null}
      {reply.state === 'not_delivered' && RETRYABLE.has(reply.failure_reason) ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="self-start"
          disabled={pending}
          onClick={() => void tryAgain()}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Try again
        </Button>
      ) : null}
      {reply.state === 'not_confirmed' ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => {
            setProblem(null);
            setDialogOpen(true);
          }}
        >
          Send again
        </Button>
      ) : null}
      {retryAt && seconds > 0 ? (
        <span role="status">
          {`Replies are limited to 30 per minute — you can send again in ${seconds} second${seconds === 1 ? '' : 's'}`}
        </span>
      ) : null}
      {failed ? <span role="alert">Something went wrong — try again</span> : null}
      <SendAgainDialog
        open={dialogOpen}
        pending={pending}
        problem={problem}
        onCancel={() => setDialogOpen(false)}
        onSendAgain={() => void sendAgain()}
      />
    </div>
  );
}
