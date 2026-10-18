import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';
import { REPLY_LIMIT, canSendReply } from './reply';

export function ReplyComposer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const valid = canSendReply(text);
  const tooLong = text.length > REPLY_LIMIT;
  const limitId = useId();

  function submit() {
    if (!valid) return;
    onSend(text.trim());
    setText('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  }

  return (
    <div className="space-y-2 border-t p-3">
      <div className="flex items-end gap-2">
        <Textarea
          aria-label="Reply"
          placeholder="Write a reply…"
          value={text}
          rows={1}
          className="max-h-40 min-h-10 resize-none"
          aria-invalid={tooLong || undefined}
          aria-describedby={tooLong ? limitId : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="button" disabled={!valid} onClick={submit}>
          Send
        </Button>
      </div>
      {tooLong ? (
        <p id={limitId} className="text-destructive text-sm">
          Replies are limited to {REPLY_LIMIT} characters
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">Preview — nothing is sent to customers</p>
    </div>
  );
}
