import type { AudienceTag, BroadcastDraft, TagFilterMode } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TagFilter } from '@/features/contacts/TagFilter';
import { useTagsStore } from '@/features/tags/store';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { formatCount } from './AudienceBreakdown';
import { useBroadcastDraftStore } from './draft-store';

const AUDIENCE_LIMIT = 10_000;

interface Choice {
  mode: TagFilterMode;
  include: string[];
  exclude: string[];
}

const choiceOf = (draft: BroadcastDraft): Choice => {
  if (draft.audience.kind !== 'tags') return { mode: 'any', include: [], exclude: [] };
  const ids = (kind: AudienceTag['kind']) =>
    draft.audience.kind === 'tags'
      ? draft.audience.tags.filter((t) => t.kind === kind).map((t) => t.tag_id)
      : [];
  return { mode: draft.audience.mode, include: ids('include'), exclude: ids('exclude') };
};

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));
const sameChoice = (a: Choice, b: Choice) =>
  a.mode === b.mode && sameIds(a.include, b.include) && sameIds(a.exclude, b.exclude);

const goneNotice = (name: string) =>
  `“${name}” no longer exists, so it was left out of this audience.`;

function Saving() {
  return <Loader2 data-testid="audience-saving" className="animate-spin" aria-hidden />;
}

/**
 * SCR-25's tag audience (AC-01, AC-05): **Send to** is the Contacts tag filter driven by the draft,
 * **Leave out** a popover of tags to leave out (a chosen tag is disabled in the other; «No tags»
 * disables Leave out). Each choice saves the whole tag audience through the draft store. Shows the
 * chosen and left-out tags as badges, the dropped-tag notices and the over-10 000 warning.
 */
