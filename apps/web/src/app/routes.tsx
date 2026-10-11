import { createBrowserRouter } from 'react-router';
import { LandingRedirect } from '@/features/workspaces/LandingRedirect';
import { AcceptInvitationPage } from '@/pages/AcceptInvitationPage';
import { NoAccessPage } from '@/pages/NoAccessPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { SignInPage } from '@/pages/SignInPage';
import { TeamPage } from '@/pages/TeamPage';
import { WorkspaceHomePage } from '@/pages/WorkspaceHomePage';
import { WorkspacesPage } from '@/pages/WorkspacesPage';

export const routes = [
  { path: '/', element: <LandingRedirect /> },
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/invite/:token', element: <AcceptInvitationPage /> },
  { path: '/reset-password/:token', element: <ResetPasswordPage /> },
  { path: '/workspaces', element: <WorkspacesPage /> },
  { path: '/no-access', element: <NoAccessPage /> },
  { path: '/w/:workspaceId', element: <WorkspaceHomePage /> },
  { path: '/w/:workspaceId/team', element: <TeamPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
