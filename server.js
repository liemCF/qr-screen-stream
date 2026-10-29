/**
 * QR Screen Stream & Remote Control Server
 * Protocol: Dual HTTP (8088) + HTTPS (8443) + WebSocket (Frame relay & input forwarding)
 */

const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');

const app = express();
const HTTP_PORT = process.env.HTTP_PORT || 8088;
const HTTPS_PORT = process.env.HTTPS_PORT || 8443;
const BIND_HOST = '0.0.0.0';

// Active sessions: Map<token, { target, viewers, createdAt, lastActive, targetInfo }>
const sessions = new Map();

// Discover host IPv4 network interfaces
function getNetworkInfo() {
    const interfaces = os.networkInterfaces();
    const list = [];
    let bestLanIp = null;

    for (const [name, addrs] of Object.entries(interfaces)) {
        for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal) {
                list.push({ name, ip: addr.address });
                if (!bestLanIp && /wi-fi|ethernet|wlan|eth/i.test(name)) {
                    bestLanIp = addr.address;
                }
            }
        }
    }

    if (!bestLanIp && list.length > 0) {
        // Fallback to any 192.168 or 10.x
        const std = list.find(item => item.ip.startsWith('192.168.') || item.ip.startsWith('10.'));
        bestLanIp = std ? std.ip : list[0].ip;
    }

    return {
        lanIp: bestLanIp || '127.0.0.1',
        allInterfaces: list,
        httpPort: HTTP_PORT,
        httpsPort: HTTPS_PORT
    };
}

function generateToken() {
    return crypto.randomBytes(6).toString('hex');
}

