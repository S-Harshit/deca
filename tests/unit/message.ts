import assert from "node:assert";
import { parseMessage, parseInline } from "../.build/message.ts";
// fenced with language + indentation preserved
let s = parseMessage("look:\n```ts\nfunction f() {\n  return 1;\n}\n```\nthoughts?");
assert.deepEqual(s.map((x) => x.kind), ["text", "code", "text"]);
assert.equal((s[1] as any).lang, "ts"); assert.equal((s[1] as any).code, "function f() {\n  return 1;\n}");
assert.equal((s[0] as any).text, "look:"); assert.equal((s[2] as any).text, "thoughts?");
// no language
s = parseMessage("```\nls -la\n```"); assert.equal((s[0] as any).lang, ""); assert.equal((s[0] as any).code, "ls -la");
// ```word``` is code, not a language
s = parseMessage("```hello```"); assert.equal((s[0] as any).kind, "code"); assert.equal((s[0] as any).code, "hello"); assert.equal((s[0] as any).lang, "");
// single line with lang then code
s = parseMessage("```js console.log(1)```"); assert.equal((s[0] as any).kind, "code");
// two blocks
s = parseMessage("a\n```py\nx=1\n```\nb\n```\ny\n```"); assert.deepEqual(s.map((x) => x.kind), ["text", "code", "text", "code"]);
// unclosed fence stays plain text
s = parseMessage("```js\nnever closed"); assert.deepEqual(s.map((x) => x.kind), ["text"]);
// tabs and CRLF survive
s = parseMessage("```\r\n\tindented\r\n```"); assert.equal((s[0] as any).code, "\tindented");
// html is data, never parsed here
s = parseMessage("```html\n<script>alert(1)</script>\n```"); assert.equal((s[0] as any).code, "<script>alert(1)</script>");
// inline
assert.deepEqual(parseInline("use `npm i` and see https://x.dev/a?b=1 ok").map((p) => p.kind + ":" + p.text), ["text:use ", "code:npm i", "text: and see ", "link:https://x.dev/a?b=1", "text: ok"]);
assert.deepEqual(parseInline("unbalanced ` tick").map((p) => p.kind), ["text"]);
console.log("message parser tests passed");

// empty code blocks count as no message at all
{
  const { isBlankMessage, parseMessage: pm } = await import("../.build/message.ts");
  const assertB = (await import("node:assert")).default;
  for (const blank of ["", "   ", "\n\n", "```\n\n```", "```\n   \n```", "```js\n\n```", "```js\n```", "```\n```", "```\n\n```\n```\n\n```"]) assertB.equal(isBlankMessage(blank), true, JSON.stringify(blank) + " is blank");
  for (const real of ["hi", "```\nx\n```", "```js\nlet a\n```", "```word```", "```", "a\n```\n```", "``` ```x"]) assertB.equal(isBlankMessage(real), false, JSON.stringify(real) + " is not blank");
  assertB.deepEqual(pm("hello\n```\n```"), [{ kind: "text", text: "hello" }], "text plus an empty fence keeps just the text");
  assertB.deepEqual(pm("```word```"), [{ kind: "code", lang: "", code: "word" }], "one-line ```word``` still means the word is the code");
  assertB.deepEqual(pm("```js\n\n```"), [], "a language with nothing under it is empty, not code named 'js'");
  console.log("blank-message rules ok");
}