export function TagAudience({ workspaceId }: { workspaceId: string }) {
  const guard = useShellGuard();
  const draft = useBroadcastDraftStore((s) => s.draft);
  const saving = useBroadcastDraftStore((s) => s.save === 'saving');
  const audiencePending = useBroadcastDraftStore((s) => s.audiencePending);
  const tagGone = useBroadcastDraftStore((s) => s.tagGone);
  const tags = useTagsStore((s) => s.items);
  const tagsStatus = useTagsStore((s) => s.status);

  // What the member chose, shown until the draft answers it (state adjusted while rendering).
  const [choice, setChoice] = useState<Choice | null>(null);
  const [choiceFor, setChoiceFor] = useState<BroadcastDraft | null>(draft);
  const [used, setUsed] = useState<'send' | 'leave' | null>(null);
  const [goneNames, setGoneNames] = useState<string[]>([]);
  // Another answer (a text save) leaves a choice still on its way shown: a next toggle builds on it.
  if (draft !== choiceFor) {
    setChoiceFor(draft);
    if (choice && (!audiencePending || !draft || sameChoice(choice, choiceOf(draft))))
      setChoice(null);
  }

  useEffect(() => {
    void useTagsStore.getState().load(workspaceId, guard);
    // the shell's guard is stable per address; the list is loaded once per workspace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // A tag deleted before the save: nothing was saved; it is unchecked and named here, and the
  // store's mark is taken in with a re-read of the tags.
  const nameOf = (tagId: string) =>
    tags.find((t) => t.id === tagId)?.name ??
    (draft?.audience.kind === 'tags'
      ? draft.audience.tags.find((t) => t.tag_id === tagId)?.name
      : undefined);
  const [seenGone, setSeenGone] = useState<string | null>(null);
  if (tagGone !== seenGone) {
    setSeenGone(tagGone);
    if (tagGone !== null) {
      const name = nameOf(tagGone);
      if (name !== undefined && !goneNames.includes(name)) setGoneNames([...goneNames, name]);
      setChoice(null);
    }
  }
  useEffect(() => {
    if (tagGone === null) return;
    useBroadcastDraftStore.getState().clearTagGone();
    void useTagsStore.getState().load(workspaceId, guard, { background: true });
    // the shell's guard is stable per address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagGone, workspaceId]);

  if (!draft || draft.audience.kind !== 'tags') return null;
  const shown = choice ?? choiceOf(draft);
  const storedName = new Map(draft.audience.tags.map((t) => [t.tag_id, t.name]));
  // The current name of a tag renamed since; the stored one until the tags are known.
  const label = (tagId: string) =>
    tags.find((t) => t.id === tagId)?.name ?? storedName.get(tagId) ?? '';

  const save = (next: Choice, control: 'send' | 'leave') => {
    setChoice(next);
    setUsed(control);
    useBroadcastDraftStore.getState().saveAudience(
      {
        kind: 'tags',
        mode: next.mode,
        tag_ids: next.mode === 'none' ? [] : next.include,
        exclude_tag_ids: next.mode === 'none' ? [] : next.exclude,
      },
      guard,
    );
  };
  const toggleLeftOut = (tagId: string, checked: boolean) => {
    const rest = shown.exclude.filter((t) => t !== tagId);
    save({ ...shown, exclude: checked ? [...rest, tagId] : rest }, 'leave');
  };

  const size = draft.breakdown.audience_size;
  const dropped = draft.audience.dropped_tags.map((t) => t.name);
  const notices = [...dropped, ...goneNames.filter((n) => !dropped.includes(n))];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <TagFilter
          tags={tags}
          status={tagsStatus === 'not_found' ? 'error' : tagsStatus}
          onRetry={() => void useTagsStore.getState().load(workspaceId, guard)}
          mode={shown.mode}
          tagIds={shown.include}
          onChange={(next) =>
            save(
              {
                mode: next.mode,
                include: next.tagIds,
                exclude: next.mode === 'none' ? [] : shown.exclude,
              },
              'send',
            )
          }
          label="Send to"
          disabledTagIds={shown.exclude}
          adornment={saving && used === 'send' ? <Saving /> : null}
          triggerClassName="w-full sm:w-auto"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={shown.mode === 'none'}
            >
              {shown.exclude.length > 0 ? `Leave out · ${shown.exclude.length}` : 'Leave out'}
              {saving && used === 'leave' ? <Saving /> : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex w-(--radix-popover-trigger-width) min-w-70 flex-col gap-2"
          >
            {tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tags yet — tags are added on a contact
              </p>
            ) : (
              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {tags.map((tag) => {
                  const chosen = shown.include.includes(tag.id);
                  return (
                    <Label
                      key={tag.id}
                      className="flex items-center gap-2 font-normal aria-disabled:opacity-50"
                      aria-disabled={chosen}
                    >
                      <Checkbox
                        checked={shown.exclude.includes(tag.id)}
                        disabled={chosen}
                        onCheckedChange={(v) => toggleLeftOut(tag.id, v === true)}
                      />
                      <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                      <span className="text-xs text-muted-foreground">{tag.contact_count}</span>
                    </Label>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {shown.include.length + shown.exclude.length > 0 ? (
        <div data-testid="audience-badges" className="flex flex-wrap gap-1.5">
          {shown.include.map((tagId) => (
            <Badge key={tagId} variant="secondary" className="max-w-full truncate">
              {label(tagId)}
            </Badge>
          ))}
          {shown.exclude.map((tagId) => (
            <Badge key={tagId} variant="outline" className="max-w-full truncate">
              {`− ${label(tagId)}`}
            </Badge>
          ))}
        </div>
      ) : null}
      {notices.length > 0 ? (
        <Alert>
          <AlertDescription className="flex flex-col gap-1">
            {notices.map((name) => (
              <span key={name}>{goneNotice(name)}</span>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      {size > AUDIENCE_LIMIT ? (
        <Alert>
          <AlertDescription>
            {`This audience holds ${formatCount(size)} contacts. A broadcast can reach at most ${formatCount(AUDIENCE_LIMIT)} — narrow it down to launch.`}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
