"""Parse Garmin .FIT activity files into normalized dicts.

Pure module: no network, no DB. Uses the official `garmin_fit_sdk` decoder.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


# FIT record field -> our sample key. enhanced_* fields are preferred when present.
_SAMPLE_FIELDS = [
    ("hr", ("heart_rate",)),
    ("speed", ("enhanced_speed", "speed")),
    ("lat", ("position_lat",)),
    ("lon", ("position_long",)),
    ("alt", ("enhanced_altitude", "altitude")),
    ("cad", ("cadence",)),
]


def _pick(rec: dict, names: tuple[str, ...]) -> Any:
    for n in names:
        if rec.get(n) is not None:
            return rec[n]
    return None


def _sample(rec: dict) -> dict:
    # The FIT SDK decodes `timestamp` to a datetime; JSON columns need it as a
    # string. Numeric record fields (hr/speed/lat/lon/alt/cad) are JSON-safe.
    t = rec.get("timestamp")
    if isinstance(t, datetime):
        t = t.isoformat()
    out: dict[str, Any] = {"t": t}
    for key, names in _SAMPLE_FIELDS:
        out[key] = _pick(rec, names)
    return out


def _downsample(records: list[dict], cap: int = 200) -> list[dict]:
    """Map FIT record messages to compact samples, capped to `cap` points.

    Always preserves the first and last record. Uniform stride in between.
    """
    if not records:
        return []
    if len(records) <= cap:
        return [_sample(r) for r in records]
    stride = len(records) / cap
    picked = [records[min(int(i * stride), len(records) - 1)] for i in range(cap)]
    picked[-1] = records[-1]  # guarantee the final point
    return [_sample(r) for r in picked]


class FitParseError(Exception):
    """Raised when a .FIT file cannot be decoded into an activity."""


def _to_dt(value: Any) -> datetime | None:
    """garmin_fit_sdk returns datetimes (convert_datetimes_to_dates=True by default)."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


def parse_activity(fit_bytes: bytes) -> dict:
    """Decode a .FIT activity file into a normalized activity dict.

    Raises FitParseError if the bytes are not a readable FIT activity.
    """
    from garmin_fit_sdk import Decoder, Stream

    stream = Stream.from_byte_array(bytearray(fit_bytes))
    decoder = Decoder(stream)
    if not decoder.is_fit():
        raise FitParseError("not a FIT file")

    messages, _errors = decoder.read()  # errors are tolerated; partial reads still usable

    sessions = messages.get("session_mesgs") or []
    records = messages.get("record_mesgs") or []
    if not sessions and not records:
        raise FitParseError("FIT file has no session or record messages")

    sess = sessions[0] if sessions else {}

    avg_speed = sess.get("enhanced_avg_speed")
    if avg_speed is None:
        avg_speed = sess.get("avg_speed")

    return {
        "sport": sess.get("sport"),                 # decoded to string by default
        "sub_sport": sess.get("sub_sport"),
        "start_time": _to_dt(sess.get("start_time")),
        "duration_s": sess.get("total_elapsed_time"),
        "distance_m": sess.get("total_distance"),
        "avg_hr": sess.get("avg_heart_rate"),
        "max_hr": sess.get("max_heart_rate"),
        "avg_speed": avg_speed,
        "calories": sess.get("total_calories"),
        "total_ascent": sess.get("total_ascent"),
        "samples": _downsample(records, cap=200),
    }
