"""Exercise Statistics form identities, immutable templates and clipboard on built/public pages."""

import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("PERSONALIZATION_URL", "http://127.0.0.1:18765").rstrip("/")
PAGES = [
    "",
    "setup/",
    "security-events/",
    "origin-performance/",
    "service-graph/",
    "access-logs/",
    "application-health/",
    "api-discovery/",
    "firewall-metrics/",
    "verification/",
    "deployment/",
    "shell-scripts/",
    "troubleshooting/",
    "api-catalog/query-concepts/",
    "api-catalog/",
    "api-catalog/api-analytics/",
    "api-catalog/application-security/",
    "api-catalog/application-traffic/",
    "api-catalog/billing-usage/",
    "api-catalog/bot-defense/",
    "api-catalog/cdn/",
    "api-catalog/client-side-defense/",
    "api-catalog/ddos-protection/",
    "api-catalog/device-data-intelligence/",
    "api-catalog/dns/",
    "api-catalog/kubernetes-storage/",
    "api-catalog/logs-events-alerts/",
    "api-catalog/networking/",
    "api-catalog/synthetic-monitoring/",
]

DISCOVERED = [
    "XCSH_VIRTUAL_HOST",
    "XCSH_APP_TYPE",
    "XCSH_GRAPH_SOURCE",
    "XCSH_GRAPH_DESTINATION",
    "XCSH_API_ENDPOINT_1",
    "XCSH_API_ENDPOINT_2",
    "XCSH_API_ENDPOINT_3",
    "XCSH_ORIGIN_VM_NAME",
    "XCSH_GENERATOR_VM_NAME",
    "XCSH_ORIGIN_IP",
]
DEFAULTS = {}
if os.environ.get("STATISTICS_DEFAULTS_MANIFEST"):
    DEFAULTS = json.loads(
        Path(os.environ["STATISTICS_DEFAULTS_MANIFEST"]).read_text(encoding="utf-8")
    )["examples"]


