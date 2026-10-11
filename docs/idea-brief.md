---
status: Draft
owner: "Dmytro Hopko"
updated_at: "2026-10-11"
depth: "medium"
---

# Idea brief — tg-inbox

## 1. Raw idea

> «далі я хочу зробити проект для початку в1 - це чат підтримки за допомогою тг бота із збереженням контактів ті які взаємоділяли з ботом. в майбутньому для того щоб створювати розсилки. також в наступних версіях мати можливість додавати пости в групу і додати аі асистента і мсп»

## 2. Problem

Businesses that run customer support through Telegram with several operators have no comfortable way to work as a team: free forwarder bots relay messages to one chat, but give no per-customer conversations, no assignment, no open/closed status and no shared history. Everyone who ever wrote to the business is also lost as an audience — there is no contact base to reach them again later.

## 3. Users

- **Business owner** — connects their own branded Telegram bot to the platform, wants the contact base for future broadcasts.
- **Operator** — answers customers from a shared web inbox; target segment is teams of 3+ operators, where forwarder pain is felt most.
- **End customer** — writes to the business's bot in Telegram and only ever sees the bot; never touches the web.

## 4. Why now

No external trigger surfaced in the interview — this is an owner-initiated product bet. The near-term goal is concrete: 5–10 businesses using v1 daily, onboarded by hand.

## 5. Out of scope

- **Self-serve signup and onboarding** — pilots are connected manually; v1 effort goes into support, not onboarding.
- **Billing / payments** — success of v1 is daily usage, not revenue.
- **Broadcasts** — v2; v1 only collects and tags contacts so the base is ready.
- **AI assistant** — v3, and as reply drafts for operators, not autonomous answers.
- **Posting to a group / channel** — v4, an extension rather than core support.
- **Platform MCP server** — v5, lets an owner query and act on their data from an external AI assistant.
- **Collecting phone / email from customers** — contact = Telegram profile + tags + history; extra fields add friction and personal-data consent questions.
- **Operators replying inside Telegram** — the bot is for the end customer only; all operator work happens on the web.

## 6. Risks

- **Weak differentiation in v1** (weakest spot) — assumes multi-operator convenience is worth switching from a free forwarder; false if pilot businesses have a single operator, and easy for competitors to copy. The main reason to pay (broadcasts) only arrives in v2.
- **Slow replies from a web-only workspace** — assumes operators notice new messages fast enough; mitigated by in-web notifications plus a Telegram ping from the bot when the operator is inactive on the web.
- **Onboarding friction** — assumes each business is willing to create its own bot in BotFather and hand over the token.
- **Bigger v1 than a forwarder** — "everything on the web" means building a full shared inbox before anything ships.

## 7. Recommendation

Build v1 as a shared web inbox for multi-operator Telegram support: each business connects its own bot, every customer becomes a contact with profile, operator tags and conversation history, and operators are notified on the web or pinged via the bot when away. Pick pilots with 3+ operators and pitch tagging as "your broadcast base in the making". Sequence afterwards: broadcasts → AI reply drafts → group posts → platform MCP server. Consider positioning the product as a "Telegram CRM" where conversations are the way contacts get collected, so later versions read as a natural continuation.

## 8. Open questions

- Where do the first 5–10 pilot businesses come from, and do they really have 3+ operators? — owner
- What exactly counts as an operator being "inactive on the web" before the bot pings? — owner, at specify
- Is "Telegram CRM" the positioning, or does it stay "support tool" through v1? — owner
- What does a pilot business get in return for using an unpaid v1 (and when does pricing start)? — owner
