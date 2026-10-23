import { useParams } from 'react-router';
import { TagsSettings } from '@/features/tags/TagsSettings';

/** SCR-21. Keyed by workspace so switching remounts the body. */
export function TagSettingsPage() {
  const { workspaceId = '' } = useParams();
  return <TagsSettings key={workspaceId} workspaceId={workspaceId} />;
}