def check_block(page, block, values: dict[str, str], route):
    """Compare displayed and copied examples and validate their language."""
    code = block.locator("pre code").text_content()
    if block.get_attribute("data-xcsh-render") != "script":
        for name, value in values.items():
            if value and value != "<" + name + ">":
                assert "<" + name + ">" not in code, (route, name)
    button = block.locator("button[data-code]").first
    button.click()
    assert page.evaluate("navigator.clipboard.readText()") == code, route
    assert button.get_attribute("data-code").replace(chr(127), "\n") == code
    kind = block.get_attribute("data-xcsh-context")
    if kind == "json":
        raw = button.get_attribute("data-code-template").replace(chr(127), "\n")

        def json_value(match: re.Match[str]) -> str:
            return json.dumps(values[match[1]])[1:-1]

        expected = re.sub(
            r"<(XCSH_[A-Z0-9_]+)>",
            json_value,
            raw,
        )
        assert json.loads(code) == json.loads(expected), route
    if kind == "shell":
        result = subprocess.run(
            ["/usr/bin/bash", "-n"],
            input=code,
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, (route, result.stderr)
    if block.get_attribute("data-xcsh-render") == "script":
        if values["XCSH_API_TOKEN"]:
            assert values["XCSH_API_TOKEN"] not in code
        assert "export XCSH_API_TOKEN=" not in code
        for name in DISCOVERED:
            assert "export " + name + "=" not in code
        with page.expect_download() as pending:
            block.get_by_role(
                "button",
                name="Download personalized script",
                exact=True,
            ).click()
        assert Path(pending.value.path()).read_text(encoding="utf-8") == code


def check_lifecycle(page, route, templates):
    """Verify clearing, reset, reload and navigation preserve template behavior."""
    for name in DISCOVERED:
        page.locator("#ph-" + name).fill("")
        if DEFAULTS:
            assert page.locator("#ph-" + name).input_value() == ""
            for block in page.locator("[data-xcsh-fields]").all():
                if block.get_attribute("data-xcsh-render") == "script":
                    continue
                code = block.locator("pre code").text_content()
                raw = block.locator("button[data-code-template]").first.get_attribute(
                    "data-code-template"
                )
                if "<" + name + ">" in raw:
                    assert DEFAULTS[name] in code, (route, name)
            page.locator("#ph-" + name).blur()
            assert page.locator("#ph-" + name).input_value() == DEFAULTS[name]
    for block in page.locator("[data-xcsh-fields]").all():
        if block.get_attribute("data-xcsh-render") == "script":
            continue
        code = block.locator("pre code").text_content()
        for name in (block.get_attribute("data-xcsh-fields") or "").split():
            if name in DISCOVERED and not DEFAULTS:
                assert "<" + name + ">" in code, (route, name)
    page.get_by_role("button", name="Reset shared values", exact=True).click()
    page.get_by_role("button", name="Clear credentials", exact=True).click()
    assert page.locator("pre code").all_text_contents() == templates, route
    assert page.locator("#ph-XCSH_API_TOKEN").get_attribute("type") == "password"
    page.get_by_role("button", name="Clear credentials", exact=True).click()
    page.locator("#ph-XCSH_VIRTUAL_HOST").fill("FORM_SENTINEL_RELOAD")
    page.reload()
    assert page.locator("#ph-XCSH_VIRTUAL_HOST").input_value() == "FORM_SENTINEL_RELOAD"
    page.goto(BASE + "/statistics/en/security-events/")
    assert page.locator("#ph-XCSH_VIRTUAL_HOST").input_value() == "FORM_SENTINEL_RELOAD"
    assert (
        "FORM_SENTINEL_RELOAD"
        in page.locator('[data-xcsh-context="json"]').first.inner_text()
    )


def check_page(page, route, artifacts, width):
    """Edit every field twice while preserving recorded measurements."""
    page.goto(BASE + "/statistics/en/" + route)
    page.locator("#placeholder-form").wait_for(state="attached")
    page.locator(".ph-form-wrapper > summary").click()
    page.get_by_role("button", name="Reset shared values", exact=True).click()
    page.get_by_role("button", name="Clear credentials", exact=True).click()
    for name in DISCOVERED:
        assert page.locator("#ph-" + name).input_value() == DEFAULTS.get(name, "")
        assert ("illustrative default" if DEFAULTS else "Leave blank") in page.locator(
            "#ph-hint-" + name
        ).inner_text()
    if DEFAULTS:
        assert page.locator("#ph-XCSH_API_TOKEN").input_value() == ""
        assert (
            page.locator("#ph-XCSH_AZURE_SUBSCRIPTION_ID").input_value()
            == "<XCSH_AZURE_SUBSCRIPTION_ID>"
        )
        initial = page.locator("pre code").all_text_contents()
        page.evaluate("""() => localStorage.setItem('f5-docs-values-v1', JSON.stringify({version: 1, values: Object.fromEntries(
            [...document.querySelectorAll('#placeholder-form input')].filter(e => e.type !== 'password').map(e => [e.id.slice(3), '']))}))""")
        page.reload()
        page.locator("#placeholder-form").wait_for(state="attached")
        assert page.locator("pre code").all_text_contents() == initial
        page.locator(".ph-form-wrapper > summary").click()
        values = {
            field.get_attribute("id").removeprefix("ph-"): field.input_value()
            for field in page.locator("#placeholder-form input").all()
        }
        for block in page.locator("[data-xcsh-context]").all():
            if block.locator("pre code").count():
                check_block(page, block, values, route)
        if not route:
            setup = page.locator(
                '[data-xcsh-render="inline"] pre code'
            ).first.text_content()
            assert 'export XCSH_API_TOKEN="$XCSH_API_TOKEN"' in setup
            env = {**os.environ, "XCSH_API_TOKEN": "mock environment token $HOME"}
            # Execute the repository-owned setup template with a synthetic environment token.
            result = subprocess.run(
                ["/usr/bin/bash", "-c", setup + '\nprintf %s "$XCSH_API_TOKEN"'],
                env=env,
                text=True,
                capture_output=True,
                check=True,
            )  # noqa: S603
            assert result.stdout == env["XCSH_API_TOKEN"]
        page.locator("#ph-XCSH_LB_NAME").fill("FORM_SENTINEL_INDEPENDENT")
        assert (
            page.locator("#ph-XCSH_VIRTUAL_HOST").input_value()
            == DEFAULTS["XCSH_VIRTUAL_HOST"]
        )
        page.get_by_role("button", name="Reset shared values", exact=True).click()
    excluded = page.locator('[data-personalize="off"]').all_text_contents()
    templates = page.locator("pre code").all_text_contents()
    for iteration in range(2):
        values = {}
        for field in page.locator("#placeholder-form input").all():
            name = field.get_attribute("id").removeprefix("ph-")
            value = (
                f"FORM_SENTINEL_{iteration}_"
                + name
                + ' O\'Brien "quote" \\ $HOME $(id) `id` <tag>\nnext'
            )
            field.fill(value)
            values[name] = field.input_value()
        for block in page.locator("[data-xcsh-context]").all():
            if block.locator("pre code").count():
                check_block(page, block, values, route)
        assert page.locator('[data-personalize="off"]').all_text_contents() == excluded
    page.screenshot(
        path=str(
            artifacts
            / (str(width) + "-" + (route.replace("/", "-") or "overview") + ".png")
        )
    )
    check_lifecycle(page, route, templates)


def observe(page, errors, requests):
    """Attach per-context browser error and request collectors."""

    def record_error(error):
        errors.append(str(error))

    def record_request(request):
        requests.append(request.url + (request.post_data or ""))

    page.on("pageerror", record_error)
    page.on("request", record_request)


class StatisticsCustomization(unittest.TestCase):
    """Accept each Statistics guide in desktop and mobile viewports."""

    def test_all_guides_and_form_lifecycle(self):
        """Exercise forms, clipboard, scripts and network privacy."""
        artifacts = Path(
            os.environ.get("PERSONALIZATION_ARTIFACTS", tempfile.mkdtemp())
        )
        artifacts.mkdir(parents=True, exist_ok=True)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path="/usr/bin/google-chrome", headless=True
            )
            for width, height in [(1440, 1000), (390, 844)]:
                context = browser.new_context(
                    viewport={"width": width, "height": height},
                    permissions=["clipboard-read", "clipboard-write"],
                )
                page = context.new_page()
                errors: list[str] = []
                requests: list[str] = []

                observe(page, errors, requests)
                for route in PAGES:
                    check_page(page, route, artifacts, width)
                for asset in [
                    "llms-full.txt",
                    "llms.txt",
                    "assets/scripts/get-stats.sh",
                    "assets/scripts/simple-stats.sh",
                ]:
                    assert (
                        "FORM_SENTINEL"
                        not in context.request.get(BASE + "/statistics/" + asset).text()
                    )
                assert all("FORM_SENTINEL" not in request for request in requests), (
                    requests
                )
                assert not errors, errors
                context.close()
            browser.close()


if __name__ == "__main__":
    unittest.main()
