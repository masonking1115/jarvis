# JARVIS Skill System — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm) — pending implementation plan

## Goal

Give JARVIS an extensible registry of named **skills** the user can grow over
time. A skill bundles an expertise/behavior with the specific actions it needs.
JARVIS automatically selects the right skill for a request (with manual
override), and the user manages skills from files plus an in-app Skills page.

## Problem

Today JARVIS's capabilities are split and neither is an extensible, discrete
system:

1. **Coded actions** — `backend/modules/agent/registry.py` lists 4 tools
   (`web_search`, `weather`, `navigate`, `open_flyover`); `agent/service.py`
   plans (reply vs action) and runs them. Adding one requires code.
2. **Prose "modes"** — `backend/jarvis_profile.md` describes Briefing / Financial
   advisor / Coach as a paragraph. They aren't discrete, selectable, toggleable,
   or addable without editing the persona.

There's no way to add a new named capability (especially a no-code one), no
per-capability enable/disable, and actions are global — every request implicitly
has every tool, regardless of relevance.

## Decisions (locked during brainstorming)

- **Unified registry:** two kinds of skill — **instruction** (markdown, no code)
  and **action** (coded tool) — live in one registry; JARVIS picks whichever fits.
- **Authoring:** markdown **files are the source of truth** (auto-discovered,
  version-controlled, editable in any editor), plus an in-app **Skills page** to
  view and enable/disable.
- **Activation:** **automatic selection with manual override** (natural language
  "use the tax helper", or a forced `skill` parameter).
- **Engine:** **two-stage selection (Approach A)** — a cheap router call sees only
  skill names + when-to-use; the chosen instruction skill's body loads only in a
  second call. Everyday chat/actions stay single-call.
- **Action scoping:** **skill-scoped actions, applied consistently.** Every skill
  has an explicit action set; none silently inherits unrelated tools. A "general"
  default context carries the everyday actions.

## Architecture

A new auto-mounting module **`backend/modules/skills/`** (router → `/api/skills`,
per `backend/core/registry.py`). It discovers instruction skills from files,
unifies them with the existing action skills, persists enable/disable, and
exposes selection + second-stage answering used by the planner.

```
backend/skills/*.md ──(loader)──┐
                                ├──► skills.registry (unified list) ──► agent/service.plan
agent/registry.TOOLS ───────────┘            ▲                              │ stage 1: route
                                             │                              ▼
SkillSetting (DB enable/disable) ────────────┘            skills.service.answer (stage 2:
                                                          instruction body + scoped actions)
/api/skills (list, toggle) ──► Skills page (web)
```

## Skill anatomy

Every skill normalizes to:

| Field | Instruction skill | Action skill |
|---|---|---|
| `name` | from frontmatter | from `agent/registry.TOOLS` |
| `kind` | `"instruction"` | `"action"` |
| `when_to_use` | frontmatter `when_to_use` | from tool `desc` |
| `actions` | frontmatter `actions` list (default `[]`) | n/a |
| `enabled` | `SkillSetting` overlay (default from frontmatter `enabled`, else true) | `SkillSetting` overlay (default true) |
| `body` | markdown body | n/a |
| `args` / `where` | n/a | from `agent/registry.TOOLS` |

### Instruction skill file format (`backend/skills/<name>.md`)

```markdown
---
name: tax-helper
when_to_use: When the user asks about taxes, deductions, filing, 1099s, W-2s.
actions: []          # pure expertise; no live tools
enabled: true
---
You are acting as a meticulous tax-prep assistant. Ground answers in the user's
tax documents and finances. Never give legal guarantees; flag when a CPA is
warranted.
```

```markdown
---
name: trip-planner
when_to_use: When the user wants to plan travel, trips, or outings.
actions: [web_search, weather]
---
You are a sharp travel planner. ...
```

Rules:
- Frontmatter is delimited by `---` lines. Parsed by a small built-in parser
  (no new YAML dependency): `key: value` lines; `actions` accepts an inline list
  `[a, b]` or empty. Unknown keys ignored.
- `name` and `when_to_use` are required; a file missing either is skipped (logged,
  never crashes discovery).
- `actions` defaults to `[]` (no tools). Names must match registered action
  skills; unknown action names are dropped (logged).
- `enabled` defaults to `true` if absent.
- Files are read **fresh per request** (live edits, like `load_persona`).

### General (default) context

When no specialized instruction skill is selected, JARVIS runs in the **general**
context: the base persona (`jarvis_profile.md`) plus a default action set —
the current four actions (`web_search`, `weather`, `navigate`, `open_flyover`).
This preserves today's behavior and ensures actions are always reached through a
context that explicitly owns them. The default action set is defined in code
(`skills/registry.py::GENERAL_ACTIONS`).

## Selection & execution (two-stage engine)

Implemented by extending `agent/service.plan(db, messages, skill=None)`:

**Stage 1 — route.** System prompt = persona + facts (existing) + general-action
list + enabled **instruction** skills as `name — when_to_use` lines. The model
returns ONLY JSON, one of:
- `{"kind":"reply","text":…}` — general answer,
- `{"kind":"action","tool":<general action>,"args":{…},"ack":…}` — runs an executor (unchanged path),
- `{"kind":"skill","name":<instruction skill>}` — a specialized skill.

`plan` validates: an `action` tool must be in the general action set; a `skill`
name must be an enabled instruction skill — otherwise it falls back to a reply.

