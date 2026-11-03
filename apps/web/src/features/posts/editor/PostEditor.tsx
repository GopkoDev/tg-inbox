import {
  BROADCAST_TEXT_MAX,
  ErrorCode,
  Post,
  type Destination,
  type DestinationProblem,
  type DraftNotice,
} from '@tg/shared';
import { MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Textarea } from '@/shared/ui/textarea';
import { createPost, duplicatePost, getPost, listDestinations, savePost } from '../api';
import { DeletePostDialog } from './DeletePostDialog';

const SAVE_DELAY_MS = 600;
const numbers = new Intl.NumberFormat();

const NOTICES: Record<DraftNotice, string> = {
  owner_deactivated: 'Back in drafts: the owner who scheduled it no longer has access',
  owner_role_changed: 'Back in drafts: the owner who scheduled it is no longer an owner',
  destination_removed: 'Back in drafts: its channel or group was removed',
};

const PROBLEMS: Record<DestinationProblem, string> = {
  no_post_right: "The bot can't post there. Give it the right to post, then try again.",
  not_member: 'The bot is no longer in this channel or group.',
  chat_gone: 'This channel or group no longer exists.',
  not_current_bot: 'This destination was connected with another bot. Connect it again.',
};

interface Fields {
  text: string;
  silent: boolean;
  destinationId: string | null;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * SCR-37: the draft editor. Saves 600 ms after the last change and on blur, one save at a time
 * (a change made during a save waits and goes out with the new version); a stale save shows the
 * teammate's version and never overwrites it (AC-06).
 */
export function PostEditor({
  workspaceId,
  postId,
  isOwner,
  onPublish,
  onSchedule,
  onNotADraft,
}: {
  workspaceId: string;
  postId: string | null;
  isOwner: boolean;
  onPublish?: (post: Post) => void;
  onSchedule?: (post: Post) => void;
  onNotADraft?: () => void;
}) {
  const guard = useShellGuard();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(postId ? 'loading' : 'ready');
  const [post, setPost] = useState<Post | null>(null);
  const [fields, setFields] = useState<Fields>({ text: '', silent: false, destinationId: null });
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [stale, setStale] = useState(false);
  const [notDraft, setNotDraft] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reloads, setReloads] = useState(0);

