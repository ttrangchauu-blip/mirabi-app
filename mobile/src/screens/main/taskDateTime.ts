/** Serialize picker values as local wall-clock fields instead of UTC timestamps. */
export const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
export const localTime = (value: Date) => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;

export function combineLocal(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour = 9, minute = 0] = time ? time.split(':').map(Number) : [];
  return new Date(year, month - 1, day, hour, minute);
}

export function displayDateTime(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [year, month, day] = date.split('-');
  return `${time ? `${time} ` : ''}${day}/${month}/${year}`;
}
