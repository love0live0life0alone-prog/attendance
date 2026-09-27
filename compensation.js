/**
 * Computes each day's display status for a worker's month, from raw
 * attendance rows. Never mutates the original attendance records —
 * ABSENT->COMPENSATED is a *display* transformation only, so the
 * underlying check_in/check_out history stays exactly as recorded.
 *
 * records: Map<'YYYY-MM-DD', {in, out}>
 * Returns: [{ day, date, status, in, out }]
 *   status ∈ PRESENT | ABSENT | FRIDAY_WORK | COMPENSATED | FUTURE | NONE
 */
function computeMonthStatuses(records, year, month /* 0-11 */, now = new Date()) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const days = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const ds = toDateStr(d);
    const isFriday = d.getDay() === 5;
    const rec = records.get(ds);
    const hasIn = !!(rec && rec.in);

    let status;
    if (d.getTime() > today.getTime()) status = 'FUTURE';
    else if (isFriday) status = hasIn ? 'FRIDAY_WORK' : 'NONE';
    else status = hasIn ? 'PRESENT' : 'ABSENT';

    days.push({ day, date: ds, status, in: rec ? rec.in : null, out: rec ? rec.out : null });
  }

  // Compensation pass: each Friday worked (FRIDAY_WORK) offsets one ABSENT day,
  // turning it into COMPENSATED. Original ABSENT is never deleted — only its
  // *display* status changes.
  const fridayWorkCount = days.filter((d) => d.status === 'FRIDAY_WORK').length;
  const absentIdx = days.map((d, i) => (d.status === 'ABSENT' ? i : -1)).filter((i) => i >= 0);
  const compensateCount = Math.min(fridayWorkCount, absentIdx.length);
  for (let i = 0; i < compensateCount; i++) {
    days[absentIdx[i]].status = 'COMPENSATED';
  }

  return days;
}

function toDateStr(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = { computeMonthStatuses, toDateStr };
