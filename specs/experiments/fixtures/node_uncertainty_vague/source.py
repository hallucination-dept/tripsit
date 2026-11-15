def parse_quantity(text: str) -> int:
    return int(text)


def line_total(unit_price: float, quantity_text: str) -> float:
    return unit_price * parse_quantity(quantity_text)


def format_total(total: float) -> str:
    return f"Total: {total:.2f}"
