// Deep link for one EllenOS window: /?app=paint hides the shell and opens that app.
(() => {
  const app = new URLSearchParams(location.search).get('app');
  if (!app) return;
  document.documentElement.dataset.app = app;
  document.body.dataset.app = app;
  const splash = document.getElementById('splash');
  if (splash) splash.remove();
  if (typeof TABS === 'undefined' || typeof view === 'undefined') return;
  const studio = { docs: 'docs', sheets: 'sheets', slides: 'slides', paint: 'paint', draw: 'draw', clip: 'clip', photo: 'photo', layout: 'layout', assets: 'assets', library: 'home' };
  const tabs = {
    stage: 'Stage', meals: 'Meals & Diet', woolies: 'Woolworths', workouts: 'Workouts',
    study: 'Study', money: 'Money', habits: 'Habits & Chores', settings: 'Settings',
    planner: 'Planner', notes: 'Notes', week: 'Week'
  };
  const house = { mail: 'mail', calendar: 'mail', media: 'media', desk: 'desk', search: 'search' };
  const go = () => {
    if (studio[app] && window.STUDIO) { view.tab = 'Studio'; STUDIO.open(studio[app]); return; }
    if (tabs[app] && TABS.includes(tabs[app])) { view.tab = tabs[app]; render(); return; }
    if (house[app] && window.HOUSE) {
      view.tab = 'House';
      HOUSE.mode = house[app];
      HOUSE.focusCal = app === 'calendar';
      HOUSE.load();
      return;
    }
    render();
  };
  setTimeout(go, 0);
})();
