"""LLM provider abstraction. Supports Anthropic and OpenAI, picked at runtime."""
from __future__ import annotations

import subprocess
from typing import Protocol
from .config import settings
from .stream_parse import parse_stream_lines


class LLMProvider(Protocol):
    name: str
    def chat(self, system: str, messages: list[dict], model: str | None = None) -> str: ...


class AnthropicProvider:
    name = "anthropic"

    def __init__(self) -> None:
        from anthropic import Anthropic
        self.client = Anthropic(api_key=settings.anthropic_api_key)
        self.model = settings.anthropic_model

    def chat(self, system: str, messages: list[dict], model: str | None = None) -> str:
        resp = self.client.messages.create(
            model=model or self.model,   # honor override (smart tier = Opus); default Sonnet
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

    def chat(self, system: str, messages: list[dict], model: str | None = None) -> str:
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

    def chat(self, system: str, messages: list[dict], model: str | None = None) -> str:
        if not self.available:
            raise RuntimeError("claude CLI not found on PATH")
        import os, subprocess, tempfile
        user = "\n\n".join(
            m["content"] for m in messages if m.get("role") == "user"
        ) or (messages[-1]["content"] if messages else "")
        env = {k: v for k, v in os.environ.items()
               if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
        cmd = [self.path, "-p", "--system-prompt", system,
               "--output-format", "text", "--model", (model or self.model)]
        proc = subprocess.run(
            cmd, input=user, capture_output=True, text=True,
            encoding="utf-8", errors="replace",  # email content has emoji/unicode
            env=env, cwd=tempfile.gettempdir(), timeout=120,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"claude cli failed ({proc.returncode}): {proc.stderr[:300]}")
        return proc.stdout.strip().replace("�", "-")  # tidy stray decode artifacts

    def web_answer(self, query: str, model: str | None = None) -> str:
        """One-shot web search via the CLI's WebSearch/WebFetch tools (no API key)."""
        if not self.available:
            raise RuntimeError("claude CLI not found on PATH")
        import os, tempfile
        env = {k: v for k, v in os.environ.items()
               if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
        prompt = ("Search the web and answer for spoken delivery — 2-3 sentences, "
                  "plain text. No markdown, no lists, no citations, no URLs, no sources section:\n\n"
                  + (query or ""))
        cmd = [self.path, "-p", prompt, "--allowedTools", "WebSearch", "WebFetch",
               "--output-format", "text", "--model", (model or self.model)]
        proc = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
            env=env, cwd=tempfile.gettempdir(), timeout=120,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"claude web search failed ({proc.returncode}): {proc.stderr[:200]}")
        import re
        out = proc.stdout.strip().replace("�", "-")
        out = re.split(r"\n\s*sources?\s*:", out, flags=re.I)[0].strip()  # drop trailing sources block
        out = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", out)                # [text](url) -> text
        return out.strip()

    def _project_cwd(self) -> str:
        # Run in the project root so the agent has the codebase + local data and
        # uses TodoWrite naturally (loads the project CLAUDE.md — intended).
        import os
        return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    def agent_text(self, prompt: str, context: str = "", model: str | None = None,
                   timeout: int = 180) -> str:
        """Non-streaming autonomous agent run (used by voice). Full toolset, no gates."""
        if not self.available:
            raise RuntimeError("claude CLI not found on PATH")
        import os
        env = {k: v for k, v in os.environ.items()
               if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
        cmd = [self.path, "-p", prompt, "--output-format", "text",
               "--permission-mode", "bypassPermissions",
               "--model", (model or self.model)]
        if context:
            cmd[3:3] = ["--append-system-prompt", context]
        proc = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
            env=env, cwd=self._project_cwd(), timeout=timeout,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"agent run failed ({proc.returncode}): {proc.stderr[:300]}")
        return proc.stdout.strip().replace("&#65533;", "-")

    def agent_stream(self, prompt: str, context: str = "", model: str | None = None,
                     timeout: int = 300):
        """Streaming autonomous agent run (used by chat). Yields normalized events."""
        if not self.available:
            yield {"type": "text", "text": "The agent is unavailable, sir."}
            yield {"type": "done", "text": ""}
            return
        import os
        env = {k: v for k, v in os.environ.items()
               if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
        cmd = [self.path, "-p", prompt,
               "--output-format", "stream-json", "--verbose", "--include-partial-messages",
               "--permission-mode", "bypassPermissions",
               "--model", (model or self.model)]
        if context:
            cmd[3:3] = ["--append-system-prompt", context]
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", errors="replace",
            env=env, cwd=self._project_cwd(),
        )
        try:
            yield from parse_stream_lines(proc.stdout)
        except Exception:  # noqa: BLE001 — never leak; close cleanly
            yield {"type": "text", "text": "I ran into a problem with that, sir."}
            yield {"type": "done", "text": ""}
        finally:
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass


class StubProvider:
    name = "stub"
    def chat(self, system: str, messages: list[dict], model: str | None = None) -> str:
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
