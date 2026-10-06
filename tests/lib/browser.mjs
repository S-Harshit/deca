// ES module twin of browser.cjs, for the .mjs tests.
import { createRequire } from "node:module";
const lib = createRequire(import.meta.url)("./browser.cjs");
export const chromium = lib.chromium;
export const BASE = lib.BASE;
