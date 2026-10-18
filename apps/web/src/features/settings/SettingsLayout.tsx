import { NavLink, Outlet } from 'react-router';
import { buttonVariants } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

const sections = [
  { to: 'bot', label: 'Bot' },
  { to: 'team', label: 'Team' },
];

/** SCR-11 Settings: title, description, the section menu and the active section's outlet. */
export function SettingsLayout() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your workspace&apos;s bot and team</p>
      </div>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav aria-label="Settings" className="flex gap-1 lg:w-48 lg:shrink-0 lg:flex-col">
          {sections.map(({ to, label }) => (
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