  const idRef = useRef<string | null>(postId);
  const versionRef = useRef(0);
  const fieldsRef = useRef(fields);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const applyPost = useCallback((next: Post) => {
    const values = {
      text: next.text,
      silent: next.silent,
      destinationId: next.destination?.id ?? null,
    };
    idRef.current = next.id;
    versionRef.current = next.version;
    fieldsRef.current = values;
    dirtyRef.current = false;
    setPost(next);
    setFields(values);
  }, []);

  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      // a change waiting for its timer goes out now rather than being dropped
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void saveRef.current();
      }
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    listDestinations(workspaceId)
      .then((list) => live && setDestinations(list.items))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    // Our own first save moved the address to the new id: nothing to load.
    if (!postId || (postId === idRef.current && versionRef.current > 0)) return;
    let live = true;
    setStatus('loading');
    getPost(workspaceId, postId)
      .then((loaded) => {
        if (!live) return;
        applyPost(loaded);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!live) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403))
          void guard(error, workspaceId).catch(() => undefined);
        setStatus('error');
      });
    return () => {
      live = false;
    };
    // the shell's guard is stable per address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, postId, reloads, applyPost]);

  const save = useCallback(async () => {
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }
    if (!dirtyRef.current) return;
    const values = fieldsRef.current;
    if (values.text.length > BROADCAST_TEXT_MAX) return;
    const creating = idRef.current === null;
    if (creating && values.text === '' && values.destinationId === null && !values.silent) return;
    savingRef.current = true;
    dirtyRef.current = false;
    setSaveStatus('saving');
    try {
      let saved: Post;
      if (creating) {
        saved = await createPost(workspaceId, {
          text: values.text,
          destination_id: values.destinationId,
          silent: values.silent,
        });
        idRef.current = saved.id;
        if (aliveRef.current) navigate(`/w/${workspaceId}/posts/${saved.id}`, { replace: true });
      } else {
        saved = await savePost(workspaceId, idRef.current as string, {
          expected_version: versionRef.current,
          text: values.text,
          destination_id: values.destinationId,
          silent: values.silent,
        });
      }
      versionRef.current = saved.version;
      if (aliveRef.current) {
        setPost(saved);
        setSaveStatus('saved');
        setStale(false);
      }
    } catch (error) {
      dirtyRef.current = false;
      queuedRef.current = false;
      if (!aliveRef.current) return;
      const code = error instanceof ApiError ? error.code : null;
      if (code === ErrorCode.POST_DRAFT_CHANGED) {
        const details = (error as ApiError).details as { post?: unknown } | undefined;
        const theirs = Post.safeParse(details?.post);
        if (theirs.success) applyPost(theirs.data);
        else if (idRef.current)
          void getPost(workspaceId, idRef.current)
            .then((latest) => aliveRef.current && applyPost(latest))
            .catch(() => undefined);
        setStale(true);
        setSaveStatus('idle');
      } else if (code === ErrorCode.POST_NOT_A_DRAFT) {
        setNotDraft(true);
        setSaveStatus('idle');
        navigate(`/w/${workspaceId}/posts/${idRef.current}`, { replace: true });
        onNotADraft?.();
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        void guard(error, workspaceId).catch(() => undefined);
        setSaveStatus('error');
      } else {
        dirtyRef.current = true;
        setSaveStatus('error');
      }
    } finally {
      savingRef.current = false;
      if (queuedRef.current && aliveRef.current) {
        queuedRef.current = false;
        void save();
      }
    }
    // the shell's guard is stable per address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, navigate, applyPost]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const change = (patch: Partial<Fields>) => {
    const next = { ...fieldsRef.current, ...patch };
    fieldsRef.current = next;
    dirtyRef.current = true;
    setFields(next);
    setStale(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  };

  const flush = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    void save();
  };

  if (notDraft) {
    return (
      <div data-testid="post-not-a-draft" className="flex flex-col gap-2">
        <Alert>
          <AlertDescription>This post is no longer a draft</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div data-testid="post-editor-skeleton" className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center gap-3">
          Couldn&apos;t load the post
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setReloads((n) => n + 1)}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const length = fields.text.length;
  const tooMany = length - BROADCAST_TEXT_MAX;
  const empty = fields.text.trim() === '';
  const chosen =
    (post?.destination?.id === fields.destinationId ? post.destination : null) ??
    destinations.find((d) => d.id === fields.destinationId) ??
    null;
  const problem = chosen?.availability === 'unavailable' ? chosen.problem : null;
  const blocked = empty || tooMany > 0 || chosen === null || chosen.availability === 'unavailable';
  const channelsHref = `/w/${workspaceId}/settings/channels`;
  const saveText =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'saved'
        ? 'Saved'
        : saveStatus === 'error'
          ? "Couldn't save"
          : '';

  return (
    <div className="flex flex-col gap-4">
      {post?.draft_notice ? (
        <Alert>
          <AlertDescription>{NOTICES[post.draft_notice]}</AlertDescription>
        </Alert>
      ) : null}
      {stale ? (
        <Alert>
          <AlertDescription>A teammate changed this draft — showing their version</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="post-destination">Destination</Label>
        {destinations.length === 0 && chosen === null ? (
          <Link className="text-sm underline" to={channelsHref}>
            Connect a channel or group
          </Link>
        ) : (
          <Select
            value={fields.destinationId ?? undefined}
            onValueChange={(value) => {
              change({ destinationId: value });
              flush();
            }}
          >
            <SelectTrigger id="post-destination" aria-label="Destination" className="w-72">
              <SelectValue placeholder="Pick a destination">{chosen?.title}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {destinations.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {chosen === null ? (
          <p className="text-sm text-muted-foreground">Pick where the post goes</p>
        ) : null}
        {problem ? (
          <p className="text-sm text-destructive">
            {PROBLEMS[problem]}{' '}
            <Link className="underline" to={channelsHref}>
              Channels &amp; groups
            </Link>
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="post-text">Text</Label>
        <Textarea
          id="post-text"
          aria-label="Text"
          rows={10}
          value={fields.text}
          onChange={(event) => change({ text: event.target.value })}
          onBlur={flush}
        />
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          {empty ? <span>Write the text of the post</span> : <span />}
          {tooMany > 0 ? (
            <span className="text-destructive">{`${numbers.format(tooMany)} characters too many`}</span>
          ) : (
            <span>{`${numbers.format(BROADCAST_TEXT_MAX - length)} characters left`}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="post-silent"
          checked={fields.silent}
          onCheckedChange={(checked) => change({ silent: checked === true })}
        />
        <Label htmlFor="post-silent">Send without sound</Label>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Preview</span>
        <div
          data-testid="post-preview"
          className="max-w-md rounded-lg border bg-muted p-3 text-sm whitespace-pre-wrap break-words"
        >
          {fields.text}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isOwner ? (
          <>
            <Button
              type="button"
              disabled={blocked || post === null}
              onClick={() => post && onPublish?.(post)}
            >
              Publish now
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={blocked || post === null}
              onClick={() => post && onSchedule?.(post)}
            >
              Schedule…
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            A business owner publishes or schedules posts
          </p>
        )}
        <span role="status" className="text-sm text-muted-foreground">
          {saveText}
        </span>
        {post ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  void duplicatePost(workspaceId, post.id)
                    .then((copy) => navigate(`/w/${workspaceId}/posts/${copy.id}`))
                    .catch(() => undefined);
                }}
              >
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDeleting(true)}>Delete draft</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {deleting && post ? (
        <DeletePostDialog
          workspaceId={workspaceId}
          postId={post.id}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate(`/w/${workspaceId}/posts`)}
          onNotADraft={() => {
            setDeleting(false);
            setNotDraft(true);
            onNotADraft?.();
          }}
        />
      ) : null}
    </div>
  );
}
