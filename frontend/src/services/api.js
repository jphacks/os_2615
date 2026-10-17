import { request } from "./http.js";
const write = (path, method, body) =>
  request(path, { method, body: JSON.stringify(body) });
export const api = {
  scheduledMessages: (conversationId) => request(`/scheduled-messages?conversationId=${encodeURIComponent(conversationId)}`),
  scheduleMessage: (body) => write('/scheduled-messages', 'POST', body),
  cancelScheduledMessage: (id) => write(`/scheduled-messages/${encodeURIComponent(id)}`, 'DELETE', {}),
  complete: (id, lastMessageId) => write(`/contacts/${encodeURIComponent(id)}/complete`, 'POST', { lastMessageId }),
  reorderTabs: (tabIds, expectedOrder) => write('/tabs/reorder', 'POST', { tabIds, expectedOrder }),
  replyImage: (conversationId, file) => request(`/messages/reply-image?conversationId=${encodeURIComponent(conversationId)}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file }),
  searchName: (id, searchName) => write(`/contacts/${encodeURIComponent(id)}/search-name`, 'PATCH', { searchName }),
  moveTab: (id, direction) => write(`/tabs/${encodeURIComponent(id)}/move`, 'POST', { direction }),
  renameTab: (id, name) => write(`/tabs/${encodeURIComponent(id)}`, 'PATCH', { name }),
  tabs: () => request('/tabs'),
  createTab: (name) => write('/tabs', 'POST', { name }),
  deleteTab: (id) => write(`/tabs/${encodeURIComponent(id)}`, 'DELETE', {}),
  tabMember: (id, contactId, included) => write(`/tabs/${encodeURIComponent(id)}/contacts/${encodeURIComponent(contactId)}`, included ? 'PUT' : 'DELETE', {}),
  contacts: (filter = "all") =>
    request(`/contacts?filter=${encodeURIComponent(filter)}`),
  messages: (id) => request(`/contacts/${encodeURIComponent(id)}/messages`),
  favorite: (id, isFavorite) =>
    write(`/contacts/${encodeURIComponent(id)}/favorite`, "PATCH", {
      isFavorite,
    }),
  reply: (body) => write("/messages/reply", "POST", body),
  remind: (body) => write("/reminders", "POST", body),
  cancel: (id) =>
    write(`/reminders/${encodeURIComponent(id)}`, "PATCH", {
      status: "cancelled",
    }),
  reminders: () => request("/reminders?status=pending"),
};
