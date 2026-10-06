// The unit tests load the app's own source files. Node cannot import the extensionless paths the app uses, so this copies the
// files the tests need into tests/.build/ with ".ts" added to their relative imports. Run by the runner; safe to run again.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "dema-client", "src");
const out = join(here, "..", ".build");
mkdirSync(out, { recursive: true });

const FILES = ["signing", "identity", "roomExport", "zip", "log", "archive", "unzip", "roomImport", "wallpaper", "runnerSim", "message", "music", "sas", "localSignal", "localNetwork", "scores", "summary"];
for (const name of FILES) {
  let text = readFileSync(join(src, `${name}.ts`), "utf8").replace(/from "\.\/([a-zA-Z]+)"/g, 'from "./$1.ts"');
  if (name === "wallpaper") {
    // the colour maths is pure; the React hook at the end needs a browser
    text = text.replace(/^import \{ useEffect \} from "react";\n/m, "").replace(/\/\*\* Keeps the page[\s\S]*$/, "");
  }
  writeFileSync(join(out, `${name}.ts`), text);
}
