import { useParams } from 'react-router';
import { ContactsPreview } from '@/features/contacts/ContactsPreview';
import { SampleDataBadge } from '@/shared/ui/sample-data-badge';

/** SCR-09: the contacts preview on sample data. */
export function ContactsPage() {
  const { workspaceId = '' } = useParams();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <SampleDataBadge />
      </div>
      <ContactsPreview workspaceId={workspaceId} />
    </div>
  );
}
