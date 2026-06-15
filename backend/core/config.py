from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Absolute path to backend/.env so the file is found regardless of CWD.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    llm_provider: str = "claude_cli"   # claude_cli (Max plan via CLI) | anthropic | openai
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    # claude_cli: drives the logged-in Claude Code CLI (Max plan) instead of an API key.
    claude_cli_path: str = "claude"
    claude_cli_model: str = "sonnet"   # alias the CLI understands (sonnet | opus | haiku)

    database_url: str = "sqlite:///./data/jarvis.db"
    cors_origins: str = "http://localhost:3000"

    garmin_email: str = ""
    garmin_password: str = ""
    garmin_token_dir: str = "./data/garmin_token"

    snaptrade_client_id: str = ""
    snaptrade_consumer_key: str = ""
    snaptrade_data_dir: str = "./data/snaptrade"
    # Personal OAuth: SnapTrade's public PKCE client id (no secret). Used for the
    # one-time browser sign-in; the stored refresh_token then powers unattended sync.
    snaptrade_oauth_client_id: str = "lBHki0jPb0OJOca1cTlkHjuWsAGC8m6o2xOib0nN"
    # Must match a redirect_uri registered for the OAuth client above. SnapTrade's
    # public client whitelists exactly http://127.0.0.1:36987/oauth/callback —
    # any other port returns "authorization request is invalid".
    snaptrade_redirect_port: int = 36987
    snaptrade_sync_interval_min: int = 60

    # Gmail / Google OAuth (Desktop-app client). You create the client in Google
    # Cloud Console; the id/secret come from the env (never committed). The stored
    # refresh_token then powers unattended access — same model as SnapTrade above.
    google_client_id: str = ""
    google_client_secret: str = ""
    gmail_redirect_port: int = 36988
    gmail_data_dir: str = "./data/gmail"
    gmail_sync_interval_min: int = 15   # how often the screening loop polls
    gmail_backfill: int = 25            # how many recent inbox msgs to screen per run (cap)

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
