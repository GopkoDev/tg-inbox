---
status: Living
updated_at: '2026-10-18'
---

# Domain Context — tg-inbox

## Glossary

- Account — a person's single sign-in identity on the platform (email + password), shared across every workspace they belong to; its email is compared ignoring letter case and surrounding spaces. NOT Operator (an operator is the role an account holds inside one workspace).
- Arrival watermark — the per-member, per-conversation point in arrival order up to which that member has read the conversation; it only moves forward and never past the newest arrival. NOT a read receipt to the end customer (Telegram never learns of it) and NOT shared by the team (each member has their own).
- Business bot — the workspace's own Telegram bot, created by the business in BotFather and connected to the workspace by a business owner pasting its token; end customers write to it and it belongs to at most one workspace. NOT a platform-wide bot (tg-inbox has no shared bot; every workspace brings its own).
- Business owner — a workspace member with the owner role: manages the workspace's team (invites, deactivates and reactivates operators and other business owners) and can do everything an operator can. NOT Platform admin (an owner manages only their own workspace).
- Change signal — a small live notice («this conversation, item or bot changed») pushed to the open inboxes of one workspace, carrying ids only; the browser then re-reads what changed. NOT the change itself (it carries no text or content) and NOT a notification to the end customer.
- Client reply key — the id the browser gives a reply before sending it, so a repeated submit of the same reply finds it instead of creating a second one. NOT the reply's own id and NOT a Telegram message id.
- Contact — an end customer as known to one workspace, created automatically from their Telegram profile (name, username, language) the first time they write to the workspace's business bot and refreshed on later messages; the same person writing to two workspaces' bots is two separate contacts. NOT Account (a contact never signs in) and NOT End customer in general (a contact is that person's record inside one workspace).
- Conversation — the one continuous thread between a workspace and one contact, holding every message that contact sent to the business bot (and, from the inbox step on, the operators' replies). NOT Message (a conversation holds many messages) and NOT a support ticket (it is not opened per issue; statuses arrive with the assignment step).
- Delivery state — what a reply shows about its way to Telegram: sending, sent, not delivered (with its reason) or not confirmed. NOT read status (tg-inbox never knows whether the end customer read a reply).
- Drain — the per-conversation delivery job that sends that conversation's pending replies one at a time, oldest first. NOT a broadcast and NOT a retry of an unconfirmed reply (those are resent only by a member).
- End customer — a person who writes to a workspace's bot in Telegram and never uses the web panel. NOT Operator (operators answer end customers from the web).
- Inbox — the web-panel screen where a workspace's operators and business owners see all of the workspace's conversations, read them and reply; it is shared by the whole team, not one per operator. NOT Conversation (the inbox lists many conversations) and NOT the business bot's own chat in Telegram (operators never work there).
- Invitation — a single-use, expiring link for one email address and one role, through which that person joins the workspace; created by a business owner, or by a platform admin for a workspace's first business owner. NOT Membership (an invitation only offers a membership until it is accepted).
- Membership — the link between an account and a workspace, carrying a role (owner / operator) and a state (active / deactivated). NOT Account (deactivating a membership leaves the account and its other memberships untouched).
- Message — one thing an end customer sent to the business bot in a private chat (text, or another kind such as a photo, voice or sticker, with its caption), captured into their conversation; an edit replaces its captured text. NOT Conversation.
- Not confirmed — the delivery state of a reply whose send to Telegram got no answer, so it may or may not have reached the end customer; it is never resent without a member confirming the risk of a duplicate. NOT Not delivered (Telegram answered and refused or did not accept it).
- Operator — a workspace member who answers end customers from the shared web inbox. NOT End customer; NOT Business owner (an operator does not manage the team).
- Platform admin — a member of the tg-inbox team who creates workspaces by hand together with the invitation for their first business owner, and issues password-reset links on request (there is no self-serve signup). NOT Business owner (a platform admin acts across workspaces, outside the web panel).
- Position time — where an item sits in a conversation's thread: a message by its Telegram send time (second precision), a reply by when a member (re)sent it; edits never move an item. NOT arrival time (a late redelivery arrives late but sits at its send time).
- Reply — a text an operator or business owner writes in a conversation in the inbox, which the business bot sends to that conversation's end customer in Telegram; the team sees which member wrote it, the end customer sees only the bot. NOT Message (a message comes from the end customer) and NOT a broadcast (a reply goes to one end customer, inside their conversation).
- Unread — the customer messages that arrived in tg-inbox after a member's arrival watermark and after their membership became active; counted per member, by arrival. NOT unanswered (see Waiting for a reply) and never counts replies.
- Waiting for a reply — a conversation whose end customer wrote after the last reply marked sent; the one shared marker before conversation statuses exist. NOT Unread (waiting is the same for the whole team).
- Workspace — one business on the platform and the boundary of all its data (bot, conversations, contacts, team). NOT Account (one account can belong to several workspaces).

## Invariants

- A workspace's data can never be seen or changed by anyone who is not an active member of that workspace.
- Once its first business owner invitation is accepted, a workspace always has at least one active business owner.
- A business bot is connected to at most one workspace, and a workspace has at most one business bot.
- A workspace has at most one contact and one conversation per end customer.
