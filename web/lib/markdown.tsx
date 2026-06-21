import React from "react";

// Lightweight markdown → React renderer for chat (no external dependency).
// Handles: code fences, inline code, **bold**, *italic*, headings, -/* and 1. lists,
// [text](url) links, and paragraphs with soft line breaks. Good enough for assistant
// replies; not a full CommonMark implementation.

function inline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined || m[3] !== undefined) nodes.push(<strong key={k++}>{m[2] ?? m[3]}</strong>);
    else if (m[4] !== undefined) nodes.push(<em key={k++}>{m[4]}</em>);
    else if (m[5] !== undefined) nodes.push(<code key={k++} className="px-1 rounded bg-white/10 text-[#9fe6ff] text-[0.92em]">{m[5]}</code>);
    else if (m[6] !== undefined) nodes.push(<a key={k++} href={m[7]} target="_blank" rel="noreferrer" className="text-[#4ad6ff] underline">{m[6]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderMarkdown(src: string): React.ReactNode {
  const lines = (src || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0, key = 0;
  const isUL = (l: string) => /^\s*[-*]\s+/.test(l);
  const isOL = (l: string) => /^\s*\d+\.\s+/.test(l);
  const isH = (l: string) => /^#{1,6}\s/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
      i++;
      blocks.push(<pre key={key++} className="my-1.5 p-2 rounded-lg bg-black/30 border border-white/10 overflow-x-auto text-[12px] leading-snug"><code>{buf.join("\n")}</code></pre>);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push(<div key={key++} className={`font-semibold ${h[1].length <= 2 ? "text-[15px]" : "text-[13.5px]"} mt-2 mb-0.5`}>{inline(h[2])}</div>);
      i++; continue;
    }
    if (isUL(line)) {
      const items: string[] = [];
      while (i < lines.length && isUL(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      blocks.push(<ul key={key++} className="list-disc pl-5 my-1 space-y-0.5">{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>);
      continue;
    }
    if (isOL(line)) {
      const items: string[] = [];
      while (i < lines.length && isOL(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      blocks.push(<ol key={key++} className="list-decimal pl-5 my-1 space-y-0.5">{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>);
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].trim().startsWith("```") && !isH(lines[i]) && !isUL(lines[i]) && !isOL(lines[i])) {
      para.push(lines[i]); i++;
    }
    blocks.push(<p key={key++} className="my-1 leading-relaxed">{para.flatMap((l, j) => j === 0 ? inline(l) : [<br key={"b" + j} />, ...inline(l)])}</p>);
  }
  return <div className="space-y-0.5">{blocks}</div>;
}

// Plain text for speech/captions — drop markdown syntax so TTS doesn't read symbols.
export function stripMarkdown(src: string): string {
  return (src || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
