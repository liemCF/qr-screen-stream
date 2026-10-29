#!/usr/bin/env python3
"""
Native Companion Agent for OS-Level Remote Desktop Control
Streams host screen frames and executes inbound input events via pyautogui.
"""

import sys
import json
import time
import io
import asyncio
import websockets
from PIL import ImageGrab
import pyautogui

# Disable PyAutoGUI fail-safe pause for low-latency control
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.0

SCREEN_WIDTH, SCREEN_HEIGHT = pyautogui.size()
print(f"[Ritmada] Screen Resolution: {SCREEN_WIDTH}x{SCREEN_HEIGHT}")

async def run_agent(token: str, server_host: str = "localhost:8088"):
    uri = f"ws://{server_host}/ws"
    print(f"[Ritmada] Connecting to session relay: {uri} (Token: {token})")

    async with websockets.connect(uri) as ws:
        # Join session as native target
        await ws.send(json.dumps({
            "type": "join",
            "role": "target",
            "token": token,
            "info": {
                "userAgent": f"NativeAgent Python (Resolution: {SCREEN_WIDTH}x{SCREEN_HEIGHT})"
            }
        }))
        print("[Ritmada] Target registration sent. Starting frame loop & input receiver.")

        # Task 1: Frame Grabber & Streamer
        async def frame_streamer():
            target_fps = 15
            interval = 1.0 / target_fps
            target_res = (1280, 720)

            while True:
                start_time = time.time()
                try:
                    # Capture full screen
                    img = ImageGrab.grab()
                    if img.size != target_res:
                        img = img.resize(target_res)

                    # Encode to JPEG buffer
                    buffer = io.BytesIO()
                    img.save(buffer, format="JPEG", quality=65)
                    jpeg_bytes = buffer.getvalue()
                    import base64
                    b64 = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode('ascii')

                    payload = {
                        "type": "frame",
                        "token": token,
                        "payload": b64,
                        "width": target_res[0],
                        "height": target_res[1],
                        "timestamp": int(time.time() * 1000)
                    }
                    await ws.send(json.dumps(payload))
                except Exception as e:
                    print(f"[!] Frame capture error: {e}")

                elapsed = time.time() - start_time
                sleep_time = max(0.01, interval - elapsed)
                await asyncio.sleep(sleep_time)

        # Task 2: Input Event Receiver
        async def input_listener():
            while True:
                try:
                    msg = await ws.recv()
                    data = json.loads(msg)

                    if data.get("type") == "input":
                        event = data.get("event")
                        norm_x = data.get("x")
                        norm_y = data.get("y")

                        # Map normalized coordinates (0.0 to 1.0) to screen pixels
                        px = int(norm_x * SCREEN_WIDTH) if norm_x is not None else None
                        py = int(norm_y * SCREEN_HEIGHT) if norm_y is not None else None

                        if event == "mousemove" and px is not None and py is not None:
                            pyautogui.moveTo(px, py)
                        elif event == "mousedown":
                            btn = "left" if data.get("button", 0) == 0 else "right"
                            if px is not None and py is not None:
                                pyautogui.mouseDown(px, py, button=btn)
                        elif event == "mouseup":
                            btn = "left" if data.get("button", 0) == 0 else "right"
                            if px is not None and py is not None:
                                pyautogui.mouseUp(px, py, button=btn)
                        elif event == "click":
                            btn = "left" if data.get("button", 0) == 0 else "right"
                            if px is not None and py is not None:
                                pyautogui.click(px, py, button=btn)
                        elif event == "keydown":
                            key = data.get("key", "").lower()
                            if key in pyautogui.KEYBOARD_KEYS:
                                pyautogui.keyDown(key)
                        elif event == "keyup":
                            key = data.get("key", "").lower()
                            if key in pyautogui.KEYBOARD_KEYS:
                                pyautogui.keyUp(key)
                except Exception as e:
                    print(f"[!] Input listener error: {e}")
                    break

        await asyncio.gather(frame_streamer(), input_listener())

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python native_agent.py <session_token> [server_host:port]")
        sys.exit(1)

    tok = sys.argv[1]
    host = sys.argv[2] if len(sys.argv) > 2 else "localhost:8088"
    try:
        asyncio.run(run_agent(tok, host))
    except KeyboardInterrupt:
        print("\n[Ritmada] Native agent terminated.")
