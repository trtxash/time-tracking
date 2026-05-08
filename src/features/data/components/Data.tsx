import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
import {
  buildDataTrendViewModel,
  buildActivityHeatmap,
  buildYearOptions,
  getDataTrendRangeLabel,
  getCachedDataHeatmapSessions,
  getCachedEarliestSessionStartTime,
  type DataTrendRange,
  type HeatmapSelection,
  loadDataHeatmapSnapshot,
  type HistorySession,
} from "../services/dataReadModel.ts";
import QuietChartTooltip from "../../../shared/components/QuietChartTooltip";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import QuietTooltip from "../../../shared/components/QuietTooltip";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking";
import {
  formatChartHours,
  formatDuration,
} from "../../history/services/historyFormatting";
import {
  type HistorySnapshot,
} from "../../history/services/historyReadModel";
import {
  getHistorySnapshotCache,
  setHistorySnapshotCache,
} from "../../history/services/historySnapshotCache";

interface Props {
  refreshKey?: number;
  trackerHealth: TrackerHealthSnapshot;
  loadHistorySnapshot: (date: Date, rollingDayCount?: number) => Promise<HistorySnapshot>;
  mappingVersion?: number;
}

const HEATMAP_WEEKDAYS = ["一", "", "三", "", "五", "", "日"] as const;
const HEATMAP_LOADING_HEIGHT = 104;
const TREND_RANGE_OPTIONS: DataTrendRange[] = [7, 30, 365];

