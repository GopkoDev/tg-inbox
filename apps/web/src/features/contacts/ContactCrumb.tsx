import { useContactsStore } from './store';
import { contactFullName } from './format';

/** Breadcrumb label of an open profile: the contact's name, «Contact» until it is known. */
export function ContactCrumb({ params }: { params: Readonly<Record<string, string | undefined>> }) {
  const name = useContactsStore((s) => {
    const open = s.profile;
    return open && open.contactId === params.contactId && open.contact
      ? contactFullName(open.contact)
      : null;
  });
  return <>{name || 'Contact'}</>;
}
