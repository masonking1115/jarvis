"""Gmail endpoints: connection layer + screening engine.

Degrades like Garmin/Robinhood: when not configured/connected, endpoints
return {"available": false, "reason": ...} with HTTP 200 so the dashboard
never errors out.
"""
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.db import get_db
from . import client as gc
from . import service
from . import file_import

router = APIRouter()


@router.get("/status")
def status():
    return gc.status()


@router.post("/connect")
def connect():
    try:
        return {"available": True, **gc.connect()}
    except gc.GmailNotConfigured as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"gmail error: {e}"}


@router.post("/disconnect")
def disconnect():
    return {"available": True, **gc.disconnect()}


@router.post("/sync")
def sync_now(db: Session = Depends(get_db)):
    try:
        result = service.sync_to_db(db)
    except (gc.GmailNotConfigured, gc.GmailNotConnected) as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"gmail error: {e}"}
    return {"available": True, **result}


@router.get("/digest")
def digest(limit: int = 100, db: Session = Depends(get_db)):
    return service.get_digest(db, limit=limit)


@router.get("/sources")
def sources(db: Session = Depends(get_db)):
    return service.get_sources(db)


class SenderIn(BaseModel):
    sender: str   # email address (e.g. promos@store.com)


@router.post("/unsubscribe")
def unsubscribe(body: SenderIn, db: Session = Depends(get_db)):
    try:
        return {"available": True, **service.unsubscribe_source(db, body.sender)}
    except (gc.GmailNotConfigured, gc.GmailNotConnected) as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"gmail error: {e}"}


@router.post("/block")
def block(body: SenderIn, db: Session = Depends(get_db)):
    try:
        return {"available": True, **service.block_source(db, body.sender)}
    except (gc.GmailNotConfigured, gc.GmailNotConnected) as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"gmail error: {e}"}


@router.get("/suppressed")
def suppressed(db: Session = Depends(get_db)):
    return service.list_suppressed(db)


@router.post("/unsuppress")
def unsuppress(body: SenderIn, db: Session = Depends(get_db)):
    try:
        return {"available": True, **service.unsuppress(db, body.sender)}
    except (gc.GmailNotConfigured, gc.GmailNotConnected) as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"gmail error: {e}"}


@router.get("/statements")
def statements(limit: int = 50, db: Session = Depends(get_db)):
    return service.get_email_statements(db, limit=limit)


@router.get("/statement-reminders")
def statement_reminders(db: Session = Depends(get_db)):
    return service.get_statement_reminders(db)


@router.post("/extract-finances")
def extract_finances(db: Session = Depends(get_db)):
    try:
        return {"available": True, **service.extract_finances_to_db(db)}
    except (gc.GmailNotConfigured, gc.GmailNotConnected) as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"gmail error: {e}"}


@router.get("/spending")
def spending(days: int = 90, db: Session = Depends(get_db)):
    return service.get_spending_summary(db, days=days)


@router.get("/card-spending")
def card_spending(db: Session = Depends(get_db)):
    return service.get_card_spending(db)


@router.post("/extract-spending")
def extract_spending(db: Session = Depends(get_db)):
    try:
        return {"available": True, **service.extract_purchases_to_db(db)}
    except (gc.GmailNotConfigured, gc.GmailNotConnected) as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"gmail error: {e}"}


@router.post("/import-spending")
async def import_spending(
    file: UploadFile = File(...),
    liability_id: int | None = Form(None),
    db: Session = Depends(get_db),
):
    """Upload a bank statement/export (CSV/XLSX/PDF) -> parse transactions + balance.
    No Gmail needed — this is a local file."""
    blob = await file.read()
    name = Path(file.filename).name if file.filename else None
    try:
        return {"available": True, **service.import_transactions_to_db(db, name, blob, liability_id)}
    except file_import.UnsupportedFile as e:
        return {"available": False, "reason": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"import error: {e}"}


@router.get("/brief")
def brief(db: Session = Depends(get_db)):
    return service.get_brief(db)


@router.post("/brief/refresh")
def brief_refresh(db: Session = Depends(get_db)):
    return service.generate_brief(db, force=True)


# ---- priority rules ----
class RuleIn(BaseModel):
    kind: str       # sender | keyword
    value: str
    weight: int = 25


@router.get("/rules")
def list_rules(db: Session = Depends(get_db)):
    return service.list_rules(db)


@router.post("/rules")
def add_rule(rule: RuleIn, db: Session = Depends(get_db)):
    return service.add_rule(db, rule.kind, rule.value, rule.weight)


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    return service.delete_rule(db, rule_id)
