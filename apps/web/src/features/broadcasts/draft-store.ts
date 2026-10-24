import {
  ErrorCode,
  type BroadcastDraft,
  type BroadcastGroupAddMatching,
  type BroadcastGroupChange,
  type BroadcastGroupMatchingAdded,
  type BroadcastGroupRow,
  type GroupAudienceSave,
  type LaunchedBroadcast,
  type LiveFrame,
  type TagAudienceSave,
} from '@tg/shared';
import { create } from 'zustand';
import type { GuardFn } from '@/features/workspaces/guard';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ApiError } from '@/shared/api/client';
import { subscribeLive } from '@/shared/api/live-connection';
import {
  addBroadcastGroupContact,
  addBroadcastGroupMatching,
  getBroadcast,
  listBroadcastGroup,
  removeBroadcastGroupContact,
  saveBroadcastAudience,
  saveBroadcastFields,
} from './api';
import { serialRead } from '@/shared/lib/serial-read';

// The draft editor's store (SCR-25/26/27/31/32, screens.md Decision 3): fields are saved as they
// change against the version the store holds, one save in flight; a change made meanwhile goes out
// after it with the answer's version. A stale save keeps the member's own value beside the
// teammate's version (AC-03). Group adds and removes are sent one by one, outside the version.

export type Phase = 'idle' | 'loading' | 'ready' | 'error' | 'not_found' | 'launched';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';
export type MoreStatus = 'idle' | 'loading' | 'error';

export interface DraftFieldsEdit {
  name?: string;
  text?: string;
}

/** An audience choice as the editor sends it; the store adds the version it holds. */
export type AudienceChoice =
  Omit<TagAudienceSave, 'expected_version'> | Omit<GroupAudienceSave, 'expected_version'>;

export interface StaleSave {
  /** The teammate's version, now the held draft. */
  theirs: BroadcastDraft;
  /** The member's own values of the fields they were saving (Use mine / Keep theirs). */
  mine: DraftFieldsEdit;
  /** The member's own audience choice the stale save carried (sent again by Use mine). */
  audience?: AudienceChoice;
}

/** Why the open draft turned out launched (SCR-28's one-line notice); null after an own launch. */
export type LaunchNotice = 'teammate' | 'refused';

/** Fields the server refused as invalid (SCR-25 field errors) until they are edited again. */
export type RejectedFields = Partial<Record<keyof DraftFieldsEdit, true>>;

export interface GroupState {
  status: 'loading' | 'ready' | 'error';
  items: BroadcastGroupRow[];
  hasNext: boolean;
  nextCursor: string | null;
  more: MoreStatus;
}

interface DraftStoreState {
  workspaceId: string | null;
  broadcastId: string | null;
  status: Phase;
  draft: BroadcastDraft | null;
  /** Set when the broadcast turned out launched (SCR-25 switches to SCR-28). */
  launched: LaunchedBroadcast | null;
  launchNotice: LaunchNotice | null;
  save: SaveStatus;
  /** An audience choice is queued or in flight (its answer has not landed yet). */
  audiencePending: boolean;
  rejected: RejectedFields;
  /** Field edits not saved yet (queued, in flight or failed); kept across a 401 for the same address. */
  unsent: DraftFieldsEdit;
  stale: StaleSave | null;
  /** `BROADCAST_GROUP_CHANGED` on a switch to tags: the group size to confirm again (SCR-32). */
  groupChanged: number | null;
  /** `TAG_NOT_FOUND` on an audience save: the tag that is gone; nothing was saved (SCR-25). */
  tagGone: string | null;
  /** The editor took the gone tag in (its notice shows, the tags are read again). */
  clearTagGone: () => void;
  group: GroupState | null;
  /** `notice`: what SCR-28 says when the read answers launched (none after an own launch). */
  open: (
    workspaceId: string,
    broadcastId: string,
    guard: GuardFn,
    notice?: LaunchNotice,
  ) => Promise<void>;
  /** Hands edits made on `/new` while the create was in flight to the created draft (sent on open). */
  carry: (workspaceId: string, broadcastId: string, edit: DraftFieldsEdit) => void;
  editFields: (edit: DraftFieldsEdit, guard: GuardFn) => void;
  saveAudience: (choice: AudienceChoice, guard: GuardFn) => void;
  /** Sends the unsent edit again (Couldn't save — Retry). */
  retry: (guard: GuardFn) => void;
  useMine: (guard: GuardFn) => void;
  keepTheirs: () => void;
  loadGroup: (guard: GuardFn) => Promise<void>;
  /** Reads the held draft again in the background (its breakdown after group changes). */
  reread: (guard: GuardFn) => Promise<void>;
  showMoreGroup: (guard: GuardFn) => Promise<void>;
  addContact: (contactId: string, guard: GuardFn) => Promise<BroadcastGroupChange | null>;
  removeContact: (contactId: string, guard: GuardFn) => Promise<BroadcastGroupChange | null>;
  addMatching: (
    body: BroadcastGroupAddMatching,
    guard: GuardFn,
  ) => Promise<BroadcastGroupMatchingAdded | null>;
  /** Acts on `status` and `deleted` of the open broadcast, `resync` and reconnects only. */
  watch: (workspaceId: string, guard: GuardFn) => () => void;
  close: () => void;
  /** Drops the kept unsent edit too (workspace switch, sign-out of another member). */
  forget: () => void;
}

