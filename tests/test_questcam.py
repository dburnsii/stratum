"""The Quest camera test page (/questcam) loads, opens a camera, measures
frames and runs the tag detector without errors (fake camera here)."""


def test_questcam_page_opens_a_camera(playwright, live_server):
    browser = playwright.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{live_server}/questcam")
    page.click("#cam")
    page.wait_for_function("document.getElementById('log').textContent.includes('camera(s)')", timeout=8000)
    page.wait_for_function("!document.getElementById('enter').disabled")
    page.wait_for_function("document.getElementById('log').textContent.includes('camera frames/s')", timeout=8000)
    text = page.text_content("#log")
    assert "camera failed" not in text, text
    assert errors == [], errors
    browser.close()
