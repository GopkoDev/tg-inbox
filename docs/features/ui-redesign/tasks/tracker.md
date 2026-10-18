# Tracker — ui-redesign

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status |
|---|---|---|---|---|---|---|
| T1 | Add the canon's shadcn primitives and the shared preview/list parts | ui | Dmytro Hopko | M | — | todo |
| T2 | Move the entry screens onto the centred auth layout | ui | Dmytro Hopko | M | T1 | todo |
| T3 | Render workspace screens inside one layout route with the sidebar frame | ui | Dmytro Hopko | L | T1 | todo |
| T4 | Build the Settings layout and move bot settings into its Bot section | ui | Dmytro Hopko | M | T3 | todo |
| T5 | Move the team page into the Settings Team section with search and filters | ui | Dmytro Hopko | M | T4 | todo |
| T6 | Build the inbox preview on a swappable sample-data source | ui | Dmytro Hopko | L | T3 | todo |
| T7 | Build the contacts and contact-profile previews on a sample-data source | ui | Dmytro Hopko | M | T3 | todo |
| T8 | Register the new components in the canon and remove the reference markup | docs | Dmytro Hopko | S | T2, T5, T6, T7 | todo |

**Total:** 8 tasks, ~6 person-days.
