import { usePostStore } from './post-store';

/** Breadcrumb label of an open post: its text start, «Post» until known. */
export function PostCrumb({ params }: { params: Readonly<Record<string, string | undefined>> }) {
  const label = usePostStore((s) =>
    s.postId === params.postId && s.post ? s.post.text.trim().slice(0, 40) : null,
  );
  return <>{label || 'Post'}</>;
}
