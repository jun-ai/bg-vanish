const http = require('http');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const API_KEY = process.env.REMOVE_BG_API_KEY || 'GRtvquHnvKPKAewykHtPLN2K';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '480367987155-qsuif9totrl50ci5h9pbri5etgasdpvv.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'bg-vanish-session-key-2026';

function parseMultipart(buf, boundary) {
  const parts = [];
  const delimiter = Buffer.from(`--${boundary}`);
  let idx = 0;
  while (true) {
    const start = buf.indexOf(delimiter, idx);
    if (start === -1) break;
    const headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerStr = buf.slice(start + delimiter.length, headerEnd).toString();
    const nextDelimiter = buf.indexOf(delimiter, headerEnd);
    if (nextDelimiter === -1) break;
    const body = buf.slice(headerEnd + 4, nextDelimiter - 2); // -2 for \r\n before delimiter
    // Parse Content-Disposition
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const contentTypeMatch = headerStr.match(/Content-Type:\s*(.+)/);
    parts.push({
      name: nameMatch ? nameMatch[1] : null,
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: contentTypeMatch ? contentTypeMatch[1].trim() : null,
      data: body,
    });
    idx = nextDelimiter + delimiter.length;
  }
  return parts;
}

function buildMultipart(fields, boundary) {
  const parts = [];
  for (const field of fields) {
    let header = `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="${field.name}"`;
    if (field.filename) header += `; filename="${field.filename}"`;
    header += '\r\n';
    if (field.contentType) header += `Content-Type: ${field.contentType}\r\n`;
    header += '\r\n';
    parts.push(Buffer.from(header));
    parts.push(field.data);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

async function handleRemoveBg(req, res) {
  if (!API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'API key not configured' }));
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  // Extract boundary from Content-Type header
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing boundary in Content-Type' }));
  }
  const boundary = boundaryMatch[1].trim();

  const parts = parseMultipart(body, boundary);
  const imagePart = parts.find(p => p.name === 'image');

  if (!imagePart || !imagePart.data.length) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No image provided' }));
  }

  if (imagePart.data.length > 10485760) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'File too large. Max 10MB' }));
  }

  const sizePart = parts.find(p => p.name === 'size');
  const size = sizePart ? sizePart.data.toString() : 'auto';

  // Forward to Remove.bg with correct multipart
  const newBoundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const fields = [
    { name: 'image_file', filename: imagePart.filename || 'image.png', contentType: imagePart.contentType || 'application/octet-stream', data: imagePart.data },
    { name: 'size', data: Buffer.from(size) },
  ];
  const forwardBody = buildMultipart(fields, newBoundary);

  try {
    const bgRes = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': API_KEY,
        'Content-Type': `multipart/form-data; boundary=${newBoundary}`,
      },
      body: forwardBody,
    });

    if (!bgRes.ok) {
      const errText = await bgRes.text();
      let msg;
      try { const j = JSON.parse(errText); msg = j.errors?.[0]?.title || errText; } catch { msg = `Remove.bg API error: ${bgRes.status}`; }
      if (bgRes.status === 402) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'API credits exhausted.', code: 'CREDITS_EXHAUSTED' }));
      }
      res.writeHead(bgRes.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: msg }));
    }

    const resultBuf = Buffer.from(await bgRes.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': bgRes.headers.get('content-type') || 'image/png',
      'Cache-Control': 'no-store',
    });
    res.end(resultBuf);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  } else if (req.url === '/api/remove-bg' && req.method === 'POST') {
    handleRemoveBg(req, res);
  } else if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', hasApiKey: !!API_KEY }));
  } else if (req.url === '/api/auth/callback' && (req.method === 'GET' || req.method === 'POST')) {
    handleAuthCallback(req, res);
  } else if (req.url === '/api/auth/me') {
    handleAuthMe(req, res);
  } else if (req.url === '/api/auth/logout' && req.method === 'POST') {
    handleLogout(req, res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// --- Google OAuth ---
function parseCookie(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    cookies[k] = v;
  });
  return cookies;
}

function setCookie(res, name, value, maxAge = 86400 * 7) {
  res.setHeader('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

async function handleAuthCallback(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing authorization code' }));
  }
  const redirectUri = `${url.protocol}//${url.host}/api/auth/callback`;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'Token exchange failed');
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();
    // Create session token (simple base64 encoded JSON with HMAC-like signature)
    const sessionData = JSON.stringify({
      sub: userData.id, name: userData.name, email: userData.email, picture: userData.picture,
      exp: Date.now() + 7 * 86400 * 1000,
    });
    const sessionToken = Buffer.from(sessionData).toString('base64url') + '.' +
      Buffer.from(COOKIE_SECRET + sessionData).toString('base64url').slice(0, 32);
    setCookie(res, 'session', sessionToken, 7 * 86400);
    res.writeHead(302, { Location: '/?auth=success' });
    res.end();
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function handleAuthMe(req, res) {
  const cookies = parseCookie(req.headers.cookie);
  const session = cookies.session;
  if (!session) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Not authenticated' }));
  }
  try {
    const [payloadB64, sig] = session.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (payload.exp < Date.now()) {
      clearCookie(res, 'session');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Session expired' }));
    }
    const expectedSig = Buffer.from(COOKIE_SECRET + JSON.stringify(payload)).toString('base64url').slice(0, 32);
    if (sig !== expectedSig) {
      clearCookie(res, 'session');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid session' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: payload.sub, name: payload.name, email: payload.email, picture: payload.picture }));
  } catch {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid session' }));
  }
}

function handleLogout(req, res) {
  clearCookie(res, 'session');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

server.listen(8787, '0.0.0.0', () => console.log('✅ Server running on http://0.0.0.0:8787'));
