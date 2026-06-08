import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { COPY } from "../src/shared/copy/uiText.ts";

const EXPECTED_VIEWS = [
  "dashboard",
  "history",
  "data",
  "mapping",
  "tools",
  "settings",
  "about",
] as const;

const EXPECTED_NAV_LABELS = [
  "今天",
  "历史",
  "数据",
  "应用",
  "工具",
  "设置",
  "关于",
] as const;

let passed = 0;
const require = createRequire(import.meta.url);

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function readUtf8(path: string) {
  return readFileSync(path, "utf8");
}

function collectCopyKeyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "function" || value === null || typeof value !== "object") {
    return [prefix];
  }

  if (Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return collectCopyKeyPaths(child, nextPrefix);
  });
}

function tauriStubFor(path: string) {
  if (path === "@tauri-apps/api/window") {
    const noop = async () => {};
    const currentWindow = {
      minimize: noop,
      toggleMaximize: noop,
      close: noop,
      startDragging: noop,
      isMaximized: async () => false,
      isVisible: async () => true,
      isFocused: async () => true,
      onFocusChanged: async () => () => {},
      onResized: async () => () => {},
    };
    return {
      getCurrentWindow: () => currentWindow,
    };
  }

  if (path === "@tauri-apps/api/webviewWindow") {
    return {
      getCurrentWebviewWindow: () => ({ label: "main" }),
    };
  }

  if (path === "@tauri-apps/api/core") {
    return {
      invoke: async () => null,
      Channel: class Channel {
        onmessage = null;
      },
    };
  }

  if (path === "@tauri-apps/api/event") {
    return {
      listen: async () => () => {},
      emit: async () => {},
    };
  }

  if (path === "@tauri-apps/api/app") {
    return {
      getVersion: async () => "0.0.0-smoke",
    };
  }

  if (path === "@tauri-apps/plugin-opener") {
    return {
      openUrl: async () => {},
    };
  }

  if (path === "@tauri-apps/plugin-sql") {
    return class Database {
      static async load() {
        return new Database();
      }

      async select() {
        return [];
      }

      async execute() {}

      async close() {}
    };
  }

  throw new Error(`Missing Tauri smoke stub for ${path}`);
}

function createMotionStub() {
  const React = require("react") as typeof import("react");
  const cache = new Map<string | symbol, unknown>();
  const ignoredMotionProps = new Set([
    "animate",
    "exit",
    "initial",
    "layout",
    "transition",
    "variants",
    "whileHover",
    "whileTap",
  ]);

  const motion = new Proxy({}, {
    get(_target, prop) {
      if (prop === "__esModule") return false;
      if (cache.has(prop)) return cache.get(prop);
      const tag = String(prop);
      const Component = React.forwardRef((props: Record<string, unknown>, ref) => {
        const domProps: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(props)) {
          if (!ignoredMotionProps.has(key)) {
            domProps[key] = value;
          }
        }
        return React.createElement(tag, { ...domProps, ref });
      });
      cache.set(prop, Component);
      return Component;
    },
  });

  return {
    AnimatePresence: ({ children }: { children?: unknown }) => (
      React.createElement(React.Fragment, null, children)
    ),
    motion,
  };
}

