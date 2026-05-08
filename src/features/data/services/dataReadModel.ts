import type { HistorySession } from "../../../shared/lib/sessionReadRepository.ts";

export type { HistorySession };

export interface HeatmapCell {
  key: string;
  date: string;
  duration: number;
  intensity: number;
  isFuture: boolean;
  isOutsideYear: boolean;
  label: string;
}

export interface HeatmapWeek {
  key: string;
  monthLabel: string;
  cells: HeatmapCell[];
}

export type HeatmapSelection = "recent" | number;

export interface HeatmapRange {
  start: Date;
  end: Date;
  weekCount: number;
}

export interface DataHeatmapSnapshot {
  earliestStartTime: number | null;
  sessions: HistorySession[];
  range: HeatmapRange;
  cacheKey: string;
}

export interface DataHeatmapDependencies {
  getEarliestSessionStartTime: () => Promise<number | null>;
  getSessionsInRange: (startMs: number, endMs: number) => Promise<HistorySession[]>;
}

const RECENT_HEATMAP_WEEK_COUNT = 53;
const heatmapSessionCache = new Map<string, HistorySession[]>();
let earliestSessionStartTimeCache: number | null | undefined;

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, delta: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatHeatmapDateLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatDuration(durationMs: number) {
  const safeMs = Math.max(0, durationMs);
  const totalSeconds = Math.floor(safeMs / 1000);
  const totalMinutes = Math.floor(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${minutes}m`;
  if (totalSeconds > 0) return `${totalSeconds}s`;
  return "<1s";
}

function formatHeatmapMonthLabel(date: Date) {
  return `${date.getMonth() + 1}月`;
}

async function resolveDefaultDataHeatmapDependencies(): Promise<DataHeatmapDependencies> {
  const repository = await import("../../../platform/persistence/sessionReadRepository.ts");
  return {
    getEarliestSessionStartTime: repository.getEarliestSessionStartTime,
    getSessionsInRange: repository.getSessionsInRange,
  };
}

export function resetDataReadModelCacheForTests() {
  heatmapSessionCache.clear();
  earliestSessionStartTimeCache = undefined;
}

export function getCachedEarliestSessionStartTime() {
  return earliestSessionStartTimeCache;
}

export function getHeatmapRange(selection: HeatmapSelection, nowMs: number): HeatmapRange {
  if (selection === "recent") {
    const todayStart = startOfLocalDay(new Date(nowMs));
    const mondayOffset = (todayStart.getDay() + 6) % 7;
    const currentWeekStart = addDays(todayStart, -mondayOffset);
    return {
      start: addDays(currentWeekStart, -(RECENT_HEATMAP_WEEK_COUNT - 1) * 7),
      end: addDays(currentWeekStart, 7),
      weekCount: RECENT_HEATMAP_WEEK_COUNT,
    };
  }

  const yearStart = new Date(selection, 0, 1);
  const nextYearStart = new Date(selection + 1, 0, 1);
  const mondayOffset = (yearStart.getDay() + 6) % 7;
  const heatmapStart = addDays(yearStart, -mondayOffset);
  const lastYearDay = addDays(nextYearStart, -1);
  const lastWeekEndOffset = 6 - ((lastYearDay.getDay() + 6) % 7);
  const heatmapEnd = addDays(lastYearDay, lastWeekEndOffset + 1);

  return {
    start: heatmapStart,
    end: heatmapEnd,
    weekCount: Math.ceil((heatmapEnd.getTime() - heatmapStart.getTime()) / (7 * 24 * 60 * 60 * 1000)),
  };
}

export function getHeatmapSelectionKey(selection: HeatmapSelection, nowMs: number) {
  const range = getHeatmapRange(selection, nowMs);
  return `${selection}:${toDateKey(range.start)}:${toDateKey(range.end)}`;
}

export function getCachedDataHeatmapSessions(selection: HeatmapSelection, nowMs: number) {
  return heatmapSessionCache.get(getHeatmapSelectionKey(selection, nowMs));
}

export function buildYearOptions(earliestStartTime: number | null, currentYear: number) {
  const earliestYear = earliestStartTime ? new Date(earliestStartTime).getFullYear() : currentYear;
  const firstYear = Math.min(earliestYear, currentYear);
  return Array.from(
    { length: currentYear - firstYear + 1 },
    (_, index) => currentYear - index,
  );
}

export function buildActivityHeatmap(
  sessions: HistorySession[],
  selection: HeatmapSelection,
  nowMs: number,
): HeatmapWeek[] {
  const { start: heatmapStart, weekCount } = getHeatmapRange(selection, nowMs);
  const todayStart = startOfLocalDay(new Date(nowMs));
  const dayBuckets = new Map<string, number>();

  for (let dayIndex = 0; dayIndex < weekCount * 7; dayIndex += 1) {
    dayBuckets.set(toDateKey(addDays(heatmapStart, dayIndex)), 0);
  }

  for (const session of sessions) {
    const sessionStart = session.startTime;
    const sessionEnd = session.endTime ?? nowMs;
    if (sessionEnd <= sessionStart) continue;

    let cursor = startOfLocalDay(new Date(sessionStart));
    while (cursor.getTime() < sessionEnd) {
      const dayStart = cursor.getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      const clippedStart = Math.max(sessionStart, dayStart);
      const clippedEnd = Math.min(sessionEnd, dayEnd);
      const key = toDateKey(cursor);
      const previous = dayBuckets.get(key);

      if (previous !== undefined && clippedEnd > clippedStart) {
        dayBuckets.set(key, previous + clippedEnd - clippedStart);
      }

      cursor = addDays(cursor, 1);
    }
  }

  const maxDuration = Math.max(1, ...Array.from(dayBuckets.values()));

  return Array.from({ length: weekCount }, (_, weekIndex) => {
    const weekStart = addDays(heatmapStart, weekIndex * 7);
    const monthStartInWeek = Array.from({ length: 7 }, (_, weekdayIndex) => addDays(weekStart, weekdayIndex))
      .find((date) => (selection === "recent" || date.getFullYear() === selection) && date.getDate() === 1);
    return {
      key: toDateKey(weekStart),
      monthLabel: monthStartInWeek ? formatHeatmapMonthLabel(monthStartInWeek) : "",
      cells: Array.from({ length: 7 }, (_, weekdayIndex) => {
        const date = addDays(weekStart, weekdayIndex);
        const dateKey = toDateKey(date);
        const duration = dayBuckets.get(dateKey) ?? 0;
        const isFuture = date.getTime() > todayStart.getTime();
        const isOutsideYear = selection !== "recent" && date.getFullYear() !== selection;
        return {
          key: dateKey,
          date: dateKey,
          duration,
          isFuture,
          isOutsideYear,
          intensity: duration <= 0 || isFuture || isOutsideYear ? 0 : Math.max(0.16, duration / maxDuration),
          label: `${formatHeatmapDateLabel(dateKey)} · ${isFuture ? "未开始" : formatDuration(duration)}`,
        };
      }),
    };
  });
}

export async function loadDataHeatmapSnapshot(
  selection: HeatmapSelection,
  nowMs: number = Date.now(),
  deps?: DataHeatmapDependencies,
): Promise<DataHeatmapSnapshot> {
  const resolvedDeps = deps ?? await resolveDefaultDataHeatmapDependencies();
  const range = getHeatmapRange(selection, nowMs);
  const cacheKey = getHeatmapSelectionKey(selection, nowMs);
  const earliestStartTimePromise = earliestSessionStartTimeCache === undefined
    ? resolvedDeps.getEarliestSessionStartTime()
    : Promise.resolve(earliestSessionStartTimeCache);

  const [earliestStartTime, sessions] = await Promise.all([
    earliestStartTimePromise,
    resolvedDeps.getSessionsInRange(range.start.getTime(), range.end.getTime()),
  ]);

  earliestSessionStartTimeCache = earliestStartTime;
  heatmapSessionCache.set(cacheKey, sessions);

  return {
    earliestStartTime,
    sessions,
    range,
    cacheKey,
  };
}
