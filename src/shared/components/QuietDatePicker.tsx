import {
  type CSSProperties,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { UI_TEXT } from "../copy/uiText.ts";

interface QuietDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  minDate?: string;
  maxDate?: string;
}

interface CalendarPosition {
  left: number;
  top: number;
  placement: "top" | "bottom";
}

const CALENDAR_WIDTH = 236;
const CALENDAR_HEIGHT = 262;
const CALENDAR_GAP = 6;
const VIEWPORT_PADDING = 8;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return startOfDay(date);
}

function formatDateDisplay(dateKey: string) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey.replace(/-/g, "/");
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function buildCalendarDays(month: Date) {
  const monthStart = startOfMonth(month);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

export default function QuietDatePicker({
  value,
  onChange,
  ariaLabel = UI_TEXT.date.pickDate,
  className,
  disabled = false,
  minDate,
  maxDate,
}: QuietDatePickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const dialogId = useId();
  const selectedDate = useMemo(() => parseDateKey(value) ?? startOfDay(new Date()), [value]);
  const minDateValue = useMemo(() => minDate ? parseDateKey(minDate) : null, [minDate]);
  const maxDateValue = useMemo(() => maxDate ? parseDateKey(maxDate) : null, [maxDate]);
  const [open, setOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(selectedDate));
  const [position, setPosition] = useState<CalendarPosition | null>(null);
  const today = startOfDay(new Date());
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);

  const resolvePosition = (): CalendarPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const rect = trigger.getBoundingClientRect();
    const minLeft = VIEWPORT_PADDING + CALENDAR_WIDTH / 2;
    const maxLeft = Math.max(minLeft, window.innerWidth - VIEWPORT_PADDING - CALENDAR_WIDTH / 2);
    const belowTop = rect.bottom + CALENDAR_GAP;
    const aboveTop = rect.top - CALENDAR_HEIGHT - CALENDAR_GAP;
    const spaceBelow = window.innerHeight - belowTop - VIEWPORT_PADDING;
    const spaceAbove = rect.top - CALENDAR_GAP - VIEWPORT_PADDING;
    const placement = spaceBelow < CALENDAR_HEIGHT && spaceAbove > spaceBelow ? "top" : "bottom";
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - CALENDAR_HEIGHT - VIEWPORT_PADDING);

    return {
      left: clamp(rect.left + rect.width / 2, minLeft, maxLeft),
      top: placement === "top" ? clamp(aboveTop, VIEWPORT_PADDING, maxTop) : clamp(belowTop, VIEWPORT_PADDING, maxTop),
      placement,
    };
  };

  const updatePosition = () => {
    const nextPosition = resolvePosition();
    if (nextPosition) {
      setPosition(nextPosition);
    }
  };

  const closeCalendar = () => {
    setOpen(false);
    setPosition(null);
  };

  const toggleCalendar = () => {
    if (disabled) return;
    if (open) {
      closeCalendar();
      return;
    }
    setCalendarMonth(startOfMonth(selectedDate));
    updatePosition();
    setOpen(true);
  };

  const selectDate = (date: Date) => {
    onChange(formatDateKey(date));
    closeCalendar();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;

    const handleOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      closeCalendar();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCalendar();
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    const handleViewportChange = () => updatePosition();

    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setCalendarMonth(startOfMonth(selectedDate));
  }, [selectedDate, open]);

  const popoverStyle: CSSProperties | undefined = position
    ? {
      left: `${position.left}px`,
      top: `${position.top}px`,
    }
    : undefined;

  const popover = open && position ? (
    <div
      ref={popoverRef}
      id={dialogId}
      role="dialog"
      aria-label={ariaLabel}
      className={`qp-calendar-popover qp-calendar-popover-${position.placement}`}
      style={popoverStyle}
    >
      <header className="qp-calendar-header">
        <button
          type="button"
          onClick={() => setCalendarMonth((month) => addMonths(month, -1))}
          className="qp-calendar-nav"
          aria-label={UI_TEXT.accessibility.date.previousMonth}
        >
          <ChevronLeft size={14} />
        </button>
        <div className="qp-calendar-title">
          {UI_TEXT.date.yearMonthLabel(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1)}
        </div>
        <button
          type="button"
          onClick={() => setCalendarMonth((month) => addMonths(month, 1))}
          className="qp-calendar-nav"
          aria-label={UI_TEXT.accessibility.date.nextMonth}
        >
          <ChevronRight size={14} />
        </button>
      </header>
      <div className="qp-calendar-grid qp-calendar-weekdays">
        {UI_TEXT.date.weekdaysShort.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="qp-calendar-grid">
        {calendarDays.map((date) => {
          const outsideMonth = date.getMonth() !== calendarMonth.getMonth();
          const selected = isSameDay(date, selectedDate);
          const isToday = isSameDay(date, today);
          const disabledDay = Boolean(
            (minDateValue && date < minDateValue)
            || (maxDateValue && date > maxDateValue),
          );
          return (
            <button
              key={formatDateKey(date)}
              type="button"
              disabled={disabledDay}
              aria-pressed={selected}
              aria-current={isToday ? "date" : undefined}
              onClick={() => selectDate(date)}
              className={`qp-calendar-day ${outsideMonth ? "qp-calendar-day-muted" : ""} ${
                selected ? "qp-calendar-day-selected" : ""
              } ${isToday ? "qp-calendar-day-today" : ""}`.trim()}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="qp-date-picker">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={toggleCalendar}
        className={`qp-input qp-date-picker-trigger ${open ? "qp-date-picker-trigger-open" : ""} ${
          className ?? ""
        }`.trim()}
      >
        <span>{formatDateDisplay(value)}</span>
        <CalendarDays size={14} aria-hidden="true" />
      </button>
      {popover ? createPortal(popover, document.body) : null}
    </div>
  );
}
