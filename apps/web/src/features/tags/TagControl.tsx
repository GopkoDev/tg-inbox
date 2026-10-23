import { ErrorCode, checkTagName, type ContactTag, type MemberTagSource } from '@tg/shared';
import { Loader2, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { formatBotDay } from '@/features/bot/settings/format';
import { addContactTag, removeContactTag } from '@/features/contacts/api';
import { useContactsStore } from '@/features/contacts/store';
import { useGuard } from '@/features/workspaces/guard';
import { ApiError } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { FieldError } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Separator } from '@/shared/ui/separator';
import { Skeleton } from '@/shared/ui/skeleton';
import { matchTags } from './match';
import { useTagsStore } from './store';

const CONTACT_LIMIT = 20;
const CREATE = 'create';
const NO_TAGS: never[] = [];

const GUIDANCE =
  "Tags are visible to your whole team. Don't use them for health, religion or other sensitive traits.";
const NAME_RULES = 'A tag name must be 1 to 32 characters';
const NOTICES = {
  contact_limit: 'A contact can carry at most 20 tags. Remove one to add another.',
  workspace_limit:
    'A workspace can have at most 100 tags. A business owner can merge or delete some in Settings → Tags.',
  gone: 'This tag no longer exists.',
  error: "Couldn't change the tags — try again.",
} as const;
type Notice = keyof typeof NOTICES;

/** What is in flight: one add (a tag id or the create row) or one remove. */
type Pending = { kind: 'add'; key: string } | { kind: 'remove'; tagId: string } | null;

/** The rate-limit window of a `TAG_CHANGE_LIMIT_REACHED`: now and `details.retry_at` (ms). */
const rateWindow = (details: unknown): { now: number; retryAt: number } => {
  const now = Date.now();
  const at = (details as { retry_at?: unknown } | undefined)?.retry_at;
  const ms = typeof at === 'string' ? Date.parse(at) : NaN;
  return { now, retryAt: Number.isNaN(ms) ? now + 60_000 : ms };
};

/**
 * SCR-20: the tag control on a contact — a popover (not the `command` primitive, no new
 * dependency) opened from **Add tag** on the inbox header (`source: inbox`) and the profile
 * (`source: profile`). Matching runs here over the workspace's tags with the shared tidy / fold
 * rules; the server decides again. It stays open after each change and shows every refusal in
 * place. The host owns the carried tags (`tags`); an answer updates them through the contacts store.
 */
