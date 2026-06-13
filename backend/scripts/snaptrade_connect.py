"""One-time CLI fallback to connect Robinhood via SnapTrade.

Prefer the in-app 'Connect Robinhood' button. This exists for headless setup.

Run from repo root:
    .\\.venv\\Scripts\\python.exe -m backend.scripts.snaptrade_connect
"""
from backend.modules.robinhood import client as rc


def main() -> None:
    try:
        result = rc.connect()
    except rc.SnapTradeNotConfigured as e:
        print(f"Not configured: {e}")
        return
    url = result.get("redirect_url")
    if not url:
        print("Could not get a connection URL. Check your SnapTrade keys.")
        return
    print("Open this URL, log into Robinhood, and authorize (read-only):\n")
    print(url)


if __name__ == "__main__":
    main()
