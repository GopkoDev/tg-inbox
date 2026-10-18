import {
  createBrowserRouter,
  redirect,
  type LoaderFunctionArgs,
  type RouteObject,
} from 'react-router';
import { LandingRedirect } from '@/features/workspaces/LandingRedirect';
import { AcceptInvitationPage } from '@/pages/AcceptInvitationPage';
import { BotSettingsPage } from '@/pages/BotSettingsPage';
import { ContactProfilePage } from '@/pages/ContactProfilePage';
import { ContactsPage } from '@/pages/ContactsPage';
import { InboxPage } from '@/pages/InboxPage';
import { NoAccessPage } from '@/pages/NoAccessPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SignInPage } from '@/pages/SignInPage';
import { TeamPage } from '@/pages/TeamPage';
import { WorkspacesPage } from '@/pages/WorkspacesPage';
import { AppShell } from '@/shared/ui/app-shell';

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
        { path: ':conversationId', handle: { crumb: 'Conversation' }, element: <InboxPage /> },
      ],
    },
    {
      path: 'contacts',
      handle: { crumb: 'Contacts' },
      children: [
        { index: true, element: <ContactsPage /> },
        { path: ':contactId', handle: { crumb: 'Contact' }, element: <ContactProfilePage /> },
      ],
    },
    {
      path: 'settings',
      handle: { crumb: 'Settings' },
      element: <SettingsPage />,
      children: [
        { index: true, loader: to('settings/bot') },
        { path: 'bot', handle: { crumb: 'Bot' }, element: <BotSettingsPage /> },
        { path: 'team', handle: { crumb: 'Team' }, element: <TeamPage /> },
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
