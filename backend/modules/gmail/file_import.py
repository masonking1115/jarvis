"""Turn an uploaded bank export (CSV / XLSX / PDF) into plain text for the LLM.

We don't try to understand each bank's column layout here — we just flatten the
file to readable text and let the LLM extract normalized transactions. Output is
capped so a huge statement can't blow up the LLM call.
"""
from __future__ import annotations

import csv
import io
from pathlib import Path

MAX_CHARS = 24000


class UnsupportedFile(Exception):
    """File type we can't parse."""


def _from_csv(blob: bytes) -> str:
    text = blob.decode("utf-8", "replace")
    # Normalize via csv so odd quoting/delimiters become clean tab-separated rows.
    try:
        rows = list(csv.reader(io.StringIO(text)))
        return "\n".join("\t".join(c.strip() for c in r) for r in rows if any(r))
    except Exception:  # noqa: BLE001
        return text


def _from_xlsx(blob: bytes) -> str:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(blob), read_only=True, data_only=True)
    out: list[str] = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            cells = [("" if c is None else str(c)).strip() for c in row]
            if any(cells):
                out.append("\t".join(cells))
    return "\n".join(out)


def _from_pdf(blob: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(blob))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def parse_file(filename: str | None, blob: bytes) -> str:
    """Detect type by extension and return flattened text (capped to MAX_CHARS)."""
    ext = (Path(filename).suffix.lower() if filename else "")
    if ext == ".csv" or (not ext and b"," in blob[:2000]):
        text = _from_csv(blob)
    elif ext in (".xlsx", ".xlsm", ".xls"):
        text = _from_xlsx(blob)
    elif ext == ".pdf":
        text = _from_pdf(blob)
    else:
        # last resort: try to decode as text
        try:
            text = blob.decode("utf-8")
        except Exception as e:  # noqa: BLE001
            raise UnsupportedFile(f"Unsupported file type: {ext or 'unknown'}") from e
    text = text.strip()
    if not text:
        raise UnsupportedFile("Could not extract any text (scanned/image PDF or empty file).")
    return text[:MAX_CHARS]
