from backend.modules.garmin import client as gc


class _FakeRaw:
    def __init__(self):
        self.calls = []

    def get_activities(self, start, limit):
        self.calls.append(("get_activities", start, limit))
        return [{"activityId": 111}, {"activityId": 222}]

    def download_activity(self, activity_id, dl_fmt=None):
        self.calls.append(("download", activity_id, dl_fmt))
        return b"PK\x03\x04zip-bytes"


def test_list_activities_delegates(monkeypatch):
    fake = _FakeRaw()
    monkeypatch.setattr(gc, "get_client", lambda: fake)
    out = gc.list_activities(0, 5)
    assert out == [{"activityId": 111}, {"activityId": 222}]
    assert ("get_activities", 0, 5) in fake.calls


def test_download_original_returns_bytes(monkeypatch):
    fake = _FakeRaw()
    monkeypatch.setattr(gc, "get_client", lambda: fake)
    data = gc.download_activity_original(111)
    assert data == b"PK\x03\x04zip-bytes"
    assert any(c[0] == "download" and c[1] == 111 for c in fake.calls)
