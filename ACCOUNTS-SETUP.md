# fiaOS accounts — one-time setup (owner)

Everything is **per profile** (Ada, Bea, Cam) and **read-only by default**. Tokens and passwords are stored only on the
Surface in `/var/lib/fiaos/accounts.json` (owner `fiaos`, mode 0600) — never in the browser. Client IDs go in
`/etc/fiaos/fiaos.env`, then `sudo systemctl restart fiaos`. Connect each person in **Settings → Accounts**.
Disconnect deletes the stored token. Test without accounts: `FIAOS_MOCK=1 npm start`.

## 1. Google (Calendar, optional Gmail, optional NotebookLM Enterprise) — ~10 min
Why not the "TV / limited input" code flow? Google only allows a few scopes there (no Calendar, no Gmail), so fiaOS uses the
normal *Desktop app* login, done in a popup on the Surface (it has a keyboard).
1. https://console.cloud.google.com → create project "fiaOS".
2. APIs & Services → Library → enable **Google Calendar API** and (if wanted) **Gmail API**.
3. OAuth consent screen (Google Auth Platform) → External → app name fiaOS → add Ada/Bea/Cam Gmail addresses as test users →
   then **Publish app (In production)**. (In *Testing*, refresh tokens die after 7 days.) You'll see a "Google hasn't verified
   this app" warning when connecting — that's expected for a private app: Advanced → Go to fiaOS.
4. Clients → Create client → **Desktop app** → copy ID + secret into `/etc/fiaos/fiaos.env`:
   `GOOGLE_CLIENT_ID=...` `GOOGLE_CLIENT_SECRET=...` (for desktop apps the "secret" isn't really secret; PKCE is used too).
5. Settings → Accounts → tick Gmail / "add study blocks" if wanted → **Connect Google** → sign in → popup says *Connected*.
No Cloud setup wanted for Gmail? Use **Set up IMAP**: host `imap.gmail.com`, port 993, Gmail address, an **app password**
(Google Account → Security → 2-Step Verification on → App passwords).

### Shared household calendar + name tags (Google Workspace)
One Google calendar for the whole house, connected **once** under Ada's profile (Settings → Accounts → Connect Google, tick
"add study blocks" so fiaOS can add events). Bea and Cam don't need their own Google connection: if they have none, their
calendar reads (and study blocks) use the shared one. Change the owner with `FIAOS_SHARED_GOOGLE=Ada` (default Ada).
Optional: `FIAOS_SHARED_CALENDAR=<calendar ID>` to read/write only one specific calendar (default: all selected calendars, writes to primary).

Each event is given to one person, first match wins:
1. Title starts with `[Bea]`, `[Cam]`, `[Ada]` or `[All]` (any case). The `[Name]` is hidden in fiaOS.
2. Description contains `#bea`, `#cam`, `#ada` or `#all`.
3. Event colour: **Grape (purple) = Bea**, **Peacock (blue) = Cam** (change with `FIAOS_TAG_COLORS="Bea=3,Cam=7"`, Google colour IDs 1–11).
4. Anything else is Ada's (so all existing events stay Ada's).

Each profile shows its own events plus `[All]`/`#all` ones; Home shows everyone. Tick **Show everyone's calendar events** on the
Setlist to see the whole calendar in any profile (API: `/api/acct/calendar?person=All` or `&all=1`). Study blocks added for Bea or Cam on the
shared calendar get `[Bea]`/`[Cam]` and their colour automatically. If someone connects their own Google account later, their own
calendar is used for them instead and isn't filtered.

## 2. Microsoft (Outlook.com, Hotmail, uni Microsoft 365) — ~10 min
1. https://entra.microsoft.com (a free Azure/Entra tenant is fine) → App registrations → New: name fiaOS,
   **Accounts in any organizational directory and personal Microsoft accounts**. No redirect URI needed.
2. Authentication → **Allow public client flows = Yes**.
3. API permissions → Microsoft Graph → Delegated: `User.Read`, `Mail.Read`, `Calendars.Read`, `offline_access`.
4. Copy the Application (client) ID → `MS_CLIENT_ID=...` (leave `MS_TENANT=common`).
5. Settings → Accounts → **Connect Microsoft** → a code + QR appears → on the phone open microsoft.com/devicelogin, enter the code, sign in.
**Uni accounts:** many universities disable user consent for third-party apps. You'll then see "Need admin approval"
(AADSTS65001 / 90094) and fiaOS shows a note. Options: ask uni IT to approve the app (tell them: read-only Mail.Read/Calendars.Read,
device-code public client), or use the uni timetable **ICS link** (Settings) for calendar. Uni IMAP with a password almost never
works on M365 any more (Basic auth was retired), so fiaOS refuses outlook/office365 hosts for IMAP.

## 3. Other email — IMAP
Settings → Accounts → **Set up IMAP**: host, port (993 TLS), username, app password. fiaOS tests the login before saving and only
ever opens the inbox read-only.

## 4. NotebookLM — pick one
* **No setup (default):** Study tab → per subject: paste the notebook link, *Study pack* (Markdown to upload as a source), *QR* to open on the phone.
* **Bea's normal NotebookLM, unofficial (opt-in):** uses the community `notebooklm-py` library (undocumented Google APIs, may break;
  the saved cookies give full access to that Google account — only do this on a device you trust).
  1. Install on the Surface: `sudo FIAOS_NOTEBOOKLM=1 bash /opt/fiaos-src/linux/install-fiaos.sh` (or rerun your install command with that variable).
  2. On the Mac: `pipx install notebooklm-py` → `notebooklm -p bea login` → sign in as Bea in the window that opens.
  3. `scp ~/.notebooklm/profiles/bea/storage_state.json <admin>@<surface-ip>:` then on the Surface:
     `sudo fiaos-notebooklm-import bea ~/storage_state.json` (it runs `auth check` and tells you to delete the copy).
  4. Study tab shows *Create notebook*: makes a notebook for the subject and adds the study pack as a source. Repeat per person if wanted. Re-import when Google signs the session out.
* **NotebookLM Enterprise (official API, paid):** requires a Google Cloud project with NotebookLM Enterprise set up and licensed
  users (Workspace/Cloud identities — not personal notebooks). Set `NOTEBOOKLM_PROJECT_NUMBER` (+ `NOTEBOOKLM_LOCATION`,
  `NOTEBOOKLM_ENDPOINT_LOCATION`, usually `global`), enable the Discovery Engine API, then Connect Google with the *NotebookLM Ent.* box ticked.
  The API is Preview (`v1alpha`) and may change.
