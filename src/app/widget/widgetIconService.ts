import { invoke } from "@tauri-apps/api/core";
import { AppClassification } from "../../shared/classification/appClassification.ts";

interface WidgetIconServiceDeps {
  getIconMap: () => Promise<Record<string, string>>;
}

const widgetIconServiceDeps: WidgetIconServiceDeps = {
  getIconMap: loadWidgetIconMapFromRuntime,
};

let iconMapCache: Record<string, string> | null = null;
let iconMapPromise: Promise<Record<string, string>> | null = null;

function expandIconMap(rawIcons: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [rawExe, icon] of Object.entries(rawIcons)) {
    const trimmedExe = rawExe.trim();
    if (!trimmedExe) continue;

    const normalizedExe = AppClassification.resolveCanonicalExecutable(trimmedExe);
    const lowerExe = trimmedExe.toLowerCase();

    map[trimmedExe] = icon;
    map[lowerExe] = icon;
    map[normalizedExe] = icon;
  }

  return map;
}

async function loadWidgetIconMapFromRuntime(): Promise<Record<string, string>> {
  const rawIcons = await invoke<Record<string, string>>("cmd_get_widget_icon_map");
  return expandIconMap(rawIcons);
}

async function loadWidgetIconMap(deps: WidgetIconServiceDeps) {
  if (iconMapCache) {
    return iconMapCache;
  }

  if (!iconMapPromise) {
    iconMapPromise = deps.getIconMap()
      .then((icons) => {
        iconMapCache = icons;
        return icons;
      })
      .catch((error) => {
        iconMapPromise = null;
        throw error;
      });
  }

  return iconMapPromise;
}

export async function loadWidgetObjectIconWithDeps(
  objectIconKey: string | null,
  deps: WidgetIconServiceDeps,
): Promise<string | null> {
  if (!objectIconKey) {
    return null;
  }

  const icons = await loadWidgetIconMap(deps);
  return icons[objectIconKey] ?? null;
}

export async function loadWidgetObjectIcon(objectIconKey: string | null): Promise<string | null> {
  return loadWidgetObjectIconWithDeps(objectIconKey, widgetIconServiceDeps);
}

export function resetWidgetIconCacheForTests() {
  iconMapCache = null;
  iconMapPromise = null;
}
