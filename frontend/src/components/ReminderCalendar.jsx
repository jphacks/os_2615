import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { monthDays, localDateTime, withDay } from "./reminderDate.js";
export default function ReminderCalendar({
  value,
  onChange,
  disabled = false,
}) {
  const selectedDate = value.slice(0, 10);
  const [month, setMonth] = useState(
    () => new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1),
  );
  useEffect(() => {
    setMonth(
      new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1),
    );
  }, [value.slice(0, 7)]);
  const today = localDateTime(new Date()).slice(0, 10);
  const cells = monthDays(month.getFullYear(), month.getMonth());
  const move = (offset) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  const canGoBack =
    new Date(month.getFullYear(), month.getMonth(), 1) >
    new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const changeTime = (part, text) => {
    const pieces = value.split("T");
    const time = pieces[1].split(":");
    time[part] = text;
    onChange(`${pieces[0]}T${time.join(":")}`);
  };
  return (
    <fieldset className="reminder-calendar" disabled={disabled}>
      <legend>返信する日時</legend>
      <div className="calendar-navigation">
        <strong aria-live="polite">
          {month.getFullYear()}年{month.getMonth() + 1}月
        </strong>
        <div>
          <button
            type="button"
            className="icon-button"
            aria-label="前の月"
            disabled={!canGoBack}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="次の月"
            onClick={() => move(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">
        {["日", "月", "火", "水", "木", "金", "土"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-days" role="group" aria-label="日付を選択">
        {cells.map((day, index) =>
          day ? (
            <button
              type="button"
              key={day}
              disabled={day < today}
              className={day === selectedDate ? "selected-day" : ""}
              aria-label={`${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`}
              aria-pressed={day === selectedDate}
              aria-current={day === today ? "date" : undefined}
              data-initial-focus={day === selectedDate ? "true" : undefined}
              onClick={() => onChange(withDay(value, day))}
            >
              {Number(day.slice(8))}
            </button>
          ) : (
            <span key={`blank-${index}`} />
          ),
        )}
      </div>
      <div className="calendar-time">
        <span>
          <Clock3 size={16} />
          時刻
        </span>
        <label>
          <span className="visually-hidden">時</span>
          <select
            aria-label="時"
            value={value.slice(11, 13)}
            onChange={(e) => changeTime(0, e.target.value)}
          >
            {Array.from({ length: 24 }, (_, h) =>
              String(h).padStart(2, "0"),
            ).map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <b>:</b>
        <label>
          <span className="visually-hidden">分</span>
          <select
            aria-label="分"
            value={value.slice(14, 16)}
            onChange={(e) => changeTime(1, e.target.value)}
          >
            {Array.from({ length: 60 }, (_, m) =>
              String(m).padStart(2, "0"),
            ).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}
