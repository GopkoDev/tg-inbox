/**
 * The text of a ping (TG-03), built from counts only. The input has no field for message text,
 * contact names or teammate names, so none of them can reach a ping (spec section 6).
 */
export interface PingTextInput {
  workspaceName: string;
  workspaceId: string;
  /** The panel's base address, with or without a trailing slash. */
  panelUrl: string;
  /** Conversations assigned to the member, unassigned ones, and a teammate's. */
  mine: number;
  unassigned: number;
  teammate: number;
  longestWaitMinutes: number;
  /** The one conversation, when the set has exactly one. */
  conversationId?: string;
}

export interface PingText {
  /** Plain text: sent without a parse mode. */
  text: string;
  /** Sent on its own line after the text, with the link preview off. */
  url: string;
}

/** Whole minutes below an hour, hours plus minutes from 60: «12 min», «1 h 5 min», «2 h». */
export function formatWait(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function pingText(input: PingTextInput): PingText {
  const { workspaceName: name, mine, unassigned, teammate } = input;
  const total = mine + unassigned + teammate;
  if (total < 1) throw new Error('a ping needs at least one conversation');
  const wait = formatWait(input.longestWaitMinutes);
  const base = `${input.panelUrl.replace(/\/+$/, '')}/w/${input.workspaceId}/inbox`;

  if (total === 1) {
    const url = input.conversationId ? `${base}/${input.conversationId}` : base;
    if (mine === 1) return { text: `${name}: 1 customer is waiting for your reply (${wait})`, url };
    if (unassigned === 1) {
      return { text: `${name}: an unassigned customer is waiting for a reply (${wait})`, url };
    }
    return { text: `${name}: a teammate's customer is waiting for a reply (${wait})`, url };
  }
  if (mine === total) {
    return {
      text: `${name}: ${total} customers are waiting for your reply, the longest ${wait}`,
      url: `${base}?assignee=mine`,
    };
  }
  if (unassigned === total) {
    return {
      text: `${name}: ${total} unassigned customers are waiting, the longest ${wait}`,
      url: `${base}?assignee=unassigned`,
    };
  }
  if (teammate === total) {
    return {
      text: `${name}: ${total} of your teammates' customers are waiting for a reply, the longest ${wait}`,
      url: base,
    };
  }
  const parts = [
    mine > 0 ? `${mine} yours` : null,
    unassigned > 0 ? `${unassigned} unassigned` : null,
    teammate > 0 ? `${teammate} a teammate's` : null,
  ].filter((p): p is string => p !== null);
  return {
    text: `${name}: ${total} customers are waiting for a reply (${parts.join(', ')}), the longest ${wait}`,
    url: base,
  };
}
