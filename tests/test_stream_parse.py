from backend.core.stream_parse import parse_stream_lines

LINES = [
    '{"type":"system","subtype":"init"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Working"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TodoWrite",'
    '"input":{"todos":[{"content":"step one","status":"in_progress"},'
    '{"content":"step two","status":"pending"}]}}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read",'
    '"input":{"file_path":"a.py"}}]}}',
    '{"type":"result","subtype":"success","result":"All done"}',
    "",  # blank line must be skipped, not crash
]


def test_parse_emits_text_todos_tool_done():
    events = list(parse_stream_lines(iter(LINES)))
    types = [e["type"] for e in events]
    assert types == ["text", "todos", "tool", "done"]
    assert events[0]["text"] == "Working"
    assert events[1]["todos"] == [
        {"content": "step one", "status": "in_progress"},
        {"content": "step two", "status": "pending"},
    ]
    assert events[2]["name"] == "Read"
    # the final result text is carried on the done event for callers that want it
    assert events[3].get("text") == "All done"


def test_parse_tolerates_garbage_lines():
    events = list(parse_stream_lines(iter(["not json", '{"type":"result","result":"ok"}'])))
    assert events[-1] == {"type": "done", "text": "ok"}


from pathlib import Path


def test_parse_real_fixture_ends_with_done():
    fx = Path(__file__).parent / "fixtures" / "stream_json_sample.jsonl"
    if not fx.exists():
        return  # spike fixture optional in CI
    events = list(parse_stream_lines(fx.read_text(encoding="utf-8").splitlines()))
    assert events and events[-1]["type"] == "done"
