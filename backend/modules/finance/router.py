"""Finance module — personal CFO.

Tracks four entity types:
  - Transactions   : one-off cash flows (existing)
  - IncomeSource   : recurring paychecks / side income with frequency
  - Asset          : balances and holdings (cash, stocks, crypto, retirement, …)
  - Liability      : debts with APR + minimum payment

GET /overview computes net worth, monthly income/expense, and the next paycheck.
"""
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.core.db import get_db
from .models import Transaction, IncomeSource, Asset, Liability
from .schemas import (
    TxnCreate, TxnOut, FinanceSummary,
    IncomeCreate, IncomeUpdate, IncomeOut, IncomeProjection,
    AssetCreate, AssetUpdate, AssetOut,
    LiabilityCreate, LiabilityUpdate, LiabilityOut,
    FinanceOverview, CategoryTotal,
)

router = APIRouter()


# ---------- Transactions ----------
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
    return _txn_summary(db)


def _txn_summary(db: Session) -> FinanceSummary:
    # Personal cash-flow rollup: exclude brokerage-synced transactions (e.g. a
    # stock buy isn't "spending" — the position is already counted as an asset).
    manual = Transaction.source != "robinhood"
    income = db.query(func.coalesce(func.sum(Transaction.amount), 0.0)).filter(manual, Transaction.amount > 0).scalar() or 0.0
    expenses = db.query(func.coalesce(func.sum(Transaction.amount), 0.0)).filter(manual, Transaction.amount < 0).scalar() or 0.0
    count = db.query(func.count(Transaction.id)).filter(manual).scalar() or 0
    return FinanceSummary(income=float(income), expenses=float(expenses), net=float(income + expenses), count=int(count))


# ---------- Income sources ----------
@router.get("/income", response_model=list[IncomeOut])
def list_income(db: Session = Depends(get_db)):
    return db.query(IncomeSource).order_by(IncomeSource.active.desc(), IncomeSource.created_at.asc()).all()


@router.post("/income", response_model=IncomeOut)
def create_income(payload: IncomeCreate, db: Session = Depends(get_db)):
    s = IncomeSource(**payload.model_dump())
    db.add(s); db.commit(); db.refresh(s)
    return s


@router.patch("/income/{source_id}", response_model=IncomeOut)
def update_income(source_id: int, payload: IncomeUpdate, db: Session = Depends(get_db)):
    s = db.get(IncomeSource, source_id)
    if not s:
        raise HTTPException(404, "income source not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit(); db.refresh(s)
    return s


@router.delete("/income/{source_id}")
def delete_income(source_id: int, db: Session = Depends(get_db)):
    s = db.get(IncomeSource, source_id)
    if not s:
        raise HTTPException(404, "income source not found")
    db.delete(s); db.commit()
    return {"ok": True}


# ---------- Assets ----------
@router.get("/assets", response_model=list[AssetOut])
def list_assets(category: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Asset)
    if category:
        q = q.filter(Asset.category == category)
    return q.order_by(Asset.category.asc(), Asset.value.desc()).all()


@router.post("/assets", response_model=AssetOut)
def create_asset(payload: AssetCreate, db: Session = Depends(get_db)):
    a = Asset(**payload.model_dump())
    db.add(a); db.commit(); db.refresh(a)
    return a


@router.patch("/assets/{asset_id}", response_model=AssetOut)
def update_asset(asset_id: int, payload: AssetUpdate, db: Session = Depends(get_db)):
    a = db.get(Asset, asset_id)
    if not a:
        raise HTTPException(404, "asset not found")
    data = payload.model_dump(exclude_unset=True)
    if data:
        for k, v in data.items():
            setattr(a, k, v)
        a.last_updated = datetime.utcnow()
        db.commit(); db.refresh(a)
    return a


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db)):
    a = db.get(Asset, asset_id)
    if not a:
        raise HTTPException(404, "asset not found")
    db.delete(a); db.commit()
    return {"ok": True}


# ---------- Liabilities ----------
@router.get("/liabilities", response_model=list[LiabilityOut])
def list_liabilities(db: Session = Depends(get_db)):
    return db.query(Liability).order_by(Liability.category.asc(), Liability.balance.desc()).all()


@router.post("/liabilities", response_model=LiabilityOut)
def create_liability(payload: LiabilityCreate, db: Session = Depends(get_db)):
    l = Liability(**payload.model_dump())
    db.add(l); db.commit(); db.refresh(l)
    return l


@router.patch("/liabilities/{liab_id}", response_model=LiabilityOut)
def update_liability(liab_id: int, payload: LiabilityUpdate, db: Session = Depends(get_db)):
    l = db.get(Liability, liab_id)
    if not l:
        raise HTTPException(404, "liability not found")
    data = payload.model_dump(exclude_unset=True)
    if data:
        for k, v in data.items():
            setattr(l, k, v)
        l.last_updated = datetime.utcnow()
        db.commit(); db.refresh(l)
    return l


@router.delete("/liabilities/{liab_id}")
def delete_liability(liab_id: int, db: Session = Depends(get_db)):
    l = db.get(Liability, liab_id)
    if not l:
        raise HTTPException(404, "liability not found")
    db.delete(l); db.commit()
    return {"ok": True}


