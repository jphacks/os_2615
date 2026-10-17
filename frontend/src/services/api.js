import { request } from "./http.js";
const write = (path, method, body) =>
  request(path, { method, body: JSON.stringify(body) });
export const api = {
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
