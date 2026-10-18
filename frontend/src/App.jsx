import BulkSend from './components/BulkSend.jsx';
import React, { useEffect, useRef, useState } from "react";
import {
  Settings as SettingsIcon,
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
import { api } from "./services/api";
import { matchesContact } from "./services/contactSearch.js";
import ContactSearchName from "./components/ContactSearchName.jsx";
import ImageReply, { MessageImage } from "./components/ImageReply.jsx";
import { readSettings } from "./services/settings.js";
import Settings from "./components/Settings.jsx";
import InstallApp from "./components/InstallApp.jsx";
import DraggableTabs from "./components/DraggableTabs.jsx";
import ScheduledMessages from "./components/ScheduledMessages.jsx";
import ReplyTextarea from "./components/ReplyTextarea.jsx";
import ContactSettings from "./components/ContactSettings.jsx";
import PlatformFilter from "./components/PlatformFilter.jsx";
import CustomTabs from "./components/CustomTabs.jsx";
import ReminderCalendar from "./components/ReminderCalendar.jsx";
import ReminderAlerts from "./components/ReminderAlerts.jsx";
import { localDateTime } from "./components/reminderDate.js";
const baseFilters = [
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
  const [tabMoveMethod, setTabMoveMethod] = useState(() => { try { return readSettings(window.localStorage).tabMoveMethod; } catch { return 'both'; } });
  const [settingsRequest, setSettingsRequest] = useState(0);
  const settingsButton = <button type="button" className="icon-button header-settings" aria-label="表示設定を開く" title="表示設定" onClick={() => setSettingsRequest(value => value + 1)}><SettingsIcon size={19} /></button>;
  const [tabs, setTabs] = useState([]);
  const [creatingTab, setCreatingTab] = useState(false);
  const [tabEditRequest, setTabEditRequest] = useState(null);
  function editTabName(id) { setCreatingTab(false); setFilter(`tab:${id}`); setTabEditRequest({ id }); }
  const filters = [...baseFilters, ...tabs.map(tab => [`tab:${tab.id}`, tab.name, Inbox])];
  const matchesFilter = (item, value) => value.startsWith("tab:")
    ? Boolean(tabs.find(tab => `tab:${tab.id}` === value)?.contactIds.includes(item.contact.id))
    : matches(item, value);
  const [items, setItems] = useState([]),
    [filter, setFilter] = useState("all"),
    [platformFilter, setPlatformFilter] = useState("all"),
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
    imageReply = useRef(null),
    end = useRef(null),
    modal = useRef(null),
    restoreFocus = useRef(null);
  const selected = detail?.contact.id === active ? detail : null;
  async function reorderTabs(tabIds, expectedOrder) {
    setError('');
    try {
      const result = await api.reorderTabs(tabIds, expectedOrder);
      ++listVersion.current;
      setTabs(result.data);
      setNotice('タブの並び順を保存しました');
    } catch (error) {
      await loadList();
      throw error;
    }
  }
  async function loadList() {
    const v = ++listVersion.current;
    try {
      const [contactsResult, tabsResult] = await Promise.allSettled([api.contacts(), api.tabs()]);
      if (v !== listVersion.current) return;
      if (contactsResult.status === "fulfilled") setItems(contactsResult.value.data);
      else setError(contactsResult.reason.message);
      if (tabsResult.status === "fulfilled") {
        const custom = tabsResult.value;
        setTabs(custom.data);
        setFilter(current => current.startsWith("tab:") && !custom.data.some(tab => `tab:${tab.id}` === current) ? "all" : current);
      } else if (contactsResult.status === "fulfilled") {
        setError(tabsResult.reason.code === "NOT_FOUND"
          ? "タブAPIが見つかりません。Backendを再起動してから再取得してください。"
          : `タブを取得できませんでした。${tabsResult.reason.message}`);
      }
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
    let stopped = false;
    let running = false;
    let timer;
    async function poll() {
      clearTimeout(timer);
      if (stopped || running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        // 応答を待って次回を予約し、遅い通信でも更新を重ねない。
        await Promise.all([
          loadList(),
          activeRef.current ? loadDetail(activeRef.current) : Promise.resolve(),
        ]);
      } finally {
        running = false;
        if (!stopped && document.visibilityState === 'visible') timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    document.addEventListener('visibilitychange', poll);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, []);
  // 秒表示はないため、次のリマインダー期限だけで時刻を更新する。
  const nextReminderAt = items.reduce((next,item) => {
    const at = item.reminder ? Date.parse(item.reminder.remindAt) : Infinity;
    return at > now && at < next ? at : next;
  }, Infinity);
  useEffect(() => {
    setNow(Date.now());
    if (!Number.isFinite(nextReminderAt)) return;
    let timer;
    const tick = () => {
      const remaining = nextReminderAt - Date.now();
      if (remaining > 0) timer = setTimeout(tick, Math.min(2147483647,remaining));
      else setNow(Date.now());
    };
    tick();
    const resumed = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    document.addEventListener('visibilitychange', resumed);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', resumed); };
  }, [nextReminderAt]);
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
    modal.current?.querySelector("[data-initial-focus]")?.focus();
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
    if (imageReply.current?.hasFile) { await imageReply.current.send(); return; }
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
      setNotice("送信しました");
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
    setWhen(localDateTime(new Date(Date.now() + 30 * 60000)));
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
            "button:not(:disabled),input:not(:disabled),select:not(:disabled)",
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
  const platformItems = items.filter(i => platformFilter === "all" || i.contact.platform === platformFilter);
  const visible = platformItems.filter(
    (i) =>
      matchesFilter(i, filter) &&
      matchesContact(i.contact, query),
  );
  const counts = Object.fromEntries(
    filters.map(([f]) => [f, platformItems.filter((i) => matchesFilter(i, f)).length]),
  );
  const due = items.filter(
    (i) => i.reminder && Date.parse(i.reminder.remindAt) <= now,
  ).length;
  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="./" className="brand">
          <span>
            <img src="/konekuto-crayon.png" alt="" width="44" height="44" />
          </span>
          <b>
            <span>こね</span><span>くと</span>
          </b>
        </a>
        <nav aria-label="受信箱フィルタ">
          <div className="sidebar-tab-group" role="group" aria-label="標準フィルタ">
            {baseFilters.map(([f, label, Icon]) => <button key={f} className={`nav-item ${filter === f ? "chosen" : ""}`} onClick={() => setFilter(f)}><Icon size={18} /><span>{label}</span><small>{counts[f]}</small></button>)}
          </div>
          <DraggableTabs onEdit={editTabName} dragEnabled={tabMoveMethod !== "buttons"} tabs={tabs} filter={filter} counts={counts} vertical onSelect={setFilter} onAdd={() => setCreatingTab(true)} onReorder={reorderTabs} onError={setError} />
        </nav>
        <div className="sidebar-bottom">
          <p>つながっているサービス</p>
          <div className="connection">
            <span className="official-service-icon"><img src="/service-icons/line.png" alt="" width="32" height="32" /></span>
            <span>LINE</span>
            <i />
          </div>
          <div className="connection">
            <span className="official-service-icon"><img src="/service-icons/slack.png" alt="" width="32" height="32" /></span>
            <span>Slack</span>
            <i />
          </div>
          <small>
            外部サービスの接続状態は未確認
          </small>
          <p className="planned-services-title">今後の接続予定</p>
          <div className="connection planned-connection">
            <span className="planned-service-mark" aria-hidden="true">T</span>
            <span>Microsoft Teams<small>未接続・対応予定</small></span>
          </div>
          <div className="connection planned-connection">
            <span className="planned-service-mark" aria-hidden="true">IG</span>
            <span>Instagram<small>未接続・対応予定</small></span>
          </div>
          <div className="profile">
            <span>K</span>
            <div>
              マイワークスペース<small>Personal workspace</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <InstallApp />
        <Settings hideTrigger openRequest={settingsRequest} onTabMoveMethodChange={setTabMoveMethod} />
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
                <span className="list-title" title={filters.find((f) => f[0] === filter)?.[1] ?? "選択中"}>
                  {filters.find((f) => f[0] === filter)?.[1] ?? "選択中"}
                </span>
                <span className="list-count">{visible.length}</span>
              </h2>
              <button
                className="icon-button list-refresh"
                aria-label="会話一覧を更新"
                onClick={refresh}
              >
                <RefreshCw size={15} />
              </button>
              <div className="list-toolbar"><PlatformFilter value={platformFilter} onChange={setPlatformFilter} />{settingsButton}</div>
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
              <div className="tab-group" role="group" aria-label="標準フィルタ">
                {baseFilters.map(([f, label]) => <button key={f} className={filter === f ? "chosen" : ""} onClick={() => setFilter(f)}>{label}</button>)}
              </div>
              <DraggableTabs onEdit={editTabName} dragEnabled={tabMoveMethod !== "buttons"} tabs={tabs} filter={filter} counts={counts} onSelect={setFilter} onAdd={() => setCreatingTab(true)} onReorder={reorderTabs} onError={setError} />
            </div>
            <CustomTabs editRequest={tabEditRequest} showOrderControls={tabMoveMethod !== "drag"} creating={creatingTab} onCloseCreate={() => setCreatingTab(false)} tabs={tabs} items={items} filter={filter} onSelect={setFilter} onRefresh={loadList} />
            {filter.startsWith("tab:") && <BulkSend key={filter} tab={tabs.find(tab => `tab:${tab.id}` === filter)} items={items} onRefresh={refresh} />}
            <p className="reply-priority-note" title="「後で返信」の期限順です。期限を過ぎた会話が先に、期限未設定の会話が後に並びます。同じ期限では従来の表示順を保ちます。">
              <Clock3 size={13} aria-hidden="true" />返信期限が早い順
            </p>
            <div className="list-scroll">
              {loading ? (
                <div className="empty">会話を読み込んでいます…</div>
              ) : !visible.length ? (
                <div className="empty">
                  <Inbox size={30} />
                  <h3>
                    {query
                      ? "一致する名前がありません"
                      : platformFilter !== "all" ? "条件に一致する会話がありません" : filter.startsWith("tab:") ? "このタブに相手が登録されていません" : "会話はまだありません"}
                  </h3>
                  <p>
                    {query
                      ? "別の名前で検索してください。"
                      : platformFilter !== "all" ? "サービスやタブの選択を変更してください。" : filter.startsWith("tab:") ? "上のメンバー編集から相手を選んでください。" : "会話が届くと、ここに表示されます。"}
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
                    <div className="contact-card-shell" key={c.id}>
                    <button
                      className={`contact-card ${active === c.id ? "active" : ""} ${r?.status === "pending" && Date.parse(r.remindAt) <= now ? "reminder-due" : ""}`}
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
                              {!m ? "履歴なし" : m.isFromMe ? "返信済み" : "既読"}
                            </span>
                          )}
                          {r && (
                            <span
                              className={`later-chip ${Date.parse(r.remindAt) <= now ? "due" : ""}`}
                            >
                              <Clock3 size={10} />
                              {Date.parse(r.remindAt) <= now
                                ? `返信の時間です · ${datetime(r.remindAt)}`
                                : `${datetime(r.remindAt)}に返信`}
                            </span>
                          )}
                        </div>
                      </div>
                      {v.hasUnreplied && <i className="unread-dot" />}
                    </button>
                    <ContactSettings contact={c} disabled={busy || sending} onChanged={refresh} onDeleted={async result => { if (activeRef.current === c.id) back(); setNotice(result.cleanupPending ? "人物を削除しました。画像の整理を再試行します" : "人物とデータを削除しました"); await loadList(); }} />
                    </div>
                  ),
                )
              )}
            </div>
            <div className="list-footer">
              <i />
              5秒ごとに更新
              <span>{visible.length} conversations</span>
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
                <div className="welcome-platforms">
                  <span className="welcome-service"><span className="official-service-icon"><img src="/service-icons/line.png" alt="LINE" width="32" height="32" /></span><span className="welcome-service-label"><Platform value="line" /></span></span>
                  <span>＋</span>
                  <span className="welcome-service"><span className="official-service-icon"><img src="/service-icons/slack.png" alt="Slack" width="32" height="32" /></span><span className="welcome-service-label"><Platform value="slack" /></span></span>
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
                <ContactSearchName key={selected.contact.id} contact={selected.contact} onRefresh={refresh} />
                <header className="conversation-header">
                  <button
                    className="mobile-back icon-button"
                    aria-label="一覧へ戻る"
                    onClick={back}
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <Avatar contact={selected.contact} />
                  <div className="conversation-person">
                    <h2>{selected.contact.displayName}</h2>
                    <Platform value={selected.contact.platform} />
                    <span className="dm-label">ダイレクトメッセージ</span>
                  </div>
                  {selected.conversation.hasUnreplied && <button
                    type="button" className="complete-button" disabled={busy || sending}
                    title="メッセージを送らず対応を完了し、リマインダーも終了します"
                    onClick={() => action(() => api.complete(selected.contact.id, selected.conversation.lastMessageId), "既読にしました")}>
                    <Check size={16} />既読にする
                  </button>}
                  <button type="button" className="later-button header-later" disabled={busy || sending || !selected.messages.length} onClick={showReminder}>
                    <Clock3 size={15} />後で返信
                  </button>
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
                  {!selected.messages.length && <div className="empty">トーク履歴はありません</div>}
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
                            <div className="bubble" tabIndex={0}
                              onClick={event => {
                                if (!event.target.closest("a, button, input")) event.currentTarget.focus({ preventScroll: true });
                              }}
                              onKeyDown={event => {
                                if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "a") return;
                                const body = event.currentTarget.querySelector(".message-body-text");
                                if (!body) return;
                                event.preventDefault();
                                event.stopPropagation();
                                const range = document.createRange();
                                range.selectNodeContents(body);
                                const selection = window.getSelection();
                                selection.removeAllRanges();
                                selection.addRange(range);
                              }}>
                              {m.messageType === "sticker" && (
                                <span className="sticker-icon">☺</span>
                              )}
                              {m.messageType === "image" ? <><MessageImage key={m.media?.id ?? m.id} media={m.media} />{m.text && m.text !== "[画像]" && <p className="image-caption message-body-text">{m.text}</p>}</> : <span className="message-body-text">{m.text}</span>}
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
                  <div ref={end} />
                </div>
                <form className="composer" onSubmit={send}>
                  <div className="composer-input">
                    <ReplyTextarea
                      aria-label="返信メッセージ"
                      onSend={send}
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
                      {<ImageReply ref={imageReply} key={selected.conversation.id} conversationId={selected.conversation.id} sending={sending} setSending={setSending} onError={setError} onSent={async () => { setNotice("画像を送信しました"); await refresh(); }} />}
                      <div className="composer-send-actions">
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
                  <ScheduledMessages key={selected.conversation.id} conversationId={selected.conversation.id}
                    name={selected.contact.displayName} platform={selected.contact.platform} text={drafts[active] || ""}
                    disabled={busy || sending} onRefresh={refresh} onReserved={text => {
                      if (draftRef.current[active] === text) {
                        draftRef.current = { ...draftRef.current, [active]: "" }; setDrafts(draftRef.current);
                      }
                      setNotice("予約送信を設定しました");
                    }} />
                  <p>
                    <i />
                    {selected.contact.platform === "line" ? "LINE" : "Slack"}
                     に送信されます
                    <span>送信は Enter・改行は Shift＋Enter</span>
                  </p>
                </form>
              </>
            )}
          </section>
        </div>
      </main>
      <ReminderAlerts items={items} now={now} onOpen={open} />
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
            <h2 id="reminder-title">返信リマインダー</h2>
            <form onSubmit={saveReminder}>
              <ReminderCalendar
                value={when}
                onChange={setWhen}
                disabled={busy}
              />
              <div className="quick-times">
                {[
                  [30, "30分後"],
                  [60, "1時間後"],
                  [180, "3時間後"],
                ].map(([mins, label]) => (
                  <button
                    key={mins}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const d = new Date(Date.now() + mins * 60000);
                      setWhen(localDateTime(d));
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="reminder-selection" aria-live="polite">
                <span>選択中の日時</span>
                <strong>
                  {new Date(when).toLocaleString("ja-JP", {
                    month: "long",
                    day: "numeric",
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </strong>
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
                {busy ? "設定中…" : "この日時で確定"}
                <Check size={15} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
