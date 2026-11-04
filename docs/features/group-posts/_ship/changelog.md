# Changelog — group-posts

## group-posts — a business owner connects the business's Telegram channels and groups with a one-time code, any member drafts a plain-text post, and an owner publishes it now or schedules it in the workspace time zone; it goes out once from the business bot, on time or honestly marked missed, and can be deleted within 48 hours

**What:** A workspace can now post to its own Telegram channels and groups from the panel, through its own bot, now or on a schedule, with no one using a personal account.

- **Channels & groups (Settings).** Every member sees the workspace's destinations: Telegram name, kind (channel or group), public username, and whether the bot can post there now. If it cannot, the reason is shown: the right to post or send messages is missing, the bot is no longer in the chat, the chat is gone, or the chat was connected with the previous bot. Only a business owner connects a destination, removes one or changes the time zone.
  - Removing a destination sends its scheduled posts back to drafts, after a confirmation that says how many.
  - A workspace has at most 20 destinations.
- **Connecting with a code.** An owner creates a single-use code that is valid for 10 minutes and posts it in the chat: as a channel post, or in a group as a command to the bot. The dialog then shows the result live:
  - connected, and the bot removes the code message when it is allowed to;
  - the right the bot is missing in that chat;
  - expired;
  - the 20-destination limit.

  A chat the bot was only added to, with no code posted, never becomes a destination. Posting a code in a chat that was connected before revives the same destination. Its name follows renames, and a group that Telegram upgrades keeps working.
- **Posts page.** It lists every post, the most recently changed first. Filters: drafts, scheduled, published, and needing attention. States update live.
  - Failed, missed and not confirmed posts are counted next to Posts in the navigation for the whole team, until any member opens them.
- **Drafts.** A draft has one destination, plain text and a "send without sound" option.
  - Text: 1–4096 characters, counted the way Telegram counts them and trimmed.
  - The draft saves as you type, against the version you saw. A teammate's newer save is never overwritten: you are shown their version instead.
  - The preview shows the plain text with its line breaks.
  - Any member duplicates a post. Only the author or an owner deletes a draft.
- **Publish now (owners only).** A confirmation shows the chat's name and kind and the exact text. Confirming publishes the post once, even after a double click or when two owners confirm.
  - The post page shows when it was published, by whom, and a link to open it in Telegram.
  - At most 30 posts go out per workspace in any 24 hours.
- **Schedule (owners only).** An owner picks a date and time to the minute in the **workspace time zone**, which is named everywhere. The first owner who schedules confirms the zone; it is prefilled from their browser.
  - The time must be at least 2 minutes and at most 90 days ahead. A time that a daylight-saving change skips is refused, and a repeated time means its first occurrence.
  - At most 100 posts can be scheduled at once.
  - An owner can change the time. Any member can move a scheduled post back to a draft. Editing a scheduled post moves it back first.
  - A post goes out only exactly as an owner confirmed it. If the owner who scheduled it loses access, or is no longer an owner, it returns to drafts with a notice.
- **On time or missed.** A scheduled post goes out within a minute of its time with nobody online.
  - Posts due together in one chat go out in order, at least 3 seconds apart.
  - If a post cannot start within 15 minutes of its time (the service was down, the bot was paused, or Telegram limited posting to that chat), it is marked missed with the reason and is never published late.
  - Telegram refusing a post fails it with a plain reason, and the destination is marked when the bot lost its rights.
  - A send that got no answer is "not confirmed" and is never sent again.
- **Delete from Telegram (owners only).** Within 48 hours of publishing, an owner can delete the post from the chat. The panel keeps it as deleted, with who and when. Past 48 hours, or when Telegram refuses, the panel says the bot can no longer delete it.
- **Support stays first.** Nothing written in a destination chat is captured: no contact, conversation, unread or ping. A rate-limit answer to a post delays only that chat's posts and never sets the bot's send pause. Posts still wait for a send pause set by replies, pings or broadcasts.

**Why:** Pilot businesses run a channel or a customer group next to their support bot and posted there by hand from personal accounts ([spec](../spec.md) §1). The sharpest failure is a post landing in the **wrong chat**, which is why connecting needs a code posted in the chat itself (spec §6.1). Key decisions:

