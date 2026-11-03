import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { PostEditor } from '@/features/posts/editor/PostEditor';
import { getPost } from '@/features/posts/api';
import { PostPage } from '@/features/posts/page/PostPage';
import { PublishDialog } from '@/features/posts/publish/PublishDialog';
import { ScheduleDialog } from '@/features/posts/publish/ScheduleDialog';
import { useWorkspaceStore } from '@/features/workspaces/store';

/**
 * SCR-37 / SCR-38 / SCR-39 / SCR-40 post pages: a draft (or a new post) opens the editor under the
 * owner-only publish (SCR-38) and schedule (SCR-39) dialogs; an operator on those addresses is
 * replaced to the post (AC-03). Every other state opens the post page.
 */
export function PostDetailPage() {
  const { workspaceId = '', postId } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isOwner = useWorkspaceStore((s) => s.current?.role === 'owner');
  const [draft, setDraft] = useState<boolean | null>(postId ? null : true);

  useEffect(() => {
    if (!postId) return;
    let live = true;
    getPost(workspaceId, postId)
      .then((post) => live && setDraft(post.state === 'draft'))
      .catch(() => live && setDraft(true));
    return () => {
      live = false;
    };
  }, [workspaceId, postId, pathname]);

  const step = postId ? pathname.split('/').pop() : null;
  const dialog = step === 'publish' || step === 'schedule' ? step : null;
  const postPath = `/w/${workspaceId}/posts/${postId}`;

  if (dialog && !isOwner) return <Navigate to={postPath} replace />;
  if (draft === null) return null;

  if (!draft && postId) {
    return <PostPage workspaceId={workspaceId} postId={postId} isOwner={isOwner} />;
  }

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
