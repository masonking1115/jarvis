from pathlib import Path
from pydantic import Field, AliasChoices
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

    # Flyover (photoreal address view). Maps key is the ONLY key sent to the
    # browser (Cesium fetches Google tiles directly); restrict it to localhost
    # referrers. OpenWeather key stays server-side (geocode + current weather).
    google_maps_api_key: str = ""
    # Accept either OPENWEATHER_API_KEY or OPENWEATHERMAP_API_KEY in .env.
    openweather_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("openweather_api_key", "openweathermap_api_key"),
    )
    flyover_default_units: str = "imperial"   # imperial | metric
    # Default location shown until the user sets one (via the in-app gear). Change
    # these in .env to point the flyover somewhere else out of the box.
    flyover_default_address: str = "2 McCormick Lane, Atherton, CA"
    flyover_default_lat: float = 37.4655585    # Google rooftop geocode (aligned with the 3D tiles)
    flyover_default_lng: float = -122.1967955

    # Voice (Azure Neural TTS). Key stays server-side (proxied via /api/voice/tts).
    azure_speech_key: str = ""
    azure_speech_region: str = "eastus"
    jarvis_voice: str = "en-GB-RyanNeural"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
