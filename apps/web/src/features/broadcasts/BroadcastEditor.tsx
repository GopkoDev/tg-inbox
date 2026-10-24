import {
  BROADCAST_TEXT_MAX,
  ErrorCode,
  broadcastTextLength,
  checkBroadcastName,
  checkBroadcastText,
  tidyBroadcastText,
  type BroadcastDraft,
  type LaunchBreakdown,
} from '@tg/shared';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuthStore } from '@/features/auth/store';
import { formatBotTime } from '@/features/bot/settings/format';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Field, FieldError, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Textarea } from '@/shared/ui/textarea';
import { createBroadcast, duplicateBroadcast, getLaunchConfirmation } from './api';
import { AudienceBreakdown, formatCount } from './AudienceBreakdown';
import { DeleteDraftDialog } from './DeleteDraftDialog';
import { useBroadcastDraftStore, type DraftFieldsEdit } from './draft-store';
import { SwitchAudienceDialog } from './SwitchAudienceDialog';
import { TagAudience } from './TagAudience';

/** Saves wait for a pause in typing (or the field's blur), screens.md Decision 3. */
export const SAVE_PAUSE_MS = 800;

const NAME_ERROR = 'A name must be 1 to 80 characters';
const TEXT_ERROR = 'The text must be 1 to 4096 characters as Telegram counts them';
const OWNERS_ONLY = 'Only a business owner launches broadcasts.';
const NOT_AUTHOR = 'A draft is deleted by its author or a business owner';
const STALE =
  'A teammate changed this draft. Their version is shown; your edit is kept below to apply again.';
const BOT_REFUSALS: Record<string, string> = {
  not_connected: 'Launching needs a connected bot.',
  needs_token: "Your bot's token stopped working — replace it to launch.",
  taken_over: 'Your bot is connected elsewhere — reconnect it to launch.',
};

type Field = 'name' | 'text';

/** What the Message card shows for the text: its remaining length or its field error. */
function textState(text: string, touched: boolean) {
  const check = checkBroadcastText(text);
  const remaining = BROADCAST_TEXT_MAX - broadcastTextLength(tidyBroadcastText(text));
  if (check.ok) return { remaining, error: null };
  if (check.reason === 'too_long')
    return { remaining, error: `${TEXT_ERROR} — ${check.over} over` };
  return { remaining, error: touched ? TEXT_ERROR : null };
}

type LaunchRefusal =
  | { kind: 'bot'; state: string }
  | { kind: 'too_large'; size: number }
  | { kind: 'unreachable'; breakdown: LaunchBreakdown }
  | { kind: 'limit'; next: string }
  | { kind: 'duplicate_failed' };

/**
 * SCR-25, the draft editor's frame and Message card (screens.md Decisions 3–7): name and text saved
 * as you go against the shown version through the draft store, the status line, the stale-save
 * view, the Audience card with its kind and breakdown, and the role-aware title actions with the
 * launch pre-check refusals in place. Without `broadcastId` it is the `/new` editor: nothing is
 * created until the first valid name.
 */
