import test from "node:test";
import assert from "node:assert/strict";
import { createMockApi } from "../src/services/mockApi.js";
const storage = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) || null,
    setItem: (k, v) => map.set(k, v),
  };
};
test("reply completes reminder and persists history and status", async () => {
  const store = storage(),
    api = createMockApi(store);
  const { data: d } = await api.messages("sato");
  assert.ok(d.reminder);
  assert.equal(d.conversation.hasUnreplied, true);
  const text = "  了解です\n :smile:  ";
  await api.reply({ conversationId: d.conversation.id, text });
  const { data: a } = await createMockApi(store).messages("sato");
  assert.equal(a.messages.at(-1).text, text);
  assert.equal(a.messages.at(-1).isFromMe, true);
  assert.equal(a.conversation.hasUnreplied, false);
  assert.equal(a.reminder, null);
});
test("reminder validates ownership, replaces pending and cancels", async () => {
  const api = createMockApi(storage()),
    { data: d } = await api.messages("yamada");
  const body = {
    conversationId: d.conversation.id,
    messageId: d.messages.at(-1).id,
    remindAt: new Date(Date.now() + 600000).toISOString(),
  };
  const first = (await api.remind(body)).data;
  const second = (
    await api.remind({
      ...body,
      remindAt: new Date(Date.now() + 1200000).toISOString(),
    })
  ).data;
  assert.equal(first.id, second.id);
  await assert.rejects(
    api.remind({ ...body, messageId: "message-sato" }),
    /一致/,
  );
  await assert.rejects(
    api.remind({ ...body, remindAt: new Date(0).toISOString() }),
    /未来/,
  );
  await api.cancel(first.id);
  assert.equal((await api.messages("yamada")).data.reminder, null);
});
test("favorite filter and failed storage preserve state", async () => {
  const store = storage(),
    api = createMockApi(store);
  await api.favorite("suzuki", true);
  assert.ok(
    (await api.contacts("favorite")).data.some(
      (i) => i.contact.id === "suzuki",
    ),
  );
  store.setItem = () => {
    throw new Error("保存失敗");
  };
  await assert.rejects(api.favorite("suzuki", false), /保存失敗/);
  assert.equal((await api.messages("suzuki")).data.contact.isFavorite, true);
});
test("invalid replies preserve history", async () => {
  const api = createMockApi(storage()),
    { data: d } = await api.messages("yamada");
  for (const text of ["", "  ", "a".repeat(5001)])
    await assert.rejects(
      api.reply({ conversationId: d.conversation.id, text }),
    );
  assert.equal(
    (await api.messages("yamada")).data.messages.length,
    d.messages.length,
  );
});
