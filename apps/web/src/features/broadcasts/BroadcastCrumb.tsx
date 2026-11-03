import { useBroadcastDraftStore } from './draft-store';
import { useBroadcastReportStore } from './report-store';

/** Breadcrumb label of an open broadcast: its name from the draft or the report, «Broadcast» until known. */
export function BroadcastCrumb({
  params,
}: {
  params: Readonly<Record<string, string | undefined>>;
}) {
  const fromDraft = useBroadcastDraftStore((s) =>
    s.broadcastId === params.broadcastId ? (s.draft?.name ?? s.launched?.name ?? null) : null,
  );
  const fromReport = useBroadcastReportStore((s) =>
    s.broadcast?.id === params.broadcastId ? (s.broadcast?.name ?? null) : null,
  );
  return <>{fromDraft || fromReport || 'Broadcast'}</>;
}
