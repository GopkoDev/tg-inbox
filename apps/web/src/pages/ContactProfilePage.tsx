import { useParams } from 'react-router';
import { ContactProfilePreview } from '@/features/contacts/ContactProfilePreview';
import { getSampleContact } from '@/features/contacts/sample-source';
import { NotFoundCard } from './NotFoundPage';

/** SCR-10: the contact profile preview; an unknown contact shows the frame's not-found card. */
export function ContactProfilePage() {
  const { contactId = '' } = useParams();
  const contact = getSampleContact(contactId);
  if (!contact) return <NotFoundCard headingLevel={1} />;
  return <ContactProfilePreview contact={contact} />;
}