export function BroadcastEditor({
  workspaceId,
  broadcastId,
  audienceControls,
}: {
  workspaceId: string;
  broadcastId?: string;
  /** The hand-picked group's controls (T33); the tag audience is built in. */
  audienceControls?: ReactNode;
}) {
  const navigate = useNavigate();
  const guard = useShellGuard();
  const role = useWorkspaceStore((s) => s.current?.role ?? 'operator');
  const me = useAuthStore((s) => s.account?.id);
  const draft = useBroadcastDraftStore((s) =>
    broadcastId && s.broadcastId === broadcastId ? s.draft : null,
  );
  const save = useBroadcastDraftStore((s) => s.save);
  const stale = useBroadcastDraftStore((s) => s.stale);

  const [values, setValues] = useState<Record<Field, string>>({
    name: draft?.name ?? '',
    text: draft?.text ?? '',
  });
  const [touched, setTouched] = useState<Record<Field, boolean>>({ name: false, text: false });
  /** SCR-32 is open: a non-empty group asked to switch to contacts with tags. */
  const [switching, setSwitching] = useState(false);
  const [syncedFor, setSyncedFor] = useState<string | null>(draft?.id ?? null);
  const [adopted, setAdopted] = useState<BroadcastDraft | null>(null);
  const [launching, setLaunching] = useState(false);
  const [refusal, setRefusal] = useState<LaunchRefusal | null>(null);
  const [noText, setNoText] = useState(false);
  const [ownersOnly, setOwnersOnly] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const timers = useRef<Partial<Record<Field, ReturnType<typeof setTimeout>>>>({});
  const textRef = useRef<HTMLTextAreaElement>(null);

  // A newly read draft fills the fields; a stale save shows the teammate's values (adjusted while rendering).
  if (draft && syncedFor !== draft.id) {
    setSyncedFor(draft.id);
    setValues({ name: draft.name, text: draft.text });
  }
  if (stale && adopted !== stale.theirs) {
    setAdopted(stale.theirs);
    setValues({ name: stale.theirs.name, text: stale.theirs.text });
  }

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of Object.values(pending)) clearTimeout(t);
    };
  }, []);

  const isNew = !broadcastId;
  const canLaunch = role === 'owner' && !ownersOnly;
  const canDelete = role === 'owner' || (draft !== null && draft.author.account_id === me);
  const botSettingsHref = role === 'owner' ? `/w/${workspaceId}/settings/bot` : undefined;
  const nameError = touched.name && !checkBroadcastName(values.name).ok ? NAME_ERROR : null;
  const text = textState(values.text, touched.text);
  const textError = noText ? 'Write the text before launching' : text.error;

  /** Creates the draft at the first valid name (`/new`), then the address becomes its own. */
  const create = async (name: string, rawText: string) => {
    if (creating) return;
    setCreating(true);
    const body = checkBroadcastText(rawText);
    try {
      const created = await createBroadcast(workspaceId, {
        name,
        ...(body.ok && { text: body.text }),
      });
      void navigate(`/w/${workspaceId}/broadcasts/${created.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        void guard(error, workspaceId);
      }
    } finally {
      setCreating(false);
    }
  };

  /** Sends a field when it is valid and differs from what the draft holds. */
  const commit = (field: Field, value: string) => {
    clearTimeout(timers.current[field]);
    if (field === 'name') {
      const check = checkBroadcastName(value);
      if (!check.ok) return;
      if (isNew) return void create(check.name, values.text);
      if (
        draft &&
        check.name === draft.name &&
        !('name' in useBroadcastDraftStore.getState().unsent)
      )
        return;
      useBroadcastDraftStore.getState().editFields({ name: check.name }, guard);
      return;
    }
    const check = checkBroadcastText(value);
    if (!check.ok || isNew) return;
    if (draft && check.text === draft.text && !('text' in useBroadcastDraftStore.getState().unsent))
      return;
    useBroadcastDraftStore.getState().editFields({ text: check.text }, guard);
  };

  const change = (field: Field, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setTouched((t) => ({ ...t, [field]: true }));
    if (field === 'text') setNoText(false);
    clearTimeout(timers.current[field]);
    timers.current[field] = setTimeout(() => commit(field, value), SAVE_PAUSE_MS);
  };

  const launch = async () => {
    if (!broadcastId) return;
    setLaunching(true);
    setRefusal(null);
    setNoText(false);
    try {
      await getLaunchConfirmation(workspaceId, broadcastId);
      void navigate(`/w/${workspaceId}/broadcasts/${broadcastId}/launch`);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      const details = (error instanceof ApiError ? error.details : undefined) as
        Record<string, unknown> | undefined;
      if (code === ErrorCode.BROADCAST_NEEDS_WORKING_BOT) {
        setRefusal({ kind: 'bot', state: String(details?.bot_state) });
      } else if (code === ErrorCode.BROADCAST_AUDIENCE_TOO_LARGE) {
        setRefusal({ kind: 'too_large', size: Number(details?.audience_size) });
      } else if (code === ErrorCode.BROADCAST_NO_REACHABLE_CONTACT) {
        setRefusal({ kind: 'unreachable', breakdown: details?.breakdown as LaunchBreakdown });
      } else if (code === ErrorCode.BROADCAST_LAUNCH_LIMIT_REACHED) {
        setRefusal({ kind: 'limit', next: String(details?.next_launch_at) });
      } else if (code === ErrorCode.BROADCAST_TEXT_INVALID) {
        setNoText(true);
        textRef.current?.focus();
      } else if (code === ErrorCode.OWNER_ONLY) {
        setOwnersOnly(true);
      } else if (code === ErrorCode.BROADCAST_NOT_A_DRAFT) {
        void useBroadcastDraftStore.getState().open(workspaceId, broadcastId, guard);
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        void guard(error, workspaceId);
      }
    } finally {
      setLaunching(false);
    }
  };

  const duplicate = async () => {
    if (!broadcastId) return;
    setDuplicating(true);
    setRefusal(null);
    try {
      const copy = await duplicateBroadcast(workspaceId, broadcastId, {
        audience: 'same',
        include_not_confirmed: false,
      });
      void navigate(`/w/${workspaceId}/broadcasts/${copy.id}`);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        void guard(error, workspaceId);
      } else setRefusal({ kind: 'duplicate_failed' });
    } finally {
      setDuplicating(false);
    }
  };

  const useMine = () => {
    const mine: DraftFieldsEdit = stale?.mine ?? {};
    setValues((v) => ({ ...v, ...mine }));
    useBroadcastDraftStore.getState().useMine(guard);
  };

  const mineBox = (field: Field) =>
    stale && stale.mine[field] !== undefined ? (
      <p
        data-testid={`mine-${field}`}
        className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words text-muted-foreground"
      >
        {stale.mine[field]}
      </p>
    ) : null;

  const audienceKind = draft?.audience.kind ?? 'tags';
  const groupSize = draft?.audience.kind === 'group' ? draft.audience.size : 0;

  const chooseKind = (kind: string) => {
    if (!draft || kind === draft.audience.kind) return;
    const store = useBroadcastDraftStore.getState();
    if (kind === 'group') store.saveAudience({ kind: 'group' }, guard);
    else if (groupSize === 0) {
      // An empty group switches at once; a non-empty one asks first (SCR-32).
      store.saveAudience({ kind: 'tags', mode: 'any', tag_ids: [], exclude_tag_ids: [] }, guard);
    } else setSwitching(true);
  };

  return (
    <section data-testid="broadcast-draft-view" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold break-words">
          {isNew ? 'New broadcast' : (draft?.name ?? '')}
        </h1>
        {!isNew ? <Badge variant="secondary">Draft</Badge> : null}
        <SaveLine
          status={save}
          onRetry={() => useBroadcastDraftStore.getState().retry(guard)}
          hidden={isNew}
        />
        {!isNew && draft ? (
          <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            {canLaunch ? (
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={launching}
                onClick={() => void launch()}
              >
                {launching ? (
                  <Loader2 data-testid="launch-spinner" className="animate-spin" aria-hidden />
                ) : null}
                Launch
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={launching || duplicating}
              onClick={() => void duplicate()}
            >
              {duplicating ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Duplicate
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" aria-label="More" disabled={launching}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canDelete ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                    Delete
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled>{NOT_AUTHOR}</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      {!isNew && !canLaunch ? <p className="text-sm text-muted-foreground">{OWNERS_ONLY}</p> : null}
      {refusal ? (
        <Refusal refusal={refusal} botSettingsHref={`/w/${workspaceId}/settings/bot`} />
      ) : null}
      {stale ? (
        <Alert>
          <AlertDescription className="flex flex-col gap-2">
            {STALE}
            <span className="flex gap-2">
              <Button type="button" size="sm" onClick={useMine}>
                Use mine
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => useBroadcastDraftStore.getState().keepTheirs()}
              >
                Keep theirs
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Message</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field data-invalid={nameError ? true : undefined}>
              <FieldLabel htmlFor="broadcast-name">Name</FieldLabel>
              <Input
                id="broadcast-name"
                value={values.name}
                aria-invalid={nameError ? true : undefined}
                onChange={(e) => change('name', e.target.value)}
                onBlur={(e) => commit('name', e.target.value)}
              />
              {mineBox('name')}
              {nameError ? <FieldError>{nameError}</FieldError> : null}
            </Field>
            <Field data-invalid={textError ? true : undefined}>
              <FieldLabel htmlFor="broadcast-text">Text</FieldLabel>
              <Textarea
                id="broadcast-text"
                ref={textRef}
                rows={8}
                className="whitespace-pre-wrap"
                value={values.text}
                aria-invalid={textError ? true : undefined}
                onChange={(e) => change('text', e.target.value)}
                onBlur={(e) => commit('text', e.target.value)}
              />
              {mineBox('text')}
              {textError ? (
                <FieldError>{textError}</FieldError>
              ) : (
                <p className="text-right text-xs text-muted-foreground tabular-nums">
                  {`${formatCount(Math.max(0, text.remaining))} characters left`}
                </p>
              )}
            </Field>
          </CardContent>
        </Card>

        <Card aria-disabled={isNew || undefined}>
          <CardHeader>
            <CardTitle>Audience</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {isNew || !draft ? (
              <p className="text-sm text-muted-foreground">Name the broadcast to start</p>
            ) : (
              <>
                <RadioGroup value={audienceKind} onValueChange={chooseKind}>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="audience-tags" value="tags" />
                    <Label htmlFor="audience-tags">Contacts with tags</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="audience-group" value="group" />
                    <Label htmlFor="audience-group">Hand-picked group</Label>
                  </div>
                </RadioGroup>
                {audienceKind === 'tags' ? (
                  <TagAudience workspaceId={workspaceId} />
                ) : (
                  audienceControls
                )}
                <AudienceBreakdown breakdown={draft.breakdown} botSettingsHref={botSettingsHref} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <SwitchAudienceDialog open={switching} onClose={() => setSwitching(false)} />
      <DeleteDraftDialog
        workspaceId={workspaceId}
        draft={
          deleting && draft ? { id: draft.id, audienceSize: draft.breakdown.audience_size } : null
        }
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleting(false);
          void navigate(`/w/${workspaceId}/broadcasts`);
        }}
        onLaunched={() => {
          setDeleting(false);
          if (broadcastId)
            void useBroadcastDraftStore.getState().open(workspaceId, broadcastId, guard);
        }}
        onGone={() => {
          setDeleting(false);
          void navigate(`/w/${workspaceId}/broadcasts`);
        }}
      />
    </section>
  );
}

function SaveLine({
  status,
  onRetry,
  hidden,
}: {
  status: 'idle' | 'saving' | 'saved' | 'failed';
  onRetry: () => void;
  hidden: boolean;
}) {
  if (hidden || status === 'idle') return null;
  if (status === 'failed')
    return (
      <span className="flex items-center gap-2 text-sm text-destructive">
        Couldn&apos;t save
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </span>
    );
  return (
    <span className="text-sm text-muted-foreground" aria-live="polite">
      {status === 'saving' ? 'Saving…' : 'Saved'}
    </span>
  );
}

function Refusal({
  refusal,
  botSettingsHref,
}: {
  refusal: LaunchRefusal;
  botSettingsHref: string;
}) {
  switch (refusal.kind) {
    case 'bot':
      return (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {BOT_REFUSALS[refusal.state] ?? BOT_REFUSALS.not_connected}
            <Button asChild size="sm" variant="outline">
              <Link to={botSettingsHref}>Open bot settings</Link>
            </Button>
          </AlertDescription>
        </Alert>
      );
    case 'too_large':
      return (
        <Alert>
          <AlertDescription>
            {`A broadcast's audience can hold at most ${formatCount(10_000)} contacts — this one holds ${formatCount(refusal.size)}.`}
          </AlertDescription>
        </Alert>
      );
    case 'unreachable':
      return (
        <Alert>
          <AlertDescription className="flex flex-col gap-2">
            <span>This audience has no reachable contact.</span>
            <AudienceBreakdown breakdown={refusal.breakdown} />
          </AlertDescription>
        </Alert>
      );
    case 'limit':
      return (
        <Alert>
          <AlertDescription>
            {`A workspace can launch at most 10 broadcasts in 24 hours. The next launch is possible at ${formatBotTime(refusal.next)}.`}
          </AlertDescription>
        </Alert>
      );
    case 'duplicate_failed':
      return (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t duplicate the broadcast</AlertDescription>
        </Alert>
      );
  }
}
