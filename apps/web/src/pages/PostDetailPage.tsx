import { instantToLocal } from '@tg/shared';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { listDestinations } from '@/features/posts/api';
import { PostEditor } from '@/features/posts/editor/PostEditor';
import { PostPage } from '@/features/posts/page/PostPage';
import { usePostStore } from '@/features/posts/post-store';
import { PublishDialog } from '@/features/posts/publish/PublishDialog';
import { ScheduleDialog } from '@/features/posts/publish/ScheduleDialog';
import type { GuardFn } from '@/features/workspaces/guard';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { Skeleton } from '@/shared/ui/skeleton';
import { NotFoundCard } from './NotFoundPage';

const unguarded: GuardFn = () => Promise.resolve('handled');

interface Address {
  workspaceId: string;
  postId: string | undefined;
  pathname: string;
  isOwner: boolean;
}

/**
 * The post address as one tree: the editor is chosen from the stored post's state, so a live
 * change, a back to draft or a refused save switches editor <-> post page in place, and the
 * `publish` / `schedule` steps open over it (SCR-37 to SCR-40). An operator on an owner-only
 * step is replaced to the post (AC-03).
 */
function PostSwitch({ workspaceId, postId, pathname, isOwner }: Address) {
  const guard = useContext(ShellGuardContext) ?? unguarded;
  const navigate = useNavigate();
  const post = usePostStore((s) => s.post);
  const status = usePostStore((s) => s.status);
  const [wasEditor, setWasEditor] = useState(false);
  const [zone, setZone] = useState<string | null>(null);

  useEffect(() => {
    if (!postId) return;
    const store = usePostStore.getState();
    void store.open(workspaceId, postId, guard);
    return store.watch(workspaceId, postId, guard);
    // the shell's guard is stable per address
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, postId]);

  useEffect(() => {
    let live = true;
    listDestinations(workspaceId, { background: true })
      .then((list) => live && setZone(list.time_zone))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [workspaceId]);

  const reload = () => void usePostStore.getState().reload(guard);
  const step = postId ? pathname.split('/').pop() : null;
  const dialog = step === 'publish' || step === 'schedule' ? step : null;
  const postPath = `/w/${workspaceId}/posts/${postId}`;
  const close = () => void navigate(postPath, { replace: true });
  const done = () => {
    close();
    reload();
  };

  if (dialog && !isOwner) return <Navigate to={postPath} replace />;

  if (!postId) {
    if (!wasEditor) setWasEditor(true);
    return (
      <PostEditor
        workspaceId={workspaceId}
        postId={null}
        isOwner={isOwner}
        onPublish={() => void navigate(`${postPath}/publish`)}
        onSchedule={() => void navigate(`${postPath}/schedule`)}
      />
    );
  }

  const current = post?.id === postId ? post : null;
  let body: ReactNode;
  let overlay: ReactNode = null;
  if (status === 'missing') {
    if (wasEditor) setWasEditor(false);
    body = <NotFoundCard />;
  } else if (current && current.state !== 'draft') {
    if (wasEditor) setWasEditor(false);
    body = (
      <PostPage
        workspaceId={workspaceId}
        postId={postId}
        isOwner={isOwner}
        onChangeTime={() => void navigate(`${postPath}/schedule`)}
        onChanged={reload}
      />
    );
    if (
      dialog === 'schedule' &&
      current.state === 'scheduled' &&
      current.schedule?.kind === 'time' &&
      zone
    )
      overlay = (
        <ScheduleDialog
          workspaceId={workspaceId}
          postId={postId}
          changeTime
          initialLocalTime={instantToLocal(new Date(current.schedule.scheduled_for), zone)}
          onClose={close}
          onDone={done}
        />
      );
  } else if (current || wasEditor || status === 'error') {
    if (!wasEditor) setWasEditor(true);
    body = (
      <PostEditor
        workspaceId={workspaceId}
        postId={postId}
        isOwner={isOwner}
        onNotADraft={reload}
        onPublish={() => void navigate(`${postPath}/publish`)}
        onSchedule={() => void navigate(`${postPath}/schedule`)}
      />
    );
    if (dialog === 'publish')
      overlay = (
        <PublishDialog workspaceId={workspaceId} postId={postId} onClose={close} onDone={done} />
      );
    if (dialog === 'schedule')
      overlay = (
        <ScheduleDialog workspaceId={workspaceId} postId={postId} onClose={close} onDone={done} />
      );
  } else {
    body = (
      <div data-testid="post-page-skeleton" className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <>
      {body}
      {overlay}
    </>
  );
}

/** One lazy component serves all four post addresses, so React keeps the instance across them (F16). */
export function PostDetailPage() {
  const { workspaceId = '', postId } = useParams();
  const { pathname } = useLocation();
  const isOwner = useWorkspaceStore((s) => s.current?.role === 'owner');

  // flush and close the store only on a real unmount of the post page
  useEffect(() => () => usePostStore.getState().close(), []);

  return (
    <PostSwitch workspaceId={workspaceId} postId={postId} pathname={pathname} isOwner={isOwner} />
  );
}