const isGuardAnswer = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);
const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;
const codeOf = (error: unknown) => (error instanceof ApiError ? error.code : null);

export const useBroadcastDraftStore = create<DraftStoreState>()((set, get) => {
  /** Counts every opening: late answers of an earlier one are dropped. */
  let epoch = 0;
  /** The unsent edit belongs to this address (workspace + broadcast). */
  let unsentFor: string | null = null;
  /** The address whose carried edit goes out as soon as it opens. */
  let sendOnOpen: string | null = null;
  let pendingAudience: AudienceChoice | null = null;
  /** The opening whose save loop is running: an earlier opening's loop never blocks or frees a later one. */
  let savingEpoch: number | null = null;
  /** The group calls, chained so that each starts after the previous one answered. */
  let groupChain: Promise<unknown> = Promise.resolve();
  /** Counts every replacement of the group list: a Show more answer for an older list is dropped. */
  let groupSeq = 0;
  /** Counts the full (skeleton) group loads: an earlier read's answer is dropped. */
  let groupLoads = 0;
  /** A background group re-read asked for while Show more was in flight runs after it. */
  let groupRereadWaits = false;
  /** The background reads of this opening, one in flight and one queued (made at open). */
  let draftReread: (() => Promise<void>) | null = null;
  let groupReread: (() => Promise<void>) | null = null;

  const address = () => `${get().workspaceId}:${get().broadcastId}`;
  const shows = (workspaceId: string) => get().workspaceId === workspaceId;

  const markLaunched = async (workspaceId: string, broadcastId: string, opened: number) => {
    set({ status: 'launched', launchNotice: 'refused' });
    try {
      const b = await getBroadcast(workspaceId, broadcastId, { background: true });
      if (opened === epoch && b.status !== 'draft') set({ launched: b });
    } catch {
      // Nothing to show yet: the load error with Retry (which opens the address again).
      if (opened === epoch && !get().launched) set({ status: 'error' });
    }
  };

  /** Sends the queued saves one at a time with the held version. */
  const pump = async (guard: GuardFn) => {
    if (savingEpoch === epoch) return;
    const { workspaceId, broadcastId } = get();
    if (!workspaceId || !broadcastId) return;
    const opened = epoch;
    savingEpoch = opened;
    try {
      for (;;) {
        const { draft, status, unsent } = get();
        if (opened !== epoch || status !== 'ready' || !draft) return;
        const fields = { ...unsent };
        const audience = pendingAudience;
        if (Object.keys(fields).length === 0 && !audience) {
          set({ save: get().save === 'saving' ? 'saved' : get().save });
          return;
        }
        set({ save: 'saving' });
        try {
          let next: BroadcastDraft;
          if (Object.keys(fields).length > 0) {
            next = await saveBroadcastFields(workspaceId, broadcastId, {
              expected_version: draft.version,
              ...fields,
            });
            if (opened !== epoch) return;
            // Edits made meanwhile stay unsent; what was saved leaves the queue.
            const left: DraftFieldsEdit = { ...get().unsent };
            for (const key of Object.keys(fields) as (keyof DraftFieldsEdit)[]) {
              if (left[key] === fields[key]) delete left[key];
            }
            set({ draft: next, unsent: left });
          } else {
            pendingAudience = null;
            next = await saveBroadcastAudience(workspaceId, broadcastId, {
              ...audience!,
              expected_version: draft.version,
            } as TagAudienceSave | GroupAudienceSave);
            if (opened !== epoch) return;
            set({ draft: next, groupChanged: null, audiencePending: pendingAudience !== null });
          }
        } catch (error) {
          if (opened !== epoch) return;
          const code = codeOf(error);
          if (code === ErrorCode.BROADCAST_DRAFT_CHANGED) {
            const theirs = (error as ApiError & { details: { draft: BroadcastDraft } }).details
              .draft;
            const mine = { ...get().unsent };
            // The member's audience choice (sent or queued) is kept beside theirs too.
            const kept = pendingAudience ?? (Object.keys(fields).length > 0 ? null : audience);
            pendingAudience = null;
            set({
              draft: theirs,
              stale: { theirs, mine, ...(kept && { audience: kept }) },
              unsent: {},
              save: 'idle',
              audiencePending: false,
            });
            return;
          }
          if (code === ErrorCode.BROADCAST_NOT_A_DRAFT) {
            pendingAudience = null;
            set({ audiencePending: false });
            await markLaunched(workspaceId, broadcastId, opened);
            return;
          }
          if (code === ErrorCode.TAG_NOT_FOUND && audience) {
            const tagId = (error as ApiError & { details?: { tag_id?: string } }).details?.tag_id;
            set({
              tagGone: tagId ?? null,
              save: 'idle',
              audiencePending: pendingAudience !== null,
            });
            continue;
          }
          const invalid =
            code === ErrorCode.BROADCAST_NAME_INVALID
              ? 'name'
              : code === ErrorCode.BROADCAST_TEXT_INVALID
                ? 'text'
                : null;
          if (invalid && invalid in fields) {
            // The field error shows on the field; the refused value leaves the queue.
            const left: DraftFieldsEdit = { ...get().unsent };
            if (left[invalid] === fields[invalid]) delete left[invalid];
            set({ unsent: left, rejected: { ...get().rejected, [invalid]: true }, save: 'idle' });
            continue;
          }
          if (code === ErrorCode.BROADCAST_GROUP_CHANGED) {
            const size = (error as ApiError & { details: { group_size: number } }).details
              .group_size;
            set({ groupChanged: size, save: 'idle', audiencePending: pendingAudience !== null });
            continue;
          }
          // A newer choice queued meanwhile wins over the one that failed.
          if (audience && !Object.keys(fields).length) pendingAudience ??= audience;
          if (isGuardAnswer(error)) guard(error, workspaceId);
          set({ save: 'failed' });
          return;
        }
      }
    } finally {
      if (savingEpoch === opened) savingEpoch = null;
    }
  };

  /** Runs one group call after the previous one answered. */
  const inGroupChain = <T>(call: () => Promise<T>): Promise<T> => {
    const next = groupChain.then(call, call);
    groupChain = next.catch(() => undefined);
    return next;
  };

  const followGroupSize = (size: number) => {
    const draft = get().draft;
    if (draft?.audience.kind === 'group') {
      set({ draft: { ...draft, audience: { kind: 'group', size } } });
    }
  };

  const readGroup = async (guard: GuardFn, background: boolean) => {
    const { workspaceId, broadcastId } = get();
    if (!workspaceId || !broadcastId) return;
    const opened = epoch;
    if (!background) {
      groupLoads++;
      groupSeq++;
      set({
        group: { status: 'loading', items: [], hasNext: false, nextCursor: null, more: 'idle' },
      });
    }
    const loads = groupLoads;
    const seq = groupSeq;
    try {
      const page = await listBroadcastGroup(workspaceId, broadcastId, {}, { background });
      // A newer full load (Retry, the picker closing) answers for the list instead.
      if (opened !== epoch || loads !== groupLoads) return;
      if (background && seq !== groupSeq) {
        // A Show more started meanwhile wins: this answer is dropped and read again after it.
        if (get().group?.more === 'loading') groupRereadWaits = true;
        else void groupReread?.(); // Show more has already landed: queue one more read now
        return;
      }
      groupSeq++;
      set({
        group: {
          status: 'ready',
          items: page.items,
          hasNext: page.has_next,
          nextCursor: page.next_cursor,
          more: 'idle',
        },
      });
      followGroupSize(page.size);
    } catch (error) {
      if (opened !== epoch || loads !== groupLoads) return;
      if (isGuardAnswer(error)) guard(error, workspaceId);
      if (!background) set({ group: { ...get().group!, status: 'error' } });
    }
  };

  /** The group's first page again in the background: one at a time, after a Show more in flight. */
  const rereadGroup = (guard: GuardFn) => {
    groupReread ??= serialRead(async () => {
      // Checked when the read runs, so a queued re-read also waits for a Show more in flight.
      if (get().group?.more === 'loading') {
        groupRereadWaits = true;
        return;
      }
      await readGroup(guard, true);
    });
    return groupReread();
  };

  const groupWrite = <T extends { group_size: number }>(
    guard: GuardFn,
    call: (workspaceId: string, broadcastId: string) => Promise<T>,
  ): Promise<T | null> => {
    const { workspaceId, broadcastId } = get();
    if (!workspaceId || !broadcastId) return Promise.resolve(null);
    const opened = epoch;
    return inGroupChain(async () => {
      try {
        const answer = await call(workspaceId, broadcastId);
        if (opened === epoch) followGroupSize(answer.group_size);
        return answer;
      } catch (error) {
        if (opened !== epoch) throw error;
        const code = codeOf(error);
        if (code === ErrorCode.BROADCAST_NOT_A_DRAFT) {
          await markLaunched(workspaceId, broadcastId, opened);
          return null;
        }
        if (isGuardAnswer(error)) guard(error, workspaceId);
        throw error;
      }
    });
  };

  /** A status change or a resync: launched → read-only, gone → not found; a draft stays as held. */
  const recheck = async (
    workspaceId: string,
    broadcastId: string,
    guard: GuardFn,
    notice: LaunchNotice,
  ) => {
    const opened = epoch;
    // Only a draft on screen learns of a launch from here; an opening answers for itself.
    const shownDraft = get().status === 'ready';
    try {
      const b = await getBroadcast(workspaceId, broadcastId, { background: true });
      if (opened !== epoch) return;
      if (b.status !== 'draft')
        set({ status: 'launched', launched: b, ...(shownDraft && { launchNotice: notice }) });
    } catch (error) {
      if (opened !== epoch) return;
      if (isNotFound(error)) set({ status: 'not_found' });
      else if (isGuardAnswer(error)) guard(error, workspaceId);
    }
  };

  const onFrame = (workspaceId: string, guard: GuardFn, frame: LiveFrame) => {
    const broadcastId = get().broadcastId;
    if (frame.workspace_id !== workspaceId || !broadcastId || !shows(workspaceId)) return;
    if (frame.type === 'resync') {
      void recheck(workspaceId, broadcastId, guard, 'refused');
      return;
    }
    if (frame.type !== 'broadcast.changed' || frame.broadcast_id !== broadcastId) return;
    // `draft` / `group` from a teammate: counts are not pushed live; the next own save answers.
    if (frame.change === 'status') void recheck(workspaceId, broadcastId, guard, 'teammate');
    if (frame.change === 'deleted') {
      epoch++;
      set({ status: 'not_found' });
    }
  };

  return {
    workspaceId: null,
    broadcastId: null,
    status: 'idle',
    draft: null,
    launched: null,
    launchNotice: null,
    save: 'idle',
    audiencePending: false,
    rejected: {},
    unsent: {},
    stale: null,
    groupChanged: null,
    tagGone: null,
    group: null,
    clearTagGone() {
      set({ tagGone: null });
    },
    async open(workspaceId, broadcastId, guard, notice) {
      const opened = ++epoch;
      pendingAudience = null;
      groupChain = Promise.resolve();
      draftReread = null;
      groupReread = null;
      groupRereadWaits = false;
      const key = `${workspaceId}:${broadcastId}`;
      const unsent = unsentFor === key ? get().unsent : {};
      unsentFor = key;
      const send = sendOnOpen === key && Object.keys(unsent).length > 0;
      sendOnOpen = null;
      set({
        workspaceId,
        broadcastId,
        status: 'loading',
        draft: null,
        launched: null,
        launchNotice: null,
        save: Object.keys(unsent).length > 0 && !send ? 'failed' : 'idle',
        audiencePending: false,
        rejected: {},
        unsent,
        stale: null,
        groupChanged: null,
        tagGone: null,
        group: null,
      });
      try {
        const b = await getBroadcast(workspaceId, broadcastId, {});
        if (opened !== epoch) return;
        if (b.status === 'draft') {
          set({ status: 'ready', draft: b });
          if (send) void pump(guard);
        } else
          set({
            status: 'launched',
            launched: b,
            launchNotice: notice ?? null,
            unsent: {},
            save: 'idle',
          });
      } catch (error) {
        if (opened !== epoch) return;
        if (isGuardAnswer(error)) guard(error, workspaceId);
        set({ status: isNotFound(error) ? 'not_found' : 'error' });
      }
    },
    editFields(edit, guard) {
      if (get().status !== 'ready') return;
      const stale = get().stale;
      if (stale) {
        // Nothing goes out against their version unasked: the edit joins the member's own values.
        set({ stale: { ...stale, mine: { ...stale.mine, ...edit } } });
        return;
      }
      unsentFor = address();
      const rejected = { ...get().rejected };
      for (const key of Object.keys(edit) as (keyof DraftFieldsEdit)[]) delete rejected[key];
      set({ unsent: { ...get().unsent, ...edit }, rejected });
      void pump(guard);
    },
    carry(workspaceId, broadcastId, edit) {
      unsentFor = `${workspaceId}:${broadcastId}`;
      sendOnOpen = unsentFor;
      set({ unsent: { ...edit } });
    },
    saveAudience(choice, guard) {
      if (get().status !== 'ready') return;
      const stale = get().stale;
      // A new choice replaces the one kept from the stale save.
      if (stale?.audience) set({ stale: { theirs: stale.theirs, mine: stale.mine } });
      pendingAudience = choice;
      set({ audiencePending: true });
      void pump(guard);
    },
    retry(guard) {
      void pump(guard);
    },
    useMine(guard) {
      const stale = get().stale;
      if (!stale) return;
      set({ stale: null, unsent: { ...stale.mine, ...get().unsent } });
      if (stale.audience) {
        pendingAudience ??= stale.audience;
        set({ audiencePending: true });
      }
      void pump(guard);
    },
    keepTheirs() {
      set({ stale: null });
    },
    loadGroup: (guard) => readGroup(guard, false),
    reread(guard) {
      const { workspaceId, broadcastId, status } = get();
      if (!workspaceId || !broadcastId || status !== 'ready') return Promise.resolve();
      draftReread ??= serialRead(async () => {
        const opened = epoch;
        try {
          const b = await getBroadcast(workspaceId, broadcastId, { background: true });
          if (opened !== epoch) return;
          const held = get().draft;
          if (b.status !== 'draft') set({ status: 'launched', launched: b });
          // A save in flight or queued answers with the newer draft itself; an older read never wins.
          else if (
            savingEpoch !== epoch &&
            !pendingAudience &&
            Object.keys(get().unsent).length === 0 &&
            (!held || b.version >= held.version)
          )
            set({ draft: b });
        } catch (error) {
          if (opened !== epoch) return;
          if (isNotFound(error)) set({ status: 'not_found' });
          else if (isGuardAnswer(error)) guard(error, workspaceId);
        }
      });
      return draftReread();
    },
    async showMoreGroup(guard) {
      const { workspaceId, broadcastId, group } = get();
      if (!workspaceId || !broadcastId || !group?.nextCursor || group.more === 'loading') return;
      const opened = epoch;
      // Show more wins over a background re-read in flight: its answer is dropped (it runs again).
      const seq = ++groupSeq;
      set({ group: { ...group, more: 'loading' } });
      try {
        const page = await listBroadcastGroup(
          workspaceId,
          broadcastId,
          { after: group.nextCursor },
          {},
        );
        if (opened !== epoch) return;
        // The list was replaced meanwhile: this page continues an older one.
        if (seq !== groupSeq) return;
        const items = get().group!.items;
        const shown = new Set(items.map((r) => r.contact.id));
        set({
          group: {
            status: 'ready',
            items: [...items, ...page.items.filter((r) => !shown.has(r.contact.id))],
            hasNext: page.has_next,
            nextCursor: page.next_cursor,
            more: 'idle',
          },
        });
      } catch (error) {
        if (opened !== epoch || seq !== groupSeq) return;
        if (isGuardAnswer(error)) guard(error, workspaceId);
        set({ group: { ...get().group!, more: 'error' } });
      } finally {
        if (opened === epoch && groupRereadWaits) {
          groupRereadWaits = false;
          void rereadGroup(guard);
        }
      }
    },
    async addContact(contactId, guard) {
      const answer = await groupWrite(guard, (w, b) =>
        addBroadcastGroupContact(w, b, { contact_id: contactId }),
      );
      if (answer?.outcome === 'added' && get().group) void rereadGroup(guard);
      return answer;
    },
    async removeContact(contactId, guard) {
      const answer = await groupWrite(guard, (w, b) =>
        removeBroadcastGroupContact(w, b, contactId),
      );
      const group = get().group;
      if (answer && group) {
        set({ group: { ...group, items: group.items.filter((r) => r.contact.id !== contactId) } });
      }
      return answer;
    },
    async addMatching(body, guard) {
      const answer = await groupWrite(guard, (w, b) => addBroadcastGroupMatching(w, b, body));
      if (answer && get().group) void rereadGroup(guard);
      return answer;
    },
    watch(workspaceId, guard) {
      const again = () => {
        const broadcastId = get().broadcastId;
        if (broadcastId && shows(workspaceId))
          void recheck(workspaceId, broadcastId, guard, 'refused');
      };
      return subscribeLive(workspaceId, {
        onFrame: (frame) => onFrame(workspaceId, guard, frame),
        onReconnected: again,
        onInvalidFrame: again,
        onClosed: () => undefined, // the shell and the next request decide
      });
    },
    close() {
      epoch++;
      pendingAudience = null;
      draftReread = null;
      groupReread = null;
      groupRereadWaits = false;
      // The unsent edit stays for the same address (a 401 sends the member to sign in and back).
      set({
        workspaceId: null,
        broadcastId: null,
        status: 'idle',
        draft: null,
        launched: null,
        launchNotice: null,
        save: 'idle',
        audiencePending: false,
        rejected: {},
        stale: null,
        groupChanged: null,
        tagGone: null,
        group: null,
      });
    },
    forget() {
      unsentFor = null;
      sendOnOpen = null;
      set({ unsent: {} });
    },
  };
});

// Workspace switch, access removed and sign-out all change the current workspace: drop its state.
useWorkspaceStore.subscribe((state, prev) => {
  if (state.current?.id !== prev.current?.id) {
    const store = useBroadcastDraftStore.getState();
    store.close();
    store.forget();
  }
});
