/* Demo data only. In the CRM, replace loadDay() with a request to your API. */
(function () {
  const P = (id, name, role, img, extra) => Object.assign({ id, name, role, photo: `https://i.pravatar.cc/80?img=${img}` }, extra);
  const providers = [
    P('okafor', 'Dr. Grace Okafor', 'Spine and orthopedics', 47),
    P('lin', 'Dr. Samuel Lin', 'Family medicine', 12),
    P('ruiz', 'Dr. Elena Ruiz', 'Cardiology', 32),
    P('porter', 'Dr. James Porter', 'Dermatology', 15, { hours: { start: '10:00', end: '18:00' } }),
    P('haddad', 'Dr. Amira Haddad', 'Pediatrics', 25),
    P('bennett', 'Dr. Noah Bennett', 'Sports medicine', 8),
    P('menon', 'Dr. Ravi Menon', 'Internal medicine', 11),
    P('dunn', 'Dr. Claire Dunn', 'Endocrinology', 29, { hours: { start: '09:00', end: '15:00' } }),
    P('adeyemi', 'Dr. Victor Adeyemi', 'Gastroenterology', 14),
    P('tan', 'Dr. Mei Tan', "Women's health", 44),
    P('ortiz', 'Dr. Lucas Ortiz', 'Neurology', 13, { hours: { start: '12:00', end: '19:00' }, breaks: [{ start: '15:30', end: '16:00', label: 'Break' }] }),
    P('walsh', 'Dr. Fiona Walsh', 'Rheumatology', 49),
    P('park', 'Dr. Hana Park', 'Allergy', 45, { hidden: true }),
    P('silva', 'Dr. Marco Silva', 'Urology', 51, { hidden: true })
  ];
  const names = ['Priya Nair','Luis Ortega','Hannah Cole','Owen Price','Grace Lee','Tom Fisher','Nell Ross','Ava Stone','Ben Adler','Ruth Adams','Daniel Kim','Sara Quinn','Leo Grant','Nina Shah','Ali Khan','Maya Brooks','Ivan Petrov','Chloe Martin','Omar Haddou','Julia Weber','Ken Sato','Lena Novak','Pablo Reyes','Dina Farouk'];
  const reasons = ['Follow-up','New patient','Annual check-up','Test results','Consultation','Prescription review'];
  const notes = { needs: 'Insurance authorisation needs your approval.', risk: 'Lab results have not arrived yet.', working: 'Agent is collecting records.', proposed: 'Agent suggests this time. Confirm or move it.' };

  window.DAYVIEW_DATA = {
    providers,
    /* date: 'YYYY-MM-DD' → array (or a Promise of an array) */
    loadDay(date) {
      let seed = [...date].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483647, 7);
      const rnd = n => (seed = (seed * 48271) % 2147483647) % n;
      if ([0, 6].includes(new Date(date + 'T12:00:00').getDay())) return [];
      const out = [];
      const toMin = s => +s.slice(0, 2) * 60 + +s.slice(3);
      const hm = m => String(m / 60 | 0).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      providers.forEach(p => {
        const h = p.hours || { start: '09:00', end: '19:00' };
        const brs = p.breaks || [{ start: '13:00', end: '14:00' }];
        let t = toMin(h.start) + rnd(4) * 10;
        while (t < toMin(h.end) - 20) {
          const dur = [20, 30, 30, 40, 45, 60][rnd(6)];
          const br = brs.find(b => t < toMin(b.end) && t + dur > toMin(b.start));
          if (br) { t = toMin(br.end); continue; }
          if (t + dur > toMin(h.end)) break;
          const r = rnd(20);
          const status = r < 13 ? 'ready' : r < 15 ? 'working' : r < 16 ? 'needs' : r < 18 ? 'risk' : 'proposed';
          out.push({ id: `${date}-${out.length}`, providerId: p.id, patient: names[rnd(names.length)], start: hm(t), duration: dur, status, reason: reasons[rnd(reasons.length)], note: notes[status] || '' });
          t += dur + [0, 5, 10, 20, 45][rnd(5)];
        }
      });
      return out;
    }
  };
})();
