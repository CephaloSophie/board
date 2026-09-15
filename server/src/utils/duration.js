// "4h", "0,5 h", "2 j" / "2d" (8h days), "1h 30min", "1j 2h" → hours.
// Mirrors client utils/format hoursOf.
function hoursOf(duration, hoursPerDay = 8) {
  if (duration === null || duration === undefined || duration === '') return 0;
  if (typeof duration === 'number') return Number.isFinite(duration) ? duration : 0;
  const re = /([\d.,]+)\s*(min|j|d|h|m)(?![a-z])/gi;
  let total = 0;
  let m;
  while ((m = re.exec(String(duration)))) {
    const v = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(v)) continue;
    const unit = m[2].toLowerCase();
    total += unit === 'j' || unit === 'd' ? v * hoursPerDay : unit === 'h' ? v : v / 60;
  }
  return Math.round(total * 100) / 100;
}

// Jira stores estimates in seconds → Kýdos text ("1j 2h", "1h 30min", "15min").
function secondsToDuration(seconds, hoursPerDay = 8) {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec <= 0) return '';
  let minutes = Math.round(sec / 60);
  const perDay = hoursPerDay * 60;
  const days = Math.floor(minutes / perDay);
  minutes -= days * perDay;
  const hours = Math.floor(minutes / 60);
  minutes -= hours * 60;
  return [days && `${days}j`, hours && `${hours}h`, minutes && `${minutes}min`].filter(Boolean).join(' ');
}

function durationToSeconds(duration, hoursPerDay = 8) {
  const h = hoursOf(duration, hoursPerDay);
  return h ? Math.round(h * 3600) : null;
}

module.exports = { hoursOf, secondsToDuration, durationToSeconds };
