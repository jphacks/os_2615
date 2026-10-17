/*
共通Inboxのフィルタと並び順を管理する。Provider固有JSONは扱わない。
*/
import { invalidInput } from '../utils/errors.js';

export function createContactService(repository) {
  return {
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
