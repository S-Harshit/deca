import { useEffect, useState } from "react";
import { highlight } from "../highlight";
import { imageUrls, parseInline, parseMessage } from "../message";
import { usePrefsValue } from "../theme";
import { openAsWindow, shareForEveryone } from "../openWindow";
import { notify } from "../toast";
import { Icon } from "./Icons";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API needs a secure context; fall back for plain http on a LAN
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function Prose({ text }: Readonly<{ text: string }>) {
  return (
    <span className="prose">
      {parseInline(text).map((p, i) => {
        const key = `${i}-${p.kind}`;
        if (p.kind === "code") return <code key={key} className="inline">{p.text}</code>;
        if (p.kind === "link") {
          return (
            <span key={key} className="link-wrap">
              <a href={p.text} target="_blank" rel="noreferrer noopener">
                {p.text}
              </a>
              <button className="link-pop" type="button" aria-label={`Open ${p.text} in a small window`} title="Open in a small window" onClick={() => openAsWindow(p.text)}>
                <Icon name="popout" size={12} />
              </button>
              <button className="link-pop" type="button" aria-label={`Open ${p.text} for everyone`} title="Open this page for everyone in the room" onClick={() => shareForEveryone(p.text)}>
                <Icon name="users" size={12} />
              </button>
            </span>
          );
        }
        return p.text;
      })}
    </span>
  );
}

const LONG = 16;

function CodeBlock({ lang, code }: Readonly<{ lang: string; code: string }>) {
  const [html, setHtml] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n").length;
  const long = lines > LONG;

  useEffect(() => {
    let dead = false;
    highlight(code, lang).then(
      (h) => !dead && setHtml(h),
      () => undefined, // highlighter failed to load: plain text is fine
    );
    return () => {
      dead = true;
    };
  }, [code, lang]);

  const copy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else notify("Couldn't copy to the clipboard", "error");
  };

  return (
    <div className="codeblock">
      <div className="cb-bar">
        <span className="cb-lang">{lang || "code"}</span>
        <span className="cb-actions">
          <button className="cb-btn" aria-pressed={wrap} onClick={() => setWrap((w) => !w)} title="Wrap long lines">
            wrap
          </button>
          <button className="cb-btn" onClick={() => void copy()} aria-label="Copy code">
            <Icon name={copied ? "check" : "copy"} size={12} /> {copied ? "copied" : "copy"}
          </button>
        </span>
      </div>
      <pre className={`${wrap ? "wrap" : ""} ${long && !open ? "clamped" : ""}`} tabIndex={0}>
        {html === null ? <code>{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}
      </pre>
      {long && (
        <button className="cb-more" onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : `Show all ${lines} lines`}
        </button>
      )}
    </div>
  );
}

/** A picture behind a link. Broken or non-image responses quietly disappear, leaving the link. */
function LinkImage({ url, onLoad }: Readonly<{ url: string; onLoad: () => void }>) {
  const { linkPreviews } = usePrefsValue();
  const [asked, setAsked] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  if (!linkPreviews && !asked) {
    return (
      <button className="small-btn show-image" onClick={() => setAsked(true)} title="Loads the image from its host, which sees your IP address">
        Show image
      </button>
    );
  }
  return (
    <a className="link-image" href={url} target="_blank" rel="noreferrer noopener">
      <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={onLoad} onError={() => setFailed(true)} />
    </a>
  );
}

/** A chat message: prose with links and `inline code`, plus fenced blocks rendered as real code. */
export function MessageBody({ text, onMedia }: Readonly<{ text: string; onMedia?: () => void }>) {
  const pictures = imageUrls(text);
  return (
    <>
      {parseMessage(text).map((s, i) =>
        s.kind === "code" ? (
          <CodeBlock key={`${i}-c`} lang={s.lang} code={s.code} />
        ) : (
          <Prose key={`${i}-t`} text={s.text} />
        ),
      )}
      {pictures.map((u) => (
        <LinkImage key={u} url={u} onLoad={() => onMedia?.()} />
      ))}
    </>
  );
}
