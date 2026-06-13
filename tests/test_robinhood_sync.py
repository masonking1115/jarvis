from backend.modules.robinhood import sync


def test_position_to_asset_stock():
    pos = {"account_id": "acc1", "ticker": "AAPL", "name": "Apple Inc.",
           "units": 10.0, "price": 150.0, "cost_basis_per_share": 120.0, "is_crypto": False}
    a = sync.position_to_asset(pos)
    assert a["category"] == "stocks"
    assert a["ticker"] == "AAPL"
    assert a["shares"] == 10.0
    assert a["value"] == 1500.0
    assert a["cost_basis"] == 1200.0
    assert a["source"] == "robinhood"
    assert a["external_id"] == "acc1:AAPL"


def test_position_to_asset_crypto_without_cost_basis():
    pos = {"account_id": "acc1", "ticker": "BTC", "name": "Bitcoin",
           "units": 0.5, "price": 60000.0, "cost_basis_per_share": None, "is_crypto": True}
    a = sync.position_to_asset(pos)
    assert a["category"] == "crypto"
    assert a["value"] == 30000.0
    assert a["cost_basis"] is None


def test_cash_to_asset():
    a = sync.cash_to_asset({"account_id": "acc1", "amount": 250.75})
    assert a["category"] == "cash"
    assert a["value"] == 250.75
    assert a["external_id"] == "acc1:CASH"
    assert a["ticker"] is None


def test_activity_buy_forced_negative():
    t = sync.activity_to_transaction({"id": "x1", "type": "BUY", "amount": 1500.0,
                                      "symbol": "AAPL", "description": "Bought 10",
                                      "date": "2026-06-10T14:30:00Z"})
    assert t["amount"] == -1500.0
    assert t["category"] == "buy"
    assert t["external_id"] == "x1"
    assert t["source"] == "robinhood"


def test_activity_dividend_positive():
    t = sync.activity_to_transaction({"id": "d1", "type": "DIVIDEND", "amount": 12.5,
                                      "symbol": "VTI", "description": None,
                                      "date": "2026-06-01T00:00:00Z"})
    assert t["amount"] == 12.5
    assert t["category"] == "dividend"


def test_activity_occurred_at_is_naive():
    t = sync.activity_to_transaction({"id": "z1", "type": "SELL", "amount": 100.0,
                                      "symbol": "AAPL", "description": None,
                                      "date": "2026-06-10T14:30:00Z"})
    assert t["occurred_at"].tzinfo is None


def test_external_ids_are_stable():
    pos = {"account_id": "acc1", "ticker": "AAPL", "name": "Apple",
           "units": 10.0, "price": 150.0, "cost_basis_per_share": 120.0, "is_crypto": False}
    assert sync.position_to_asset(pos)["external_id"] == sync.position_to_asset(pos)["external_id"]
    act = {"id": "x1", "type": "BUY", "amount": 1500.0, "symbol": "AAPL",
           "description": "d", "date": "2026-06-10T14:30:00Z"}
    assert sync.activity_to_transaction(act)["external_id"] == sync.activity_to_transaction(act)["external_id"]
