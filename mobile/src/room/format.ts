/** "18:30" today, "18:30 28/10" on another day: when the pet comes back from its walk. */
export const clockLabel = (iso: string) => {
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString() ? time : `${time} ${d.getDate()}/${d.getMonth() + 1}`;
};
