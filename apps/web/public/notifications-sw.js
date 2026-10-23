/*
 * Desktop notifications for tg-inbox (ADR-0009). Notifications only: no fetch handler, no cache,
 * no push. The panel's tabs post a candidate when a customer writes in a conversation that is the
 * member's or unassigned; this worker shows one notification per message across tabs, none while a
 * tab of the workspace is in focus, and brings the most recently focused tab forward on a click.
 * It never carries message text: the notification says «New message».
 */
const SEEN_LIMIT = 200;
const seen = new Set();

function workspacePath(workspaceId) {
  return '/w/' + workspaceId;
}

function inWorkspace(client, workspaceId) {
  let path;
  try {
    path = new URL(client.url).pathname;
  } catch {
    return false;
  }
  const base = workspacePath(workspaceId);
  return path === base || path.startsWith(base + '/');
}

function text(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Remembers a message id; false when it was already handled (another tab posted it first). */
function firstTime(messageId) {
  if (seen.has(messageId)) return false;
  seen.add(messageId);
  if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
  return true;
}

async function show(candidate) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const mine = windows.filter((client) => inWorkspace(client, candidate.workspaceId));
  // No tab of the workspace in this browser, or one the member is working in: nothing to show.
  if (mine.length === 0 || mine.some((client) => client.focused)) return;
  await self.registration.showNotification(
    candidate.contactName + ' · ' + candidate.workspaceName,
    {
      body: 'New message',
      tag: candidate.workspaceId + ':' + candidate.conversationId,
      renotify: true,
      icon: '/favicon.svg',
      data: {
        workspaceId: candidate.workspaceId,
        conversationId: candidate.conversationId,
        url: candidate.url,
      },
    },
  );
}

async function open(data) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // matchAll orders by most recent focus: the first match is the tab the member used last.
  const target = windows.find((client) => inWorkspace(client, data.workspaceId));
  if (!target) {
    await self.clients.openWindow(data.url);
    return;
  }
  await target.focus();
  target.postMessage({
    type: 'open-conversation',
    workspaceId: data.workspaceId,
    conversationId: data.conversationId,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'candidate') return;
  const candidate = {
    workspaceId: text(data.workspaceId),
    workspaceName: text(data.workspaceName),
    conversationId: text(data.conversationId),
    messageId: text(data.messageId),
    contactName: text(data.contactName),
    url: text(data.url),
  };
  if (Object.values(candidate).some((value) => value === null)) return;
  if (!firstTime(candidate.messageId)) return;
  event.waitUntil(show(candidate));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  if (!data || !text(data.workspaceId) || !text(data.conversationId) || !text(data.url)) return;
  event.waitUntil(open(data));
});
