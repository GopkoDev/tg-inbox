import { NavLink, Outlet } from 'react-router';
import { useWorkspaceStore } from '@/features/workspaces/store';
import { buttonVariants } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

const sections = [
  { to: 'bot', label: 'Bot', ownerOnly: true },
  { to: 'team', label: 'Team', ownerOnly: true },
  { to: 'notifications', label: 'Notifications', ownerOnly: false },
];

/**
 * SCR-11 Settings: title, description, the section menu and the active section's outlet. The menu
 * follows the role: an owner sees Bot, Team and Notifications, an operator Notifications only.
 */
export function SettingsLayout() {
  const isOwner = useWorkspaceStore((s) => s.current?.role === 'owner');
  const visible = sections.filter((section) => isOwner || !section.ownerOnly);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">
          {isOwner
            ? "Manage your workspace's bot and team, and your notifications"
            : 'Manage your notifications'}
        </p>
      </div>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav aria-label="Settings" className="flex gap-1 lg:w-48 lg:shrink-0 lg:flex-col">
          {visible.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  buttonVariants({ variant: 'ghost' }),
                  'justify-start lg:w-full',
                  isActive && 'bg-accent',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
