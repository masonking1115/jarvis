from datetime import datetime
from sqlalchemy import String, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.core.db import Base


class TaxDocument(Base):
    """One uploaded tax file, stored on disk (local-only vault) and tracked here.

    Unlike statement imports — which keep only the extracted numbers — tax docs
    are files the user wants to open later, so we persist the actual bytes under
    backend/data/tax/<year>/ and record the on-disk name in `stored_name`.
    Nothing is ever sent to the LLM or any server unless the user explicitly asks.
    """
    __tablename__ = "tax_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tax_year: Mapped[int] = mapped_column(Integer, index=True)
    filename: Mapped[str] = mapped_column(String(255))                    # original name shown to the user
    doc_type: Mapped[str] = mapped_column(String(32), default="other")    # w2 | 1099-b | 1099-int | 1099-div | return | other
    stored_name: Mapped[str] = mapped_column(String(300))                 # unique on-disk filename
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    content_type: Mapped[str | None] = mapped_column(String(120), default=None)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
