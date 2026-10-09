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
]
PAGES += [
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


class StatisticsCustomization(unittest.TestCase):
    def test_all_guides_and_form_lifecycle(self):
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
                errors, requests = [], []
                page.on(
                    "pageerror", lambda error, errors=errors: errors.append(str(error))
                )
                page.on(
                    "request",
                    lambda req, requests=requests: requests.append(
                        req.url + (req.post_data or "")
                    ),
                )
                for route in PAGES:
                    page.goto(BASE + "/statistics/en/" + route)
                    page.locator("#placeholder-form").wait_for(state="attached")
                    page.locator(".ph-form-wrapper > summary").click()
                    page.get_by_role(
                        "button", name="Reset shared values", exact=True
                    ).click()
                    for name in DISCOVERED:
                        assert page.locator("#ph-" + name).input_value() == ""
                        assert (
                            "Leave blank"
                            in page.locator("#ph-hint-" + name).inner_text()
                        )
                    excluded = page.locator(
                        '[data-personalize="off"]'
                    ).all_text_contents()
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
                            if not block.locator("pre code").count():
                                continue
                            code = block.locator("pre code").text_content()
                            if block.get_attribute("data-xcsh-render") != "script":
                                for name in values:
                                    assert "<" + name + ">" not in code, (route, name)
                            button = block.locator("button[data-code]").first
                            button.click()
                            assert (
                                page.evaluate("navigator.clipboard.readText()") == code
                            ), route
                            assert (
                                button.get_attribute("data-code").replace(
                                    chr(127), "\n"
                                )
                                == code
                            )
                            kind = block.get_attribute("data-xcsh-context")
                            if kind == "json":
                                raw = button.get_attribute(
                                    "data-code-template"
                                ).replace(chr(127), "\n")
                                expected = re.sub(
                                    r"<(XCSH_[A-Z0-9_]+)>",
                                    lambda m, values=values: json.dumps(values[m[1]])[
                                        1:-1
                                    ],
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
                                assert Path(pending.value.path()).read_text() == code
                        assert (
                            page.locator('[data-personalize="off"]').all_text_contents()
                            == excluded
                        )
                    page.screenshot(
                        path=str(
                            artifacts
                            / (
                                str(width)
                                + "-"
                                + (route.replace("/", "-") or "overview")
                                + ".png"
                            )
                        )
                    )
                    for name in DISCOVERED:
                        page.locator("#ph-" + name).fill("")
                    for block in page.locator("[data-xcsh-fields]").all():
                        if block.get_attribute("data-xcsh-render") == "script":
                            continue
                        code = block.locator("pre code").text_content()
                        for name in (
                            block.get_attribute("data-xcsh-fields") or ""
                        ).split():
                            if name in DISCOVERED:
                                assert "<" + name + ">" in code, (route, name)
                    page.get_by_role(
                        "button", name="Reset shared values", exact=True
                    ).click()
                    page.get_by_role(
                        "button", name="Clear credentials", exact=True
                    ).click()
                    assert page.locator("pre code").all_text_contents() == templates, (
                        route
                    )
                    assert (
                        page.locator("#ph-XCSH_API_TOKEN").get_attribute("type")
                        == "password"
                    )
                    page.get_by_role(
                        "button", name="Clear credentials", exact=True
                    ).click()
                    page.locator("#ph-XCSH_VIRTUAL_HOST").fill("FORM_SENTINEL_RELOAD")
                    page.reload()
                    assert (
                        page.locator("#ph-XCSH_VIRTUAL_HOST").input_value()
                        == "FORM_SENTINEL_RELOAD"
                    )
                    page.goto(BASE + "/statistics/en/security-events/")
                    assert (
                        page.locator("#ph-XCSH_VIRTUAL_HOST").input_value()
                        == "FORM_SENTINEL_RELOAD"
                    )
                    assert (
                        "FORM_SENTINEL_RELOAD"
                        in page.locator('[data-xcsh-context="json"]').first.inner_text()
                    )
                for asset in [
                    "llms-full.txt",
                    "llms.txt",
                    "assets/scripts/get-stats.sh",
                    "assets/scripts/simple-stats.sh",
                ]:
                    body = context.request.get(BASE + "/statistics/" + asset).text()
                    assert "FORM_SENTINEL" not in body
                assert all("FORM_SENTINEL" not in request for request in requests), (
                    requests
                )
                assert not errors, errors
                context.close()
            browser.close()


if __name__ == "__main__":
    unittest.main()
