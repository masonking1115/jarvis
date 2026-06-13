from backend.modules.fitness.fit_parser import _downsample


def _records(n):
    return [
        {"timestamp": i, "heart_rate": 100 + i, "enhanced_speed": 2.0,
         "position_lat": 1, "position_long": 2, "enhanced_altitude": 10, "cadence": 80}
        for i in range(n)
    ]


def test_downsample_keeps_all_when_under_cap():
    out = _downsample(_records(50), cap=200)
    assert len(out) == 50
    assert out[0]["hr"] == 100
    assert out[0]["speed"] == 2.0


def test_downsample_caps_large_input():
    out = _downsample(_records(2000), cap=200)
    assert len(out) <= 200
    # first and last samples are preserved
    assert out[0]["hr"] == 100
    assert out[-1]["hr"] == 100 + 1999


def test_downsample_handles_missing_fields():
    out = _downsample([{"timestamp": 5}], cap=200)
    assert out == [{"t": 5, "hr": None, "speed": None,
                    "lat": None, "lon": None, "alt": None, "cad": None}]


def test_downsample_empty():
    assert _downsample([], cap=200) == []


def test_downsample_serializes_datetime_timestamps():
    # Real FIT records carry datetime timestamps; samples land in a JSON column,
    # so `t` must be JSON-safe (string), not a raw datetime.
    import json
    from datetime import datetime, timezone
    recs = [{"timestamp": datetime(2022, 8, 29, 18, 31, 22, tzinfo=timezone.utc), "heart_rate": 70}]
    out = _downsample(recs, cap=200)
    assert isinstance(out[0]["t"], str)
    json.dumps(out)  # must not raise


import os
import pytest

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "sample_activity.fit")


@pytest.mark.skipif(not os.path.exists(FIXTURE), reason="no sample_activity.fit fixture")
def test_parse_activity_structure():
    from backend.modules.fitness.fit_parser import parse_activity
    with open(FIXTURE, "rb") as fh:
        result = parse_activity(fh.read())

    # Summary keys always present (values may be None for sparse files).
    for key in ("sport", "sub_sport", "start_time", "duration_s", "distance_m",
                "avg_hr", "max_hr", "avg_speed", "calories", "total_ascent", "samples"):
        assert key in result

    assert isinstance(result["samples"], list)
    assert len(result["samples"]) <= 200
    for s in result["samples"]:
        assert set(s.keys()) == {"t", "hr", "speed", "lat", "lon", "alt", "cad"}