# ---------- Overview ----------
_FREQ_PER_MONTH = {
    "weekly": 52 / 12,
    "biweekly": 26 / 12,
    "semimonthly": 2,
    "monthly": 1,
    "annual": 1 / 12,
    "irregular": 1,  # treat as monthly equivalent — let user override via notes
}


def _net_rate(annual_gross: float) -> float:
    """Rough combined federal + CA state + FICA take-home rate, progressive.
    CA-leaning (highest-tax state) — better than a flat 75% for high earners."""
    if annual_gross <= 50_000:
        return 0.85
    if annual_gross <= 100_000:
        return 0.75
    if annual_gross <= 200_000:
        return 0.67   # e.g. $164k CA single ≈ $9.2k/mo net
    if annual_gross <= 400_000:
        return 0.60
    return 0.55


def _project_next_pay(src: IncomeSource) -> tuple[date | None, float | None, int | None]:
    """Return (next_pay_date, amount, days_until). Rolls forward the stored date
    if it's already in the past, based on the source's frequency."""
    if not src.active or src.next_pay_date is None:
        return (src.next_pay_date, src.amount if src.active else None, None)

    today = date.today()
    pay = src.next_pay_date
    delta_days = {"weekly": 7, "biweekly": 14}.get(src.frequency)
    if delta_days:
        while pay < today:
            pay = pay + timedelta(days=delta_days)
    elif src.frequency in ("semimonthly",):
        # If past, jump to the 15th or last day of the current/next month — coarse approximation.
        while pay < today:
            pay = pay + timedelta(days=15)
    elif src.frequency == "monthly":
        while pay < today:
            y = pay.year + (1 if pay.month == 12 else 0)
            m = 1 if pay.month == 12 else pay.month + 1
            try:
                pay = pay.replace(year=y, month=m)
            except ValueError:
                pay = pay.replace(year=y, month=m, day=28)
    elif src.frequency == "annual":
        while pay < today:
            try:
                pay = pay.replace(year=pay.year + 1)
            except ValueError:
                pay = pay.replace(year=pay.year + 1, day=28)

    return (pay, src.amount, (pay - today).days)


@router.get("/overview", response_model=FinanceOverview)
def overview(db: Session = Depends(get_db)):
    assets = db.query(Asset).all()
    liabilities = db.query(Liability).all()
    income_sources = db.query(IncomeSource).filter(IncomeSource.active == True).all()  # noqa: E712

    assets_total = sum(a.value or 0 for a in assets)
    liab_total = sum(l.balance or 0 for l in liabilities)
    cash_total = sum(a.value or 0 for a in assets if a.category == "cash")
    investments_total = sum(a.value or 0 for a in assets if a.category in ("stocks", "crypto", "retirement"))
    min_pay = sum((l.minimum_payment or 0) for l in liabilities)

    # category breakdowns
    abreak: dict[str, float] = {}
    for a in assets:
        abreak[a.category] = abreak.get(a.category, 0.0) + (a.value or 0)
    lbreak: dict[str, float] = {}
    for l in liabilities:
        lbreak[l.category] = lbreak.get(l.category, 0.0) + (l.balance or 0)

    # income projection
    monthly_gross = 0.0
    soonest_pay: date | None = None
    soonest_amount: float | None = None
    soonest_days: int | None = None
    for src in income_sources:
        per_month_count = _FREQ_PER_MONTH.get(src.frequency, 1)
        monthly_gross += (src.amount or 0) * per_month_count
        pay_date, amount, days = _project_next_pay(src)
        if pay_date and days is not None:
            if soonest_days is None or days < soonest_days:
                soonest_pay, soonest_amount, soonest_days = pay_date, amount, days
    # net = progressive CA-aware take-home of gross, unless the source is already net
    estimated_net = 0.0
    for src in income_sources:
        monthly = (src.amount or 0) * _FREQ_PER_MONTH.get(src.frequency, 1)
        estimated_net += monthly if not src.is_gross else monthly * _net_rate(monthly * 12)

    # monthly expense from last 30 days of transactions (absolute value)
    cutoff = datetime.utcnow() - timedelta(days=30)
    expenses_30d = db.query(func.coalesce(func.sum(Transaction.amount), 0.0)).filter(
        Transaction.source != "robinhood",
        Transaction.amount < 0,
        Transaction.occurred_at >= cutoff,
    ).scalar() or 0.0
    monthly_expenses = abs(float(expenses_30d))

    return FinanceOverview(
        net_worth=float(assets_total - liab_total),
        assets_total=float(assets_total),
        liabilities_total=float(liab_total),
        cash_total=float(cash_total),
        investments_total=float(investments_total),
        debt_minimum_payment_total=float(min_pay),
        asset_breakdown=[CategoryTotal(category=k, value=v) for k, v in sorted(abreak.items())],
        liability_breakdown=[CategoryTotal(category=k, value=v) for k, v in sorted(lbreak.items())],
        income=IncomeProjection(
            monthly_gross=float(monthly_gross),
            monthly_net=float(estimated_net),
            next_pay_date=soonest_pay,
            next_pay_amount=soonest_amount,
            days_to_next_pay=soonest_days,
        ),
        monthly_expenses=float(monthly_expenses),
        monthly_savings_est=float(estimated_net - monthly_expenses),
        transaction_summary=_txn_summary(db),
    )
