# FiaOS demo

**GreyHat Inc**

This is a public demo of the Fia suite. Every person, place, message, bill, and note in this copy is **fake demo data**.

## Demo data notice

The household is three fictional profiles:

| Profile | Role in the demo |
| --- | --- |
| Ada | Demo science notebook and demo targets |
| Bea | Home profile, demo letters notebook, demo workshop |
| Cam | Demo training week, no study notebook |

- Stage opens with demo meals, a demo bill, a demo chore, and a demo study item. A banner marks them as example data.
- Notes start from `examples/fianotes.seed.json`. Mail starts with letters from `desk@example.local` and `house@example.local`.
- Weather defaults to the fictional place **Demo Harbour**. It is not a real address.
- Nothing here is a real household. Do not type real names, addresses, health notes, or keys into a copy you publish.
- Browser storage key is `fiaos.demo.v1`. Reset from Settings returns the same demo household.
- `data/` is created only at runtime and is gitignored. This archive contains no `data/` directory, no database, no `.ics`, no `.env`, and no API key.
- Set `XAI_API_KEY` in the environment yourself if you want the helper. This tree does not contain a key.
- Set `NOTION_PARENT_PAGE` yourself if you connect Notion. No workspace id is built in.
- Fia Health’s vault app is not in this repository. The hub only links to it. Point `FIA_HEALTH_DIR` at a copy you run yourself. This demo never includes health records.

## Run

```bash
npm start
# http://127.0.0.1:8080
npm test
```

Node 18 or newer. No npm packages. The server listens on `127.0.0.1` only.

## Apps

The EllenOS app library (`linux/ellenos/`, including `install-app-library.sh` and `PKGBUILD`) launches these 27 apps, one window each:

| App | What it is |
| --- | --- |
| App Library | Grid of every FiaOS app |
| Stage | Today for the demo household: weather, meals, bills, messages |
| Meals | Day plan for Ada, Bea, and Cam |
| Shop list | Shop list built from the meal plan |
| Workouts | A suggested session from food and the demo calendar |
| Study | Demo assignments, exams, and study blocks |
| Money | Demo bills split three ways, plus demo expenses |
| Habits | Demo habits and the chore roster |
| Week | Weekly review for the demo household |
| Planner | On-screen copy of the paper planner |
| FiaNotes | Notes, documents, sheets, and review cards |
| Fia Mail | Local inbox for the demo household |
| Calendar | Local calendar, including the demo workshop |
| FiaMedia | Library, focus audio, and podcast list |
| Search | One search across notes, mail, and tasks |
| Fia Desk | Launcher, clipboard, and window tiles |
| Facet | Start page: bookmarks, history, house search |
| FiaDocs | Letters, lists, comments, and suggestions |
| FiaSheets | Workbooks, formulas, and charts |
| FiaSlides | Decks that can play on a timer |
| FiaPaint | Layers, brush, eraser, and a flattened PNG |
| FiaDraw | Rectangles, ellipses, text, and path booleans |
| FiaClip | In/out spans, cut with ffmpeg when it is installed |
| FiaPhoto | Exposure, contrast, colour, and a centre crop |
| FiaLayout | A page or a poster |
| Picture library | Pictures shared by the other apps |
| Settings | Display, targets, bins, and connections |

Fia Health in this tree is the hub link only (`fiahealth.js`, `health.js`, `healthlink.js`). It checks whether a separate health app is running and opens each demo profile’s own sign-in. It does not read health records.
