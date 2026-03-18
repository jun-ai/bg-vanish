const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

const workerJs = `
const HTML = ${JSON.stringify(html)};
const COOKIE_SECRET = 'bg-vanish-session-2026';

function parseCookie(h) {
  const c = {};
  if (!h) return c;
  h.split(';').forEach(p => { const [k,v] = p.trim().split('='); if(k) c[k]=v; });
  return c;
}
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).padStart(8, '0');
}
function b64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  return btoa(String.fromCharCode(...bytes));
}
function b64Decode(b64) {
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
}
function json(data, status) { return new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}}); }

async function getSessionUser(request, env) {
  const session = parseCookie(request.headers.get('cookie'));
  const token = session.session;
  if (!token) return null;
  try {
    const parts = token.split('.');
    const payload = b64Decode(parts[0]);
    if (payload.exp < Date.now()) return null;
    if (parts[1] !== simpleHash(COOKIE_SECRET + JSON.stringify(payload))) return null;
    // Get credits from D1
    let credits = 0;
    if (env.DB) {
      try {
        const row = await env.DB.prepare('SELECT credits, plan FROM users WHERE google_id = ?').bind(payload.sub).first();
        credits = row ? row.credits : 0;
      } catch(e) { credits = 0; }
    }
    return { ...payload, credits };
  } catch(e) { return null; }
}

async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return json({error:'Missing code'}, 400);
  const redirectUri = url.protocol + '//' + url.host + '/api/auth/callback';
  try {
    const clientId = env.GOOGLE_CLIENT_ID || '';
    const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code'}),
    });
    const td = await tokenRes.json();
    if (!tokenRes.ok) throw new Error('Token exchange failed: ' + JSON.stringify({error:td.error, status:tokenRes.status}));
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {headers: {Authorization: 'Bearer ' + td.access_token}});
    const ud = await userRes.json();
    const sessionData = JSON.stringify({sub:ud.id, name:ud.name, email:ud.email, picture:ud.picture, exp:Date.now()+604800000});
    const payloadB64 = b64Encode(sessionData);
    const sessionToken = payloadB64 + '.' + simpleHash(COOKIE_SECRET + sessionData);
    // Create user in D1 if not exists (give 3 free credits)
    if (env.DB) {
      try {
        await env.DB.prepare(\`INSERT INTO users (google_id, email, name, picture, credits) VALUES (?, ?, ?, ?, 3) ON CONFLICT(google_id) DO NOTHING\`).bind(ud.id, ud.email, ud.name, ud.picture).run();
      } catch(e) { console.error('D1 insert error:', e); }
    }
    return new Response(null, {status: 302, headers: {'Location': '/?auth=success', 'Set-Cookie': 'session=' + sessionToken + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'}});
  } catch(e) { return json({error:e.message}, 500); }
}

async function handleAuthMe(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({error:'Not authenticated'}, 401);
  return json({id:user.sub, name:user.name, email:user.email, picture:user.picture, credits:user.credits});
}

function handleLogout(request) {
  return new Response(JSON.stringify({success:true}), {headers:{'Content-Type':'application/json', 'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'}});
}

async function handleRemoveBg(request, env) {
  // Check auth
  const user = await getSessionUser(request, env);
  if (!user) return json({error:'Please sign in to use this feature'}, 401);
  // Check credits
  if (user.credits <= 0) return json({error:'No credits remaining. Please purchase more credits.'}, 402);
  const apiKey = env.REMOVE_BG_API_KEY;
  if (!apiKey) return json({error:'API key not configured'}, 500);
  const maxSize = parseInt(env.MAX_FILE_SIZE || '10485760', 10);
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image');
    const size = formData.get('size') || 'auto';
    if (!imageFile) return json({error:'No image provided'}, 400);
    if (imageFile.size > maxSize) return json({error:'File too large. Max '+(maxSize/1024/1024)+'MB'}, 400);
    const bg = new FormData();
    bg.append('image_file', imageFile, imageFile.name);
    bg.append('size', size);
    const res = await fetch('https://api.remove.bg/v1.0/removebg', {method:'POST', headers:{'X-Api-Key':apiKey}, body:bg});
    if (!res.ok) {
      const txt = await res.text();
      let msg;
      try { const j = JSON.parse(txt); msg = (j.errors&&j.errors[0]&&j.errors[0].title)||txt; } catch(e) { msg='Remove.bg error: '+res.status; }
      if (res.status === 402) return json({error:'API credits exhausted.'}, 503);
      return json({error:msg}, res.status);
    }
    // Deduct credit
    if (env.DB) {
      try {
        await env.DB.prepare('UPDATE users SET credits = credits - 1 WHERE google_id = ?').bind(user.sub).run();
      } catch(e) { console.error('D1 credit deduct error:', e); }
    }
    return new Response(await res.arrayBuffer(), {headers:{'Content-Type':'image/png','Cache-Control':'no-store'}});
  } catch(e) { return json({error:e.message||'Server error'}, 500); }
}

function handleAuthDebug(request) {
  const ck = parseCookie(request.headers.get('cookie'));
  return json({cookie: ck});
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, {headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/index.html') return new Response(HTML, {headers:{'Content-Type':'text/html;charset=utf-8'}});
    if (url.pathname === '/api/remove-bg' && request.method === 'POST') return handleRemoveBg(request, env);
    if (url.pathname === '/api/auth/callback') return handleAuthCallback(request, env);
    if (url.pathname === '/api/auth/me') return handleAuthMe(request, env);
    if (url.pathname === '/api/auth/debug') return handleAuthDebug(request);
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return handleLogout(request);
    if (url.pathname === '/api/health') return Response.json({status:'ok'});
    // SPA fallback - serve HTML for all other routes
    return new Response(HTML, {headers:{'Content-Type':'text/html;charset=utf-8'}});
  }
};
`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/worker.js'), workerJs);
console.log('✅ Built dist/worker.js (' + workerJs.length + ' bytes)');
