// Syntax highlighting, loaded on demand so people who never paste code never download it.
type Hljs = typeof import("highlight.js/lib/core").default;

let loading: Promise<Hljs> | null = null;

function load(): Promise<Hljs> {
  loading ??= (async () => {
    const [core, ...langs] = await Promise.all([
      import("highlight.js/lib/core"),
      import("highlight.js/lib/languages/javascript"),
      import("highlight.js/lib/languages/typescript"),
      import("highlight.js/lib/languages/python"),
      import("highlight.js/lib/languages/json"),
      import("highlight.js/lib/languages/bash"),
      import("highlight.js/lib/languages/xml"),
      import("highlight.js/lib/languages/css"),
      import("highlight.js/lib/languages/sql"),
      import("highlight.js/lib/languages/go"),
      import("highlight.js/lib/languages/rust"),
      import("highlight.js/lib/languages/java"),
      import("highlight.js/lib/languages/kotlin"),
      import("highlight.js/lib/languages/swift"),
      import("highlight.js/lib/languages/c"),
      import("highlight.js/lib/languages/cpp"),
      import("highlight.js/lib/languages/csharp"),
      import("highlight.js/lib/languages/php"),
      import("highlight.js/lib/languages/ruby"),
      import("highlight.js/lib/languages/yaml"),
      import("highlight.js/lib/languages/markdown"),
      import("highlight.js/lib/languages/diff"),
      import("highlight.js/lib/languages/dockerfile"),
    ]);
    const names = [
      "javascript", "typescript", "python", "json", "bash", "xml", "css", "sql", "go", "rust", "java",
      "kotlin", "swift", "c", "cpp", "csharp", "php", "ruby", "yaml", "markdown", "diff", "dockerfile",
    ];
    const hljs = core.default;
    names.forEach((n, i) => hljs.registerLanguage(n, langs[i].default));
    return hljs;
  })();
  return loading;
}

/** HTML for the highlighted code (hljs escapes its input), or null to show it as plain text. */
export async function highlight(code: string, lang: string): Promise<string | null> {
  if (code.length > 30000) return null;
  const h = await load();
  if (lang) return h.getLanguage(lang) ? h.highlight(code, { language: lang, ignoreIllegals: true }).value : null;
  return code.length < 6000 ? h.highlightAuto(code).value : null;
}
