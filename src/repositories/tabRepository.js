/* カスタムタブとContactの所属を直列化した保存処理で管理する。 */
import { randomUUID } from 'node:crypto';
import { notFound } from '../utils/errors.js';
export function createTabRepository(store) {
  return {
    list: () => store.read().tabs ?? [],
    create(name) { return store.update(state => {
      const tab = { id: randomUUID(), name, contactIds: [] };
      (state.tabs ??= []).push(tab);
      return tab;
    }); },
    move(id, direction) { return store.update(state => {
      const tabs = state.tabs ?? [];
      const index = tabs.findIndex(tab => tab.id === id);
      if (index < 0) throw notFound();
      const destination = direction === 'first' ? 0 : direction === 'last' ? tabs.length - 1
        : index + (direction === 'previous' ? -1 : 1);
      if (destination >= 0 && destination < tabs.length && destination !== index) {
        const [tab] = tabs.splice(index, 1);
        tabs.splice(destination, 0, tab);
      }
      return tabs;
    }); },
    remove(id) { return store.update(state => {
      if (!(state.tabs ?? []).some(tab => tab.id === id)) throw notFound();
      state.tabs = state.tabs.filter(tab => tab.id !== id);
      return { id };
    }); },
    setMember(id, contactId, included) { return store.update(state => {
      const tab = (state.tabs ?? []).find(tab => tab.id === id);
      if (!tab || !state.contacts.some(contact => contact.id === contactId)) throw notFound();
      tab.contactIds = tab.contactIds.filter(value => value !== contactId);
      if (included) tab.contactIds.push(contactId);
      return tab;
    }); }
  };
}
