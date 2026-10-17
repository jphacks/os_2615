/* アニメーション中のDOMに依存せず、固定したスロットから挿入先を決める。 */
export function tabSlotIndex(centers, position) {
  let index = 0;
  while (index < centers.length - 1 && position > (centers[index] + centers[index + 1]) / 2) index++;
  return index;
}
export function tabOrderAt(original, id, index) {
  if (!original.includes(id)) return [...original];
  const next = original.filter(value => value !== id);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}
