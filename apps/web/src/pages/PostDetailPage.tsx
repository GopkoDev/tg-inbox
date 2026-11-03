import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { PostEditor } from '@/features/posts/editor/PostEditor';
import { PublishDialog } from '@/features/posts/publish/PublishDialog';
import { ScheduleDialog } from '@/features/posts/publish/ScheduleDialog';
import { useWorkspaceStore } from '@/features/workspaces/store';

/**
 * SCR-37 / SCR-38 / SCR-39 / SCR-40 post pages. The editor (SCR-37) sits under the owner-only
 * publish (SCR-38) and schedule (SCR-39) dialogs; an operator on those addresses is replaced to
 * the post (AC-03). The non-draft post page (T22) comes later.
 */
export function PostDetailPage() {
  const { workspaceId = '', postId } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isOwner = useWorkspaceStore((s) => s.current?.role === 'owner');
  const step = postId ? pathname.split('/').pop() : null;
  const dialog = step === 'publish' || step === 'schedule' ? step : null;
  const postPath = `/w/${workspaceId}/posts/${postId}`;

  if (dialog && !isOwner) return <Navigate to={postPath} replace />;

  const close = () => navigate(postPath, { replace: true });
  return (
    <>
      <PostEditor
        workspaceId={workspaceId}
        postId={postId ?? null}
        isOwner={isOwner}
        onPublish={() => navigate(`${postPath}/publish`)}
        onSchedule={() => navigate(`${postPath}/schedule`)}
      />
      {postId && dialog === 'publish' ? (
        <PublishDialog workspaceId={workspaceId} postId={postId} onClose={close} onDone={close} />
      ) : null}
      {postId && dialog === 'schedule' ? (
        <ScheduleDialog workspaceId={workspaceId} postId={postId} onClose={close} onDone={close} />
      ) : null}
    </>
  );
}
