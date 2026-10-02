// Pure message parsing: ```fenced``` code blocks and `inline` code. No DOM, so it is unit-testable.

export type Segment = { kind: "text"; text: string } | { kind: "code"; lang: string; code: string };

/** Split a chat message into prose and fenced code blocks. Unclosed fences stay plain text. */
export function parseMessage(text: string): Segment[] {
  const out: Segment[] = [];
  const fence = /```([\w+#.-]*)[ \t]*\r?\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const prose = (s: string) => {
    const t = s.replace(/^\n+|\n+$/g, "");
    if (t.trim()) out.push({ kind: "text", text: t });
  };
  while ((m = fence.exec(text))) {
    prose(text.slice(last, m.index));
    let lang = m[1].toLowerCase();
    let code = m[2].replace(/\r?\n$/, "");
    if (!code.trim() && lang && !m[0].includes("\n")) {
      // ```word``` on one line has no language, the word is the code. With a line break the word is a language and the block is just empty.
      code = m[1];
      lang = "";
    }
    if (code.trim()) out.push({ kind: "code", lang, code });
    last = fence.lastIndex;
  }
  prose(text.slice(last));
  return out;
}

/** True when nothing would be shown: empty, whitespace only, or only empty code fences. */
export const isBlankMessage = (text: string) => parseMessage(text).length === 0;

/**
 * A web address that is safe to hand to other people's browsers: http or https only, no embedded user name or
 * password (the classic "https://amazon.com@evil.example" disguise), a sane length. Returns the normalised address.
 */
export function safeWebUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2000) return null;
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Split prose into plain, `inline code` and link pieces. */
export type Inline = { kind: "text" | "code" | "link"; text: string };
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  for (const [i, part] of text.split(/(`[^`\n]+`)/g).entries()) {
    if (i % 2) {
      out.push({ kind: "code", text: part.slice(1, -1) });
      continue;
    }
    for (const [j, bit] of part.split(/(https?:\/\/[^\s<>"'`]+)/g).entries()) {
      if (!bit) continue;
      if (j % 2 === 0) {
        out.push({ kind: "text", text: bit });
        continue;
      }
      // "see https://x.dev/a.png." : the final dot or bracket belongs to the sentence, not the link
      const trail = /[.,;:!?)\]}]+$/.exec(bit)?.[0] ?? "";
      out.push({ kind: "link", text: trail ? bit.slice(0, -trail.length) : bit });
      if (trail) out.push({ kind: "text", text: trail });
    }
  }
  return out;
}

/** True for http(s) links whose path ends in a picture extension. */
export function isImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** Distinct image links in a message, capped so one message can't pull in a wall of pictures. */
export function imageUrls(text: string, max = 4): string[] {
  const urls = parseMessage(text)
    .filter((s) => s.kind === "text")
    .flatMap((s) => parseInline((s as { text: string }).text))
    .filter((p) => p.kind === "link" && isImageUrl(p.text))
    .map((p) => p.text);
  return [...new Set(urls)].slice(0, max);
}
