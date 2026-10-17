"""Reference links come from a local JSON file and must only open as web pages."""

from __future__ import annotations

import logging

import asl_desktop.services.external_links as links_module
import pytest
from asl_desktop.services.external_links import open_web_link


@pytest.fixture
def opened(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(links_module.webbrowser, "open", lambda url: calls.append(url) or True)
    return calls


@pytest.mark.parametrize(
    "url",
    ["https://www.youtube.com/watch?v=abc", "http://example.com/sign"],
)
def test_web_urls_are_opened(opened, url):
    assert open_web_link(url) is True
    assert opened == [url]


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "FILE:///Applications/Calculator.app",
        "vscode://settings",
        "javascript:alert(1)",
        "ftp://example.com/x",
        "/Applications/Calculator.app",
        "not a url",
        "",
    ],
)
def test_other_schemes_are_refused_and_logged(opened, caplog, url):
    with caplog.at_level(logging.WARNING):
        assert open_web_link(url) is False

    assert opened == []
    if url:
        assert any(record.levelno == logging.WARNING for record in caplog.records)
