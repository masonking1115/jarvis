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
    {"name": "look", "where": "frontend",
     "desc": "Look through the webcam and answer about what is seen. Use when the user asks what you see, to look at something, or to describe their surroundings/an object.",
     "args": "question (string, optional): what to look for or answer about"},
    {"name": "add_todo", "where": "backend",
     "desc": "Add a to-do/task to the user's list. Use when the user wants to remember or schedule something to do.",
     "args": "title (string): the task; due (string, optional): ISO date YYYY-MM-DD if the user names a day; priority (int 1-5, optional, 1=high)"},
    {"name": "list_todos", "where": "backend",
     "desc": "List the user's open to-dos for this week.",
     "args": "(none)"},
]
NAMES = {t["name"] for t in TOOLS}


def render() -> str:
    lines = ["Available actions:"]
    for t in TOOLS:
        lines.append(f'- {t["name"]}({t["args"]}) — {t["desc"]}')
    return "\n".join(lines)
