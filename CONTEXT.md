---
status: Living
updated_at: '2026-10-11'
---

# Domain Context — tg-inbox

## Glossary

- Account — a person's single sign-in identity on the platform (email + password), shared across every workspace they belong to; its email is compared ignoring letter case and surrounding spaces. NOT Operator (an operator is the role an account holds inside one workspace).
- Business bot — the workspace's own Telegram bot, created by the business in BotFather and connected to the workspace by a business owner pasting its token; end customers write to it and it belongs to at most one workspace. NOT a platform-wide bot (tg-inbox has no shared bot; every workspace brings its own).
- Business owner — a workspace member with the owner role: manages the workspace's team (invites, deactivates and reactivates operators and other business owners) and can do everything an operator can. NOT Platform admin (an owner manages only their own workspace).
- Contact — an end customer as known to one workspace, created automatically from their Telegram profile (name, username, language) the first time they write to the workspace's business bot and refreshed on later messages; the same person writing to two workspaces' bots is two separate contacts. NOT Account (a contact never signs in) and NOT End customer in general (a contact is that person's record inside one workspace).
- Conversation — the one continuous thread between a workspace and one contact, holding every message that contact sent to the business bot (and, from the inbox step on, the operators' replies). NOT Message (a conversation holds many messages) and NOT a support ticket (it is not opened per issue; statuses arrive with the assignment step).
- End customer — a person who writes to a workspace's bot in Telegram and never uses the web panel. NOT Operator (operators answer end customers from the web).
- Invitation — a single-use, expiring link for one email address and one role, through which that person joins the workspace; created by a business owner, or by a platform admin for a workspace's first business owner. NOT Membership (an invitation only offers a membership until it is accepted).
- Membership — the link between an account and a workspace, carrying a role (owner / operator) and a state (active / deactivated). NOT Account (deactivating a membership leaves the account and its other memberships untouched).
- Message — one thing an end customer sent to the business bot in a private chat (text, or another kind such as a photo, voice or sticker, with its caption), captured into their conversation; an edit replaces its captured text. NOT Conversation.
- Operator — a workspace member who answers end customers from the shared web inbox. NOT End customer; NOT Business owner (an operator does not manage the team).
- Platform admin — a member of the tg-inbox team who creates workspaces by hand together with the invitation for their first business owner, and issues password-reset links on request (there is no self-serve signup). NOT Business owner (a platform admin acts across workspaces, outside the web panel).
- Workspace — one business on the platform and the boundary of all its data (bot, conversations, contacts, team). NOT Account (one account can belong to several workspaces).

## Invariants

- A workspace's data can never be seen or changed by anyone who is not an active member of that workspace.
- Once its first business owner invitation is accepted, a workspace always has at least one active business owner.
- A business bot is connected to at most one workspace, and a workspace has at most one business bot.
- A workspace has at most one contact and one conversation per end customer.
