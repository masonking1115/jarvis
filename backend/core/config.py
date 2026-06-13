from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Absolute path to backend/.env so the file is found regardless of CWD.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    llm_provider: str = "anthropic"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    database_url: str = "sqlite:///./data/jarvis.db"
    cors_origins: str = "http://localhost:3000"

    garmin_email: str = ""
    garmin_password: str = ""
    garmin_token_dir: str = "./data/garmin_token"

    snaptrade_client_id: str = ""
    snaptrade_consumer_key: str = ""
    snaptrade_data_dir: str = "./data/snaptrade"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
