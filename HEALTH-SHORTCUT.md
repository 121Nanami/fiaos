# Apple Health → fiaOS (iPhone Shortcut)

Each person builds this **once on their own iPhone** (the phone that has their Health data). It sends today's steps, active energy and exercise minutes, plus last night's sleep, to fiaOS. Takes about 10 minutes.

**First, get your personal link.** In fiaOS, open **Settings → ❤️ Apple Health (via Shortcuts)**. Point the iPhone **Camera** at your QR code and tap the link that pops up. A page opens with your link. Tap **Copy link**. (Or copy the text under your QR code.)

> Each link has a private code that identifies you. Keep it on your own phone, and don't share the finished shortcut.

---

## Part 1: Build the shortcut

1. Open **Shortcuts**, go to the **Shortcuts** tab and tap **+**. Tap the name at the top, choose **Rename** and call it **fiaOS Health**.

**Steps**

2. Tap **Search Actions**, then add **Find Health Samples**.
   - Tap **Type** → **Steps**.
   - In the **Start Date** row, tap **is in the last** → **is today**.
   - Tap **Group By** → **Day**.
3. Add **Calculate Statistics** and tap **Average** → **Sum**.
4. Add **Set Variable** and name it **Steps**.

**Active energy**

5. Add **Find Health Samples** again: **Type** → **Active Energy**, **Start Date** **is today**, **Group By** → **Day**.
6. Add **Calculate Statistics** → **Sum**, then **Set Variable** named **Kcal**.

**Exercise minutes**

7. Add **Find Health Samples**: **Type** → **Exercise Minutes**, **Start Date** **is today**, **Group By** → **Day**.
8. Add **Calculate Statistics** → **Sum**, then **Set Variable** named **Exercise**.

**Sleep (last night)**

9. Add **Find Health Samples**: **Type** → **Sleep Analysis**.
   - Set **Start Date** → **is in the last** · **24** · **hours**.
   - Tap **Add Filter** → **Value** · **is not** · **In Bed**.
   - Tap **Add Filter** again → **Value** · **is not** · **Awake**.
   - Leave **Group By** as **None**.
10. Add **Get Details of Health Samples** and tap **Detail** → **Duration**.
11. Add **Calculate Statistics** → **Sum**, then **Set Variable** named **Sleep**.
    (fiaOS works out whether the total is in seconds, minutes or hours.)

**Resting heart rate (optional)**

12. Add **Find Health Samples**: **Type** → **Resting Heart Rate**, **Start Date** **is today**, **Sort by** → **Start Date**, **Order** → **Latest First**. Turn on **Limit** and set it to **1**. Then add **Set Variable** named **RestingHR**.

**Send it to fiaOS**

13. Add **Get Contents of URL**. Tap **URL** and paste your link.
14. Tap the **›** arrow on that action to show more options:
    - **Method** → **POST**
    - **Request Body** → **JSON**
15. Tap **Add new field** → **Number** for each row below. Type the **Key** exactly as shown. For the **Value**, tap the box and pick the variable from the bar above the keyboard.

    | Key           | Value       |
    |---------------|-------------|
    | `steps`       | Steps       |
    | `activeKcal`  | Kcal        |
    | `exerciseMin` | Exercise    |
    | `sleepHours`  | Sleep       |
    | `restingHR`   | RestingHR *(only if you did step 12)* |

    - If your Health app shows energy in **kJ**, use the key `activeKJ` instead of `activeKcal`. fiaOS converts it.
    - If a **Number** field won't accept a variable, use a **Text** field instead. fiaOS reads "8,432", "7.5 hr" and similar text too.
    - You don't need to send your name or the date. The link says who you are, and fiaOS uses today's date.
16. Tap **▶** at the bottom to test it.
    - When asked, allow access to **Health** (turn on Steps, Active Energy, Exercise Minutes, Sleep and Resting Heart Rate).
    - Allow Shortcuts to **find and connect to devices on your local network**.
    - The result should say **✅ Saved <your name>'s Health for …**. In fiaOS, "Last data" on your Settings card updates, and the ❤️ Health card fills in.

---

## Part 2: Make it run by itself

1. In Shortcuts, open the **Automation** tab and tap **+** (or **New Automation**).
2. Choose **Time of Day**. Set it to **9:00 pm**, **Repeat** → **Daily**, and choose **Run Immediately**. Tap **Next**.
3. Pick **fiaOS Health**. Done.
4. *Optional:* make a second one at **7:00 am** so last night's sleep shows in the morning brief.

---

## Good to know

- **Home Wi-Fi only.** fiaOS only listens on the home network, so the iPhone has to be on the home Wi-Fi when the shortcut runs.
- **Locked iPhone = no Health data.** iOS locks Health data while the iPhone is locked, so a 9 pm run on a locked phone sends nothing. If "Last data" in Settings stays old, add another automation: **App** → choose an app you open every evening → **Is Opened** → **Run Immediately** → **fiaOS Health**. Sending more than once a day is fine, because the newest numbers replace the older ones.
- **Too many steps?** If fiaOS shows more steps than the Health app (iPhone and Apple Watch both counting), tap **Add Filter** on the Steps action → **Source** · **is** → choose your Apple Watch.
- **Workouts.** Exercise Minutes already covers your workouts. The server also accepts a `workouts` list (`[{"type":"Running","minutes":32,"kcal":310}]`), which is added to the Notion **Workouts** database and counted as fiaOS workouts. Shortcuts has no simple built-in action that lists today's workouts by type, though, so this guide leaves it out.

## What fiaOS does with it

- A calm **❤️ Health** card on each person's Stage and Workouts view shows steps, active kcal, exercise minutes, last night's sleep and a 7-day steps line. Home gets a one-table summary for everyone.
- **Workout suggestions:** after lots of exercise today it suggests recovery. After less than 6 h sleep it lowers the intensity and says why. With few steps by the evening it suggests a walk.
- **Morning brief:** one line with last night's sleep and yesterday's steps.
- **Notion:** each day is saved to the **Health** database in *fiaOS Data*, one row per person per day.
- fiaOS keeps 90 days of data in `data/health.json` on the Mac. Tokens live in `data/health-tokens.json`, which is never served to the network.

## For the technically curious

`POST http://<mac>:8090/api/health/ingest?token=<personal token>` with JSON (or form) fields `steps`, `activeKcal` (or `activeKJ`), `exerciseMin`, `sleepHours`, optional `restingHR`, `workouts`, `date` (YYYY-MM-DD, default today) and `person` (ignored if it doesn't match the token). A missing or wrong token gets **401**. Values can be numbers or text with units.
