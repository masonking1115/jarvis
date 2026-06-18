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
        # If the package's `router` attribute is a submodule rather than an APIRouter
        # (happens when __init__.py doesn't shadow the submodule name), unwrap it.
        import types
        if isinstance(router, types.ModuleType):
            router = getattr(router, "router", None)
        if router is None or not isinstance(router, APIRouter):
            continue
        prefix = f"/api/{mod.name}"
        app.include_router(router, prefix=prefix, tags=[mod.name])
        mounted.append(ModuleInfo(name=mod.name, prefix=prefix))
    return mounted