- [ADR-0001](../adr/0001-add-a-posts-module-that-owns-destinations-codes-and-posts-and-reaches-bots-and-workspaces-through-their-app-layers.md): a new `posts` module owns destinations, codes and posts, and reaches `bots` and `workspaces` through their app layers.
- [ADR-0002](../adr/0002-connect-a-destination-by-a-hashed-single-use-code-received-as-a-bot-command-or-channel-post.md): a destination is connected by a hashed single-use code, received as a bot command or a channel post.
- [ADR-0003](../adr/0003-classify-group-and-channel-updates-in-bots-and-hand-only-codes-membership-upgrades-and-renames-to-posts.md): `bots` classifies group and channel updates and passes on only codes, membership, upgrades and renames. Everything else is dropped before any write.
- [ADR-0004](../adr/0004-send-each-post-through-its-own-pg-boss-job-that-claims-the-post-before-the-send.md): each post is sent by its own job, which claims the post before the send (at most once).
- [ADR-0005](../adr/0005-publish-and-schedule-against-the-shown-version-and-re-check-the-scheduling-owner-at-the-send.md): publish and schedule run against the shown version, and the scheduling owner is checked again at the send.
- [ADR-0006](../adr/0006-store-the-schedule-as-an-instant-and-one-iana-time-zone-on-the-workspace.md): the schedule is stored as an instant, with one IANA time zone on the workspace.
- [ADR-0007](../adr/0007-keep-a-per-destination-pause-for-post-rate-limits-and-never-set-the-bot-send-pause-from-a-post.md): post rate limits pause only that destination and never set the bot's send pause.
- [ADR-0008](../adr/0008-delete-a-published-post-through-the-bot-within-48-hours-and-keep-the-post-as-a-deleted-record.md): a published post is deleted through the bot within 48 hours and kept as a deleted record.

**How to use:**

1. Open *Settings → Channels & groups*. As a business owner, add the bot to your channel as an admin who can post messages (or to your group), then choose *Connect a channel or group* and post the code there.
2. Open *Posts → New post*, pick the destination and write the text.
3. As an owner, choose *Publish now* or *Schedule…*. Follow the outcome on the post page, and use *Delete from Telegram* within 48 hours if needed.

The HTTP surface is in [openapi.yaml](../contracts/openapi.yaml), all under `/api/workspaces/:workspaceId/posts`:

- **Destinations and time zone:**
  - `GET …/destinations`; `POST …/destinations/connect-codes`, `GET …/connect-codes/:codeId`; `POST …/destinations/:destinationId/remove`; `POST …/time-zone`.
- **Posts:**
  - `GET` / `POST …/posts`, `GET …/posts/attention`, `GET …/posts/:postId`;
  - `POST …/:postId/{save,duplicate,delete,publish,schedule,back-to-draft,delete-from-telegram,seen}`;
  - `GET …/:postId/publish-confirmation`.
- **Refusals:** 17 new error codes in `packages/shared/src/errors.ts` (`POST_*`, `DESTINATION_*`, `POSTS_NEED_WORKING_BOT`, `TIME_ZONE_*`).
- **Live:** `post.changed` and `destinations.changed` on the `…/inbox/live` socket, ids only ([events.md](../contracts/events.md)).

**Operational notes:**

- **Migrations:** five reversible migrations, `1791681110021_add_workspaces_time_zone` … `1791681110025_widen_destination_codes_result`: the workspace time zone, `destinations`, `destination_codes`, `posts`, and the widened code results (see [data-model.md](../data-model.md)). Run `pnpm db:migrate` on deploy, before the new API starts.
- **After the deploy:** each bot's next health check (≤ 3 minutes) re-registers its webhook with `channel_post` in its allowed updates, with no owner action. Until then, a channel's code is not received, but a group's is.
- **Jobs (pg-boss):** `posts.send` (one job per post moment, policy `standard`, retry 2, expire 60 s) and its dead letter `posts.send-dlq`. The dead letter settles only stale claims and missed posts.
- **Rollback:** revert the deploy, then run `pnpm db:rollback` five times. This drops every post, destination and connect code, and the workspace time zone. Webhooks re-registered with `channel_post` keep receiving it; the old code ignores those updates.
- **Config / feature flag:** none. **Tenancy:** no new controlled exception; every link carries `workspace_id` in a composite FK.
- **Logs:** post text, chat titles, usernames, codes and chat ids never appear in logs, live frames or job payloads. The run-book integrity queries are `postIntegrity.*` in `apps/api/src/e2e/helpers.ts`.
- **Residual notes from the review:** the timing thresholds in `posts-load` (reply p95 while posting) and `broadcasts-load` can fail under full-suite parallel load on a developer machine, and pass alone. A candidate follow-up is to run the load suites in their own sequential project.
- **Open questions carried:**
  - OQ-1 (photos in posts) and OQ-2 (editing a published post): due after the first 30 days of pilot posting.
  - OQ-3 (a failed or missed post also reaching the scheduling owner through their Telegram link): due after the first 30 days, or earlier if the failed-share alert fires.

**Acceptance criteria delivered:** AC-01 – AC-18:

- connecting with a code (AC-01) and its refusals (AC-02);
- owner-only actions (AC-03) and tenancy (AC-04);
- drafts (AC-05, AC-06);
- publish once (AC-07, AC-08);
- scheduling in the workspace zone (AC-09, AC-10);
- a changed or orphaned schedule returns to draft (AC-11);
- missed after 15 minutes (AC-12);
- failures with reasons and attention (AC-13);
- the bot not working or replaced (AC-14);
- delete within 48 hours (AC-15);
- limits (AC-16);
- support unaffected and nothing captured from chats (AC-17);
- deleting drafts (AC-18).
