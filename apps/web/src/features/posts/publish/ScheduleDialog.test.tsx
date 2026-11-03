import { ErrorCode, type PublishConfirmation } from '@tg/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({
  getPublishConfirmation: vi.fn(),
  schedulePost: vi.fn(),
  setPostingTimeZone: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getPublishConfirmation: (...a: unknown[]) => api.getPublishConfirmation(...a),
  schedulePost: (...a: unknown[]) => api.schedulePost(...a),
  setPostingTimeZone: (...a: unknown[]) => api.setPostingTimeZone(...a),
}));

import { ScheduleDialog } from './ScheduleDialog';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const POST = '0198f0c0-0000-7000-8000-000000000701';
const DEST = '0198f0c0-0000-7000-8000-000000000801';
const guard = vi.fn();
const handlers = { onClose: vi.fn(), onDone: vi.fn() };

const confirmation = (over: Partial<PublishConfirmation> = {}): PublishConfirmation => ({
  post_id: POST,
  version: 3,
  text: 'New arrivals this week',
  silent: false,
  destination: {
    id: DEST,
    kind: 'channel',
    title: 'Test Channel',
    username: 'test_channel',
    availability: 'available',
    problem: null,
  },
  time_zone: 'Europe/Kyiv',
  sent_last_24h: 4,
  daily_limit: 30,
  frees_at: null,
  scheduled_waiting: 3,
  scheduled_limit: 100,
  blockers: [],
  ...over,
});

const renderIt = (props: { changeTime?: boolean; initialLocalTime?: string } = {}) =>
  render(
    <ShellGuardContext.Provider value={guard}>
      <MemoryRouter>
        <ScheduleDialog workspaceId={WS} postId={POST} {...props} {...handlers} />
      </MemoryRouter>
    </ShellGuardContext.Provider>,
  );

const fill = () => {
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-04' } });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
};

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
  api.getPublishConfirmation.mockResolvedValue(confirmation());
});

describe('SCR-39 ScheduleDialog', () => {
  it('default (AC-09): date and time inputs, the zone named, destination and text summary', async () => {
    renderIt();
    expect(await screen.findByText('Schedule the post')).toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Time')).toHaveAttribute('type', 'time');
    expect(screen.getByText('Europe/Kyiv')).toBeInTheDocument();
    expect(screen.getByText('Test Channel')).toBeInTheDocument();
    expect(screen.getByText(/New arrivals this week/)).toBeInTheDocument();
  });

  it('submits local time with the workspace zone and the shown version (AC-09, AC-08)', async () => {
    api.schedulePost.mockResolvedValue({ outcome: 'scheduled', post: {} });
    renderIt();
    await screen.findByText('Schedule the post');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(api.schedulePost).toHaveBeenCalledWith(WS, POST, {
      expected_version: 3,
      local_time: '2026-11-04T09:00',
      time_zone: 'Europe/Kyiv',
    });
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    await waitFor(() => expect(handlers.onDone).toHaveBeenCalled());
  });

  it('change time: prefilled from the current schedule, button says Change time', async () => {
    renderIt({ changeTime: true, initialLocalTime: '2026-11-04T09:00' });
    await screen.findByRole('button', { name: 'Change time' });
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-04');
    expect(screen.getByLabelText('Time')).toHaveValue('09:00');
  });

  it('time zone first: no zone yet asks to confirm it, saves, then shows the form (AC-09)', async () => {
    api.getPublishConfirmation.mockResolvedValue(confirmation({ time_zone: null }));
    api.setPostingTimeZone.mockResolvedValue({
      outcome: 'saved',
      time_zone: 'Europe/Warsaw',
      relabelled_scheduled: 0,
    });
    renderIt();
    expect(await screen.findByText('Confirm the workspace time zone')).toBeInTheDocument();
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Time zone' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Europe/Warsaw' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(api.setPostingTimeZone).toHaveBeenCalledWith(WS, { time_zone: 'Europe/Warsaw' });
    expect(await screen.findByLabelText('Date')).toBeInTheDocument();
    expect(screen.getByText('Europe/Warsaw')).toBeInTheDocument();
  });

  it('validation: out of range tells the allowed range (AC-10)', async () => {
    api.schedulePost.mockRejectedValue(
      new ApiError(400, ErrorCode.POST_SCHEDULE_OUT_OF_RANGE, 'range'),
    );
    renderIt();
    await screen.findByText('Schedule the post');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(
      await screen.findByText('Pick a time between 2 minutes and 90 days from now'),
    ).toBeInTheDocument();
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it('validation: a skipped daylight-saving hour says the time does not exist (AC-10)', async () => {
    api.schedulePost.mockRejectedValue(
      new ApiError(400, ErrorCode.POST_TIME_DOES_NOT_EXIST, 'skipped'),
    );
    renderIt();
    await screen.findByText('Schedule the post');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-03-28' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '03:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(
      await screen.findByText(/03:30 doesn't exist on 28 Mar in Europe\/Kyiv/),
    ).toBeInTheDocument();
  });

  it('zone changed: TIME_ZONE_CHANGED names the new zone', async () => {
    api.schedulePost.mockRejectedValue(
      new ApiError(409, ErrorCode.TIME_ZONE_CHANGED, 'zone', { time_zone: 'Europe/Warsaw' }),
    );
    renderIt();
    await screen.findByText('Schedule the post');
    api.getPublishConfirmation.mockResolvedValue(confirmation({ time_zone: 'Europe/Warsaw' }));
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(
      await screen.findByText('The workspace time zone changed to Europe/Warsaw — check the time'),
    ).toBeInTheDocument();
  });

  it('refused: scheduled-post limit (AC-16)', async () => {
    api.schedulePost.mockRejectedValue(
      new ApiError(409, ErrorCode.POST_SCHEDULED_LIMIT_REACHED, 'limit'),
    );
    renderIt();
    await screen.findByText('Schedule the post');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/100/);
  });

  it('refused: bot not working offers Open bot settings (AC-14)', async () => {
    api.schedulePost.mockRejectedValue(new ApiError(409, ErrorCode.POSTS_NEED_WORKING_BOT, 'bot'));
    renderIt();
    await screen.findByText('Schedule the post');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('link', { name: 'Open bot settings' })).toHaveAttribute(
      'href',
      `/w/${WS}/settings/bot`,
    );
  });

  it('refused: draft changed re-reads and asks to check again (AC-08)', async () => {
    api.schedulePost.mockRejectedValue(new ApiError(409, ErrorCode.POST_DRAFT_CHANGED, 'changed'));
    renderIt();
    await screen.findByText('Schedule the post');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByText('The draft changed — check it again')).toBeInTheDocument();
  });

  it('AC-10: a destination refusal names the problem in plain language', async () => {
    api.schedulePost.mockRejectedValue(
      new ApiError(409, ErrorCode.DESTINATION_UNAVAILABLE, 'gone', { problem: 'no_post_right' }),
    );
    renderIt();
    await screen.findByText('Schedule the post');
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByText(/Give it the right to post/)).toBeInTheDocument();
  });
});
