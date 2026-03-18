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
function setCookie(res, name, val, maxAge=604800) {
  res.headers.append('Set-Cookie', name + '=' + val + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge);
}
function clearCookie(res, name) {
  res.headers.append('Set-Cookie', name + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).padStart(8, '0');
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
    if (!tokenRes.ok) throw new Error('Token exchange failed: ' + JSON.stringify({error:td.error, status:tokenRes.status, desc:td.error_description}));
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {headers: {Authorization: 'Bearer ' + td.access_token}});
    const ud = await userRes.json();
    const sessionData = JSON.stringify({sub:ud.id, name:ud.name, email:ud.email, picture:ud.picture, exp:Date.now()+604800000});
    const payloadB64 = btoa(new TextEncoder().encode(sessionData));
    const sessionToken = payloadB64 + '.' + simpleHash(COOKIE_SECRET + sessionData);
    const res = new Response(null, {status: 302, headers: {'Location': '/?auth=success', 'Set-Cookie': 'session=' + sessionToken + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'}});
    return res;
  } catch(e) { return json({error:e.message}, 500); }
}

function handleAuthMe(request) {
  const session = parseCookie(request.headers.get('cookie'));
  const token = session.session;
  if (!token) return json({error:'Not authenticated'}, 401);
  try {
    const parts = token.split('.');
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0))));
    if (payload.exp < Date.now()) return json({error:'Session expired'}, 401);
    const expectedSig = simpleHash(COOKIE_SECRET + JSON.stringify(payload));
    if (parts[1] !== expectedSig) return json({error:'Invalid session'}, 401);
    return json({id:payload.sub, name:payload.name, email:payload.email, picture:payload.picture});
  } catch(e) { return json({error:'Invalid session'}, 401); }
}

function handleLogout(request) {
  return new Response(JSON.stringify({success:true}), {headers:{'Content-Type':'application/json', 'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'}});
}

async function handleRemoveBg(request, env) {
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
    return new Response(await res.arrayBuffer(), {headers:{'Content-Type':'image/png','Cache-Control':'no-store'}});
  } catch(e) { return json({error:e.message||'Server error'}, 500); }
}

function json(data, status) { return new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}}); }

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, {headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/index.html') return new Response(HTML, {headers:{'Content-Type':'text/html;charset=utf-8'}});
    if (url.pathname === '/api/remove-bg' && request.method === 'POST') return handleRemoveBg(request, env);
    if (url.pathname === '/api/auth/callback') return handleAuthCallback(request, env);
    if (url.pathname === '/api/auth/me') return handleAuthMe(request);
    if (url.pathname === '/api/auth/debug') {
      const ck = parseCookie(request.headers.get('cookie'));
      return json({cookie: ck, allHeaders: Object.fromEntries(request.headers)});
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return handleLogout(request);
    if (url.pathname === '/api/health') return Response.json({status:'ok'});
    return new Response('Not found', {status:404});
  }
};
`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/worker.js'), workerJs);
console.log('✅ Built dist/worker.js (' + workerJs.length + ' bytes)');
