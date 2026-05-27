/** Returns UTC midnight for the calendar day of the given instant. */
function startOfUtcDay(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

module.exports = { startOfUtcDay };
