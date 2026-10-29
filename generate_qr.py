#!/usr/bin/env python3
"""
QR Code Generator for Screen Stream & Remote Control Session
Generates session token, exports PNG, and prints terminal ASCII QR code.
"""

import sys
import secrets
import qrcode
import socket

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def get_lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def generate(token: str = None, host: str = None, output_file: str = "session_qr.png"):
    if not token:
        token = secrets.token_hex(6)

    lan_ip = get_lan_ip()
    if not host:
        host = f"https://{lan_ip}:8443"

    if not host.startswith("http://") and not host.startswith("https://"):
        url = f"https://{host}/qr/{token}"
    else:
        url = f"{host.rstrip('/')}/qr/{token}"
    
    print(f"[Ritmada] Token:    {token}")
    print(f"[Ritmada] Scan URL: {url}")

    # Generate QR Code Object
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)

    # Save to disk as PNG
    img = qr.make_image(fill_color="black", back_color="white")
    img.save(output_file)
    print(f"[Ritmada] Saved QR image to: {output_file}")

    # Render ASCII in terminal for immediate scan
    print("\n[Ritmada] Terminal QR Scan (Quét bằng điện thoại):\n")
    try:
        if sys.platform == "win32":
            sys.stdout.reconfigure(encoding='utf-8')
        qr.print_ascii(invert=True)
    except Exception:
        pass
    print("\n")
    return token, url

if __name__ == "__main__":
    host_arg = sys.argv[1] if len(sys.argv) > 1 else None
    token_arg = sys.argv[2] if len(sys.argv) > 2 else None
    generate(token=token_arg, host=host_arg)
