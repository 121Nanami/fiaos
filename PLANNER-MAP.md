# FiaOS planner map

The three paper planners (`Ada FiaOS Planner.docx`, `Bea FiaOS Planner.docx`, `Cam FiaOS Planner.docx` in `demo/forms/`) all have the same six pages. The only difference is that Cam has no NotebookLM box.

**Where to type your answers:** open fiaOS, choose your avatar, then open the **Planner** tab. You can also go straight there with `http://<fiaOS>/?person=Ada&tab=Planner` (or `Bea`, `Cam`). In Household view the tab asks whose planner it is.

The Planner tab has one card for each box on the paper. Each card saves directly into the part of the system that owns that data, so nothing is entered twice. Each card also shows where its data lives and links there.

| Page | Planner box | Enter it in | Where the data lives | Also linked |
|---|---|---|---|---|
| 1 | My targets (goal, kcal, protein, carbs, fat, weekly budget) | Planner, or Settings → Targets (all 6 fields now) | fiaOS app state | Notion *People & Targets*; Fia Health *Your data* (step goal) |
| 1 | One-off to-dos | Planner, or Habits & Chores | fiaOS server (`chores.js`), also shown in Facet | — |
| 1 | Repeating chores (day, owner) | Planner, or Habits & Chores | fiaOS server (`chores.js`); ticks clear each Monday | — |
| 2 | Meal plan (Mon–Sun × breakfast/lunch/dinner) | Planner, or Meals & Diet | fiaOS app state, which feeds the Woolworths list | Notion *Meal Plan* |
| 2 | Recipe to add (macros, product + pack fraction + pack price, tags, notes) | Planner (new recipe builder) | fiaOS app state + product prices | Notion *Recipes* |
| 3 | Extra shopping + product prices | Planner, or Woolworths | Charged to the person who adds the item (older extras stay on Bea); the price editor flags AUD 5 placeholders | Notion *Shopping Extras* |
| 3 | Bills and rent (shared, enter once) | Planner, or Money | Split across the "people sharing bills" setting; the Planner warns about duplicates | Notion *Bills* |
| 3 | Expenses (date, description, category, amount) | Planner, or Money | fiaOS app state | Notion *Expenses* |
| 3 | Order date + actual checkout total | Planner → Mark order placed | The order record keeps both the calculated and the paid total; grocery shares go to Expenses automatically | — |
| 4 | Assignments (course, due, done %) | Planner, or Study | fiaOS app state | Notion *Uni* |
| 4 | Exams (subject, date, owner) | Planner, or Study | fiaOS app state; study blocks are generated | Notion *Uni* |
| 4 | Habits M–S | Planner (this week's grid), or Habits & Chores | fiaOS app state | Notion *Habits* |
| 4 | NotebookLM (Ada: Demo Science, Bea: Demo Letters) | Planner (link + 3 ticks) | Link in Settings → NotebookLM; ticks on the fiaOS server (`planner.js`) | Study → NotebookLM card |
| 5 | Food actually eaten (date, portion, macros) | Planner, or Meals & Diet → Log / Open Food Facts | fiaOS app state | Notion *Food Log* |
| 5 | Workouts completed (date, minutes, intensity) | Planner, or Workouts → ✓ Done | fiaOS app state | Notion *Workouts*; Fia Health check-in (steps) |
| 5 | Family message board | Planner, or Stage | fiaOS server (`notes.js`), also shown in Facet | — |
| 5 | Household wiki additions | Notion (read-only in fiaOS) | Notion *Household Wiki* | — |
| 5 | Personal journal reflection + mood | **Fia Health → Daily check-in** (mood, notes) | Your own encrypted Fia Health vault; fiaOS never reads it | The morning-brief journal in Notion is written by fiaOS |
| 6 | Shared preferences (weather town, people sharing bills, home profile, persona, display, auto quality, night mode, Grok model, bin/recycling/green-waste dates, email cards, everyone's calendar) | Planner, or Settings | fiaOS settings | — |
| 6 | My connections (Google, Microsoft, other email, calendar, Notion, Apple Health, helper) | Settings (passwords and keys go there only) | The Planner shows live status and a Ready tick for each | — |
| 6 | Week beginning / filled in on / before-entering checklist | Planner header and last card | fiaOS server (`planner.js`) | — |

## How the pieces link

- **fiaOS → Fia Health:** each Planner card that involves health links to that person's Fia Health sign-in (`?user=`). Mood and reflections open the Daily check-in directly (`&tab=Daily check-in`). The Stage card is unchanged.
- **Fia Health → fiaOS:** after sign-in, the sidebar has a **fiaOS planner ↗** link to that person's Planner. Its address comes from Fia Health's `/api/links`, which uses `FIAOS_URL` and defaults to `http://127.0.0.1:8080`. No health record ever leaves the vault.
- **Facet / forks / Ellen VM:** they already read to-dos, chores and notes from the fiaOS server. They can also read `GET /api/planner/map` and `GET /api/planner?person=…`, or open `/?person=…&tab=Planner`.
- **Notion:** unchanged two-way sync; Planner entries sync like any other entry.

## API (fiaOS server, LAN only, POST needs `X-FiaOS: 1`)

- `GET /api/planner/map`: every page and section, with where it lives.
- `GET /api/planner?person=Bea`: that person's map (Cam has no NotebookLM), links and planner ticks.
- `POST /api/planner/meta {person, weekOf?, filledOn?, checks?}`: saved in `$FIAOS_DATA/planner.json` (mode 0600).

## No separate app

Every planner box fits inside fiaOS. The only sensitive area is personal reflection and mood, and it already belongs to Fia Health's encrypted check-in, so it is linked there rather than copied.

Tests: `npm test` in fiaOS (planner map and API). In Fia Health, `npm test` now also covers `/api/links`.
