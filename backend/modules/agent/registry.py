"""Action registry — the single source of truth for what JARVIS can do.

Add a new capability (e.g. Slack/Linear) by appending an entry here and
implementing its executor in service.run (backend) or the frontend dispatch
map (frontend).
"""
TOOLS = [
    {"name": "web_search", "where": "backend",
     "desc": "Search the web for current info, facts, news, prices, etc.",
     "args": "query (string): what to search for"},
    {"name": "weather", "where": "backend",
     "desc": "Current weather conditions for a place.",
     "args": "location (string, optional): city/address; omit for the user's saved location"},
    {"name": "navigate", "where": "frontend",
     "desc": "Open a section of the JARVIS console.",
     "args": "target (string): one of dashboard, finance, spending, email, fitness, workouts, projects, trading, agents, notes, settings, goals, schedule, tax"},
    {"name": "open_flyover", "where": "frontend",
     "desc": "Open the full-screen photoreal map/flyover of the user's address.",
     "args": "(none)"},
]
NAMES = {t["name"] for t in TOOLS}


def render() -> str:
    lines = ["Available actions:"]
    for t in TOOLS:
        lines.append(f'- {t["name"]}({t["args"]}) — {t["desc"]}')
    return "\n".join(lines)
