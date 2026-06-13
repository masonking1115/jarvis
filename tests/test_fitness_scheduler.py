from backend.modules.fitness import scheduler


def test_config_defaults(monkeypatch):
    monkeypatch.delenv("FITNESS_SYNC_ENABLED", raising=False)
    monkeypatch.delenv("FITNESS_SYNC_INTERVAL_MIN", raising=False)
    assert scheduler._enabled() is True
    assert scheduler._interval_seconds() == 600


def test_config_overrides(monkeypatch):
    monkeypatch.setenv("FITNESS_SYNC_ENABLED", "false")
    monkeypatch.setenv("FITNESS_SYNC_INTERVAL_MIN", "5")
    assert scheduler._enabled() is False
    assert scheduler._interval_seconds() == 300


def test_start_is_idempotent(monkeypatch):
    monkeypatch.setattr(scheduler, "_loop", lambda: None)
    scheduler._started = False
    t1 = scheduler.start()
    t2 = scheduler.start()
    assert t1 is t2  # second call returns the same thread, does not spawn another
