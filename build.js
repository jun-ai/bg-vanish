const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

// Pricing plans
const PLANS = {
  starter: { amount: '4.99', credits: 40 },
  popular: { amount: '9.99', credits: 85 },
  pro_pack: { amount: '23.99', credits: 200 },
};

const workerJs = `
const HTML = ${JSON.stringify(html)};
const COOKIE_SECRET = 'bg-vanish-session-2026';
const PLANS = ${JSON.stringify(PLANS)};

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
function json(data, status) { return new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}}); }

async function getSessionUser(request, env) {
  const session = parseCookie(request.headers.get('cookie'));
  const token = session.session;
  if (!token) return null;
  try {
    const parts = token.split('.');
    const payload = b64Decode(parts[0]);
    if (payload.exp < Date.now()) return null;
    if (parts[1] !== simpleHash(COOKIE_SECRET + JSON.stringify(payload))) return null;
    let credits = 0, plan = 'free';
    if (env.DB) {
      try {
        const row = await env.DB.prepare('SELECT credits, plan FROM users WHERE google_id = ?').bind(payload.sub).first();
        if (row) { credits = row.credits; plan = row.plan; }
      } catch(e) { credits = 0; }
    }
    return { ...payload, credits, plan };
  } catch(e) { return null; }
}

// --- Init D1 tables ---
async function initDB(env) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(\`CREATE TABLE IF NOT EXISTS users (google_id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, picture TEXT, credits INTEGER DEFAULT 3, plan TEXT DEFAULT 'free', created_at TEXT DEFAULT (datetime('now')))\`).run();
    await env.DB.prepare(\`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, google_id TEXT NOT NULL, paypal_order_id TEXT UNIQUE NOT NULL, plan_id TEXT NOT NULL, amount TEXT NOT NULL, currency TEXT DEFAULT 'USD', credits_added INTEGER NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), captured_at TEXT, FOREIGN KEY (google_id) REFERENCES users(google_id))\`).run();
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS webhook_events (id INTEGER PRIMARY KEY AUTOINCREMENT, transmission_id TEXT UNIQUE NOT NULL, event_type TEXT, resource_id TEXT, processed_at TEXT)').run();
  } catch(e) { console.error('DB init error:', e); }
}

// --- PayPal helpers ---
async function getPayPalAccessToken(env) {
  const base = env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
  const res = await fetch(base + '/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) { const t = await res.text(); throw new Error('PayPal auth failed: ' + t); }
  const data = await res.json();
  return data.access_token;
}

// --- Google OAuth ---
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
    // Create user in D1 if not exists
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
  return json({id:user.sub, name:user.name, email:user.email, picture:user.picture, credits:user.credits, plan:user.plan});
}

function handleLogout(request) {
  return new Response(JSON.stringify({success:true}), {headers:{'Content-Type':'application/json', 'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'}});
}

// --- Remove BG ---
async function handleRemoveBg(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({error:'Please sign in to use this feature'}, 401);
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
      try { await env.DB.prepare('UPDATE users SET credits = credits - 1 WHERE google_id = ?').bind(user.sub).run(); } catch(e) { console.error('D1 credit deduct error:', e); }
    }
    return new Response(await res.arrayBuffer(), {headers:{'Content-Type':'image/png','Cache-Control':'no-store'}});
  } catch(e) { return json({error:e.message||'Server error'}, 500); }
}

// --- PayPal: Create Order ---
async function handlePayPalCreateOrder(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({error:'Not authenticated'}, 401);
  try {
    const body = await request.json();
    const planId = body.planId;
    const plan = PLANS[planId];
    if (!plan) return json({error:'Invalid plan'}, 400);

    const accessToken = await getPayPalAccessToken(env);
    const base = env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    const origin = new URL(request.url).origin;
    const res = await fetch(base + '/v2/checkout/orders', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: plan.amount, breakdown: { item_total: { currency_code: 'USD', value: plan.amount } } }, description: 'BG Vanish Credit Pack: ' + planId, custom_id: user.sub + ':' + planId }],
        application_context: {
          brand_name: 'BG Vanish',
          return_url: origin + '/?paypal=success',
          cancel_url: origin + '/?paypal=cancel',
          user_action: 'PAY_NOW',
        },
      }),
    });
    if (!res.ok) { const t = await res.text(); return json({error:'PayPal create order failed', detail:t}, 502); }
    const data = await res.json();
    // Store pending order in D1
    if (env.DB) {
      try {
        await env.DB.prepare('INSERT INTO orders (google_id, paypal_order_id, plan_id, amount, credits_added) VALUES (?, ?, ?, ?, ?)').bind(user.sub, data.id, planId, plan.amount, plan.credits).run();
      } catch(e) { console.error('Order insert error:', e); }
    }
    // Redirect to PayPal approve URL
    const approveLink = data.links?.find(l => l.rel === 'approve');
    if (approveLink) {
      return json({ approveUrl: approveLink.href, orderId: data.id });
    }
    return json({ orderId: data.id, links: data.links });
  } catch(e) { return json({error:e.message}, 500); }
}

// --- PayPal: Capture Order ---
async function handlePayPalCaptureOrder(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({error:'Not authenticated'}, 401);
  try {
    const body = await request.json();
    const orderId = body.orderId;
    if (!orderId) return json({error:'Missing orderId'}, 400);

    const accessToken = await getPayPalAccessToken(env);
    const base = env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    const res = await fetch(base + '/v2/checkout/orders/' + orderId + '/capture', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    });
    if (!res.ok) { const t = await res.text(); return json({error:'PayPal capture failed', detail:t}, 502); }
    const data = await res.json();
    if (data.status !== 'COMPLETED') return json({error:'Payment not completed', status:data.status}, 400);

    // Verify amount and add credits
    const capture = data.purchase_units[0]?.payments?.captures[0];
    if (!capture) return json({error:'No capture found'}, 400);
    const paidAmount = capture.amount?.value;
    const customId = data.purchase_units[0]?.custom_id;
    const [paidGoogleId, planId] = (customId || '').split(':');
    if (paidGoogleId !== user.sub) return json({error:'User mismatch'}, 403);
    const plan = PLANS[planId];
    if (!plan) return json({error:'Invalid plan'}, 400);
    if (paidAmount !== plan.amount) return json({error:'Amount mismatch'}, 400);

    // Check if already captured
    if (env.DB) {
      const existing = await env.DB.prepare('SELECT status FROM orders WHERE paypal_order_id = ?').bind(orderId).first();
      if (existing && existing.status === 'completed') return json({message:'Already processed', credits: user.credits});
    }

    // Add credits
    if (env.DB) {
      await env.DB.prepare('UPDATE users SET credits = credits + ?, plan = ? WHERE google_id = ?').bind(plan.credits, planId, user.sub).run();
      await env.DB.prepare("UPDATE orders SET status = 'completed', captured_at = datetime('now') WHERE paypal_order_id = ?").bind(orderId).run();
    }
    return json({message:'Payment successful', creditsAdded: plan.credits, planId});
  } catch(e) { return json({error:e.message}, 500); }
}

// --- PayPal: Webhook Handler ---
async function handlePayPalWebhook(request, env) {
  try {
    const body = await request.json();
    const eventType = body.event_type;
    const transmissionId = request.headers.get('paypal-transmission-id');

    // Idempotency: skip if already processed
    if (env.DB && transmissionId) {
      const existing = await env.DB.prepare('SELECT id FROM webhook_events WHERE transmission_id = ?').bind(transmissionId).first();
      if (existing) return json({message:'Already processed'});
    }

    // Verify webhook signature via PayPal API
    if (env.PAYPAL_WEBHOOK_ID) {
      const accessToken = await getPayPalAccessToken(env);
      const base = env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
      const verifyRes = await fetch(base + '/v1/notifications/verify-webhook-signature', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_id: env.PAYPAL_WEBHOOK_ID,
          transmission_id: request.headers.get('paypal-transmission-id'),
          transmission_time: request.headers.get('paypal-transmission-time'),
          cert_url: request.headers.get('paypal-cert-url'),
          auth_algo: request.headers.get('paypal-auth-algo'),
          transmission_sig: request.headers.get('paypal-transmission-sig'),
          webhook_event: body,
        }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.verification_status !== 'SUCCESS') {
        console.error('Webhook signature verification failed:', verifyData);
        return json({error:'Invalid signature'}, 401);
      }
    }

    // Process event
    const resourceId = body.resource?.id;
    const customId = body.resource?.custom_id;

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED' && customId) {
      const [googleId, planId] = customId.split(':');
      const plan = PLANS[planId];
      if (plan && env.DB) {
        // Check if order already completed
        const order = await env.DB.prepare("SELECT status FROM orders WHERE paypal_order_id = ?").bind(resourceId).first();
        if (!order || order.status !== 'completed') {
          await env.DB.prepare('UPDATE users SET credits = credits + ?, plan = ? WHERE google_id = ?').bind(plan.credits, planId, googleId).run();
          await env.DB.prepare("UPDATE orders SET status = 'completed', captured_at = datetime('now') WHERE paypal_order_id = ?").bind(resourceId).run();
        }
      }
    } else if (eventType === 'PAYMENT.CAPTURE.DENIED' && resourceId) {
      if (env.DB) {
        await env.DB.prepare("UPDATE orders SET status = 'denied' WHERE paypal_order_id = ?").bind(resourceId).run();
      }
    } else if (eventType === 'PAYMENT.CAPTURE.REFUNDED' && customId) {
      const [googleId, planId] = customId.split(':');
      const plan = PLANS[planId];
      if (plan && env.DB) {
        const order = await env.DB.prepare("SELECT status, credits_added FROM orders WHERE paypal_order_id = ?").bind(resourceId).first();
        if (order && (order.status === 'completed' || order.status === 'refunded_partial')) {
          await env.DB.prepare('UPDATE users SET credits = MAX(credits - ?, 0) WHERE google_id = ?').bind(order.credits_added || plan.credits, googleId).run();
          const newStatus = order.status === 'refunded_partial' ? 'refunded_partial' : 'refunded';
          await env.DB.prepare("UPDATE orders SET status = ? WHERE paypal_order_id = ?").bind(newStatus, resourceId).run();
        }
      }
    }

    // Record processed webhook
    if (env.DB && transmissionId) {
      try { await env.DB.prepare('INSERT OR IGNORE INTO webhook_events (transmission_id, event_type, resource_id, processed_at) VALUES (?, ?, ?, datetime("now"))').bind(transmissionId, eventType, resourceId).run(); } catch(e) { console.error('Webhook log error:', e); }
    }

    return json({received: true, event_type: eventType});
  } catch(e) { console.error('Webhook error:', e); return json({error:e.message}, 500); }
}

// --- Main router ---
export default {
  async fetch(request, env) {
    // Init DB on first request
    initDB(env);

    if (request.method === 'OPTIONS') return new Response(null, {headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/index.html') return new Response(HTML, {headers:{'Content-Type':'text/html;charset=utf-8'}});
    if (url.pathname === '/api/remove-bg' && request.method === 'POST') return handleRemoveBg(request, env);
    if (url.pathname === '/api/auth/callback') return handleAuthCallback(request, env);
    if (url.pathname === '/api/auth/me') return handleAuthMe(request, env);
    if (url.pathname === '/api/auth/debug') { const ck = parseCookie(request.headers.get('cookie')); return json({cookie: ck}); }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return handleLogout(request);
    if (url.pathname === '/api/paypal/create-order' && request.method === 'POST') return handlePayPalCreateOrder(request, env);
    if (url.pathname === '/api/paypal/capture-order' && request.method === 'POST') return handlePayPalCaptureOrder(request, env);
    if (url.pathname === '/api/paypal/webhook' && request.method === 'POST') return handlePayPalWebhook(request, env);
    if (url.pathname === '/api/health') return Response.json({status:'ok'});
    return new Response(HTML, {headers:{'Content-Type':'text/html;charset=utf-8'}});
  }
};
`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/worker.js'), workerJs);
console.log('✅ Built dist/worker.js (' + workerJs.length + ' bytes)');
