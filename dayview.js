/* Dayview — day schedule. No dependencies. Usage: see index.html */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  const pad = n => String(n).padStart(2, '0');
  const hm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const span = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;

  function mount(root, opts) {
    const cfg = Object.assign({
      dayStart: '09:00', dayEnd: '19:00', expandToFit: false, breaks: [], snapMinutes: 5, gridMinutes: 15,
      defaultDuration: 30, rowHeight: 68, zoomLevels: [0, 160, 240, 360], defaultZoom: 0, minHourWidth: 112,
      timeZone: null, hour12: false, locale: 'en-GB', followNow: true, editable: true, storageKey: 'dayview', statuses: {}
    }, opts.config);
    if (!(toMin(cfg.dayEnd) > toMin(cfg.dayStart))) throw new Error('Dayview: dayEnd must be later than dayStart');
    const providers = opts.providers;

    const clockFmt = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    // ?now=14:25 in the URL freezes the clock, for demos and testing
    const fake = new URLSearchParams(location.search).get('now');
    function clock() {
      const p = Object.fromEntries(clockFmt.formatToParts(new Date()).map(x => [x.type, x.value]));
      const min = fake && /^\d{1,2}:\d{2}$/.test(fake) ? toMin(fake) : +p.hour * 60 + +p.minute + +p.second / 60;
      return { date: `${p.year}-${p.month}-${p.day}`, min };
    }
    const time = m => {
      m = Math.floor(m);
      if (!cfg.hour12) return hm(m);
      const h = Math.floor(m / 60) % 24;
      return `${h % 12 || 12}${m % 60 ? ':' + pad(m % 60) : ''} ${h < 12 ? 'AM' : 'PM'}`;
    };
    const range = a => `${time(a.s)} – ${time(a.s + a.duration)}`;

    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(cfg.storageKey)) || {}; } catch (e) {}
    const savePrefs = () => { try { localStorage.setItem(cfg.storageKey, JSON.stringify({ zoom, hidden: [...hidden] })); } catch (e) {} };

    let date = clock().date, appts = [], loading = false, loadError = '', seq = 0;
    let zoom = clamp(prefs.zoom ?? cfg.defaultZoom, 0, cfg.zoomLevels.length - 1);
    let hidden = new Set(prefs.hidden || providers.filter(p => p.hidden).map(p => p.id));
    let filter = null, query = '', selected = null, draft = null, follow = cfg.followNow;
    let start, end, ppm, drag = null, toastTimer, issueIx = -1, autoScroll = 0, lastDay = clock().date;
    const cache = new Map(); // keeps edits while switching days

    root.innerHTML = `
    <div class="dv${cfg.editable ? '' : ' ro'}">
      <div class="top">
        <div class="row1">
          <div class="title"><h1>Day view</h1><div class="sub" aria-live="polite"></div></div>
          <div class="group">
            <button class="btn" data-a="prev" aria-label="Previous day" title="Previous day (←)">‹</button>
            <input class="date" type="date" aria-label="Date">
            <button class="btn" data-a="next" aria-label="Next day" title="Next day (→)">›</button>
            <button class="btn" data-a="today" title="Today (T)">Today</button>
          </div>
          <div class="group">
            <button class="btn" data-a="zout" aria-label="Zoom out" title="Zoom out (−)">−</button>
            <button class="btn" data-a="fit" title="Fit whole day (0)">Fit</button>
            <button class="btn" data-a="zin" aria-label="Zoom in" title="Zoom in (+)">+</button>
          </div>
          ${cfg.editable ? '<button class="btn dark" data-a="new" title="New appointment (C)">+ Appointment</button>' : ''}
        </div>
        <div class="row2">
          <div class="legend" role="group" aria-label="Filter by status"></div>
          <button class="btn" data-a="issue" title="Jump to next item that needs attention (A)"></button>
          <input class="search" type="search" placeholder="Find patient  /" aria-label="Find patient">
          <div class="menu"><button class="btn" data-a="menu" aria-expanded="false"></button><div class="pop" hidden></div></div>
        </div>
      </div>
      <div class="scroll"><div class="grid"></div></div>
      <button class="btn dark jump" data-a="now" hidden></button>
      <aside class="panel" hidden aria-label="Appointment"></aside>
      <div class="toast" role="status" hidden></div>
    </div>
    <div class="tip" hidden></div>`;
    const $ = s => root.querySelector(s);
    const dv = $('.dv'), scroller = $('.scroll'), grid = $('.grid'), panel = $('.panel'), pop = $('.pop'), tip = $('.tip'), toastEl = $('.toast');

    const visible = () => providers.filter(p => !hidden.has(p.id));
    const shownAppts = () => appts.filter(a => !hidden.has(a.providerId));
    const matches = a => (!filter || a.status === filter) && (!query || a.patient.toLowerCase().includes(query));
    const norm = a => ({ ...a, s: toMin(a.start), duration: +a.duration });
    const plain = ({ s, ...a }) => ({ ...a, start: hm(s), date });
    const hoursOf = p => ({ s: p.hours ? toMin(p.hours.start) : -Infinity, e: p.hours ? toMin(p.hours.end) : Infinity });
    const breaksOf = p => (p.breaks || cfg.breaks).map(b => ({ s: toMin(b.start), e: toMin(b.end), label: b.label || 'Break' }));
    const x = m => (m - start) * ppm;
    const sideW = () => parseFloat(getComputedStyle(root).getPropertyValue('--side')) || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side'));

    function problems(a) {
      const p = providers.find(q => q.id === a.providerId), out = [];
      if (!p) return out;
      const hit = appts.filter(b => b.id !== a.id && b.providerId === a.providerId && b.s < a.s + a.duration && b.s + b.duration > a.s);
      if (hit.length) out.push('Overlaps with ' + hit.map(b => `${b.patient} (${time(b.s)})`).join(', '));
      const h = hoursOf(p);
      if (a.s < Math.max(h.s, toMin(cfg.dayStart)) || a.s + a.duration > Math.min(h.e, toMin(cfg.dayEnd))) out.push('Outside working hours');
      const br = breaksOf(p).find(b => a.s < b.e && a.s + a.duration > b.s);
      if (br) out.push(`During ${br.label.toLowerCase()}`);
      return out;
    }

    // Overlapping appointments are split into lanes inside the row
    function lanes(list) {
      list.sort((a, b) => a.s - b.s || b.duration - a.duration);
      let cluster = [], ends = [], until = -1;
      const flush = () => { cluster.forEach(a => a._n = ends.length); cluster = []; ends = []; };
      const res = list.map(a => ({ ...a, ref: a }));
      res.forEach(a => {
        if (a.s >= until) flush();
        let i = ends.findIndex(e => e <= a.s);
        if (i < 0) i = ends.length;
        ends[i] = a.s + a.duration; a._i = i; cluster.push(a);
        until = Math.max(until, ends[i]);
      });
      flush();
      return res;
    }

    function layout() {
      start = toMin(cfg.dayStart); end = toMin(cfg.dayEnd);
      if (cfg.expandToFit) shownAppts().forEach(a => {
        start = Math.min(start, Math.floor(a.s / 60) * 60); end = Math.max(end, Math.ceil((a.s + a.duration) / 60) * 60);
      });
      const px = cfg.zoomLevels[zoom];
      const fit = (scroller.clientWidth - sideW()) / ((end - start) / 60);
      ppm = (px || Math.max(fit, cfg.minHourWidth)) / 60;
    }

    function render() {
      layout();
      const W = (end - start) * ppm, H = cfg.rowHeight;
      let axis = '', lines = '';
      for (let m = Math.ceil(start / cfg.gridMinutes) * cfg.gridMinutes; m <= end; m += cfg.gridMinutes) {
        const hour = m % 60 === 0;
        if (m > start && m < end && (hour || cfg.gridMinutes * ppm >= 18)) lines += `<i class="${hour ? 'h' : ''}" style="left:${x(m)}px"></i>`;
      }
      const marks = new Set([start, end]);
      const step = ppm * 30 >= 90 ? 30 : 60;
      for (let m = Math.ceil(start / step) * step; m < end; m += step) if (Math.min(x(m), W - x(m)) > 44) marks.add(m);
      [...marks].sort((a, b) => a - b).forEach(m => {
        axis += `<span data-m="${m}" class="${m === start ? 'first' : m === end ? 'last' : ''}" style="left:${x(m)}px">${time(m)}</span><em style="left:${Math.min(x(m), W - 1)}px"></em>`;
      });

      const rows = visible().map(p => {
        const h = hoursOf(p);
        const block = (s, e, label) => {
          s = clamp(s, start, end); e = clamp(e, start, end);
          return e > s ? `<div class="off" style="left:${x(s)}px;width:${(e - s) * ppm}px">${(e - s) * ppm > 44 ? esc(label) : ''}</div>` : '';
        };
        let html = block(start, h.s, 'Off') + block(h.e, end, 'Off') + breaksOf(p).filter(b => b.e > h.s && b.s < h.e).map(b => block(b.s, b.e, b.label)).join('');
        const all = appts.filter(a => a.providerId === p.id);
        const before = all.filter(a => a.s + a.duration <= start), after = all.filter(a => a.s >= end);
        [[before, 'l', 'earlier'], [after, 'r', 'later']].forEach(([l, c, w]) => {
          if (l.length) html += `<button class="out ${c}" data-id="${esc(l[0].id)}" title="${esc(l.map(a => a.patient + ' ' + time(a.s)).join(', '))}">+${l.length} ${w}</button>`;
        });
        lanes(all.filter(a => a.s < end && a.s + a.duration > start)).forEach(a => {
          const st = cfg.statuses[a.status] || {};
          const left = x(Math.max(a.s, start)), w = Math.max(x(Math.min(a.s + a.duration, end)) - left - 2, 6);
          const lh = (H - 12) / a._n;
          const cls = ['appt', w < 62 && 'small', w < 26 && 'tiny', a._n > 1 && 'lane', a._n > 1 && 'clash', !matches(a) && 'dim', a.id === selected && 'sel'].filter(Boolean).join(' ');
          html += `<div class="${cls}" tabindex="0" role="button" data-id="${esc(a.id)}" aria-label="${esc(`${a.patient}, ${range(a)}, ${st.label || a.status}`)}"
            style="left:${left + 1}px;width:${w}px;top:${6 + a._i * lh}px;height:${lh - (a._n > 1 ? 2 : 0)}px;border:${st.border || '1px solid #ddd'}">
            <div class="p" style="${st.attention ? 'color:' + st.color : ''}">${esc(a.patient)}</div><div class="t">${time(a.s)} · ${a.duration}m</div><div class="bar" hidden></div>${cfg.editable && w >= 26 ? '<div class="grip"></div>' : ''}</div>`;
        });
        const initials = p.name.replace(/^Dr\.?\s+/, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('');
        return `<div class="row" style="height:${H}px"><div class="who" title="${esc(p.name + ' · ' + p.role)}">
          <div class="ava">${esc(initials)}${p.photo ? `<img src="${esc(p.photo)}" alt="">` : ''}</div>
          <div class="meta"><div class="n">${esc(p.name)}</div><div class="r">${esc(p.role)}</div><div class="state" data-state="${esc(p.id)}"></div></div></div>
          <div class="track" data-p="${esc(p.id)}" style="width:${W}px">${html}</div></div>`;
      }).join('');

      const msg = loading ? 'Loading…' : loadError ? `${esc(loadError)} <button class="btn" data-a="retry">Retry</button>`
        : !visible().length ? 'No providers selected.' : !appts.length ? 'No appointments on this day.' + (cfg.editable ? ' Click a row to add one.' : '') : '';
      grid.innerHTML = `<div class="hrow"><div class="corner"><span>Provider</span></div><div class="axis" style="width:${W}px">${axis}<div class="nowpill" hidden></div></div></div>
        <div class="lines" style="width:${W}px">${lines}</div><div class="past" hidden></div>
        ${msg ? `<div class="empty">${msg}</div>` : ''}${loading || loadError ? '' : rows}<div class="nowline" hidden></div>`;
      grid.querySelectorAll('.ava img').forEach(i => i.onerror = () => i.remove());
      renderBars();
      tick();
    }

    function renderBars() {
      const list = shownAppts();
      $('.legend').innerHTML = Object.entries(cfg.statuses).map(([k, s]) =>
        `<button class="chip${s.attention ? ' att' : ''}" data-status="${esc(k)}" aria-pressed="${filter === k}"><i style="border:${s.border}"></i>${esc(s.label)}<b>${list.filter(a => a.status === k).length}</b></button>`).join('');
      const n = issues().length, b = $('[data-a=issue]');
      b.textContent = n ? `Next issue · ${n}` : 'No open issues'; b.disabled = !n;
      $('[data-a=menu]').textContent = `${visible().length} of ${providers.length} providers ▾`;
      $('.date').value = date;
      $('[data-a=zout]').disabled = zoom === 0; $('[data-a=zin]').disabled = zoom === cfg.zoomLevels.length - 1;
    }

    // Attention items that are not over yet, in time order
    function issues() {
      const c = clock();
      return shownAppts().filter(a => cfg.statuses[a.status]?.attention && (date !== c.date || a.s + a.duration > c.min)).sort((a, b) => a.s - b.s);
    }

    // Everything that depends on the current time; cheap, runs every second
    function tick() {
      const c = clock(), today = date === c.date;
      if (c.date !== lastDay) { const was = date === lastDay; lastDay = c.date; if (was && panel.hidden && !drag) return go(c.date); }
      const inDay = today && c.min >= start && c.min <= end;
      const line = $('.nowline'), pill = $('.nowpill'), past = $('.past');
      if (!line) return;
      const nx = x(c.min), side = sideW();
      line.hidden = pill.hidden = !inDay;
      line.style.left = side + nx + 'px'; pill.style.left = clamp(nx, 26, (end - start) * ppm - 26) + 'px'; pill.textContent = time(c.min);
      grid.querySelectorAll('.axis span').forEach(s => s.classList.toggle('hide', inDay && Math.abs(x(+s.dataset.m) - nx) < 52));
      const pastW = date < c.date ? (end - start) * ppm : today ? clamp(nx, 0, (end - start) * ppm) : 0;
      past.hidden = !pastW; past.style.width = pastW + 'px';

      grid.querySelectorAll('.appt').forEach(el => {
        const a = appts.find(q => q.id === el.dataset.id); if (!a) return;
        const done = date < c.date || (today && a.s + a.duration <= c.min);
        const live = today && a.s <= c.min && c.min < a.s + a.duration;
        el.classList.toggle('done', done); el.classList.toggle('live', live);
        const bar = el.querySelector('.bar'); bar.hidden = !live;
        if (live) bar.style.width = (c.min - a.s) / a.duration * 100 + '%';
      });

      grid.querySelectorAll('[data-state]').forEach(el => {
        const p = providers.find(q => q.id === el.dataset.state);
        const list = appts.filter(a => a.providerId === p.id).sort((a, b) => a.s - b.s);
        let text = `${list.length} visit${list.length === 1 ? '' : 's'}`, busy = false;
        if (today) {
          const h = hoursOf(p), now = list.find(a => a.s <= c.min && c.min < a.s + a.duration), next = list.find(a => a.s > c.min);
          const br = breaksOf(p).find(b => b.s <= c.min && c.min < b.e);
          if (now) { text = `Busy · ${span(Math.ceil(now.s + now.duration - c.min))} left`; busy = true; }
          else if (c.min >= Math.min(h.e, end)) text = 'Day finished';
          else if (br) text = `${br.label} until ${time(br.e)}`;
          else if (next) text = `Free · next in ${span(Math.ceil(next.s - c.min))}`;
          else text = 'Free for the rest of the day';
        }
        el.textContent = text; el.classList.toggle('busy', busy);
      });

      const day = new Intl.DateTimeFormat(cfg.locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
      let note = `${time(toMin(cfg.dayStart))} to ${time(toMin(cfg.dayEnd))}`;
      if (today && c.min < start) note = `Day starts in ${span(Math.ceil(start - c.min))}`;
      if (today && c.min > end) note = 'Working day is over';
      const sub = `${day} · ${note}`; if ($('.sub').textContent !== sub) $('.sub').textContent = sub;

      if (follow && inDay && !drag && panel.hidden && !query) {
        const view = scroller.clientWidth - side, at = nx - scroller.scrollLeft;
        if (at < view * .05 || at > view * .8) scrollToMin(c.min, false);
      }
      updateJump();
    }

    function updateJump() {
      const c = clock(), j = $('.jump'), side = sideW();
      const at = x(c.min) - scroller.scrollLeft, off = at < 0 || at > scroller.clientWidth - side;
      const show = !loading && (date !== c.date || (c.min >= start && c.min <= end && off));
      j.hidden = !show || !panel.hidden || !toastEl.hidden;
      j.textContent = date !== c.date ? 'Back to today' : at < 0 ? '‹ Now' : 'Now ›';
    }

    function scrollToMin(m, smooth = true) {
      const left = Math.max(0, x(m) - (scroller.clientWidth - sideW()) * .3);
      autoScroll = Date.now() + 800;
      scroller.scrollTo({ left, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    }
    function reveal(a) {
      const row = grid.querySelector(`.track[data-p="${CSS.escape(a.providerId)}"]`)?.parentElement;
      follow = false; scrollToMin(a.s);
      if (row) scroller.scrollTop = Math.max(0, row.offsetTop - scroller.clientHeight / 2);
    }
    function goNow() { follow = cfg.followNow; const c = clock(); if (date !== c.date) go(c.date); else scrollToMin(c.min); }

    async function go(d) {
      if (!/^\d{4}-\d\d-\d\d$/.test(d)) return;
      date = d; selected = null; issueIx = -1; closePanel(); hideToast(); loadError = '';
      const id = ++seq;
      if (!cache.has(d)) {
        appts = []; loading = true; render();
        try { const data = await opts.loadDay(d); cache.set(d, data.map(norm)); }
        catch (e) { if (id === seq) { loading = false; loadError = 'Could not load this day.'; render(); } return; }
        if (id !== seq) return;
      }
      loading = false; appts = cache.get(d); render();
      const c = clock(); follow = cfg.followNow && d === c.date;
      scrollToMin(d === c.date ? clamp(c.min, start, end) : start, false); updateJump();
    }

    // All edits go through here: optimistic update, save to CRM, rollback on failure, undo
    async function commit(type, next, prev, undoable = true) {
      const day = date, list = appts;
      const put = (add, removeId) => { const i = list.findIndex(a => a.id === removeId); if (i >= 0) list.splice(i, 1); if (add) list.push(add); };
      const item = next || prev;
      put(next, item.id); render();
      if (undoable) toast(type === 'delete' ? `Deleted ${item.patient}` : type === 'create' ? `Added ${item.patient}, ${time(item.s)}` : `Saved ${item.patient}, ${time(item.s)}${problems(item).length ? ' · check conflicts' : ''}`,
        () => commit(type === 'create' ? 'delete' : type === 'delete' ? 'create' : 'update', prev, next, false));
      try { await opts.onSave?.({ type, date: day, appointment: plain(item), previous: prev ? plain(prev) : null }); }
      catch (e) { put(prev, item.id); render(); toast('Could not save. The change was reverted.'); }
    }

    function toast(text, undo) {
      clearTimeout(toastTimer);
      toastEl.innerHTML = `<span>${esc(text)}</span>${undo ? '<button>Undo</button>' : ''}`; toastEl.hidden = false;
      toastEl.undo = undo; if (undo) toastEl.querySelector('button').onclick = () => { hideToast(); undo(); };
      toastTimer = setTimeout(hideToast, 6000); updateJump();
    }
    function hideToast() { clearTimeout(toastTimer); toastEl.hidden = true; toastEl.undo = null; }

    function openPanel(a, isNew) {
      hideTip(); selected = a.id; draft = { a, isNew };
      const dis = cfg.editable ? '' : 'disabled';
      const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
      panel.innerHTML = `<header><h2>${isNew ? 'New appointment' : 'Appointment'}</h2><button class="btn" data-a="close" aria-label="Close">✕</button></header>
        <form>
          <label>Patient<input name="patient" required value="${esc(a.patient)}" ${dis} autocomplete="off"></label>
          <label>Provider<select name="providerId" ${dis}>${providers.map(p => opt(p.id, p.name, a.providerId)).join('')}</select></label>
          <label class="half">Start<input name="start" type="time" required value="${hm(a.s)}" ${dis}></label>
          <label class="half">Duration, min<input name="duration" type="number" required min="5" max="720" step="5" value="${a.duration}" ${dis}></label>
          <label>Status<select name="status" ${dis}>${Object.entries(cfg.statuses).map(([k, s]) => opt(k, s.label, a.status)).join('')}</select></label>
          <label>Reason<input name="reason" value="${esc(a.reason)}" ${dis}></label>
          <label>Note<textarea name="note" rows="3" ${dis}>${esc(a.note)}</textarea></label>
          <div class="warn" hidden></div>
          ${cfg.editable ? `<footer><button class="btn dark">${isNew ? 'Create' : 'Save'}</button><button type="button" class="btn" data-a="close">Cancel</button>${isNew ? '' : '<button type="button" class="btn danger" data-a="del">Delete</button>'}</footer>` : ''}
        </form>`;
      panel.hidden = false;
      const form = panel.querySelector('form');
      const read = () => { const f = Object.fromEntries(new FormData(form)); return { ...a, ...f, patient: (f.patient || '').trim(), s: toMin(f.start), duration: +f.duration }; };
      const check = () => { const w = form.querySelector('.warn'), p = cfg.editable ? problems(read()) : []; w.hidden = !p.length; w.textContent = p.join('. '); };
      form.oninput = check; check();
      form.onsubmit = e => {
        e.preventDefault(); if (!cfg.editable) return;
        const n = read(); if (!n.patient) { form.patient.value = ''; form.reportValidity(); return; }
        delete n.start; closePanel(); selected = null; commit(isNew ? 'create' : 'update', n, isNew ? null : a);
      };
      grid.querySelectorAll('.appt').forEach(el => el.classList.toggle('sel', el.dataset.id === a.id));
      if (isNew) form.patient.focus(); else panel.querySelector('[data-a=close]').focus({ preventScroll: true });
      updateJump();
    }
    function closePanel() {
      if (panel.hidden) return;
      panel.hidden = true; draft = null; selected = null;
      grid.querySelectorAll('.appt.sel').forEach(el => el.classList.remove('sel')); updateJump();
    }
    function newAt(providerId, s) {
      const d = cfg.defaultDuration;
      openPanel({ id: 'new-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), providerId, patient: '', s, duration: d, status: Object.keys(cfg.statuses)[0], reason: '', note: '' }, true);
    }
    // First free slot from now (or from day start on another date)
    function freeSlot() {
      const c = clock(), from = date === c.date ? Math.ceil(clamp(c.min, start, end) / cfg.snapMinutes) * cfg.snapMinutes : start;
      let best = null;
      visible().forEach(p => {
        for (let s = from; s + cfg.defaultDuration <= end; s += cfg.snapMinutes) {
          if (!problems({ id: '', providerId: p.id, s, duration: cfg.defaultDuration }).length) { if (!best || s < best.s) best = { p: p.id, s }; break; }
        }
      });
      return best || { p: (visible()[0] || providers[0]).id, s: Math.min(from, end - cfg.defaultDuration) };
    }

    function showTip(el, e) {
      const a = appts.find(q => q.id === el.dataset.id); if (!a || drag) return;
      const w = problems(a);
      tip.innerHTML = `<b>${esc(a.patient)}</b><span>${range(a)} · ${span(a.duration)}</span><span>${esc([cfg.statuses[a.status]?.label, a.reason].filter(Boolean).join(' · '))}</span>${a.note ? `<span>${esc(a.note)}</span>` : ''}${w.length ? `<span style="color:#fdba74">${esc(w.join('. '))}</span>` : ''}`;
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
      tip.style.top = (e.clientY + 18 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 12 : e.clientY + 18) + 'px';
    }
    function hideTip() { tip.hidden = true; }
    const hideGhost = () => grid.querySelector('.ghost')?.remove();
    const slotAt = (track, cx) => clamp(Math.floor((start + (cx - track.getBoundingClientRect().left) / ppm) / cfg.snapMinutes) * cfg.snapMinutes, start, end - cfg.snapMinutes);

    // Drag to move (also between providers) and drag the right edge to resize. Mouse and pen only:
    // on touch screens a swipe must scroll, so editing there happens in the panel.
    grid.addEventListener('pointerdown', e => {
      const el = e.target.closest('.appt');
      if (!el || !cfg.editable || e.button || e.pointerType === 'touch') return;
      const a = appts.find(q => q.id === el.dataset.id);
      drag = { a, el, resize: e.target.classList.contains('grip'), x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, s: a.s, d: a.duration, p: a.providerId, moved: false };
    });
    addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x + scroller.scrollLeft - drag.sl;
      if (!drag.moved) {
        if (Math.hypot(dx, e.clientY - drag.y) < 5) return;
        drag.moved = true; drag.el.classList.add('drag'); hideTip(); hideGhost();
      }
      const snap = v => Math.round(v / cfg.snapMinutes) * cfg.snapMinutes;
      if (drag.resize) {
        drag.d = clamp(snap(drag.a.duration + dx / ppm), cfg.snapMinutes, Math.max(end - drag.a.s, cfg.snapMinutes));
        drag.el.style.width = Math.max(drag.d * ppm - 2, 6) + 'px';
      } else {
        drag.s = clamp(snap(drag.a.s + dx / ppm), start, Math.max(start, end - drag.a.duration));
        const track = [...grid.querySelectorAll('.track')].find(t => { const r = t.getBoundingClientRect(); return e.clientY >= r.top && e.clientY < r.bottom; });
        if (track) { drag.p = track.dataset.p; if (drag.el.parentElement !== track) track.appendChild(drag.el); }
        drag.el.style.left = x(drag.s) + 1 + 'px'; drag.el.style.top = '6px'; drag.el.style.height = cfg.rowHeight - 12 + 'px';
      }
      const t = drag.el.querySelector('.t'); t.style.display = 'block';
      t.textContent = `${time(drag.s)} – ${time(drag.s + drag.d)}`;
      const r = scroller.getBoundingClientRect();
      if (e.clientX > r.right - 40) scroller.scrollLeft += 14; else if (e.clientX < r.left + sideW() + 30) scroller.scrollLeft -= 14;
      if (e.clientY > r.bottom - 30) scroller.scrollTop += 10; else if (e.clientY < r.top + 70) scroller.scrollTop -= 10;
    });
    let suppressClick = false;
    addEventListener('pointerup', () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.moved) return;
      suppressClick = true; setTimeout(() => suppressClick = false, 0);
      if (d.s === d.a.s && d.d === d.a.duration && d.p === d.a.providerId) return render();
      commit('update', { ...d.a, s: d.s, duration: d.d, providerId: d.p }, d.a);
    });
    const cancelDrag = () => { if (drag) { drag = null; render(); } };
    addEventListener('pointercancel', cancelDrag);

    grid.addEventListener('pointermove', e => {
      if (drag || e.pointerType === 'touch') return;
      const el = e.target.closest('.appt');
      if (el) { hideGhost(); return showTip(el, e); }
      hideTip();
      const track = e.target.classList.contains('track') ? e.target : null;
      if (!track || !cfg.editable) return hideGhost();
      let g = grid.querySelector('.ghost');
      if (!g) { g = document.createElement('div'); g.className = 'ghost'; }
      const s = slotAt(track, e.clientX);
      g.textContent = '+ ' + time(s);
      Object.assign(g.style, { left: x(s) + 'px', width: Math.min(cfg.defaultDuration, end - s) * ppm + 'px', top: '10px', height: cfg.rowHeight - 20 + 'px' });
      track.appendChild(g);
    });
    grid.addEventListener('pointerleave', () => { hideTip(); hideGhost(); });

    root.addEventListener('click', e => {
      if (suppressClick) return;
      if (!e.target.closest('.menu')) { pop.hidden = true; $('[data-a=menu]').setAttribute('aria-expanded', false); }
      const t = e.target;
      const chip = t.closest('[data-status]');
      if (chip) { filter = filter === chip.dataset.status ? null : chip.dataset.status; render(); const f = shownAppts().filter(matches).sort((a, b) => a.s - b.s); if (filter && f.length) reveal(f.find(a => date !== clock().date || a.s + a.duration > clock().min) || f[0]); return; }
      const ap = t.closest('.appt,.out');
      if (ap) return openPanel(appts.find(a => a.id === ap.dataset.id), false);
      if (t.classList.contains('track') && cfg.editable) { if (!panel.hidden) return closePanel(); hideGhost(); return newAt(t.dataset.p, slotAt(t, e.clientX)); }
      const act = t.closest('[data-a]')?.dataset.a; if (act) run(act);
    });

    function run(act) {
      const keepCentre = fn => {
        const half = (scroller.clientWidth - sideW()) / 2, mid = start + (scroller.scrollLeft + half) / ppm;
        fn(); savePrefs(); render(); autoScroll = Date.now() + 300; scroller.scrollLeft = x(mid) - half;
      };
      ({
        prev: () => go(addDays(date, -1)), next: () => go(addDays(date, 1)), today: goNow, now: goNow, retry: () => go(date),
        zin: () => keepCentre(() => zoom = Math.min(zoom + 1, cfg.zoomLevels.length - 1)),
        zout: () => keepCentre(() => zoom = Math.max(zoom - 1, 0)),
        fit: () => keepCentre(() => zoom = 0),
        new: () => { if (loading || loadError) return; const f = freeSlot(); newAt(f.p, f.s); },
        close: closePanel,
        del: () => { const a = draft.a; closePanel(); commit('delete', null, a); },
        issue: () => { const l = issues(); if (!l.length) return; issueIx = (issueIx + 1) % l.length; const a = l[issueIx]; closePanel(); reveal(a); openPanel(a, false); },
        menu: () => { pop.hidden = !pop.hidden; $('[data-a=menu]').setAttribute('aria-expanded', !pop.hidden); if (!pop.hidden) renderMenu(); },
        all: () => { hidden.clear(); savePrefs(); renderMenu(); render(); },
        none: () => { providers.forEach(p => hidden.add(p.id)); savePrefs(); renderMenu(); render(); }
      })[act]?.();
    }
    function renderMenu() {
      pop.innerHTML = `<div class="group"><button class="btn" data-a="all">Select all</button><button class="btn" data-a="none">Clear</button></div>` +
        providers.map(p => `<label><input type="checkbox" value="${esc(p.id)}" ${hidden.has(p.id) ? '' : 'checked'}>${esc(p.name)}<small>${appts.filter(a => a.providerId === p.id).length}</small></label>`).join('');
    }
    pop.addEventListener('click', e => e.stopPropagation());
    pop.addEventListener('click', e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) run(a); });
    pop.addEventListener('change', e => { hidden[e.target.checked ? 'delete' : 'add'](e.target.value); savePrefs(); render(); });
    $('.date').addEventListener('change', e => go(e.target.value));
    $('.search').addEventListener('input', e => {
      query = e.target.value.trim().toLowerCase(); render();
      const f = shownAppts().filter(matches).sort((a, b) => a.s - b.s); if (query && f.length) reveal(f[0]);
    });

    addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (drag) return cancelDrag();
        if (!pop.hidden) return pop.hidden = true;
        if (!panel.hidden) return closePanel();
        const s = $('.search'); if (query || filter) { s.value = query = ''; filter = null; s.blur(); render(); }
        return;
      }
      if (e.target.matches('input,select,textarea') || !panel.hidden) return;
      const el = e.target.closest?.('.appt');
      if (el) {
        const a = appts.find(q => q.id === el.dataset.id);
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); return openPanel(a, false); }
        // Alt + arrows moves the focused appointment
        if (e.altKey && cfg.editable && e.key.startsWith('Arrow')) {
          e.preventDefault();
          const n = { ...a }, ids = visible().map(p => p.id), i = ids.indexOf(a.providerId);
          if (e.key === 'ArrowLeft') n.s = Math.max(start, a.s - cfg.snapMinutes);
          if (e.key === 'ArrowRight') n.s = Math.min(end - a.duration, a.s + cfg.snapMinutes);
          if (e.key === 'ArrowUp') n.providerId = ids[Math.max(0, i - 1)];
          if (e.key === 'ArrowDown') n.providerId = ids[Math.min(ids.length - 1, i + 1)];
          if (n.s === a.s && n.providerId === a.providerId) return;
          commit('update', n, a); grid.querySelector(`.appt[data-id="${CSS.escape(a.id)}"]`)?.focus();
          return;
        }
      }
      if (e.ctrlKey || e.metaKey) { if (e.key === 'z' && toastEl.undo) { e.preventDefault(); const u = toastEl.undo; hideToast(); u(); } return; }
      if (e.altKey) return;
      if (e.key === '/') { e.preventDefault(); return $('.search').focus(); }
      const k = { ArrowLeft: 'prev', ArrowRight: 'next', KeyT: 'today', KeyN: 'now', KeyA: 'issue', KeyC: cfg.editable ? 'new' : '', Digit0: 'fit', Equal: 'zin', NumpadAdd: 'zin', Minus: 'zout', NumpadSubtract: 'zout' }[e.code];
      if (k) { e.preventDefault(); run(k); }
    });

    scroller.addEventListener('scroll', () => { hideTip(); updateJump(); }, { passive: true });
    // Manual scrolling pauses "follow now" until the user presses Now / Today
    ['wheel', 'touchstart'].forEach(n => scroller.addEventListener(n, () => follow = false, { passive: true }));
    scroller.addEventListener('pointerdown', e => { if (e.target === scroller) follow = false; });

    let lastW = 0;
    new ResizeObserver(() => { if (scroller.clientWidth !== lastW) { lastW = scroller.clientWidth; if (!drag) render(); } }).observe(scroller);
    setInterval(() => { if (!drag) tick(); }, 1000);
    // Refresh the "Next issue" counter as visits end
    setInterval(() => { if (!drag && !loading) renderBars(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

    go(date);
    return { goTo: go, reload: () => { cache.delete(date); return go(date); }, scrollToNow: goNow };
  }
  window.Dayview = { mount };
})();
