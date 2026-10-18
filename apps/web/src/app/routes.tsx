import { lazy, Suspense, type ComponentType } from 'react';
import {
  createBrowserRouter,
  redirect,
  type LoaderFunctionArgs,
  type RouteObject,
} from 'react-router';
import { ConversationCrumb } from '@/features/inbox/ConversationCrumb';
import { getSampleContact } from '@/features/contacts/sample-source';
import { LandingRedirect } from '@/features/workspaces/LandingRedirect';
import { AcceptInvitationPage } from '@/pages/AcceptInvitationPage';
import { InboxPage } from '@/pages/InboxPage';
import { NoAccessPage } from '@/pages/NoAccessPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { SignInPage } from '@/pages/SignInPage';
import { WorkspacesPage } from '@/pages/WorkspacesPage';
import { Skeleton } from '@/shared/ui/skeleton';
import { AppShell } from '@/shared/ui/app-shell';

/** A page whose code loads on first visit (kept out of the inbox's first download); the frame stays up meanwhile. */
const lazyPage = (load: () => Promise<Record<string, unknown>>, name: string) => {
  const Page = lazy(async () => ({ default: (await load())[name] as ComponentType }));
  return (
    <Suspense
      fallback={
        <div className="space-y-3 p-4 pt-0" data-testid="page-skeleton">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      }
    >
      <Page />
    </Suspense>
  );
};

/** A redirect decided before anything renders, so the address is final when the frame mounts. */
const to =
  (section: string) =>
  ({ params }: LoaderFunctionArgs) =>
    redirect(`/w/${params.workspaceId}/${section}`);

/** The workspace screens: one layout route (the frame), `handle.crumb` feeds the breadcrumb. */
const workspaceRoute: RouteObject = {
  path: '/w/:workspaceId',
  element: <AppShell />,
  children: [
    { index: true, loader: to('inbox') },
    {
      path: 'inbox',
      handle: { crumb: 'Inbox' },
      children: [
        { index: true, element: <InboxPage /> },
        {
          path: ':conversationId',
          handle: { crumb: 'Conversation', Crumb: ConversationCrumb },
          element: <InboxPage />,
        },
      ],
    },
    {
      path: 'contacts',
      handle: { crumb: 'Contacts' },
      children: [
        { index: true, element: lazyPage(() => import('@/pages/ContactsPage'), 'ContactsPage') },
        {
          path: ':contactId',
          handle: {
            crumb: (p: Record<string, string | undefined>) =>
              getSampleContact(p.contactId ?? '')?.name ?? 'Contact',
          },
          element: lazyPage(() => import('@/pages/ContactProfilePage'), 'ContactProfilePage'),
        },
      ],
    },
    {
      path: 'settings',
      handle: { crumb: 'Settings' },
      element: lazyPage(() => import('@/pages/SettingsPage'), 'SettingsPage'),
      children: [
        { index: true, loader: to('settings/bot') },
        {
          path: 'bot',
          handle: { crumb: 'Bot' },
          element: lazyPage(() => import('@/pages/BotSettingsPage'), 'BotSettingsPage'),
        },
        {
          path: 'team',
          handle: { crumb: 'Team' },
          element: lazyPage(() => import('@/pages/TeamPage'), 'TeamPage'),
        },
      ],
    },
    { path: 'team', loader: to('settings/team') },
    { path: 'bot', loader: to('settings/bot') },
  ],
};

export const routes: RouteObject[] = [
  { path: '/', element: <LandingRedirect /> },
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/invite/:token', element: <AcceptInvitationPage /> },
  { path: '/reset-password/:token', element: <ResetPasswordPage /> },
  { path: '/workspaces', element: <WorkspacesPage /> },
  { path: '/no-access', element: <NoAccessPage /> },
  workspaceRoute,
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
