// Durations are never negative here; coerce + clamp so a bad/negative value
// (or a string) can't render "-2h -30m" or "NaNh NaNm".
export const formatTime = (mins) => {
  const m = Math.max(0, Math.floor(Number(mins) || 0))
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'
}
