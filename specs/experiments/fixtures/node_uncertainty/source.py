from datetime import date

FREE_SHIPPING_THRESHOLD = 50.0
FLAT_SHIPPING_FEE = 4.99


def membership_days(joined: date, today: date) -> int:
    return (today - joined).days


def qualifies_for_free_shipping(order_total: float, joined: date, today: date) -> bool:
    return order_total >= FREE_SHIPPING_THRESHOLD


def shipping_cost(order_total: float, joined: date, today: date) -> float:
    if qualifies_for_free_shipping(order_total, joined, today):
        return 0.0
    return FLAT_SHIPPING_FEE


def format_receipt_line(label: str, amount: float) -> str:
    return f"{label}: ${amount:.2f}"
