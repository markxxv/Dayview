# Dayview

Day schedule for providers. Plain HTML, CSS and JavaScript: no build, no dependencies.
Open `index.html`, or publish the folder to GitHub Pages.

| File | Purpose |
|---|---|
| `config.js` | Hours (09:00–19:00), breaks, grid step, zoom, time zone, statuses |
| `data.js` | Demo providers and appointments (replace with your API) |
| `dayview.js` | Component |
| `styles.css` | Styles |

## CRM integration

```js
const view = Dayview.mount(element, {
  config: window.DAYVIEW_CONFIG,
  providers,  // [{id, name, role, photo?, hours?: {start,end}, breaks?: [{start,end,label}], hidden?}]
  loadDay: date => fetch(`/api/appointments?date=${date}`).then(r => { if (!r.ok) throw r; return r.json(); }),
  onSave: async ({type, date, appointment, previous}) => { /* create | update | delete; throw to roll back */ }
});
view.reload();        // re-fetch the current day (e.g. after a websocket event)
view.goTo('2026-11-27');
view.scrollToNow();
```

Appointment: `{id, providerId, patient, start: "09:30", duration: 30, status, reason?, note?}`.
New appointments get a temporary `new-…` id; call `view.reload()` after saving to pick up the server id.

## Controls

- Click an empty slot to create, click an appointment to edit.
- Drag to move (also to another provider), drag the right edge to change duration. On touch screens, edit in the panel.
- Keys: `←` `→` day, `T` today, `N` now, `A` next issue, `C` new, `/` search, `+` `-` `0` zoom,
  `Alt`+arrows move the focused appointment, `Ctrl/Cmd+Z` undo while the toast is visible, `Esc` close.
- Add `?now=14:25` to the URL to preview the time line at any time of day.
