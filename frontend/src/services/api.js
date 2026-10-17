import { createMockApi } from "./mockApi.js";
import { request } from "./http.js";
export const isMock = import.meta.env.VITE_USE_MOCK !== "false";
const write = (path, method, body) =>
  request(path, { method, body: JSON.stringify(body) });
const live = {
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
const demoStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => localStorage.setItem(key, value),
};
export const api = isMock ? createMockApi(demoStorage) : live;
