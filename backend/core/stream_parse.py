"""Translate the Claude CLI's stream-json events into normalized UI events.

Pure over an iterable of raw JSONL lines so it is testable without a subprocess.
Emitted event dicts:
  {"type":"text","text": <str>}                      assistant text
  {"type":"todos","todos":[{content,status}, ...]}   a TodoWrite tool call
  {"type":"tool","name": <str>, "summary": <str>}    any other tool call
  {"type":"done","text": <final result str>}         terminal event
"""
from __future__ import annotations

import json
from typing import Iterable, Iterator


def _tool_summary(name: str, inp: dict) -> str:
    for key in ("file_path", "path", "query", "command", "url", "pattern"):
        if isinstance(inp, dict) and inp.get(key):
            return f"{name} {inp[key]}"
    return name


def parse_stream_lines(lines: Iterable[str]) -> Iterator[dict]:
    final = ""
    saw_delta = False   # when partial-message deltas stream, the final assistant
                        # text block duplicates them — suppress the block in that case
    for raw in lines:
        s = (raw or "").strip()
        if not s:
            continue
        try:
            ev = json.loads(s)
        except (ValueError, TypeError):
            continue
        etype = ev.get("type")
        if etype == "assistant":
            for block in (ev.get("message") or {}).get("content", []) or []:
                btype = block.get("type")
                if btype == "text" and block.get("text"):
                    if not saw_delta:   # avoid duplicating streamed deltas
                        yield {"type": "text", "text": block["text"]}
                elif btype == "tool_use":
                    name = block.get("name") or "tool"
                    inp = block.get("input") or {}
                    if name == "TodoWrite":
                        todos = [
                            {"content": t.get("content", ""), "status": t.get("status", "pending")}
                            for t in inp.get("todos", [])
                        ]
                        yield {"type": "todos", "todos": todos}
                    else:
                        yield {"type": "tool", "name": name, "summary": _tool_summary(name, inp)}
        elif etype == "stream_event":
            # token-level delta when --include-partial-messages is active
            delta = (ev.get("event") or {}).get("delta") or {}
            if delta.get("type") == "text_delta" and delta.get("text"):
                saw_delta = True
                yield {"type": "text", "text": delta["text"]}
        elif etype == "result":
            final = ev.get("result") or final
    yield {"type": "done", "text": final}
