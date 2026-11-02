# Centre (Electron)

The Desk panel is a normal page so Centre can embed it.

- Panel: `http://127.0.0.1:8080/desk.html`
- Full house: `http://127.0.0.1:8080/?tab=House`
- Facet start page: `http://127.0.0.1:8080/facet.html`

Reads are GET. Writes are POST with header `X-FiaOS: 1` and a JSON body.

| Call | Body | What it does |
| --- | --- | --- |
| `GET /api/launcher` | | apps, stats, clipboard |
| `POST /api/launcher/clipboard` | `{text}` | keep a clipping |
| `GET /api/launcher/clipboard?live=1` | | also try `wl-paste` or `xclip` |
| `POST /api/launcher/tile` | `{preset:"left"\|"right"\|"focus"}` | `swaymsg` or `wmctrl` if present, otherwise the command to run |
| `POST /api/launcher/apps` | `{name,exec}` | add a custom launcher row |
| `GET /api/hub/search?q=` | | notes, mail, events, tasks, media, bookmarks |
| `POST /api/facet/history` | `{url,title}` | record a visit (http/https only) |
| `POST /api/facet/bookmark` | `{url,title,group}` | save a bookmark |

Load the panel from localhost. Do not point it at a public host; the routes refuse anything that is not this machine or the LAN.
