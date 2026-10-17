const pad = (value) => String(value).padStart(2, "0");
export function localDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function monthDays(year, month) {
  const start = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: start }, () => null);
  for (let day = 1; day <= count; day++)
    cells.push(`${year}-${pad(month + 1)}-${pad(day)}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function withDay(value, day) {
  return `${day}T${value.slice(11, 16)}`;
}
