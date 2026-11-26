/* Dayview settings. Edit this file — no build step needed. */
window.DAYVIEW_CONFIG = {
  // Visible day
  dayStart: '09:00',
  dayEnd: '19:00',
  // Appointments outside these hours: true = widen the day to show them,
  // false = keep the hours fixed and show a "+N outside hours" badge.
  expandToFit: false,

  // Breaks for everyone (a provider can override with its own `breaks`)
  breaks: [{ start: '13:00', end: '14:00', label: 'Lunch' }],

  // Grid
  snapMinutes: 5,          // step for drag, resize and new appointments
  gridMinutes: 15,         // thin grid lines
  defaultDuration: 30,
  rowHeight: 68,           // px

  // Zoom, px per hour. 0 = fit the whole day into the window (never below minHourWidth)
  zoomLevels: [0, 160, 240, 360],
  defaultZoom: 0,
  minHourWidth: 112,

  // Time
  timeZone: null,          // e.g. 'Europe/Madrid'; null = browser time zone
  hour12: false,           // true = 9 AM, false = 09:00
  locale: 'en-GB',
  followNow: true,         // scroll to the current time on open and keep it in view

  editable: true,          // drag, resize, create, delete
  storageKey: 'dayview',   // remembers zoom and hidden providers in this browser

  // Order here = order in the legend. `attention` statuses feed the "Next issue" button.
  statuses: {
    ready:    { label: 'Ready',             color: '#9ca3af', border: '1px solid #d9dbe0' },
    working:  { label: 'Agent working',     color: '#6b7280', border: '1px dashed #9ca3af' },
    needs:    { label: 'Needs you',         color: '#9333ea', border: '2px solid #c084fc', attention: true },
    risk:     { label: 'At risk',           color: '#ea580c', border: '2px solid #fb923c', attention: true },
    proposed: { label: 'Proposed by agent', color: '#6b7280', border: '2px dotted #9ca3af' }
  }
};
