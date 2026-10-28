"""Explicit context building; feature modules choose every field sent to a model."""
from typing import Any


def build_context(values: dict[str, Any], *, allowed: set[str]) -> dict[str, str]:
    unknown = set(values) - allowed
    if unknown:
        raise ValueError("context_contains_unapproved_fields")
    result: dict[str, str] = {}
    for key, value in values.items():
        if not isinstance(value, (str, int, float, bool)):
            raise ValueError("context_value_must_be_scalar")
        result[key] = str(value)[:5000]
    return result
