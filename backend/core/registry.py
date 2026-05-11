"""Module registry.

Each subpackage under backend/modules/ that defines a top-level `router`
(an APIRouter) is auto-mounted at /api/<module_name>.

To add a new module:
  1. Create backend/modules/<name>/
  2. Expose `router = APIRouter()` in its __init__.py (or import it there)
  3. Restart the server — it shows up at /api/<name>

This is the seam that keeps Jarvis modular.
"""
from __future__ import annotations

import importlib
import pkgutil
from dataclasses import dataclass
from fastapi import APIRouter, FastAPI


@dataclass
class ModuleInfo:
    name: str
    prefix: str


def discover_and_mount(app: FastAPI) -> list[ModuleInfo]:
    import backend.modules as modules_pkg

    mounted: list[ModuleInfo] = []
    for mod in pkgutil.iter_modules(modules_pkg.__path__):
        if not mod.ispkg:
            continue
        full_name = f"backend.modules.{mod.name}"
        pkg = importlib.import_module(full_name)
        router: APIRouter | None = getattr(pkg, "router", None)
        if router is None:
            continue
        prefix = f"/api/{mod.name}"
        app.include_router(router, prefix=prefix, tags=[mod.name])
        mounted.append(ModuleInfo(name=mod.name, prefix=prefix))
    return mounted