function getOrCreateSession(token) {
    if (!sessions.has(token)) {
        sessions.set(token, {
            token,
            target: null,
            viewers: new Set(),
            createdAt: Date.now(),
            lastActive: Date.now(),
            targetInfo: null
        });
    }
    return sessions.get(token);
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: Network discovery info
app.get('/api/network-info', (req, res) => {
    res.json({ ok: true, data: getNetworkInfo() });
});

// API: Create new session and return QR code data URL
app.get('/api/session/new', async (req, res) => {
    const token = req.query.token || generateToken();
    getOrCreateSession(token);

    const net = getNetworkInfo();
    let baseUrl = req.query.baseUrl;

    if (!baseUrl) {
        // If not specified, default to HTTPS with LAN IP so mobile phones can share screen
        baseUrl = `https://${net.lanIp}:${HTTPS_PORT}`;
    }

    // Strip trailing slash
    baseUrl = baseUrl.replace(/\/+$/, '');
    const shareUrl = `${baseUrl}/qr/${token}`;

    try {
        const qrDataUrl = await QRCode.toDataURL(shareUrl, {
            width: 340,
            margin: 2,
            color: { dark: '#0f172a', light: '#ffffff' }
        });
        res.json({
            ok: true,
            token,
            shareUrl,
            qrDataUrl,
            netInfo: net,
            createdAt: Date.now()
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// API: Check session status
app.get('/api/session/:token', (req, res) => {
    const session = sessions.get(req.params.token);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    res.json({
        ok: true,
        token: session.token,
        hasTarget: !!(session.target && session.target.readyState === WebSocket.OPEN),
        viewerCount: session.viewers.size,
        targetInfo: session.targetInfo
    });
});

// Routes
app.get(['/qr/:token', '/share/:token'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

app.get(['/', '/viewer', '/viewer/:token'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Shared WebSocket Protocol
function attachWebSocketLogic(wss) {
    wss.on('connection', (ws) => {
        let currentToken = null;
        let currentRole = null;

        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', (message) => {
            let data;
            try { data = JSON.parse(message); } catch (e) { return; }

            const { type, token, payload, role, info } = data;

            if (type === 'join') {
                if (!token) return;
                currentToken = token;
                currentRole = role || 'viewer';

                const session = getOrCreateSession(token);
                session.lastActive = Date.now();

                if (currentRole === 'target') {
                    if (session.target && session.target !== ws && session.target.readyState === WebSocket.OPEN) {
                        session.target.close();
                    }
                    session.target = ws;
                    session.targetInfo = info || {};

                    const notify = JSON.stringify({ type: 'status', status: 'target_connected', info: session.targetInfo });
                    for (const v of session.viewers) {
                        if (v.readyState === WebSocket.OPEN) v.send(notify);
                    }
                    ws.send(JSON.stringify({ type: 'ready', role: 'target', token }));
                } else {
                    session.viewers.add(ws);
                    const hasTarget = !!(session.target && session.target.readyState === WebSocket.OPEN);
                    ws.send(JSON.stringify({
                        type: 'status',
                        status: hasTarget ? 'target_connected' : 'waiting_for_target',
                        targetInfo: session.targetInfo
                    }));
                }
                return;
            }

            if (type === 'frame') {
                if (!currentToken) return;
                const session = sessions.get(currentToken);
                if (!session || session.target !== ws) return;

                const frameData = JSON.stringify({
                    type: 'frame',
                    payload,
                    width: data.width,
                    height: data.height,
                    timestamp: data.timestamp || Date.now()
                });

                for (const v of session.viewers) {
                    if (v.readyState === WebSocket.OPEN) v.send(frameData);
                }
                return;
            }

            if (type === 'input') {
                if (!currentToken) return;
                const session = sessions.get(currentToken);
                if (!session || !session.target) return;

                if (session.target.readyState === WebSocket.OPEN) {
                    session.target.send(JSON.stringify({
                        type: 'input',
                        event: data.event,
                        x: data.x,
                        y: data.y,
                        button: data.button,
                        key: data.key,
                        code: data.code
                    }));
                }
            }
        });

        ws.on('close', () => {
            if (!currentToken) return;
            const session = sessions.get(currentToken);
            if (!session) return;

            if (currentRole === 'target' && session.target === ws) {
                session.target = null;
                const msg = JSON.stringify({ type: 'status', status: 'target_disconnected' });
                for (const v of session.viewers) {
                    if (v.readyState === WebSocket.OPEN) v.send(msg);
                }
            } else if (currentRole === 'viewer') {
                session.viewers.delete(ws);
            }
        });
    });

    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => clearInterval(interval));
}

// Startup: initialize both HTTP and HTTPS servers
async function startServers() {
    const net = getNetworkInfo();

    // 1. HTTP Server
    const httpServer = http.createServer(app);
    const wssHttp = new WebSocketServer({ server: httpServer });
    attachWebSocketLogic(wssHttp);

    httpServer.listen(HTTP_PORT, BIND_HOST, () => {
        console.log(`[Ritmada] HTTP server listening on http://${BIND_HOST}:${HTTP_PORT}`);
        console.log(`[Ritmada] Local Viewer: http://localhost:${HTTP_PORT}/viewer`);
        console.log(`[Ritmada] LAN Wi-Fi:   http://${net.lanIp}:${HTTP_PORT}/viewer`);
    });

    // 2. HTTPS Server (Required for mobile camera/screen-share getDisplayMedia API)
    try {
        console.log('[Ritmada] Generating self-signed SSL certificate for LAN IP...');
        const attrs = [{ name: 'commonName', value: net.lanIp }];
        const pems = await selfsigned.generate(attrs, {
            days: 365,
            algorithm: 'sha256',
            keySize: 2048,
            extensions: [{
                name: 'subjectAltName',
                altNames: [
                    { type: 2, value: 'localhost' },
                    { type: 7, ip: net.lanIp },
                    { type: 7, ip: '127.0.0.1' }
                ]
            }]
        });

        const httpsServer = https.createServer({
            key: pems.private,
            cert: pems.cert
        }, app);

        const wssHttps = new WebSocketServer({ server: httpsServer });
        attachWebSocketLogic(wssHttps);

        httpsServer.listen(HTTPS_PORT, BIND_HOST, () => {
            console.log(`[Ritmada] HTTPS server listening on https://${BIND_HOST}:${HTTPS_PORT}`);
            console.log(`[Ritmada] Mobile Scan HTTPS: https://${net.lanIp}:${HTTPS_PORT}/qr/:token`);
        });
    } catch (err) {
        console.error('[!] Failed to initialize HTTPS server:', err.message);
    }
}

startServers();
