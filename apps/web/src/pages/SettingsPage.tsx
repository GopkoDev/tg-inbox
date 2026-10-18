import { Outlet } from 'react-router';

/** Settings section outlet; T4 builds the real layout (section tabs). */
export function SettingsPage() {
  return (
    <>
      <h2 className="mb-3 text-lg font-semibold">Settings</h2>
      <Outlet />
    </>
  );
}