export function TagControl({
  workspaceId,
  contactId,
  tags,
  source,
}: {
  workspaceId: string;
  contactId: string;
  tags: ContactTag[];
  source: MemberTagSource;
}) {
  const guard = useGuard();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [nameError, setNameError] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const items = useTagsStore((s) => (s.workspaceId === workspaceId ? s.items : NO_TAGS));
  const status = useTagsStore((s) => (s.workspaceId === workspaceId ? s.status : 'loading'));

  // The workspace's tags follow `tags.changed` while the control is open. Frames that came while
  // it was closed were not followed, so every opening reads them again: in the background when a
  // list is already shown, with the skeletons otherwise.
  useEffect(() => {
    if (!open) return;
    const store = useTagsStore.getState();
    const shown = store.workspaceId === workspaceId && store.status === 'ready';
    void store.load(workspaceId, guard, shown ? { background: true } : {});
    return useTagsStore.getState().watch(workspaceId, guard);
    // the guard is stable per address; the tags are read once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  // The rate-limit countdown: a tick a second until `retry_at`, then the alert goes.
  useEffect(() => {
    if (retryAt === null) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= retryAt) setRetryAt(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const limited = retryAt !== null && now < retryAt;
  const busy = pending !== null || limited;
  const atLimit = tags.length >= CONTACT_LIMIT;
  const ready = status === 'ready';
  const matches = matchTags(
    ready ? items : NO_TAGS,
    text,
    tags.map((t) => t.id),
  );
  const addDisabled = busy || atLimit;
  const selectable = addDisabled
    ? []
    : [
        ...matches.rows.filter((r) => !r.carried).map((r) => r.tag.id),
        ...(matches.create !== null ? [CREATE] : []),
      ];
  // Typed text makes the first offer active, so Enter picks it.
  const active =
    activeKey !== null && selectable.includes(activeKey)
      ? activeKey
      : text.trim()
        ? (selectable[0] ?? null)
        : null;
  const optionId = (key: string) => `${listId}-${key}`;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setText('');
      setActiveKey(null);
      setNotice(null);
      setNameError(false);
    }
  };

  const refused = async (error: unknown) => {
    if (!(error instanceof ApiError)) return setNotice('error');
    switch (error.code) {
      case ErrorCode.TAG_NAME_INVALID:
        return setNameError(true);
      case ErrorCode.TAG_LIMIT_REACHED:
        return setNotice('workspace_limit');
      case ErrorCode.CONTACT_TAG_LIMIT_REACHED:
        // the host shows fewer tags than the contact carries: re-read so the rows disable
        setNotice('contact_limit');
        return void useContactsStore.getState().rereadContact(workspaceId, contactId, guard);
      case ErrorCode.TAG_NOT_FOUND:
        setNotice('gone');
        void useTagsStore.getState().load(workspaceId, guard, { background: true });
        return void useContactsStore.getState().rereadContact(workspaceId, contactId, guard);
      case ErrorCode.TAG_CHANGE_LIMIT_REACHED: {
        const window = rateWindow(error.details);
        setNow(window.now);
        return setRetryAt(window.retryAt);
      }
      default:
        break;
    }
    if (error.status === 401 || error.status === 403) {
      setOpen(false);
      return void guard(error, workspaceId).catch(() => undefined);
    }
    if (error.status === 404) {
      // the contact is not (or no longer) of this workspace: the host re-reads and says so
      setOpen(false);
      return void useContactsStore.getState().rereadContact(workspaceId, contactId, guard);
    }
    setNotice('error');
  };

  const run = async <T extends { tags: ContactTag[] }>(
    next: Pending,
    call: () => Promise<T>,
  ): Promise<T | null> => {
    setPending(next);
    setNotice(null);
    setNameError(false);
    try {
      const answer = await call();
      useContactsStore.getState().applyTags(workspaceId, contactId, answer.tags, guard);
      return answer;
    } catch (error) {
      await refused(error);
      return null;
    } finally {
      setPending(null);
    }
  };

  const add = async (key: string) => {
    if (addDisabled) return;
    let body: { tag_id: string } | { name: string };
    if (key === CREATE) {
      const check = checkTagName(text);
      if (!check.ok) {
        setNotice(null);
        return setNameError(true);
      }
      body = { name: check.name };
    } else body = { tag_id: key };
    const answer = await run({ kind: 'add', key }, () =>
      addContactTag(workspaceId, contactId, { ...body, source }),
    );
    if (!answer) return;
    if (answer.tag_created)
      void useTagsStore.getState().load(workspaceId, guard, { background: true });
    setText('');
    setActiveKey(null);
    input.current?.focus();
  };

  const remove = async (tagId: string) => {
    if (busy) return;
    await run({ kind: 'remove', tagId }, () =>
      removeContactTag(workspaceId, contactId, tagId, { source }),
    );
    // the pressed badge may be gone: focus stays in the control
    input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (selectable.length === 0) return;
      const at = active === null ? -1 : selectable.indexOf(active);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const from = at === -1 && step === -1 ? 0 : at;
      setActiveKey(selectable[(from + step + selectable.length) % selectable.length] ?? null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active !== null) void add(active);
      else if (text && !addDisabled) void add(CREATE);
    }
  };

  const shownNotice: Notice | null = notice ?? (atLimit ? 'contact_limit' : null);
  const spinner = <Loader2 data-testid="row-spinner" className="animate-spin" aria-hidden />;
  const rowClass = 'h-auto min-h-11 w-full justify-start md:min-h-8';

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="xs">
          <Plus aria-hidden />
          Add tag
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Tags"
        className="flex w-[calc(100vw-2rem)] flex-col gap-2 p-2 md:w-80"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
      >
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <Badge
                key={t.id}
                variant="secondary"
                title={`Added by ${t.added_by.display_name}, ${formatBotDay(t.added_at)}`}
                className="max-w-full pr-1"
              >
                <span className="truncate">{t.name}</span>
                <button
                  type="button"
                  aria-label={`Remove tag ${t.name}`}
                  disabled={busy}
                  onClick={() => void remove(t.id)}
                  className="rounded-full p-0.5 hover:bg-foreground/10 disabled:opacity-50"
                >
                  {pending?.kind === 'remove' && pending.tagId === t.id ? (
                    <Loader2
                      data-testid="row-spinner"
                      className="size-3 animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <X className="size-3" aria-hidden />
                  )}
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <Input
            ref={input}
            role="combobox"
            aria-label="Add a tag"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active !== null ? optionId(active) : undefined}
            aria-invalid={nameError || undefined}
            placeholder="Add a tag…"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setActiveKey(null);
              setNameError(false);
            }}
            onKeyDown={onKeyDown}
          />
          {nameError ? <FieldError>{NAME_RULES}</FieldError> : null}
        </div>
        {limited && retryAt !== null ? (
          <Alert>
            <AlertDescription>
              {`Tag changes are limited to 60 a minute. You can continue in ${Math.max(
                1,
                Math.ceil((retryAt - now) / 1000),
              )} s.`}
            </AlertDescription>
          </Alert>
        ) : null}
        {shownNotice ? (
          <Alert variant={shownNotice === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{NOTICES[shownNotice]}</AlertDescription>
          </Alert>
        ) : null}
        <Separator />
        <div
          id={listId}
          role="listbox"
          aria-label="Tag suggestions"
          className="flex max-h-64 flex-col gap-0.5 overflow-y-auto"
        >
          {status === 'error' ? (
            <Alert>
              <AlertDescription className="flex items-center justify-between gap-2">
                Couldn&apos;t load the tags
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void useTagsStore.getState().load(workspaceId, guard, {})}
                >
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : !ready ? (
            [0, 1, 2].map((n) => (
              <div key={n} data-testid="tag-skeleton" className="px-2 py-1.5">
                <Skeleton className="h-4 w-32" />
              </div>
            ))
          ) : (
            <>
              {items.length === 0 && !text.trim() ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  Type a name to create the first tag
                </p>
              ) : null}
              {matches.rows.map(({ tag, carried }) => (
                <Button
                  key={tag.id}
                  id={optionId(tag.id)}
                  type="button"
                  role="option"
                  variant="ghost"
                  size="sm"
                  aria-selected={active === tag.id}
                  disabled={carried || addDisabled}
                  onClick={() => void add(tag.id)}
                  className={cn(rowClass, active === tag.id && 'bg-accent')}
                >
                  <span className="truncate">{tag.name}</span>
                  {pending?.kind === 'add' && pending.key === tag.id ? (
                    <span className="ml-auto">{spinner}</span>
                  ) : carried ? (
                    <span className="ml-auto text-xs text-muted-foreground">✓ On this contact</span>
                  ) : null}
                </Button>
              ))}
              {matches.create !== null ? (
                <Button
                  id={optionId(CREATE)}
                  type="button"
                  role="option"
                  variant="ghost"
                  size="sm"
                  aria-selected={active === CREATE}
                  disabled={addDisabled}
                  onClick={() => void add(CREATE)}
                  className={cn(rowClass, active === CREATE && 'bg-accent')}
                >
                  {pending?.kind === 'add' && pending.key === CREATE ? (
                    spinner
                  ) : (
                    <Plus aria-hidden />
                  )}
                  <span className="truncate">{`Create tag "${matches.create}"`}</span>
                </Button>
              ) : null}
            </>
          )}
        </div>
        <Separator />
        <p className="px-2 text-xs text-muted-foreground">{GUIDANCE}</p>
      </PopoverContent>
    </Popover>
  );
}
