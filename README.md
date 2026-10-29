# QR Screen Stream & Remote Control

Complete end-to-end screen streaming and remote control system driven by session QR tokens.

## Architecture

- **Session Server (`server.js`)**: Node.js + Express + `ws` WebSocket relay handling bidirectional frame streaming and input forwarding.
- **QR Generator (`generate_qr.py`)**: Standalone Python utility generating session token, `session_qr.png`, and instant ASCII QR code in terminal.
- **Web Client (`public/client.html`)**: In-browser client loaded when QR is scanned (`/qr/:token`). Captures screen via `navigator.mediaDevices.getDisplayMedia`, pumps throttled JPEG frames, and displays interactive cursor ripples for remote actions.
- **Viewer Console (`public/viewer.html`)**: Operator HUD (`/viewer`). Displays live stream canvas, monitors latency/FPS, generates new session QRs, and forwards mouse moves, clicks, and keyboard strokes.
- **Native OS Agent (`native_agent.py`)**: Optional Python desktop agent utilizing `pyautogui` for full OS-level mouse and keyboard event execution.

## Quick Start

### 1. Launch Server
```bash
node server.js
```
Server runs on `http://localhost:8088`. Open `http://localhost:8088/viewer` in your browser.

### 2. Generate Session QR
In the Viewer dashboard click **"New QR"**, or generate via CLI:
```bash
python generate_qr.py localhost:8088
```

### 3. Connect Controlled Target
- **Option A (Web Browser, zero-install)**: Scan the QR code or open `http://localhost:8088/qr/<token>` on the target device, then tap **"Start Screen Share"**.
- **Option B (Native OS Agent, full control)**:
  ```bash
  python native_agent.py <token> localhost:8088
  ```
