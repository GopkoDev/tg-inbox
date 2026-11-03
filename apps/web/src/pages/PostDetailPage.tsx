import { useParams } from 'react-router';
import { PostEditor } from '@/features/posts/editor/PostEditor';
import { useWorkspaceStore } from '@/features/workspaces/store';

/**
 * SCR-37 / SCR-38 / SCR-39 / SCR-40 post pages. The editor (SCR-37) is built; the publish /
 * schedule dialogs (T21) and the non-draft post page (T22) come later.
 */
export function PostDetailPage() {
  const { workspaceId = '', postId } = useParams();
  const isOwner = useWorkspaceStore((s) => s.current?.role === 'owner');
  return <PostEditor workspaceId={workspaceId} postId={postId ?? null} isOwner={isOwner} />;
}
