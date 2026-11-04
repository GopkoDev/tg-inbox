import { Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { PostsTable } from '@/features/posts/list/PostsTable';
import { Button } from '@/shared/ui/button';

/** SCR-36: the workspace's posts; keyed by workspace so a switch starts fresh. */
export function PostsPage() {
  const { workspaceId = '' } = useParams();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Posts</h1>
        <Button asChild className="w-full sm:w-auto">
          <Link to={`/w/${workspaceId}/posts/new`}>
            <Plus aria-hidden />
            New post
          </Link>
        </Button>
      </div>
      <PostsTable key={workspaceId} workspaceId={workspaceId} />
    </div>
  );
}
