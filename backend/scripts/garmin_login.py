r"""One-time Garmin Connect login.

Reads GARMIN_EMAIL / GARMIN_PASSWORD from backend/.env, logs in (prompting for
an MFA code if your account has 2FA enabled), and caches a session token under
GARMIN_TOKEN_DIR (default: data/garmin_token/).

Run from the project root:
    .\.venv\Scripts\python.exe -m backend.scripts.garmin_login

After this succeeds, the backend can read your Garmin data without ever needing
your password again. Re-run if the token expires or you change passwords.
"""
from __future__ import annotations

import sys
from pathlib import Path

from backend.core.config import settings


def main() -> int:
    if not settings.garmin_email or not settings.garmin_password:
        print("ERROR: set GARMIN_EMAIL and GARMIN_PASSWORD in backend/.env first.")
        return 1

    try:
        from garminconnect import Garmin
    except ImportError:
        print("ERROR: garminconnect is not installed. Run: pip install -r backend/requirements.txt")
        return 1

    token_dir = Path(settings.garmin_token_dir)
    if not token_dir.is_absolute():
        token_dir = (Path(__file__).resolve().parent.parent.parent / token_dir).resolve()
    token_dir.mkdir(parents=True, exist_ok=True)

    print(f"Logging in as {settings.garmin_email} …")
    print(f"Token cache: {token_dir}")

    def prompt_mfa() -> str:
        return input("Enter Garmin MFA code: ").strip()

    client = Garmin(
        email=settings.garmin_email,
        password=settings.garmin_password,
        prompt_mfa=prompt_mfa,
    )

    try:
        client.login()
    except Exception as e:  # noqa: BLE001
        print(f"\nLogin failed: {e}")
        print("Check the email/password in backend/.env. If you have 2FA, you may need to")
        print("respond to a code prompt that didn't appear (try again).")
        return 2

    # Persist tokens
    client.garth.dump(str(token_dir))
    print(f"\n✓ Logged in. Token cache saved to {token_dir}")
    print("You can now restart the backend and use /api/garmin/* endpoints.")

    # Quick sanity probe
    try:
        from datetime import date
        s = client.get_user_summary(date.today().isoformat())
        steps = s.get("totalSteps") if isinstance(s, dict) else None
        if steps is not None:
            print(f"  Steps today: {steps}")
    except Exception as e:  # noqa: BLE001
        print(f"  (data probe failed: {e})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
