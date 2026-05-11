"""LLM provider abstraction. Supports Anthropic and OpenAI, picked at runtime."""
from __future__ import annotations

from typing import Protocol
from .config import settings


class LLMProvider(Protocol):
    name: str
    def chat(self, system: str, messages: list[dict]) -> str: ...


class AnthropicProvider:
    name = "anthropic"

    def __init__(self) -> None:
        from anthropic import Anthropic
        self.client = Anthropic(api_key=settings.anthropic_api_key)
        self.model = settings.anthropic_model

    def chat(self, system: str, messages: list[dict]) -> str:
        resp = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=system,
            messages=messages,
        )
        parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
        return "".join(parts).strip()


class OpenAIProvider:
    name = "openai"

    def __init__(self) -> None:
        from openai import OpenAI
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model

    def chat(self, system: str, messages: list[dict]) -> str:
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system}, *messages],
        )
        return (resp.choices[0].message.content or "").strip()


class StubProvider:
    name = "stub"
    def chat(self, system: str, messages: list[dict]) -> str:
        last = messages[-1]["content"] if messages else ""
        return f"[stub LLM — no API key configured] You said: {last}"


def get_provider(override: str | None = None) -> LLMProvider:
    choice = (override or settings.llm_provider or "").lower()
    if choice == "anthropic":
        if not settings.anthropic_api_key:
            return StubProvider()
        return AnthropicProvider()
    if choice == "openai":
        if not settings.openai_api_key:
            return StubProvider()
        return OpenAIProvider()
    return StubProvider()
