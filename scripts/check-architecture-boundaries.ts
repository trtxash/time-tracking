import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SCAN_ROOTS = ["src/features"] as const;

interface SourceFile {
  path: string;
  content: string;
}

interface ArchitectureViolation {
  path: string;
  line: number;
  rule: string;
  text: string;
}

function normalizePath(path: string) {
  return path.split(sep).join("/");
}

function collectSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];

  function walk(path: string) {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) {
        walk(join(path, entry));
      }
      return;
    }

    if (!/\.(ts|tsx)$/.test(path)) {
      return;
    }

    files.push({
      path: normalizePath(relative(process.cwd(), path)),
      content: readFileSync(path, "utf8"),
    });
  }

  walk(root);
  return files;
}

function isFeatureComponentOrHook(path: string) {
  return /^src\/features\/[^/]+\/(components|hooks)\//.test(path);
}

function findArchitectureViolations(files: SourceFile[]): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const file of files) {
    if (!isFeatureComponentOrHook(file.path)) {
      continue;
    }

    const lines = file.content.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      if (lineText.includes("platform/persistence")) {
        violations.push({
          path: file.path,
          line: index + 1,
          rule: "feature-ui-no-persistence",
          text: lineText.trim(),
        });
      }

      if (lineText.includes("@tauri-apps")) {
        violations.push({
          path: file.path,
          line: index + 1,
          rule: "feature-ui-no-tauri-api",
          text: lineText.trim(),
        });
      }

      if (/\binvoke\s*\(/.test(lineText)) {
        violations.push({
          path: file.path,
          line: index + 1,
          rule: "feature-ui-no-direct-invoke",
          text: lineText.trim(),
        });
      }
    });
  }

  return violations;
}

function runSelfTest() {
  const violations = findArchitectureViolations([
    {
      path: "src/features/data/components/Data.tsx",
      content: "import { getSessionsInRange } from '../../../platform/persistence/sessionReadRepository.ts';",
    },
    {
      path: "src/features/data/services/dataReadModel.ts",
      content: "const repository = await import('../../../platform/persistence/sessionReadRepository.ts');",
    },
    {
      path: "src/features/settings/hooks/useSettings.ts",
      content: "await invoke('cmd_save_settings');",
    },
  ]);

  if (violations.length !== 2) {
    throw new Error("Architecture boundary self-test failed");
  }
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    console.log("Architecture boundary self-test passed");
    return;
  }

  const files = SCAN_ROOTS.flatMap((root) => collectSourceFiles(root));
  const violations = findArchitectureViolations(files);

  if (violations.length === 0) {
    console.log("Architecture boundary check passed");
    return;
  }

  console.error("Architecture boundary check failed. Feature UI and hooks must not bypass owned services.");
  for (const violation of violations) {
    console.error(`${violation.path}:${violation.line} ${violation.rule} -> ${violation.text}`);
  }
  process.exitCode = 1;
}

main();
