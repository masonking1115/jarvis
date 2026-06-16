"""Tax vault endpoints — local-only document storage under /api/tax.

Stores uploaded tax files (W-2, 1099s, prior returns) on disk and tracks them
in the tax_documents table. No LLM, no network — files never leave the machine.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from .models import TaxDocument
from . import storage

router = APIRouter()

DOC_TYPES = ["w2", "1099-b", "1099-int", "1099-div", "1098", "return", "other"]


def _store(db: Session, year: int, name: str, content_type: str | None, blob: bytes) -> list[dict]:
    """Persist one upload. If it's a zip, expand it into individual documents;
    otherwise store the file as-is. Returns the created document(s)."""
    if storage.is_zip(name, content_type):
        try:
            entries = storage.extract_zip(blob)
        except Exception:  # noqa: BLE001 — not a valid zip; fall back to storing the blob
            entries = []
        if entries:
            return [_persist(db, year, fn, None, data) for fn, data in entries]
    return [_persist(db, year, name, content_type, blob)]


def _persist(db: Session, year: int, name: str, content_type: str | None, blob: bytes) -> dict:
    stored_name, size = storage.save(year, name or "file", blob)
    doc = TaxDocument(
        tax_year=int(year),
        filename=(name or "file")[:255],
        doc_type=storage.guess_doc_type(name or ""),
        stored_name=stored_name,
        size_bytes=size,
        content_type=content_type,
        uploaded_at=datetime.utcnow(),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _out(doc)


def _out(d: TaxDocument) -> dict:
    return {
        "id": d.id,
        "tax_year": d.tax_year,
        "filename": d.filename,
        "doc_type": d.doc_type,
        "size_bytes": d.size_bytes,
        "content_type": d.content_type,
        "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
    }


@router.get("")
def list_docs(db: Session = Depends(get_db)):
    docs = db.query(TaxDocument).order_by(
        TaxDocument.tax_year.desc(), TaxDocument.uploaded_at.desc()
    ).all()
    years = sorted({d.tax_year for d in docs}, reverse=True)
    return {"documents": [_out(d) for d in docs], "years": years, "doc_types": DOC_TYPES}


@router.post("/upload")
async def upload(
    files: list[UploadFile] = File(...),
    year: int = Form(...),
    db: Session = Depends(get_db),
):
    """Store one or more files into the given tax year. Accepts any file type;
    a .zip is automatically expanded into its individual documents."""
    saved: list[dict] = []
    for f in files:
        blob = await f.read()
        if not blob:
            continue
        saved.extend(_store(db, year, f.filename or "file", f.content_type, blob))
    return {"ok": True, "saved": saved, "count": len(saved)}


@router.post("/{doc_id}/expand")
def expand(doc_id: int, db: Session = Depends(get_db)):
    """Unpack an already-stored zip into individual documents, then remove the zip."""
    doc = db.get(TaxDocument, doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
    if not storage.is_zip(doc.filename, doc.content_type):
        raise HTTPException(400, "document is not a zip")
    path = storage.path_for(doc.tax_year, doc.stored_name)
    if not path.exists():
        raise HTTPException(404, "file missing on disk")
    created = _store(db, doc.tax_year, doc.filename, doc.content_type, path.read_bytes())
    # Only drop the wrapper once we actually extracted something.
    expanded = [d for d in created if d["id"] != doc.id]
    if expanded:
        storage.delete(doc.tax_year, doc.stored_name)
        db.delete(doc)
        db.commit()
    return {"ok": True, "expanded": expanded, "count": len(expanded)}


class DocTypeIn(BaseModel):
    doc_type: str


@router.patch("/{doc_id}")
def update_doc(doc_id: int, body: DocTypeIn, db: Session = Depends(get_db)):
    doc = db.get(TaxDocument, doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
    doc.doc_type = body.doc_type if body.doc_type in DOC_TYPES else "other"
    db.commit()
    db.refresh(doc)
    return _out(doc)


@router.get("/file/{doc_id}")
def get_file(doc_id: int, download: bool = False, db: Session = Depends(get_db)):
    doc = db.get(TaxDocument, doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
    path = storage.path_for(doc.tax_year, doc.stored_name)
    if not path.exists():
        raise HTTPException(404, "file missing on disk")
    disposition = "attachment" if download else "inline"
    return FileResponse(
        str(path),
        media_type=doc.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'{disposition}; filename="{doc.filename}"'},
    )


@router.delete("/{doc_id}")
def delete_doc(doc_id: int, db: Session = Depends(get_db)):
    doc = db.get(TaxDocument, doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
    storage.delete(doc.tax_year, doc.stored_name)
    db.delete(doc)
    db.commit()
    return {"ok": True}
