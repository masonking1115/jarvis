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


class ClaudeCliProvider:
    """Drives the logged-in Claude Code CLI (Max plan) headlessly — no API key.

    Each call shells out to `claude -p` with our system prompt and the user
    content on stdin. ANTHROPIC_API_KEY is stripped from the subprocess env so
    the CLI authenticates with the Max subscription, not a (possibly invalid)
    key. Runs in a temp cwd so it doesn't load the project's CLAUDE.md/MCP.
    """
    name = "claude_cli"

    def __init__(self) -> None:
        import shutil, os
        self.bin = settings.claude_cli_path or "claude"
        self.model = settings.claude_cli_model or "sonnet"
        # PATH may differ for a detached backend process, so fall back to the
        # standard install locations if `which` comes up empty.
        self.path = shutil.which(self.bin)
        if not self.path:
            for c in (os.path.expanduser(r"~\.local\bin\claude.exe"),
                      os.path.expanduser("~/.local/bin/claude")):
                if os.path.exists(c):
                    self.path = c
                    break
        self.available = bool(self.path)

    def chat(self, system: str, messages: list[dict]) -> str:
        if not self.available:
            raise RuntimeError("claude CLI not found on PATH")
        import os, subprocess, tempfile
        user = "\n\n".join(
            m["content"] for m in messages if m.get("role") == "user"
        ) or (messages[-1]["content"] if messages else "")
        env = {k: v for k, v in os.environ.items()
               if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
        cmd = [self.path, "-p", "--system-prompt", system,
               "--output-format", "text", "--model", self.model]
        proc = subprocess.run(
            cmd, input=user, capture_output=True, text=True,
            encoding="utf-8", errors="replace",  # email content has emoji/unicode
            env=env, cwd=tempfile.gettempdir(), timeout=120,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"claude cli failed ({proc.returncode}): {proc.stderr[:300]}")
        return proc.stdout.strip().replace("�", "-")  # tidy stray decode artifacts


class StubProvider:
    name = "stub"
    def chat(self, system: str, messages: list[dict]) -> str:
        last = messages[-1]["content"] if messages else ""
        return f"[stub LLM — no API key configured] You said: {last}"


def get_provider(override: str | None = None) -> LLMProvider:
    choice = (override or settings.llm_provider or "").lower()
    if choice == "claude_cli":
        p = ClaudeCliProvider()
        return p if p.available else StubProvider()
    if choice == "anthropic":
        if not settings.anthropic_api_key:
            return StubProvider()
        return AnthropicProvider()
    if choice == "openai":
        if not settings.openai_api_key:
            return StubProvider()
        return OpenAIProvider()
    return StubProvider()
