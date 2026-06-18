// web/check_sse.ts — run: npx tsx check_sse.ts
import { parseSseChunk } from "./lib/sseParse";

// Two complete frames + a partial that must be carried over.
const chunk = 'data: {"type":"text","text":"hi"}\n\ndata: {"type":"done","text":"hi"}\n\ndata: {"type":"text"';
const { events, rest } = parseSseChunk("", chunk);
if (events.length !== 2) throw new Error(`expected 2 events, got ${events.length}`);
if (events[0].type !== "text" || (events[0] as any).text !== "hi") throw new Error("bad first event");
if (events[1].type !== "done") throw new Error("bad second event");
if (!rest.startsWith("data: {\"type\":\"text\"")) throw new Error("partial not carried over");
console.log("parseSseChunk: all cases pass");
