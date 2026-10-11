# Design system

Tool: code (no design-tool MCP). Components are shadcn/ui primitives in `apps/web/src/shared/ui`;
Tailwind only.

## Component inventory

New components that no shadcn/ui primitive covers.

| Component | Path | Purpose | Composes |
| --- | --- | --- | --- |
| AppShell | `apps/web/src/shared/ui/app-shell.tsx` | Workspace-area frame shared by SCR-06/07/08: enters the URL's workspace (`useWorkspaceFromUrl`) and renders the page body only when entered (body skeleton before; in-shell SCR-10 `NotFoundCard` and error/Retry slots on failure); workspace switcher, owner-only Team and Bot links (Bot → `/w/:id/bot`, bot-connection SCR-01), account menu with sign-out (collapsing into a menu at phone width), dismissible `access-removed` notice slot; wires the shared guard handler for its screens (`useShellGuard`). | dropdown-menu, Button, alert, skeleton |
