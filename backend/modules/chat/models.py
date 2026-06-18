from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class ChatTurn(Base):
    """One message in the single persistent chat thread."""
    __tablename__ = "chat_turns"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[str] = mapped_column(String(16))            # user | assistant
    content: Mapped[str] = mapped_column(Text)
    tier: Mapped[str | None] = mapped_column(String(16), default=None)  # brain that produced an assistant turn
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChatState(Base):
    """Single-row chat state: sticky tier, mode, and the running compaction summary."""
    __tablename__ = "chat_state"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tier: Mapped[str] = mapped_column(String(16), default="fast")     # fast | smart | agent
    mode: Mapped[str] = mapped_column(String(16), default="")         # "" | brainstorm
    compaction_summary: Mapped[str] = mapped_column(Text, default="")


def get_state(db) -> "ChatState":
    row = db.get(ChatState, 1)
    if row is None:
        row = ChatState(id=1)
        db.add(row); db.commit(); db.refresh(row)
    return row
