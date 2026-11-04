import { isValidTimeZone } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { setPostingTimeZone } from '../api';

export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const allZones = (): string[] => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
};

/** The one time zone picker (SCR-33 row and SCR-39 zone step): a Select over the IANA zones. */
export function TimeZoneSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}) {
  const zones = useMemo(() => {
    const list = allZones();
    const extra = [value, browserZone()].filter((z) => z && !list.includes(z));
    return [...new Set(extra), ...list];
  }, [value]);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label="Time zone" className="w-60">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {zones.map((z) => (
          <SelectItem key={z} value={z}>
            {z}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** SCR-33 time zone row with the SCR-43 confirmation (owner only edits). */
export function TimeZoneField({
  workspaceId,
  timeZone,
  scheduledTotal,
  canEdit,
  onSaved,
}: {
  workspaceId: string;
  timeZone: string | null;
  scheduledTotal: number;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await setPostingTimeZone(workspaceId, { time_zone: value.trim() });
      setConfirming(false);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'TIME_ZONE_INVALID'
          ? "That isn't a valid time zone"
          : "Couldn't change the time zone",
      );
    } finally {
      setPending(false);
    }
  };

  const proceed = () => {
    const zone = value.trim();
    if (!isValidTimeZone(zone)) {
      setError("That isn't a valid time zone");
      return;
    }
    setError(null);
    if (timeZone === null || zone === timeZone) void save();
    else setConfirming(true);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Time zone for scheduled posts:</span>
        {!editing &&
          (timeZone ? (
            <span className="font-medium">{timeZone}</span>
          ) : (
            <span className="text-sm text-muted-foreground">
              Not set — you'll be asked when you first schedule a post
            </span>
          ))}
        {editing && <TimeZoneSelect value={value} onChange={setValue} disabled={pending} />}
        {canEdit && !editing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setValue(timeZone ?? browserZone());
              setError(null);
              setEditing(true);
            }}
          >
            {timeZone ? 'Change' : 'Set'}
          </Button>
        )}
        {canEdit && editing && (
          <>
            <Button size="sm" disabled={pending} onClick={proceed}>
              {timeZone === null ? 'Save' : 'Continue'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {error && !confirming && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <AlertDialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Change the time zone to ${value.trim()}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {scheduledTotal > 0
                ? `${scheduledTotal} scheduled ${scheduledTotal === 1 ? 'post keeps its moment and shows' : 'posts keep their moment and show'} a new local time.`
                : 'Posts you schedule from now on use the new time zone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button disabled={pending} onClick={() => void save()}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Change
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
