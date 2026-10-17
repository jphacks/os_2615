/* タブ自体をつかんで移動する。長押し前はタッチスクロールを妨げない。 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tabSlotIndex, tabOrderAt } from '../services/tabDrag.js';
export default function DraggableTabs({ tabs, filter, counts, dragEnabled = true, vertical = false, onSelect, onAdd, onReorder, onError, onEdit }) {
  const [preview, setPreview] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [saving, setSaving] = useState(false);
  const group = useRef(null);
  const drag = useRef(null);
  const previousRects = useRef(null);
  const suppressClick = useRef(0);
  useEffect(() => () => {
    clearTimeout(drag.current?.timer);
    drag.current?.cleanup?.();
    drag.current = null;
  }, []);
  useEffect(() => { if (!dragEnabled && drag.current) void finish(true); }, [dragEnabled]);
  useLayoutEffect(() => {
    const before = previousRects.current;
    previousRects.current = null;
    if (!before || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const element of group.current?.querySelectorAll('[data-sort-tab]') ?? []) {
      if (element.dataset.sortTab === dragging) continue;
      const from = before.get(element.dataset.sortTab);
      if (!from) continue;
      const to = element.getBoundingClientRect();
      const x = from.left - to.left, y = from.top - to.top;
      if (x || y) element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }, [preview, dragging]);
  const shown = dragging && drag.current ? drag.current.before.map(id => tabs.find(tab => tab.id === id)).filter(Boolean) : tabs;
  function ghostPosition(work, x, y) {
    const frame = group.current.getBoundingClientRect();
    const scroll = group.current.closest('.mobile-tabs');
    const visible = scroll?.getBoundingClientRect() ?? frame;
    const left = Math.max(frame.left + work.tabArea.left, visible.left + 1, 0);
    const top = Math.max(frame.top + work.tabArea.top, visible.top + 1, 0);
    const right = Math.min(frame.left + work.tabArea.right, visible.right - 1, window.innerWidth);
    const bottom = Math.min(frame.top + work.tabArea.bottom, visible.bottom - 1, window.innerHeight);
    const bounds = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    const width = Math.min(work.rect.width, bounds.width);
    const height = Math.min(work.rect.height, bounds.height);
    return { bounds, width, height, name: work.name,
      x: Math.max(0, Math.min(x - work.offsetX - left, bounds.width - width)),
      y: Math.max(0, Math.min(y - work.offsetY - top, bounds.height - height)) };
  }
  function activate() {
    const work = drag.current;
    if (!work) return;
    work.active = true;
    setDragging(work.id); setPreview(work.order);
    setGhost(ghostPosition(work, work.x, work.y));
    const cleanupListeners = work.cleanup;
    work.cleanup = () => { cleanupListeners?.(); cancelAnimationFrame(work.frame); };
    const tick = () => {
      if (drag.current !== work || !work.active) return;
      if (work.scroll) {
        const bounds = work.scroll.getBoundingClientRect();
        const previous = work.scroll.scrollLeft;
        if (work.lastX > bounds.right - 35) work.scroll.scrollLeft += 5;
        else if (work.lastX < bounds.left + 35) work.scroll.scrollLeft -= 5;
        if (previous !== work.scroll.scrollLeft) {
          updateOrder(work, work.lastX, work.lastY);
          setGhost(ghostPosition(work, work.lastX, work.lastY));
        }
      }
      work.frame = requestAnimationFrame(tick);
    };
    work.frame = requestAnimationFrame(tick);
  }
  function begin(element, id, x, y, kind, pointerId) {
    const rect = element.getBoundingClientRect();
    const scroll = group.current.closest('.mobile-tabs');
    // 開始時のタブ領域を固定し、追加ボタンと並び替えアニメーションを境界に含めない。
    const frame = group.current.getBoundingClientRect();
    const boxes = [...group.current.querySelectorAll('[data-sort-tab]')].map(node => node.getBoundingClientRect());
    const tabArea = {
      left: Math.min(...boxes.map(box => box.left)) - frame.left,
      right: Math.max(...boxes.map(box => box.right)) - frame.left,
      top: Math.min(...boxes.map(box => box.top)) - frame.top,
      bottom: Math.max(...boxes.map(box => box.bottom)) - frame.top,
    };
    const centers = boxes.map(box => vertical ? box.top + box.height / 2 : box.left + box.width / 2);
    drag.current = { id, name: tabs.find(tab => tab.id === id)?.name, pointerId, element, kind,
      x, y, lastX: x, lastY: y, centers, tabArea, scroll, initialScroll: scroll?.scrollLeft ?? 0, offsetX: x - rect.left, offsetY: y - rect.top, rect,
      active: false, before: tabs.map(tab => tab.id), order: tabs.map(tab => tab.id) };
    if (kind === 'mouse') {
      const moving = event => {
        if (event.pointerId !== pointerId) return;
        move(event.clientX, event.clientY);
        if (drag.current?.active && event.cancelable) event.preventDefault();
      };
      const ended = event => { if (event.pointerId === pointerId) void finish(); };
      const cancelled = () => { void finish(true); };
      document.addEventListener('pointermove', moving, { passive: false });
      document.addEventListener('pointerup', ended);
      document.addEventListener('pointercancel', cancelled);
      window.addEventListener('blur', cancelled);
      drag.current.cleanup = () => {
        document.removeEventListener('pointermove', moving);
        document.removeEventListener('pointerup', ended);
        document.removeEventListener('pointercancel', cancelled);
        window.removeEventListener('blur', cancelled);
      };
    }
  }
  function updateOrder(work, x, y) {
    const position = vertical ? y : x + (work.scroll?.scrollLeft ?? 0) - work.initialScroll;
    const next = tabOrderAt(work.before, work.id, tabSlotIndex(work.centers, position));
    if (next.join() === work.order.join()) return;
    previousRects.current = new Map();
    for (const element of group.current.querySelectorAll('[data-sort-tab]')) {
      previousRects.current.set(element.dataset.sortTab, element.getBoundingClientRect());
      element.getAnimations().forEach(animation => animation.cancel());
    }
    work.order = next; setPreview(next);
  }
  function move(x, y) {
    const work = drag.current;
    if (!work) return;
    work.lastX = x; work.lastY = y;
    const distance = Math.hypot(x - work.x, y - work.y);
    if (!work.active && work.kind === 'mouse' && distance > 5) activate();
    if (!work.active) {
      if (distance > 8) {
        clearTimeout(work.timer); work.cleanup?.(); drag.current = null;
        suppressClick.current = Date.now() + 500;
      }
      return;
    }
    setGhost(ghostPosition(work, x, y));
    updateOrder(work, x, y);
  }
  async function finish(cancelled = false) {
    const work = drag.current;
    if (!work) return;
    clearTimeout(work.timer); work.cleanup?.(); drag.current = null;

    setDragging(null); setGhost(null);
    if (work.active) suppressClick.current = Date.now() + 500;
    if (!cancelled && work.active && work.order.join() !== work.before.join()) {
      setSaving(true);
      try { await onReorder(work.order, work.before); }
      catch(error) { onError(error.message); }
      finally { setSaving(false); setPreview(null); }
    } else setPreview(null);
  }
  function startTouch(event, id) {
    if (!dragEnabled || saving || drag.current || event.touches.length !== 1) return;
    const touch = event.touches[0];
    begin(event.currentTarget, id, touch.clientX, touch.clientY, 'touch', touch.identifier);
    const moving = event => {
      if (event.touches.length !== 1) { void finish(true); return; }
      const finger = [...event.touches].find(item => item.identifier === touch.identifier);
      if (!finger) return;
      if (drag.current?.active && event.cancelable) event.preventDefault();
      move(finger.clientX, finger.clientY);
    };
    const ended = event => {
      if (![...event.changedTouches].some(item => item.identifier === touch.identifier)) return;
      if (drag.current?.active && event.cancelable) event.preventDefault();
      void finish();
    };
    const cancelled = () => { void finish(true); };
    const scroll = group.current.closest('.mobile-tabs');
    const scrolled = () => { if (drag.current && !drag.current.active) { suppressClick.current = Date.now() + 500; void finish(true); } };
    scroll?.addEventListener('scroll', scrolled);
    window.addEventListener('blur', cancelled);
    document.addEventListener('touchmove', moving, { passive: false });
    document.addEventListener('touchend', ended, { passive: false });
    document.addEventListener('touchcancel', cancelled);
    drag.current.cleanup = () => {
      scroll?.removeEventListener('scroll', scrolled);
      window.removeEventListener('blur', cancelled);
      document.removeEventListener('touchmove', moving);
      document.removeEventListener('touchend', ended);
      document.removeEventListener('touchcancel', cancelled);
    };
    drag.current.timer = setTimeout(activate, 400);
  }
  return <>
    <div ref={group} data-sort-group className={`${vertical ? 'sidebar-tab-group' : 'tab-group'} draggable-tab-group ${dragEnabled ? '' : 'drag-disabled'}`} role="group" aria-label="ユーザー作成タブ" aria-busy={saving}>
      {shown.map(tab => <div key={tab.id} data-sort-tab={tab.id} style={{ order: preview ? preview.indexOf(tab.id) : undefined }} className={`sortable-tab ${vertical ? 'vertical' : ''} ${dragging === tab.id ? 'is-dragging' : ''}`}
        onPointerDown={event => { if (dragEnabled && !saving && !drag.current && event.pointerType === 'mouse' && event.button === 0) begin(event.currentTarget, tab.id, event.clientX, event.clientY, 'mouse', event.pointerId); }}
        onTouchStart={event => startTouch(event, tab.id)} onContextMenu={event => { event.preventDefault(); if (drag.current?.kind === 'touch') return; if (drag.current) void finish(true); if (!saving) onEdit?.(tab.id); }}>
        <button type="button" disabled={saving} title={dragEnabled ? 'ドラッグで並び替え（スマホは長押し）' : undefined} className={`${vertical ? 'nav-item' : ''} ${filter === `tab:${tab.id}` ? 'chosen' : ''}`} onClick={() => { if (Date.now() > suppressClick.current) onSelect(`tab:${tab.id}`); }}>
          <span>{tab.name}</span>{vertical && <small>{counts[`tab:${tab.id}`]}</small>}
        </button>
      </div>)}
      <button type="button" disabled={saving} style={{ order: tabs.length }} className={`${vertical ? 'nav-item' : ''} add-tab-button`} onClick={onAdd}>＋ タブを追加</button>
      <span className="visually-hidden" aria-live="polite">{saving ? '並び順を保存しています' : dragging ? 'タブを移動中です。離すと保存します' : ''}</span>
    </div>
    {ghost && createPortal(<div className="tab-drag-boundary" aria-hidden="true" style={{ left: ghost.bounds.left, top: ghost.bounds.top, width: ghost.bounds.width, height: ghost.bounds.height }}>
      <div className="floating-sort-tab" style={{ width: ghost.width, height: ghost.height, transform: `translate3d(${ghost.x}px, ${ghost.y}px, 0)` }}>{ghost.name}</div>
    </div>, document.body)}
  </>;
}