export default function Data({
  refreshKey = 0,
  loadHistorySnapshot,
  mappingVersion = 0,
}: Props) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const [selectedTrendRange, setSelectedTrendRange] = useState<DataTrendRange>(7);
  const cachedSnapshot = getHistorySnapshotCache(today, selectedTrendRange);
  const initialCachedHeatmapSessions = getCachedDataHeatmapSessions("recent", Date.now());
  const [rawSnapshot, setRawSnapshot] = useState<HistorySnapshot | null>(cachedSnapshot);
  const [rawSnapshotRange, setRawSnapshotRange] = useState<DataTrendRange | null>(
    cachedSnapshot ? selectedTrendRange : null,
  );
  const [selectedHeatmapView, setSelectedHeatmapView] = useState<HeatmapSelection>("recent");
  const [earliestStartTime, setEarliestStartTime] = useState<number | null>(
    getCachedEarliestSessionStartTime() ?? null,
  );
  const [yearSessions, setYearSessions] = useState<HistorySession[]>(
    () => initialCachedHeatmapSessions ?? [],
  );
  const [heatmapLoading, setHeatmapLoading] = useState(!initialCachedHeatmapSessions);
  const [hasFetchedHeatmapOnce, setHasFetchedHeatmapOnce] = useState(Boolean(initialCachedHeatmapSessions));
  const [nowMs, setNowMs] = useState(() => cachedSnapshot?.fetchedAtMs ?? Date.now());
  const [loading, setLoading] = useState(!cachedSnapshot);
  const [hasFetchedOverviewOnce, setHasFetchedOverviewOnce] = useState(Boolean(cachedSnapshot));
  const hasLoadedRef = useRef(new Set<DataTrendRange>(cachedSnapshot ? [selectedTrendRange] : []));
  const initialRefreshKeyRef = useRef(refreshKey);
  const hasFetchedOverviewOnceRef = useRef(Boolean(cachedSnapshot));
  const hasFetchedHeatmapOnceRef = useRef(Boolean(initialCachedHeatmapSessions));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const cached = getHistorySnapshotCache(new Date(), selectedTrendRange);

      if (cached) {
        setRawSnapshot(cached);
        setRawSnapshotRange(selectedTrendRange);
        setNowMs(cached.fetchedAtMs);
        hasFetchedOverviewOnceRef.current = true;
        setHasFetchedOverviewOnce(true);
        setLoading(false);
      }

      if (cached && hasLoadedRef.current.has(selectedTrendRange) && refreshKey === initialRefreshKeyRef.current) {
        return;
      }

      if (!hasLoadedRef.current.has(selectedTrendRange) && !cached) {
        setLoading(!hasFetchedOverviewOnceRef.current);
      }

      if (!cached) {
        setLoading(true);
      }

      try {
        const snapshot = await loadHistorySnapshot(new Date(), selectedTrendRange);
        if (cancelled) return;
        setHistorySnapshotCache(snapshot, new Date(), selectedTrendRange);
        setRawSnapshot(snapshot);
        setRawSnapshotRange(selectedTrendRange);
        setNowMs(snapshot.fetchedAtMs);
        hasFetchedOverviewOnceRef.current = true;
        setHasFetchedOverviewOnce(true);
        hasLoadedRef.current.add(selectedTrendRange);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadHistorySnapshot, refreshKey, selectedTrendRange]);

  useEffect(() => {
    let cancelled = false;
    const loadYear = async () => {
      const nowForRange = Date.now();
      const cachedSessions = getCachedDataHeatmapSessions(selectedHeatmapView, nowForRange);

      if (cachedSessions) {
        setYearSessions(cachedSessions);
        hasFetchedHeatmapOnceRef.current = true;
        setHasFetchedHeatmapOnce(true);
        setHeatmapLoading(false);
      } else {
        setHeatmapLoading(!hasFetchedHeatmapOnceRef.current);
      }

      try {
        const snapshot = await loadDataHeatmapSnapshot(selectedHeatmapView, nowForRange);
        if (cancelled) return;

        setEarliestStartTime(snapshot.earliestStartTime);
        setYearSessions(snapshot.sessions);
        hasFetchedHeatmapOnceRef.current = true;
        setHasFetchedHeatmapOnce(true);

        if (snapshot.earliestStartTime) {
          const earliestYear = new Date(snapshot.earliestStartTime).getFullYear();
          if (selectedHeatmapView !== "recent" && selectedHeatmapView < earliestYear) {
            setSelectedHeatmapView(earliestYear);
          }
        }
      } finally {
        if (!cancelled) {
          setHeatmapLoading(false);
        }
      }
    };

    void loadYear();
    return () => {
      cancelled = true;
    };
  }, [selectedHeatmapView, refreshKey]);

  const trendViewModel = useMemo(() => {
    if (!rawSnapshot || rawSnapshotRange !== selectedTrendRange) return null;
    return buildDataTrendViewModel(rawSnapshot.weeklySessions, selectedTrendRange, nowMs);
  }, [mappingVersion, nowMs, rawSnapshot, rawSnapshotRange, selectedTrendRange]);
  const heatmapRows = useMemo(() => (
    buildActivityHeatmap(yearSessions, selectedHeatmapView, nowMs)
  ), [nowMs, selectedHeatmapView, yearSessions]);
  const yearOptions = useMemo(
    () => buildYearOptions(earliestStartTime, currentYear),
    [currentYear, earliestStartTime],
  );
  const heatmapViewOptions = useMemo<HeatmapSelection[]>(
    () => ["recent", ...yearOptions],
    [yearOptions],
  );
  const selectedHeatmapViewIndex = heatmapViewOptions.findIndex((option) => option === selectedHeatmapView);
  const canSelectOlderHeatmapView = selectedHeatmapViewIndex >= 0
    && selectedHeatmapViewIndex < heatmapViewOptions.length - 1;
  const canSelectNewerHeatmapView = selectedHeatmapViewIndex > 0;
  const selectAdjacentHeatmapView = (delta: number) => {
    if (selectedHeatmapViewIndex < 0) return;
    const nextView = heatmapViewOptions[selectedHeatmapViewIndex + delta];
    if (nextView !== undefined) {
      setSelectedHeatmapView(nextView);
    }
  };
  const selectedHeatmapViewLabel = selectedHeatmapView === "recent"
    ? UI_TEXT.data.recentYear
    : String(selectedHeatmapView);
  const selectedTrendRangeIndex = TREND_RANGE_OPTIONS.indexOf(selectedTrendRange);
  const canSelectShorterTrendRange = selectedTrendRangeIndex > 0;
  const canSelectLongerTrendRange = selectedTrendRangeIndex >= 0
    && selectedTrendRangeIndex < TREND_RANGE_OPTIONS.length - 1;
  const selectAdjacentTrendRange = (delta: number) => {
    if (selectedTrendRangeIndex < 0) return;
    const nextRange = TREND_RANGE_OPTIONS[selectedTrendRangeIndex + delta];
    if (nextRange !== undefined) {
      setSelectedTrendRange(nextRange);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 md:gap-5 overflow-y-auto pr-1 custom-scrollbar">
      <QuietPageHeader
        icon={<BarChart3 size={18} />}
        title={UI_TEXT.data.title}
        subtitle={UI_TEXT.data.subtitle}
      />

      <div className="data-overview-grid">
        <div className="qp-panel p-5 md:p-6 data-trend-panel">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">
              {UI_TEXT.data.activityTrend}
            </h3>
            <div className="data-heatmap-range-control" aria-label="选择趋势范围">
              <button
                type="button"
                onClick={() => selectAdjacentTrendRange(-1)}
                disabled={!canSelectShorterTrendRange}
                className="qp-control data-heatmap-range-arrow"
                aria-label="查看更短趋势范围"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="qp-status data-heatmap-range-label data-trend-range-label"
                disabled
              >
                {getDataTrendRangeLabel(selectedTrendRange)}
              </button>
              <button
                type="button"
                onClick={() => selectAdjacentTrendRange(1)}
                disabled={!canSelectLongerTrendRange}
                className="qp-control data-heatmap-range-arrow"
                aria-label="查看更长趋势范围"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          {(loading && !hasFetchedOverviewOnce) || !trendViewModel ? (
            <div className="data-trend-chart flex items-center justify-center text-[var(--qp-text-tertiary)] text-xs">
              {UI_TEXT.history.loading}
            </div>
          ) : (
            <div className="pt-4">
              <div className="data-trend-chart">
                <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendViewModel.chartData} margin={{ top: 8, right: 22, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(156, 168, 186, 0.25)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--qp-text-tertiary)" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--qp-text-tertiary)" }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    ticks={trendViewModel.chartAxis.ticks}
                    domain={[0, trendViewModel.chartAxis.domainMax]}
                    tickFormatter={(value) => formatChartHours(Number(value))}
                  />
                  <QuietChartTooltip
                    formatter={(value) => [
                      formatDuration(Number(value) * 3600000),
                      "时长",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="hours"
                    stroke="var(--qp-accent-default)"
                    strokeWidth={2}
                    fill="var(--qp-accent-default)"
                    fillOpacity={0.12}
                    dot={{ fill: "var(--qp-accent-default)", r: 3 }}
                  isAnimationActive={false}
                />
              </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        <div className="data-metric-stack">
          <div className="qp-panel p-5 data-metric-card">
            <div className="flex items-center gap-2 text-[var(--qp-text-secondary)]">
              <Clock3 size={14} />
              <span className="text-xs font-semibold">{trendViewModel?.metricLabels.total ?? UI_TEXT.data.weeklyTotal}</span>
            </div>
            <div className="mt-3 text-xl font-semibold tabular-nums text-[var(--qp-text-primary)]">
              {trendViewModel ? formatDuration(trendViewModel.totalDuration) : "-"}
            </div>
          </div>
          <div className="qp-panel p-5 data-metric-card">
            <div className="flex items-center gap-2 text-[var(--qp-text-secondary)]">
              <CalendarDays size={14} />
              <span className="text-xs font-semibold">{trendViewModel?.metricLabels.average ?? UI_TEXT.data.dailyAverage}</span>
            </div>
            <div className="mt-3 text-xl font-semibold tabular-nums text-[var(--qp-text-primary)]">
              {trendViewModel ? formatDuration(trendViewModel.averageDuration) : "-"}
            </div>
            <p className="mt-1 text-[11px] text-[var(--qp-text-tertiary)]">
              {trendViewModel?.metricLabels.averageHint ?? UI_TEXT.data.dailyAverageHint}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
        <div className="qp-panel p-5 md:col-span-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{UI_TEXT.data.activityHeatmap}</h3>
              <p className="mt-1 text-[11px] text-[var(--qp-text-tertiary)]">
                {selectedHeatmapViewLabel} · {UI_TEXT.data.activityHeatmapHint}
              </p>
            </div>
            <div className="data-heatmap-header-actions">
              <div className="data-heatmap-range-control" aria-label="选择热力图范围">
                <button
                  type="button"
                  onClick={() => selectAdjacentHeatmapView(1)}
                  disabled={!canSelectOlderHeatmapView}
                  className="qp-control data-heatmap-range-arrow"
                  aria-label="查看更早范围"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  className="qp-status data-heatmap-range-label"
                  disabled
                >
                  {selectedHeatmapViewLabel}
                </button>
                <button
                  type="button"
                  onClick={() => selectAdjacentHeatmapView(-1)}
                  disabled={!canSelectNewerHeatmapView}
                  className="qp-control data-heatmap-range-arrow"
                  aria-label="查看更新范围"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="hidden items-center gap-1.5 text-[10px] font-medium text-[var(--qp-text-tertiary)] sm:flex">
                <span>{UI_TEXT.data.less}</span>
                <span className="data-heatmap-swatch data-heatmap-level-0" />
                <span className="data-heatmap-swatch data-heatmap-level-1" />
                <span className="data-heatmap-swatch data-heatmap-level-2" />
                <span className="data-heatmap-swatch data-heatmap-level-3" />
                <span className="data-heatmap-swatch data-heatmap-level-4" />
                <span>{UI_TEXT.data.more}</span>
              </div>
            </div>
          </div>

          {heatmapLoading && !hasFetchedHeatmapOnce ? (
            <div
              className="mt-5 flex items-center justify-center text-[var(--qp-text-tertiary)] text-xs"
              style={{ height: HEATMAP_LOADING_HEIGHT }}
            >
              {UI_TEXT.history.loading}
            </div>
          ) : (
            <div className="data-heatmap data-heatmap-calendar mt-5">
              <div className="data-heatmap-content">
                <div className="data-heatmap-scroll">
                  <div className="data-heatmap-months" aria-hidden>
                    <span />
                    {heatmapRows.map((week) => (
                      <span key={week.key}>{week.monthLabel}</span>
                    ))}
                  </div>
                  <div className="data-heatmap-body" aria-label={UI_TEXT.data.activityHeatmap}>
                    <div className="data-heatmap-weekdays" aria-hidden>
                      {HEATMAP_WEEKDAYS.map((weekday, index) => (
                        <span key={`${weekday}-${index}`}>{weekday}</span>
                      ))}
                    </div>
                    <div className="data-heatmap-weeks">
                      {heatmapRows.map((week) => (
                        <div key={week.key} className="data-heatmap-week">
                          {week.cells.map((cell) => (
                            <QuietTooltip
                              key={cell.key}
                              label={cell.label}
                              placement="top"
                              className="data-heatmap-tooltip-anchor"
                            >
                              <span
                                className={`data-heatmap-cell ${
                                  cell.isFuture ? "data-heatmap-cell-future" : ""
                                } ${cell.isOutsideYear ? "data-heatmap-cell-outside" : ""}`}
                                style={{ "--heatmap-intensity": cell.intensity } as CSSProperties}
                              />
                            </QuietTooltip>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
