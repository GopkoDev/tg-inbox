import { useParams } from 'react-router';
import { ContactsTable } from '@/features/contacts/ContactsTable';

/** SCR-18: the workspace's contacts; keyed by workspace so a switch starts with no search and no filter. */
export function ContactsPage() {
  const { workspaceId = '' } = useParams();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Contacts</h1>
      <ContactsTable key={workspaceId} workspaceId={workspaceId} />
    </div>
  );
}
