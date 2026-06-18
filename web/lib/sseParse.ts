export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "todos"; todos: { content: string; status: string }[] }
  | { type: "tool"; name: string; summary: string }
  | { type: "action"; name: string }
  | { type: "error"; text: string }
  | { type: "done"; text: string };

/** Parse an SSE text chunk. `buffer` is leftover from the previous chunk.
 * Returns complete events plus the unparsed remainder to carry forward. */
export function parseSseChunk(buffer: string, chunk: string): { events: ChatEvent[]; rest: string } {
  const data = buffer + chunk;
  const parts = data.split("\n\n");
  const rest = parts.pop() ?? "";          // last piece may be incomplete
  const events: ChatEvent[] = [];
  for (const frame of parts) {
    const line = frame.split("\n").find(l => l.startsWith("data:"));
    if (!line) continue;
    try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
  }
  return { events, rest };
}