**Stage 2 — apply (only for `kind:"skill"`), server-side in the same request.**
`skills.service.answer(db, name, messages)` builds a system prompt by reusing the
chat context builder (`chat/router.py::_build_context` — tasks, goals, finance,
and the injected profile facts) + persona + **that skill's body** + **only that
skill's declared actions**, then calls the model. It returns reply/action JSON scoped to the
skill's actions:
- reply → `plan` returns `{"kind":"reply","text":…}`,
- action → `plan` returns `{"kind":"action",…}` (executed via the existing
  `agent/service.run` for backend tools or the frontend dispatch for frontend
  tools — unchanged).

Because stage 2 collapses into a normal `reply`/`action` result, **the frontend
needs no new case.** Latency: general chat/actions stay single-call (~2.6s on the
API provider); a specialized-skill answer pays one extra call.

**Manual override.** `plan(..., skill="tax-helper")` skips stage-1 routing and goes
straight to stage 2 with that skill (works even if disabled, for testing). The
stage-1 prompt also instructs the model to honor an explicit user request ("use
the tax helper") by returning that `skill`. The `/api/agent/plan` endpoint gains
an optional `skill` field forwarded to `plan`.

## Enable/disable

`SkillSetting(name: str unique, enabled: bool)` overlays the file/code default.
`skills.registry` merges: a skill is enabled unless a `SkillSetting` row says
otherwise. Disabled skills are excluded from stage-1 routing (but a forced skill
still runs). Action skills can also be toggled; a disabled action is dropped from
the general action set and from any skill's action list.

## Skills page + API

New **Skills** tab (`web/app/(console)/skills/page.tsx`, added to `Sidebar.tsx`
after Profile). Lists every skill grouped by kind, showing `name`, `when_to_use`,
the actions it carries (so scoping is visible), and an enable/disable toggle.

| Endpoint | Purpose |
|---|---|
| `GET /api/skills` | list all skills (merged files + actions) with kind, when_to_use, actions, enabled |
| `PATCH /api/skills/{name}` | `{enabled: bool}` — upsert a `SkillSetting` |

`web/lib/api.ts` gets a `skills` client + `Skill` type, mirroring `profile`/`tax`.

## Seed skills

Ship two example instruction skills as working templates:
- `backend/skills/tax-helper.md` (`actions: []`)
- `backend/skills/fitness-coach.md` (`actions: []` — grounds in the user's goals/tasks via the existing chat context)

## Error handling & privacy

- **Discovery resilience:** a malformed/incomplete skill file is skipped, never
  crashes discovery or a request.
- **Selection fallback:** unknown/disabled auto-selected skill or action → plain
  reply; stage-2 failure → plain reply ("I ran into a problem, sir.").
- **Secrets:** unchanged app-wide rule; skills never expose secrets. Action
  execution keeps the existing key-stripping behavior.
- **Local-only:** files on disk + SQLite, like the rest of the app.

## Testing

In-memory SQLite fixture + monkeypatched provider (mirrors `tests/test_profile.py`):

- **Loader:** parse valid frontmatter (name/when_to_use/actions/enabled + body);
  inline `actions: [a, b]` and empty; missing required field → skipped; unknown
  action names dropped.
- **Registry:** unified list includes instruction + action skills; `SkillSetting`
  overlay disables correctly; disabled action removed from general set + skill sets.
- **Selection:** stage-1 returns `skill` → `plan` runs stage 2 (mock provider) and
  returns the skill's answer; stage-2 action scoping (a skill only offers its
  declared actions; an action outside the set is rejected → reply); forced `skill`
  param bypasses routing.
- **Endpoints:** `GET /api/skills` lists; `PATCH` toggles. PATCH on a name that
  has no `SkillSetting` row yet **upserts** one (so any known skill can be toggled
  the first time); PATCH on a name that matches no known skill at all → 404.

## File structure

**Create:**
- `backend/modules/skills/__init__.py` — exports `router`
- `backend/modules/skills/loader.py` — discover + parse instruction skill files
- `backend/modules/skills/models.py` — `SkillSetting`
- `backend/modules/skills/registry.py` — unify instruction + action skills, `GENERAL_ACTIONS`, enable/disable merge
- `backend/modules/skills/service.py` — render skill list for the router, `answer()` (stage 2)
- `backend/modules/skills/router.py` — `/api/skills` endpoints
- `backend/skills/tax-helper.md`, `backend/skills/fitness-coach.md` — seed skills
- `web/app/(console)/skills/page.tsx` — Skills management page
- `tests/test_skills.py` — backend tests

**Modify:**
- `backend/core/db.py` — register `SkillSetting` in `init_db`
- `backend/modules/agent/service.py` — `plan` gains skill listing + `kind:"skill"`
  routing + stage-2 delegation + optional `skill` param
- `backend/modules/agent/router.py` — `PlanIn` gains optional `skill`; forward it
- `web/lib/api.ts` — `skills` client + `Skill` type
- `web/components/Sidebar.tsx` — add Skills nav entry

## Future / out of scope (separate spec)

- **Authoring skills from the UI** (create/edit bodies in-app) — for now the page
  is view + enable/disable; new skills are added as files.
- **Multi-action skills with tool loops** — stage 2 currently selects at most one
  action per turn (same as today's planner). A multi-step agent loop within a
  skill is a later enhancement.
- **Slack/Linear action skills** — added when those integrations land; they slot
  in as new action skills a skill can declare.
