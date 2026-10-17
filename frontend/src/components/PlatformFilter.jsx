import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
const options = [['all', 'すべて'], ['line', 'LINE'], ['slack', 'Slack']];
export default function PlatformFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null), buttons = useRef([]);
  useEffect(() => {
    if (!open) return;
    buttons.current[options.findIndex(([id]) => id === value)]?.focus();
    // iOSではタップ時のblurでrelatedTargetがnullになるため、外側の操作で閉じる。
    const close = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('focusin', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('focusin', close);
    };
  }, [open, value]);
  return <div className="platform-filter">
    <span>サービス</span>
    <div className="platform-picker" ref={root} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
      if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const i = buttons.current.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (i + (e.key === 'ArrowDown' ? 1 : 2)) % 3;
        buttons.current[next]?.focus();
      }
    }}>
      <button type="button" className="platform-trigger" ref={trigger} aria-label={`サービスで絞り込み：${options.find(([id]) => id === value)?.[1]}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}>
        {options.find(([id]) => id === value)?.[1]}<ChevronDown size={15} />
      </button>
      {open && <div className="platform-options" role="menu" aria-label="サービスで絞り込み">
        {options.map(([id, label], i) => <button type="button" role="menuitemradio" aria-checked={value === id} key={id} ref={el => { buttons.current[i] = el; }} onClick={() => { onChange(id); setOpen(false); trigger.current?.focus(); }}>{label}{value === id && <Check size={14} />}</button>)}
      </div>}
    </div>
  </div>;
}
