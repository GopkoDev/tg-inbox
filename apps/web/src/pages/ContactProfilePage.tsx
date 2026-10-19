import { useParams } from 'react-router';
import { ContactProfile } from '@/features/contacts/ContactProfile';

/** SCR-19: a contact's profile; keyed by contact so moving between profiles starts fresh. */
export function ContactProfilePage() {
  const { workspaceId = '', contactId = '' } = useParams();
  return <ContactProfile key={contactId} workspaceId={workspaceId} contactId={contactId} />;
}
