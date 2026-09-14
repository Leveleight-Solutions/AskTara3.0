/** Duration of an independently maintained catalog experience, in minutes. */
export function catalogDurationMinutes(duration: string): number {
  const hours = duration.match(/(\d+(?:\.\d+)?)\s*hours?/i);
  const minutes = duration.match(/(\d+)\s*min(?:ute)?s?/i);
  const total = Number(hours?.[1] || 0) * 60 + Number(minutes?.[1] || 0);
  return total > 0 ? Math.min(720, Math.round(total)) : 120;
}
