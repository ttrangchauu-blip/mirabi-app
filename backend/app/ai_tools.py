"""Allowlisted tool registry. Only Python callables registered in source can run."""
from collections.abc import Callable
from typing import Any


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Callable[..., Any]] = {}

    def register(self, name: str, handler: Callable[..., Any]) -> None:
        if not name or name in self._tools:
            raise ValueError("tool_name_invalid_or_duplicate")
        self._tools[name] = handler

    def execute(self, name: str, arguments: dict[str, Any]) -> Any:
        handler = self._tools.get(name)
        if handler is None:
            raise ValueError("tool_not_registered")
        return handler(**arguments)

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._tools))


tools = ToolRegistry()