function createRechartsStub() {
  const React = require("react") as typeof import("react");
  const Container = ({ children }: { children?: unknown }) => (
    React.createElement("div", null, children)
  );
  const Empty = () => null;

  return {
    Area: Container,
    AreaChart: Container,
    Bar: Container,
    BarChart: Container,
    CartesianGrid: Empty,
    Cell: Empty,
    Pie: Container,
    PieChart: Container,
    Rectangle: Empty,
    ResponsiveContainer: Container,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
}

function createLucideStub() {
  const React = require("react") as typeof import("react");
  const cache = new Map<string | symbol, unknown>();

  return new Proxy({}, {
    get(_target, prop) {
      if (prop === "__esModule") return false;
      if (cache.has(prop)) return cache.get(prop);
      const Component = (props: Record<string, unknown>) => (
        React.createElement("svg", {
          ...props,
          "aria-hidden": props["aria-hidden"] ?? true,
          focusable: false,
        })
      );
      cache.set(prop, Component);
      return Component;
    },
  });
}

function installSmokeRenderHooks() {
  const Module = require("node:module") as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = Module._load;
  const originalTs = require.extensions[".ts"];
  const originalTsx = require.extensions[".tsx"];
  const originalCss = require.extensions[".css"];
  const originalPng = require.extensions[".png"];

  const transpile = (module: NodeJS.Module, filename: string) => {
    const source = readFileSync(filename, "utf8")
      .replaceAll("import.meta.env.DEV", "false");
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    module._compile(output, filename);
  };

  require.extensions[".ts"] = transpile;
  require.extensions[".tsx"] = transpile;
  require.extensions[".css"] = (module) => {
    module._compile("module.exports = {};", "");
  };
  require.extensions[".png"] = (module) => {
    module._compile("module.exports = 'data:image/png;base64,';", "");
  };

  Module._load = function smokeLoad(request: string, parent: unknown, isMain: boolean) {
    if (request.startsWith("@tauri-apps/")) {
      return tauriStubFor(request);
    }
    if (request === "framer-motion") {
      return createMotionStub();
    }
    if (request === "lucide-react") {
      return createLucideStub();
    }
    if (request === "recharts") {
      return createRechartsStub();
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return () => {
    Module._load = originalLoad;
    require.extensions[".ts"] = originalTs;
    require.extensions[".tsx"] = originalTsx;
    require.extensions[".css"] = originalCss;
    require.extensions[".png"] = originalPng;
  };
}

function renderAppShellForSmoke() {
  const restoreHooks = installSmokeRenderHooks();
  try {
    const React = require("react") as typeof import("react");
    const { renderToString } = require("react-dom/server") as typeof import("react-dom/server");
    const AppShellModule = require("../src/app/AppShell.tsx") as {
      default: React.ComponentType;
    };

    const originalWarn = console.warn;
    console.warn = (...args) => {
      if (String(args[0] ?? "").includes("width(-1) and height(-1) of chart")) {
        return;
      }
      originalWarn(...args);
    };
    try {
      return renderToString(React.createElement(AppShellModule.default));
    } finally {
      console.warn = originalWarn;
    }
  } finally {
    restoreHooks();
  }
}

await runTest("app shell declares every primary desktop view", () => {
  const viewType = readUtf8("src/app/types/view.ts");
  const shell = readUtf8("src/app/AppShell.tsx");
  const sidebar = readUtf8("src/app/components/AppSidebar.tsx");

  for (const view of EXPECTED_VIEWS) {
    assert.match(viewType, new RegExp(`"${view}"`));
    assert.match(shell, new RegExp(`currentView === "${view}"`));
    assert.match(sidebar, new RegExp(`id: "${view}" as View`));
  }
});

await runTest("Chinese and English copy packages keep the same key structure", () => {
  assert.deepEqual(
    collectCopyKeyPaths(COPY["en-US"]).sort(),
    collectCopyKeyPaths(COPY["zh-CN"]).sort(),
  );
});

await runTest("app shell keeps History and Data snapshot loaders on their owning views", () => {
  const shell = readUtf8("src/app/AppShell.tsx");
  const historyBranch = shell.slice(shell.indexOf("<History"), shell.indexOf("<Data"));
  const dataBranch = shell.slice(shell.indexOf("<Data"), shell.indexOf("<Settings"));

  assert.match(historyBranch, /loadHistorySnapshot=\{loadHistoryRuntimeSnapshot\}/);
  assert.doesNotMatch(historyBranch, /loadDataTrendSnapshot=/);
  assert.match(dataBranch, /loadDataTrendSnapshot=\{loadDataTrendRuntimeSnapshot\}/);
  assert.doesNotMatch(dataBranch, /loadHistorySnapshot=/);
});

await runTest("Data regular view avoids visible loading and skeleton branches", () => {
  const data = readUtf8("src/features/data/components/Data.tsx");

  assert.doesNotMatch(data, /UI_TEXT\.history\.loading/);
  assert.doesNotMatch(data, /data-heatmap-skeleton/);
  assert.doesNotMatch(data, /aria-busy/);
});

await runTest("History regular view avoids visible loading copy", () => {
  const history = readUtf8("src/features/history/components/History.tsx");

  assert.doesNotMatch(history, /UI_TEXT\.history\.loading/);
  assert.doesNotMatch(history, /aria-busy/);
});

await runTest("operation-oriented pages keep explicit busy feedback", () => {
  const settings = readUtf8("src/features/settings/components/Settings.tsx");
  const mapping = readUtf8("src/features/classification/components/AppMapping.tsx");
  const dataSafety = readUtf8("src/features/settings/components/SettingsDataSafetyPanel.tsx");
  const updateDialog = readUtf8("src/features/update/components/UpdateConfirmDialog.tsx");

  assert.match(settings, /UI_TEXT\.settings\.loading/);
  assert.match(mapping, /UI_TEXT\.mapping\.loading/);
  assert.match(dataSafety, /backupExporting|backupRestoring/);
  assert.match(updateDialog, /UpdateProgressBar/);
  assert.match(updateDialog, /UI_TEXT\.update\.processing/);
});

await runTest("app shell uses feature-owned Data prewarm and heavy cache lifecycle exits", () => {
  const shell = readUtf8("src/app/AppShell.tsx");

  assert.match(shell, /prewarmDataFirstScreen/);
  assert.match(shell, /clearDataHeavyCaches/);
  assert.match(shell, /clearDataBootstrapCache/);
  assert.doesNotMatch(shell, /clearDataBootstrapSnapshot/);
  assert.doesNotMatch(shell, /buildDataTrendViewModel/);
  assert.doesNotMatch(shell, /buildActivityHeatmap/);
});

await runTest("app shell uses feature-owned page cache lifecycle exits", () => {
  const shell = readUtf8("src/app/AppShell.tsx");
  const cleanupEffect = shell.slice(shell.indexOf("if (isForegroundReady) return undefined;"), shell.indexOf("const handleMinSessionSecsChange"));

  assert.match(shell, /clearDashboardSnapshotCache/);
  assert.match(shell, /clearHistorySnapshotCache/);
  assert.match(shell, /includeDashboard: isDashboardRefreshEnabled/);
  assert.match(shell, /includeHistory: isHistoryRefreshEnabled/);
  assert.doesNotMatch(cleanupEffect, /clearDashboardSnapshotCache/);
  assert.match(cleanupEffect, /clearHistorySnapshotCache/);
  assert.match(cleanupEffect, /clearDataHeavyCaches/);
  assert.doesNotMatch(shell, /DASHBOARD_SNAPSHOT_CACHE/);
  assert.doesNotMatch(shell, /HISTORY_SNAPSHOT_CACHE/);
});

await runTest("app shell uses one five minute threshold for long background behavior", () => {
  const policy = readUtf8("src/app/services/backgroundReturnHomePolicy.ts");
  const shell = readUtf8("src/app/AppShell.tsx");

  assert.match(policy, /LONG_BACKGROUND_DELAY_MS = 5 \* 60 \* 1000/);
  assert.doesNotMatch(shell, /15 \* 60 \* 1000/);
  assert.doesNotMatch(shell, /10 \* 60 \* 1000/);
  assert.match(shell, /const BACKGROUND_CACHE_RELEASE_DELAY_MS = LONG_BACKGROUND_DELAY_MS/);
  assert.match(shell, /resetToDashboardAfterLongBackground/);
  assert.match(shell, /backgroundEnteredAtMsRef/);
});

await runTest("Dashboard first snapshot load is not gated by foreground refresh", () => {
  const hook = readUtf8("src/features/dashboard/hooks/useDashboardStats.ts");

  const firstLoadEffect = hook.slice(
    hook.indexOf("if (!classificationReady || hasRequestedInitialSnapshotRef.current) return;"),
    hook.indexOf("if (refreshKey === 0"),
  );
  const refreshEffect = hook.slice(
    hook.indexOf("if (refreshKey === 0"),
    hook.indexOf("const hasLiveSession"),
  );

  assert.doesNotMatch(firstLoadEffect, /foregroundRefreshEnabled/);
  assert.match(firstLoadEffect, /void loadSnapshot\(\)/);
  assert.match(refreshEffect, /foregroundRefreshEnabled/);
});

await runTest("update snapshot listener disposes if subscription resolves after unmount", () => {
  const hook = readUtf8("src/app/hooks/useUpdateState.ts");

  assert.match(hook, /if \(cancelled\) \{\s*dispose\(\);\s*return;\s*\}/);
});

await runTest("window foreground watcher composes and releases Tauri listeners", () => {
  const gateway = readUtf8("src/platform/desktop/windowControlGateway.ts");

  assert.match(gateway, /readCurrentWindowForegroundState/);
  assert.match(gateway, /onFocusChanged/);
  assert.match(gateway, /onResized/);
  assert.match(gateway, /unlisteners\.splice\(0\)/);
});

await runTest("app shell renders dashboard and primary navigation without Tauri runtime", async () => {
  const html = renderAppShellForSmoke();

  for (const label of EXPECTED_NAV_LABELS) {
    assert.ok(html.includes(`aria-label="${label}"`), `missing nav label ${label}`);
  }
  assert.ok(html.includes("专注分布"));
  assert.ok(html.includes("应用排行"));
  assert.ok(html.includes(`aria-label="按分类显示"`));
});

console.log(`Passed ${passed} UI smoke tests`);
