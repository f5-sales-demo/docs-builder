#!/usr/bin/env python3
"""Accept the built shared form through real browser inputs and clipboard."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import ClassVar

from playwright.sync_api import Browser, Playwright, sync_playwright

BASE = os.environ.get("PERSONALIZATION_URL", "http://127.0.0.1:18765")
ARTIFACTS = Path(
    os.environ.get(
        "PERSONALIZATION_ARTIFACTS", tempfile.mkdtemp(prefix="f5-form-acceptance-")
    )
)
CONSUMERS = [
    "statistics",
    "csd",
    "dns",
    "ddos",
    "webapp-api-protection",
    "traffic-generator",
    "demo-resource-template",
]


class BrowserAcceptance(unittest.TestCase):
    playwright: ClassVar[Playwright]
    browser: ClassVar[Browser]

    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path="/usr/bin/google-chrome", headless=True
        )
        ARTIFACTS.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(
            permissions=["clipboard-read", "clipboard-write"]
        )
        self.page = self.context.new_page()
        self.errors: list[str] = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()

    def visit(self, repo, path=""):
        self.page.goto(BASE + "/" + repo + "/en/" + path)
        self.page.locator("#placeholder-form").wait_for(state="attached")
        self.page.locator("summary").filter(has_text="Customize examples").click()

    def test_desktop_mobile_all_forms_and_no_form(self):
        for repo in CONSUMERS:
            for width, height in [(1440, 1000), (390, 844)]:
                with self.subTest(repo=repo, width=width):
                    self.page.set_viewport_size({"width": width, "height": height})
                    self.visit(repo)
                    fields = self.page.locator(
                        "#placeholder-form input,#placeholder-form select"
                    )
                    assert fields.count() > 0
                    assert self.page.evaluate(
                        "document.documentElement.scrollWidth <= innerWidth+1"
                    )
                    self.page.screenshot(
                        path=str(ARTIFACTS / (repo + "-" + str(width) + ".png"))
                    )
                    self.page.locator("#placeholder-form button").first.focus()
                    assert self.page.locator("#placeholder-form button").first.evaluate(
                        "(e)=>e===document.activeElement"
                    )
                    assert not self.errors, self.errors
        self.page.goto(BASE + "/docs-builder/en/")
        assert self.page.locator("#placeholder-form").count() == 0

    def test_clipboard_shell_quotes_and_discovery(self):
        self.visit("statistics")
        sentinel = ARTIFACTS / "never-execute"
        value = f'O\'Brien; $(touch {sentinel}) `id` "quoted"'
        self.page.locator("#ph-XCSH_NAMESPACE").fill(value)
        self.page.locator("#ph-XCSH_API_TOKEN").fill("SECRET_SENTINEL")
        block = self.page.locator("[data-xcsh-fields]").first
        block.locator("button[data-code]").click()
        copied = self.page.evaluate("navigator.clipboard.readText()")
        assert copied == block.locator("pre code").text_content()
        assert "$(date -u +%s)" in copied
        assert "$((XCSH_END_TIME - 7200))" in copied
        assert "SECRET_SENTINEL" not in self.page.evaluate(
            "JSON.stringify(localStorage)"
        )
        assert "SECRET_SENTINEL" in self.page.evaluate("JSON.stringify(sessionStorage)")
        assert (
            self.page.locator("#ph-XCSH_API_TOKEN").get_attribute("type") == "password"
        )
        # Execute exports only; metacharacters must be transported as literal data.
        exports = copied.split("\n\n", 1)[0]
        # Fixed test-owned exports are executed to prove shell quoting.
        result = subprocess.run(  # noqa: S603
            [
                "/usr/bin/bash",
                "-c",
                exports
                + "\npython3 -c 'import os,json; print(json.dumps(os.environ[\"XCSH_NAMESPACE\"]))'",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        assert json.loads(result.stdout) == value
        assert not sentinel.exists()

    def test_navigation_tabs_reset_and_credential_lifetime(self):
        self.visit("statistics")
        self.page.locator("#ph-XCSH_NAMESPACE").fill("reader-app")
        self.page.locator("#ph-XCSH_API_TOKEN").fill("SECRET_SENTINEL")
        self.visit("csd")
        assert self.page.locator("#ph-XCSH_NAMESPACE").input_value() == "reader-app"
        assert (
            self.page.locator("#ph-XCSH_API_TOKEN").input_value() == "SECRET_SENTINEL"
        )
        tab = self.context.new_page()
        tab.goto(BASE + "/statistics/en/")
        tab.locator("#placeholder-form").wait_for(state="attached")
        # A new independent tab does not inherit the session.
        assert tab.locator("#ph-XCSH_API_TOKEN").input_value() == "<XCSH_API_TOKEN>"
        self.page.locator("#ph-XCSH_NAMESPACE").fill("updated-app")
        tab.wait_for_function(
            'document.querySelector("#ph-XCSH_NAMESPACE").value==="updated-app"'
        )
        self.page.get_by_role("button", name="Reset shared values", exact=True).click()
        tab.wait_for_function(
            'document.querySelector("#ph-XCSH_NAMESPACE").value==="demo-app"'
        )
        assert (
            self.page.locator("#ph-XCSH_API_TOKEN").input_value() == "SECRET_SENTINEL"
        )
        self.page.get_by_role("button", name="Clear credentials", exact=True).click()
        assert (
            self.page.locator("#ph-XCSH_API_TOKEN").input_value() == "<XCSH_API_TOKEN>"
        )

    def test_historical_evidence_and_download_bytes(self):
        self.visit("statistics", "setup/")
        before = self.page.locator('[data-personalize="off"]').all_text_contents()
        self.page.locator("#ph-XCSH_NAMESPACE").fill("reader-app")
        assert (
            self.page.locator('[data-personalize="off"]').all_text_contents() == before
        )
        first = self.context.request.get(
            BASE + "/statistics/assets/scripts/get-stats.sh"
        ).body()
        self.page.locator("#ph-XCSH_API_TOKEN").fill("SECRET_SENTINEL")
        second = self.context.request.get(
            BASE + "/statistics/assets/scripts/get-stats.sh"
        ).body()
        assert first == second
        assert b"SECRET_SENTINEL" not in second
        machine = self.context.request.get(BASE + "/statistics/llms-full.txt").body()
        assert b"SECRET_SENTINEL" not in machine
        assert b"reader-app" not in machine

    def test_values_do_not_reach_network(self):
        self.visit("statistics")
        requests = []
        self.page.on(
            "request",
            lambda request: requests.append(
                request.url + " " + (request.post_data or "")
            ),
        )
        self.page.locator("#ph-XCSH_NAMESPACE").fill("NETWORK_SENTINEL")
        self.page.locator("#ph-XCSH_API_TOKEN").fill("SECRET_SENTINEL")
        self.page.wait_for_timeout(200)
        assert all(
            "NETWORK_SENTINEL" not in r and "SECRET_SENTINEL" not in r for r in requests
        )

    def test_structured_clipboard_and_diagram_labels(self):
        self.visit("statistics", "deployment/")
        value = 'O\'Brien "quoted" \\\\ path ${literal}'
        self.page.locator("#ph-XCSH_NAMESPACE").fill(value)
        block = self.page.locator('[data-xcsh-context="hcl"]')
        block.locator("button[data-code]").click()
        copied = self.page.evaluate("navigator.clipboard.readText()")
        assert copied == block.locator("pre code").text_content()
        assert "$${literal}" in copied
        assert chr(92) + '"quoted' in copied
        self.visit("ddos", "overview/")
        self.page.locator("#ph-XCSH_DC_NAME").fill("Reader Datacenter")
        self.page.wait_for_function(
            'Array.from(document.querySelectorAll(".mermaid-container svg")).some(e => e.textContent.includes("Reader Datacenter"))'
        )
        self.page.locator("#ph-XCSH_DC_NAME").fill(
            "Reader <img src=x onerror=alert(1)>"
        )
        self.page.wait_for_timeout(300)
        assert self.page.locator(".mermaid-container img").count() == 0

    def test_split_highlighted_markers_and_json_clipboard(self):
        self.visit("statistics")
        self.page.evaluate(
            "() => {\n const wrapper=document.createElement('div');\n wrapper.dataset.xcshContext='json';\n const expressive=document.createElement('div');\n expressive.className='expressive-code';\n const pre=document.createElement('pre'); pre.dataset.language='json';\n const code=document.createElement('code');\n code.append(document.createTextNode('{\"namespace\":\"'));\n for (const part of ['<','XCSH_NAMESPACE','>']) {\n  const span=document.createElement('span'); span.textContent=part; code.append(span);\n }\n code.append(document.createTextNode('\"}')); pre.append(code);\n const button=document.createElement('button');\n button.setAttribute('data-code','{\"namespace\":\"<XCSH_NAMESPACE>\"}');\n button.textContent='Copy fixture';\n expressive.append(pre,button); wrapper.append(expressive);\n document.querySelector('.sl-markdown-content').append(wrapper);\n}"
        )
        value = 'Reader "quote" \\ path'
        self.page.locator("#ph-XCSH_NAMESPACE").fill(value)
        code = self.page.locator('[data-xcsh-context="json"] pre code').last
        assert json.loads(code.text_content())["namespace"] == value
        button = self.page.locator('[data-xcsh-context="json"] button[data-code]').last
        assert json.loads(button.get_attribute("data-code"))["namespace"] == value

    def test_statistics_origin_and_all_inline_clipboards(self):
        for width, height in [(1440, 1000), (390, 844)]:
            self.page.set_viewport_size({"width": width, "height": height})
            for path in [
                "origin-performance/",
                "setup/",
                "service-graph/",
                "access-logs/",
                "application-health/",
                "api-discovery/",
                "firewall-metrics/",
                "security-events/",
                "verification/",
                "deployment/",
                "troubleshooting/",
                "",
            ]:
                with self.subTest(width=width, path=path):
                    self.visit("statistics", path)
                    value = 'Reader O\'Brien "quote" \\ $HOME $(id) `id`'
                    self.page.locator("#ph-XCSH_NAMESPACE").fill(value)
                    for block in self.page.locator('[data-xcsh-render="inline"]').all():
                        button = block.locator("button[data-code]")
                        button.click()
                        copied = self.page.evaluate("navigator.clipboard.readText()")
                        assert copied == block.locator("pre code").text_content()
                        assert "<XCSH_NAMESPACE>" not in copied
                        # Parse only: resource commands are never executed here.
                        result = subprocess.run(
                            ["/usr/bin/bash", "-n"],
                            input=copied,
                            text=True,
                            capture_output=True,
                            check=False,
                        )
                        assert result.returncode == 0, (path, result.stderr)
                    assert not self.errors, self.errors

    def test_statistics_script_lines_clipboard_and_blob_download(self):
        for width, height in [(1440, 1000), (390, 844)]:
            self.page.set_viewport_size({"width": width, "height": height})
            self.visit("statistics", "shell-scripts/")
            for name in ["simple-stats", "get-stats"]:
                with self.subTest(width=width, name=name):
                    block = self.page.locator(
                        f'[data-xcsh-download="{name}-personalized.sh"]'
                    )
                    value = 'Reader O\'Brien "quote" \\ $HOME $(id) `id`'
                    self.page.locator("#ph-XCSH_NAMESPACE").fill(value)
                    self.page.locator("#ph-XCSH_API_TOKEN").fill("SECRET_SENTINEL")
                    block.locator("button[data-code]").click()
                    copied = self.page.evaluate("navigator.clipboard.readText()")
                    assert copied == block.locator("pre code").text_content()
                    assert copied.startswith("#!/usr/bin/env bash\nexport ")
                    assert "SECRET_SENTINEL" not in copied
                    assert "export XCSH_API_TOKEN=" not in copied
                    assert "$XCSH_VIRTUAL_HOST" in copied
                    assert "${XCSH_API_TOKEN}" in copied
                    # The source retains its exact canonical suffix, including all lines.
                    canonical = (
                        self.context.request.get(
                            BASE + f"/statistics/assets/scripts/{name}.sh"
                        )
                        .body()
                        .decode()
                    )
                    assert copied.endswith(canonical.split("\n", 1)[1])
                    assert block.locator("pre code").evaluate(
                        "(e)=>getComputedStyle(e).whiteSpace"
                    ) in ["pre", "pre-wrap", "break-spaces"]
                    with self.page.expect_download() as pending:
                        block.get_by_role(
                            "button", name="Download personalized script", exact=True
                        ).click()
                    download = pending.value
                    assert download.suggested_filename == name + "-personalized.sh"
                    assert Path(download.path()).read_text() == copied
                    result = subprocess.run(
                        ["/usr/bin/bash", "-n"],
                        input=copied,
                        text=True,
                        capture_output=True,
                        check=False,
                    )
                    assert result.returncode == 0, result.stderr
                    assert not self.errors, self.errors


if __name__ == "__main__":
    unittest.main()
