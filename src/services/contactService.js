/*
共通Inboxのフィルタ・並び順とお気に入り操作を管理する。Provider固有JSONは扱わない。
*/
import { invalidInput } from '../utils/errors.js';

export function createContactService(repository) {
  return {
    setSearchName(contactId, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).length !== 1 || typeof input.searchName !== 'string' ||
          input.searchName.trim().length > 100) throw invalidInput();
      return repository.setSearchName(contactId, input.searchName.trim());
    },
    setFavorite(contactId, input) {
      if (typeof contactId !== 'string' || !contactId.trim() || !input ||
          typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).length !== 1 || !Object.hasOwn(input, 'isFavorite') ||
          typeof input.isFavorite !== 'boolean') throw invalidInput();
      return repository.setFavorite(contactId, input.isFavorite);
    },
    list(filter = 'all') {
      if (!['all', 'unreplied', 'favorite', 'later'].includes(filter)) throw invalidInput();
      return repository.listInbox().filter(item => {
        if (filter === 'unreplied') return item.conversation.hasUnreplied;
        if (filter === 'favorite') return item.contact.isFavorite;
        if (filter === 'later') return item.reminder !== null;
        return true;
      }).sort((a, b) => Number(b.contact.isFavorite) - Number(a.contact.isFavorite) ||
        Date.parse(b.contact.lastMessageAt) - Date.parse(a.contact.lastMessageAt) ||
        a.contact.id.localeCompare(b.contact.id));
    }
  };
}
