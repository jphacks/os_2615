const KEY = "konekuto-demo-v1";
const iso = (offset) => new Date(Date.now() + offset * 60000).toISOString();
export function createSeed() {
  const people = [
    ["yamada", "山田 花子", "line", "明日の集合時間どうする？", -8, true, true],
    [
      "sato",
      "佐藤 健太",
      "slack",
      "発表資料の確認をお願いします！ :pray:",
      -23,
      true,
      true,
    ],
    [
      "suzuki",
      "鈴木 美咲",
      "line",
      "ありがとう！当日楽しみにしています 🌿",
      -48,
      false,
      false,
    ],
    [
      "tanaka",
      "田中 翔太",
      "slack",
      "修正版のデザイン、送りました！",
      -95,
      false,
      true,
    ],
    [
      "takahashi",
      "高橋 葵",
      "line",
      "[スタンプが送信されました]",
      -180,
      false,
      true,
    ],
    [
      "ito",
      "伊藤 大輔",
      "slack",
      "了解です。よろしくお願いします！",
      -1200,
      false,
      false,
    ],
  ];
  const contacts = [],
    conversations = [],
    messages = [],
    reminders = [];
  for (const [
    id,
    name,
    platform,
    text,
    offset,
    favorite,
    unreplied,
  ] of people) {
    const cid = `conversation-${id}`,
      mid = `message-${id}`,
      uid = `demo-${id}`;
    contacts.push({
      id,
      platform,
      platformUserId: uid,
      displayName: name,
      isFavorite: favorite,
      lastMessageAt: iso(offset),
    });
    conversations.push({
      id: cid,
      platform,
      platformConversationId: `dm-${id}`,
      contactId: id,
      lastMessageId: mid,
      hasUnreplied: unreplied,
      updatedAt: iso(offset),
    });
    const msg = (suffix, body, time, me = false) => ({
      id: suffix,
      platform,
      messageType: "text",
      platformMessageId: suffix,
      senderId: me ? "demo-self" : uid,
      senderName: me ? "自分" : name,
      conversationId: cid,
      text: body,
      timestamp: iso(time),
      isFromMe: me,
      metadata: {},
    });
    messages.push(
      msg(
        `${mid}-intro`,
        "お疲れさまです！イベントの件で連絡しました。",
        offset - 65,
      ),
      msg(`${mid}-self`, "お疲れさまです！準備は順調です。", offset - 50, true),
    );
    const last = msg(mid, text, offset);
    if (id === "takahashi") {
      last.messageType = "sticker";
      last.metadata = { keywords: ["happy", "smile"] };
    }
    messages.push(last);
    if (!unreplied) {
      const reply = msg(
        `${mid}-reply`,
        "ありがとうございます！また連絡しますね。",
        offset + 1,
        true,
      );
      messages.push(reply);
      Object.assign(conversations.at(-1), {
        lastMessageId: reply.id,
        updatedAt: reply.timestamp,
      });
      contacts.at(-1).lastMessageAt = reply.timestamp;
    }
    if (id === "sato")
      reminders.push({
        id: "reminder-sato",
        messageId: mid,
        conversationId: cid,
        remindAt: iso(45),
        status: "pending",
      });
    if (id === "tanaka")
      reminders.push({
        id: "reminder-tanaka",
        messageId: mid,
        conversationId: cid,
        remindAt: iso(-5),
        status: "pending",
      });
  }
  return { contacts, conversations, messages, reminders };
}
function fail(message, code = "VALIDATION_ERROR") {
  throw Object.assign(new Error(message), { code });
}
export function createMockApi(storage) {
  let state;
  try {
    state = JSON.parse(storage.getItem(KEY));
  } catch {
    /* unavailable or invalid demo storage */
  }
  if (
    !state?.contacts ||
    !state?.messages ||
    !state?.conversations ||
    !state?.reminders
  )
    state = createSeed();
  const save = (next) => {
    storage.setItem(KEY, JSON.stringify(next));
    state = next;
  };
  const mutate = (fn) => {
    const next = structuredClone(state);
    const data = fn(next);
    save(next);
    return { data: structuredClone(data) };
  };
  const pending = (s, cid) =>
    s.reminders.find(
      (r) => r.conversationId === cid && r.status === "pending",
    ) || null;
  const detail = (id) => {
    const contact = state.contacts.find((c) => c.id === id);
    if (!contact) fail("会話が見つかりません。", "NOT_FOUND");
    const conversation = state.conversations.find((c) => c.contactId === id);
    return {
      contact,
      conversation,
      messages: state.messages
        .filter((m) => m.conversationId === conversation.id)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      reminder: pending(state, conversation.id),
    };
  };
  return {
    async contacts(filter = "all") {
      if (!["all", "unreplied", "favorite", "later"].includes(filter))
        fail("フィルタが不正です。");
      return {
        data: state.contacts
          .map((c) => {
            const d = detail(c.id);
            return {
              contact: c,
              conversation: d.conversation,
              lastMessage: d.messages.at(-1) || null,
              reminder: d.reminder,
            };
          })
          .filter(
            (i) =>
              filter === "all" ||
              (filter === "unreplied" && i.conversation.hasUnreplied) ||
              (filter === "favorite" && i.contact.isFavorite) ||
              (filter === "later" && i.reminder),
          )
          .sort(
            (a, b) =>
              Number(b.contact.isFavorite) - Number(a.contact.isFavorite) ||
              b.contact.lastMessageAt.localeCompare(a.contact.lastMessageAt) ||
              a.contact.id.localeCompare(b.contact.id),
          )
          .map((i) => structuredClone(i)),
      };
    },
    async messages(id) {
      return { data: structuredClone(detail(id)) };
    },
    async favorite(id, isFavorite) {
      return mutate((s) => {
        const c = s.contacts.find((c) => c.id === id);
        if (!c) fail("人物が見つかりません。", "NOT_FOUND");
        c.isFavorite = isFavorite;
        return c;
      });
    },
    async reply({ conversationId, text }) {
      if (typeof text !== "string" || !text.trim() || text.length > 5000)
        fail("本文は1〜5000文字で入力してください。");
      return mutate((s) => {
        const c = s.conversations.find((c) => c.id === conversationId);
        if (!c) fail("会話が見つかりません。", "NOT_FOUND");
        const now = new Date().toISOString();
        const message = {
          id: crypto.randomUUID(),
          platform: c.platform,
          messageType: "text",
          platformMessageId: crypto.randomUUID(),
          senderId: "demo-self",
          senderName: "自分",
          conversationId,
          text,
          timestamp: now,
          isFromMe: true,
          metadata: {},
        };
        s.messages.push(message);
        Object.assign(c, {
          lastMessageId: message.id,
          hasUnreplied: false,
          updatedAt: now,
        });
        s.contacts.find((x) => x.id === c.contactId).lastMessageAt = now;
        s.reminders
          .filter(
            (r) =>
              r.conversationId === conversationId && r.status === "pending",
          )
          .forEach((r) => (r.status = "done"));
        return { message, conversation: c };
      });
    },
    async remind({ conversationId, messageId, remindAt }) {
      if (
        !Number.isFinite(Date.parse(remindAt)) ||
        Date.parse(remindAt) <= Date.now()
      )
        fail("未来の日時を選んでください。");
      return mutate((s) => {
        if (!s.conversations.some((c) => c.id === conversationId))
          fail("会話が見つかりません。", "NOT_FOUND");
        const message = s.messages.find((m) => m.id === messageId);
        if (!message) fail("メッセージが見つかりません。", "NOT_FOUND");
        if (message.conversationId !== conversationId)
          fail("会話が一致しません。");
        let r = pending(s, conversationId);
        if (!r) {
          r = { id: crypto.randomUUID(), conversationId, status: "pending" };
          s.reminders.push(r);
        }
        Object.assign(r, {
          messageId,
          remindAt: new Date(remindAt).toISOString(),
        });
        return r;
      });
    },
    async cancel(id) {
      return mutate((s) => {
        const r = s.reminders.find((r) => r.id === id);
        if (!r) fail("リマインダーが見つかりません。", "NOT_FOUND");
        if (r.status === "done") fail("完了済みです。", "INVALID_STATE");
        r.status = "cancelled";
        return r;
      });
    },
    async reminders() {
      return {
        data: structuredClone(
          state.reminders
            .filter((r) => r.status === "pending")
            .sort(
              (a, b) =>
                a.remindAt.localeCompare(b.remindAt) ||
                a.id.localeCompare(b.id),
            ),
        ),
      };
    },
  };
}
