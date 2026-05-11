from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from backend.core.db import get_db
from .models import Transaction
from .schemas import TxnCreate, TxnOut, FinanceSummary

router = APIRouter()


@router.get("", response_model=list[TxnOut])
def list_txns(limit: int = 100, db: Session = Depends(get_db)):
    return db.query(Transaction).order_by(Transaction.occurred_at.desc()).limit(limit).all()


@router.post("", response_model=TxnOut)
def create_txn(payload: TxnCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    if data.get("occurred_at") is None:
        data["occurred_at"] = datetime.utcnow()
    t = Transaction(**data)
    db.add(t); db.commit(); db.refresh(t)
    return t


@router.delete("/{txn_id}")
def delete_txn(txn_id: int, db: Session = Depends(get_db)):
    t = db.get(Transaction, txn_id)
    if not t:
        raise HTTPException(404, "transaction not found")
    db.delete(t); db.commit()
    return {"ok": True}


@router.get("/summary", response_model=FinanceSummary)
def summary(db: Session = Depends(get_db)):
    income = db.query(func.coalesce(func.sum(Transaction.amount), 0.0)).filter(Transaction.amount > 0).scalar() or 0.0
    expenses = db.query(func.coalesce(func.sum(Transaction.amount), 0.0)).filter(Transaction.amount < 0).scalar() or 0.0
    count = db.query(func.count(Transaction.id)).scalar() or 0
    return FinanceSummary(income=float(income), expenses=float(expenses), net=float(income + expenses), count=int(count))
