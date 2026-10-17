/* 表示名と登録済みの別名を、かな・幅・大文字小文字・空白をそろえて検索する。 */
export function normalizeName(value) {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/\s/g, '');
}
export function matchesContact(contact, query) {
  const term = normalizeName(query);
  return [contact.displayName, contact.searchName ?? ''].some(name => normalizeName(name).includes(term));
}
