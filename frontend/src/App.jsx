import React, { useEffect, useRef, useState } from "react";
import {
  Link2,
  Inbox,
  MessageCircle,
  Clock3,
  Star,
  Search,
  RefreshCw,
  ChevronRight,
  ArrowLeft,
  Send,
  Check,
  X,
  Bell,
} from "lucide-react";
import { api, isMock } from "./services/api";
const filters = [
  ["all", "すべて", Inbox],
  ["unreplied", "未返信", MessageCircle],
  ["later", "後で返信", Clock3],
  ["favorite", "お気に入り", Star],
];
const time = (v) =>
  new Date(v).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
const datetime = (v) =>
  new Date(v).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const matches = (i, f) =>
  f === "all" ||
  (f === "unreplied" && i.conversation.hasUnreplied) ||
  (f === "favorite" && i.contact.isFavorite) ||
  (f === "later" && i.reminder);
function Platform({ value }) {
  return (
    <span className={`platform ${value}`}>
      {value === "line" ? "LINE" : "Slack"}
    </span>
  );
}
function Avatar({ contact: c }) {
  return (
    <span className={`avatar ${c.platform}`} aria-hidden="true">
      {c.displayName[0]}
      <i>{c.platform === "line" ? <MessageCircle size={9} /> : "#"}</i>
    </span>
  );
}
export default function App() {
  const [items, setItems] = useState([]),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(null),
    [detail, setDetail] = useState(null),
    [loading, setLoading] = useState(true),
    [detailLoading, setDetailLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [drafts, setDrafts] = useState({}),
    [sending, setSending] = useState(false),
    [busy, setBusy] = useState(false),
    [target, setTarget] = useState(null),
    [when, setWhen] = useState(""),
    [modalError, setModalError] = useState(""),
    [now, setNow] = useState(Date.now());
  const activeRef = useRef(null),
    listVersion = useRef(0),
    detailVersion = useRef(0),
    draftRef = useRef({}),
    end = useRef(null),
    modal = useRef(null),
    restoreFocus = useRef(null);
  const selected = detail?.contact.id === active ? detail : null;
  async function loadList() {
    const v = ++listVersion.current;
    try {
      const r = await api.contacts();
      if (v === listVersion.current) setItems(r.data);
    } catch (e) {
      if (v === listVersion.current) setError(e.message);
    } finally {
      if (v === listVersion.current) setLoading(false);
    }
  }
  async function loadDetail(id, foreground = false) {
    const v = ++detailVersion.current;
    if (foreground) setDetailLoading(true);
    try {
      const r = await api.messages(id);
      if (activeRef.current === id && v === detailVersion.current)
        setDetail(r.data);
    } catch (e) {
      if (activeRef.current === id && v === detailVersion.current)
        setError(e.message);
    } finally {
      if (activeRef.current === id && v === detailVersion.current)
        setDetailLoading(false);
    }
  }
  async function refresh() {
    await loadList();
    if (activeRef.current) await loadDetail(activeRef.current);
  }
  function open(id) {
    activeRef.current = id;
    setActive(id);
    setDetail(null);
    setError("");
    loadDetail(id, true);
  }
  function back() {
    activeRef.current = null;
    setActive(null);
    setDetail(null);
  }
  useEffect(() => {
    loadList();
    const t = setInterval(() => {
      setNow(Date.now());
      loadList();
      if (activeRef.current) loadDetail(activeRef.current);
    }, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, selected?.messages.length]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!target) return;
    restoreFocus.current = document.activeElement;
    modal.current?.querySelector("input")?.focus();
    return () => restoreFocus.current?.focus();
  }, [target]);
  async function action(fn, message) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      setNotice(message);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e) {
    e.preventDefault();
    if (!selected || sending) return;
    const id = active,
      text = draftRef.current[id] || "";
    if (!text.trim() || text.length > 5000) return;
    setSending(true);
    setError("");
    try {
      await api.reply({ conversationId: selected.conversation.id, text });
      if (draftRef.current[id] === text) {
        draftRef.current = { ...draftRef.current, [id]: "" };
        setDrafts(draftRef.current);
      }
      setNotice(isMock ? "デモの会話に返信を追加しました" : "送信しました");
      await refresh();
    } catch (e) {
      setError(
        e.code === "DELIVERY_UNKNOWN"
          ? "送信結果が不明です。送信先を確認してから再送してください。入力文は保持しています。"
          : e.message,
      );
    } finally {
      setSending(false);
    }
  }
  function showReminder() {
    const m = selected?.messages.at(-1);
    if (!m) return;
    setTarget({
      conversationId: selected.conversation.id,
      messageId: m.id,
      name: selected.contact.displayName,
    });
    setWhen("");
    setModalError("");
  }
  async function saveReminder(e) {
    e.preventDefault();
    if (
      !when ||
      !Number.isFinite(new Date(when).getTime()) ||
      new Date(when).getTime() <= Date.now()
    ) {
      setModalError("未来の日時を選んでください。");
      return;
    }
    if (busy) return;
    setBusy(true);
    setModalError("");
    try {
      await api.remind({
        conversationId: target.conversationId,
        messageId: target.messageId,
        remindAt: new Date(when).toISOString(),
      });
      setTarget(null);
      setNotice("後で返信を設定しました");
      await refresh();
    } catch (e) {
      setModalError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function modalKeys(e) {
    if (e.key === "Escape" && !busy) setTarget(null);
    if (e.key === "Tab") {
      const controls = [
          ...modal.current.querySelectorAll(
            "button:not(:disabled),input:not(:disabled)",
          ),
        ],
        first = controls[0],
        last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  const visible = items.filter(
    (i) =>
      matches(i, filter) &&
      i.contact.displayName.toLowerCase().includes(query.toLowerCase()),
  );
  const counts = Object.fromEntries(
    filters.map(([f]) => [f, items.filter((i) => matches(i, f)).length]),
  );
  const due = items.filter(
    (i) => i.reminder && Date.parse(i.reminder.remindAt) <= now,
  ).length;
  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="./" className="brand">
          <span>
            <Link2 size={23} />
          </span>
          <b>
            こねくと<i>.</i>
          </b>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="受信箱フィルタ">
          {filters.map(([f, label, Icon]) => (
            <button
              key={f}
              className={`nav-item ${filter === f ? "chosen" : ""}`}
              onClick={() => setFilter(f)}
            >
              <Icon size={18} />
              <span>{label}</span>
              <small>{counts[f]}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>つながっているサービス</p>
          <div className="connection">
            <Platform value="line" />
            <span>LINE</span>
            <i />
          </div>
          <div className="connection">
            <Platform value="slack" />
            <span>Slack</span>
            <i />
          </div>
          <small>
            {isMock
              ? "サンプルデータで体験中"
              : "外部サービスの接続状態は未確認"}
          </small>
          <div className="profile">
            <span>K</span>
            <div>
              マイワークスペース<small>Personal workspace</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            ワークスペース <ChevronRight size={13} /> <b>Inbox</b>
          </span>
          <span className="mode">
            <i />
            {isMock ? "デモモード" : "APIモード"}
          </span>
        </header>
        <section className="heading">
          <div>
            <div className="eyebrow">ALL YOUR CONVERSATIONS, TOGETHER.</div>
            <h1>
              Inbox <span>受信トレイ</span>
            </h1>
            <p>人と、会話を、ひとつに。大切な返信を見逃さない。</p>
          </div>
          <div className="date">
            {new Date(now).toLocaleDateString("ja-JP", {
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
            <small>
              <i />
              {counts.unreplied}件の会話が返信を待っています
            </small>
          </div>
        </section>
        {isMock && (
          <div className="demo-banner">
            <span>
              <b>DEMO</b>
              サンプルの会話を表示しています。返信はLINE・Slackに送信されません。
            </span>
            <small>操作はこのブラウザに保存</small>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            <button
              onClick={() => {
                setError("");
                refresh();
              }}
            >
              <RefreshCw size={13} />
              再取得
            </button>
            <button aria-label="エラーを閉じる" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className={`inbox-layout ${active ? "has-selection" : ""}`}>
          <section className="inbox-panel" aria-label="会話一覧">
            <div className="list-heading">
              <h2>
                {filters.find((f) => f[0] === filter)[1]}の会話{" "}
                <span>{visible.length}</span>
              </h2>
              <button
                className="icon-button"
                aria-label="会話一覧を更新"
                onClick={refresh}
              >
                <RefreshCw size={15} />
              </button>
            </div>
            <label className="search">
              <Search size={16} />
              <input
                aria-label="名前で検索"
                placeholder="名前で検索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="検索をクリア" onClick={() => setQuery("")}>
                  <X size={13} />
                </button>
              )}
            </label>
            <div className="mobile-tabs">
              {filters.map(([f, label]) => (
                <button
                  key={f}
                  className={filter === f ? "chosen" : ""}
                  onClick={() => setFilter(f)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="list-scroll">
              {loading ? (
                <div className="empty">会話を読み込んでいます…</div>
              ) : !visible.length ? (
                <div className="empty">
                  <Inbox size={30} />
                  <h3>
                    {query
                      ? "一致する名前がありません"
                      : "会話はまだありません"}
                  </h3>
                  <p>
                    {query
                      ? "別の名前で検索してください。"
                      : "会話が届くと、ここに表示されます。"}
                  </p>
                </div>
              ) : (
                visible.map(
                  ({
                    contact: c,
                    conversation: v,
                    lastMessage: m,
                    reminder: r,
                  }) => (
                    <button
                      className={`contact-card ${active === c.id ? "active" : ""}`}
                      key={c.id}
                      onClick={() => open(c.id)}
                    >
                      <Avatar contact={c} />
                      <div className="contact-body">
                        <div className="contact-top">
                          <strong>{c.displayName}</strong>
                          {c.isFavorite && (
                            <Star size={11} className="star-filled" />
                          )}
                          <time>{m ? time(m.timestamp) : ""}</time>
                        </div>
                        <Platform value={c.platform} />
                        <p>
                          {m?.isFromMe ? "自分：" : ""}
                          {m?.text || "メッセージはありません"}
                        </p>
                        <div className="statuses">
                          {v.hasUnreplied ? (
                            <span className="unreplied">• 未返信</span>
                          ) : (
                            <span className="replied">
                              <Check size={11} />
                              返信済み
                            </span>
                          )}
                          {r && (
                            <span
                              className={`later-chip ${Date.parse(r.remindAt) <= now ? "due" : ""}`}
                            >
                              <Clock3 size={10} />
                              {Date.parse(r.remindAt) <= now
                                ? "返信の時間です"
                                : `${time(r.remindAt)}に返信`}
                            </span>
                          )}
                        </div>
                      </div>
                      {v.hasUnreplied && <i className="unread-dot" />}
                    </button>
                  ),
                )
              )}
            </div>
            <div className="list-footer">
              <i />
              {isMock ? "デモデータを表示中" : "5秒ごとに更新"}
              <span>{items.length} conversations</span>
            </div>
          </section>
          <section className="conversation-panel" aria-label="会話詳細">
            {!active ? (
              <div className="welcome">
                <div className="welcome-icon">
                  <MessageCircle size={36} />
                  <span>
                    <Link2 size={18} />
                  </span>
                </div>
                <div className="eyebrow">A LITTLE CLOSER.</div>
                <h2>会話のつづきを、ここから。</h2>
                <p>
                  左の一覧から相手を選んで、
                  <br />
                  LINEもSlackも、この場所で返信しましょう。
                </p>
                <div className="welcome-platforms">
                  <Platform value="line" />
                  <span>＋</span>
                  <Platform value="slack" />
                </div>
                {due > 0 && (
                  <button
                    className="due-callout"
                    onClick={() => setFilter("later")}
                  >
                    <Bell size={14} />
                    {due}件の会話が返信の時間です
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
            ) : detailLoading || !selected ? (
              <div className="empty">
                <button className="back-button" onClick={back}>
                  <ArrowLeft size={15} />
                  一覧に戻る
                </button>
                <p>
                  {detailLoading
                    ? "会話を読み込んでいます…"
                    : "会話を取得できませんでした。再取得してください。"}
                </p>
              </div>
            ) : (
              <>
                <header className="conversation-header">
                  <button
                    className="mobile-back icon-button"
                    aria-label="一覧へ戻る"
                    onClick={back}
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <Avatar contact={selected.contact} />
                  <div>
                    <h2>{selected.contact.displayName}</h2>
                    <Platform value={selected.contact.platform} />
                    <span className="dm-label">ダイレクトメッセージ</span>
                  </div>
                  <button
                    className={`favorite-button ${selected.contact.isFavorite ? "is-favorite" : ""}`}
                    aria-label={
                      selected.contact.isFavorite
                        ? "お気に入りを解除"
                        : "お気に入りに登録"
                    }
                    aria-pressed={selected.contact.isFavorite}
                    disabled={busy}
                    onClick={() =>
                      action(
                        () =>
                          api.favorite(
                            selected.contact.id,
                            !selected.contact.isFavorite,
                          ),
                        "お気に入りを更新しました",
                      )
                    }
                  >
                    <Star size={20} />
                  </button>
                </header>
                {selected.reminder && (
                  <div
                    className={`reminder-banner ${Date.parse(selected.reminder.remindAt) <= now ? "due" : ""}`}
                  >
                    <Clock3 size={15} />
                    <span>
                      {Date.parse(selected.reminder.remindAt) <= now
                        ? "返信の時間です"
                        : "後で返信"}{" "}
                      · {datetime(selected.reminder.remindAt)}
                    </span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        action(
                          () => api.cancel(selected.reminder.id),
                          "後で返信を取り消しました",
                        )
                      }
                    >
                      取消
                    </button>
                  </div>
                )}
                <div className="messages">
                  {selected.messages.map((m, i) => {
                    const prev = selected.messages[i - 1];
                    return (
                      <React.Fragment key={m.id}>
                        {(!prev ||
                          new Date(prev.timestamp).toDateString() !==
                            new Date(m.timestamp).toDateString()) && (
                          <div className="day-divider">
                            <span>
                              {new Date(m.timestamp).toLocaleDateString(
                                "ja-JP",
                                {
                                  month: "long",
                                  day: "numeric",
                                  weekday: "short",
                                },
                              )}
                            </span>
                          </div>
                        )}
                        <div className={`message ${m.isFromMe ? "mine" : ""}`}>
                          {!m.isFromMe && (
                            <span className="message-avatar">
                              {selected.contact.displayName[0]}
                            </span>
                          )}
                          <div className="message-content">
                            {!m.isFromMe && <small>{m.senderName}</small>}
                            <div className="bubble">
                              {m.messageType === "sticker" && (
                                <span className="sticker-icon">☺</span>
                              )}
                              {m.text}
                              {m.messageType === "sticker" &&
                                Array.isArray(m.metadata?.keywords) &&
                                m.metadata.keywords.length > 0 && (
                                  <span className="keywords">
                                    {m.metadata.keywords
                                      .filter((v) => typeof v === "string")
                                      .join(" / ")}
                                  </span>
                                )}
                            </div>
                            <time>
                              {m.isFromMe && <Check size={10} />}{" "}
                              {time(m.timestamp)}
                            </time>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                  {!selected.messages.length && (
                    <div className="empty">メッセージはまだありません</div>
                  )}
                  <div ref={end} />
                </div>
                <form className="composer" onSubmit={send}>
                  <div className="composer-input">
                    <textarea
                      aria-label="返信メッセージ"
                      placeholder={`${selected.contact.displayName}さんに返信…`}
                      rows={3}
                      maxLength={5000}
                      value={drafts[active] || ""}
                      onChange={(e) => {
                        draftRef.current = {
                          ...draftRef.current,
                          [active]: e.target.value,
                        };
                        setDrafts(draftRef.current);
                      }}
                    />
                    <div className="composer-actions">
                      <button
                        type="button"
                        className="later-button"
                        disabled={busy || sending || !selected.messages.length}
                        onClick={showReminder}
                      >
                        <Clock3 size={15} />
                        後で返信
                      </button>
                      <div>
                        <span className="character-count">
                          {(drafts[active] || "").length} / 5000
                        </span>
                        <button
                          className="send-button"
                          disabled={sending || !(drafts[active] || "").trim()}
                        >
                          {sending ? "送信中…" : "送信"}
                          <Send size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <p>
                    <i />
                    {selected.contact.platform === "line" ? "LINE" : "Slack"}
                    {isMock ? " のデモ会話に追加されます" : " に送信されます"}
                    <span>改行は Enter</span>
                  </p>
                </form>
              </>
            )}
          </section>
        </div>
        <footer className="page-footer">
          ひとつの場所から、つながりを大切に。<span>こねくと / KONEKUTO</span>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {target && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setTarget(null);
          }}
        >
          <section
            className="modal"
            ref={modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reminder-title"
            onKeyDown={modalKeys}
          >
            <button
              className="modal-close icon-button"
              aria-label="閉じる"
              disabled={busy}
              onClick={() => setTarget(null)}
            >
              <X size={19} />
            </button>
            <div className="modal-icon">
              <Clock3 size={25} />
            </div>
            <h2 id="reminder-title">ちょうどいい時間に、返信を。</h2>
            <p>{target.name}さんへの返信を、あとで思い出せるように。</p>
            <form onSubmit={saveReminder}>
              <label className="datetime-label">
                返信する日時
                <input
                  type="datetime-local"
                  aria-label="返信する日時"
                  required
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </label>
              <div className="quick-times">
                {[
                  [30, "30分後"],
                  [60, "1時間後"],
                  [180, "3時間後"],
                ].map(([mins, label]) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => {
                      const d = new Date(Date.now() + mins * 60000);
                      setWhen(
                        new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                          .toISOString()
                          .slice(0, 16),
                      );
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="modal-note">
                設定時刻になると、アプリ内で目立つ表示になります。
              </p>
              {modalError && (
                <p className="modal-error" role="alert">
                  {modalError}
                </p>
              )}
              <button
                className="send-button modal-submit"
                disabled={busy || !when}
              >
                {busy ? "設定中…" : "後で返信を設定"}
                <Check size={15} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
