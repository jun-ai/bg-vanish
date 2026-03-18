export interface Env {
  REMOVE_BG_API_KEY: string;
  MAX_FILE_SIZE: string;
}

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BG Vanish — Remove Image Backgrounds Instantly</title>
  <meta name="description" content="Remove image backgrounds in seconds. Free, fast, no signup required.">
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    body { font-family: 'Inter', sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .glass { background: rgba(255,255,255,0.1); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.2); }
    .drop-zone { border: 2px dashed rgba(255,255,255,0.4); transition: all 0.3s ease; }
    .drop-zone:hover, .drop-zone.drag-over { border-color: rgba(255,255,255,0.8); background: rgba(255,255,255,0.15); transform: scale(1.01); }
    .checker-bg {
      background-image: linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%);
      background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.2); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes pulse-glow { 0%,100%{box-shadow:0 0 20px rgba(102,126,234,0.3)} 50%{box-shadow:0 0 40px rgba(118,75,162,0.5)} }
    .glow { animation: pulse-glow 2s ease-in-out infinite; }
    .fade-in { animation: fadeIn 0.5s ease-out; }
    @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    input[type="color"] { -webkit-appearance:none; border:none; width:40px; height:40px; border-radius:50%; cursor:pointer; overflow:hidden; }
    input[type="color"]::-webkit-color-swatch-wrapper { padding:0; }
    input[type="color"]::-webkit-color-swatch { border:2px solid rgba(255,255,255,0.5); border-radius:50%; }
    .thumb { transition: all 0.2s; }
    .thumb:hover { transform: scale(1.05); }
  </style>
</head>
<body class="gradient-bg min-h-screen text-white">
  <header class="py-6 px-4">
    <div class="max-w-5xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl">✨</div>
        <span class="text-xl font-bold">BG Vanish</span>
      </div>
      <div id="counter" class="text-sm text-white/70"></div>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 pb-20">
    <section class="text-center py-10">
      <h1 class="text-4xl md:text-6xl font-extrabold mb-4 leading-tight">
        Remove Any Background<br>
        <span class="text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 to-pink-200">In Seconds</span>
      </h1>
      <p class="text-lg text-white/70 max-w-xl mx-auto">Drop your image, get a clean cutout. No signup, no watermark. Powered by AI.</p>
    </section>
    <section id="uploadSection" class="mb-8">
      <div id="dropZone" class="drop-zone rounded-2xl p-12 text-center cursor-pointer glass glow">
        <div class="flex flex-col items-center gap-4">
          <div class="text-6xl">🖼️</div>
          <div>
            <p class="text-lg font-semibold">Drop your image here</p>
            <p class="text-sm text-white/60 mt-1">or click to browse · PNG, JPG, WebP up to 10MB · max 5 images</p>
          </div>
          <label class="px-6 py-2.5 bg-white/20 hover:bg-white/30 rounded-lg font-medium cursor-pointer transition">
            Choose Files
            <input type="file" id="fileInput" accept="image/png,image/jpeg,image/webp" multiple class="hidden">
          </label>
        </div>
      </div>
    </section>
    <section id="queueSection" class="hidden mb-8 fade-in">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Queue</h2>
        <button id="clearAllBtn" class="text-sm text-white/60 hover:text-white transition">Clear All</button>
      </div>
      <div id="queue" class="flex gap-3 overflow-x-auto pb-2"></div>
    </section>
    <section id="resultsSection" class="hidden fade-in">
      <div id="results" class="grid gap-6"></div>
    </section>
    <div id="limitModal" class="hidden fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div class="glass rounded-2xl p-8 max-w-sm w-full text-center">
        <div class="text-4xl mb-3">🚫</div>
        <h3 class="text-xl font-bold mb-2">Daily Limit Reached</h3>
        <p class="text-white/70 text-sm mb-6">You've used all <span id="limitCount">5</span> free removals today.<br>Come back tomorrow or upgrade for unlimited access!</p>
        <button onclick="document.getElementById('limitModal').classList.add('hidden')" class="px-6 py-2 bg-white/20 hover:bg-white/30 rounded-lg font-medium transition">Got it</button>
      </div>
    </div>
    <section class="mt-12 text-center">
      <div class="glass rounded-2xl p-6 inline-block">
        <p class="text-sm text-white/60">Need more? <span class="text-yellow-200 font-semibold">API access</span> available for developers →</p>
      </div>
    </section>
  </main>
  <footer class="py-6 text-center text-xs text-white/40">
    <p>BG Vanish · Powered by Remove.bg API · No data stored</p>
  </footer>
  <script>
    const FREE_LIMIT=5;
    const state={queue:[],processing:0,maxConcurrent:2};
    function getUsage(){const t=new Date().toISOString().slice(0,10);const d=JSON.parse(localStorage.getItem('bgv_usage')||'{}');return d.date===t?d:{date:t,count:0}}
    function incrementUsage(){const u=getUsage();u.count++;localStorage.setItem('bgv_usage',JSON.stringify(u));updateCounter()}
    function updateCounter(){const u=getUsage();const r=FREE_LIMIT-u.count;document.getElementById('counter').textContent=u.count>0?\`\u{1F195} \${r}/\${FREE_LIMIT} today\`:''}
    updateCounter();
    const dropZone=document.getElementById('dropZone'),fileInput=document.getElementById('fileInput');
    dropZone.addEventListener('dragover',e=>{e.preventDefault();dropZone.classList.add('drag-over')});
    dropZone.addEventListener('dragleave',()=>dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop',e=>{e.preventDefault();dropZone.classList.remove('drag-over');handleFiles(e.dataTransfer.files)});
    dropZone.addEventListener('click',e=>{if(e.target.tagName!=='INPUT'&&e.target.tagName!=='LABEL')fileInput.click()});
    fileInput.addEventListener('change',e=>handleFiles(e.target.files));
    document.getElementById('clearAllBtn').addEventListener('click',()=>{state.queue.forEach(i=>{URL.revokeObjectURL(i.originalUrl);URL.revokeObjectURL(i.resultUrl)});state.queue=[];render()});
    function handleFiles(files){const arr=Array.from(files);const rem=FREE_LIMIT-getUsage().count;const ok=arr.filter(f=>f.type.startsWith('image/')).slice(0,Math.min(5-state.queue.length,rem));if(!ok.length){if(getUsage().count>=FREE_LIMIT){document.getElementById('limitModal').classList.remove('hidden')}return}ok.forEach(f=>{state.queue.push({id:Math.random().toString(36).slice(2),file:f,originalUrl:URL.createObjectURL(f),resultUrl:null,status:'pending',error:null})});render();processQueue()}
    function render(){const qs=document.getElementById('queueSection'),qe=document.getElementById('queue'),rs=document.getElementById('resultsSection'),re=document.getElementById('results');if(!state.queue.length){qs.classList.add('hidden');rs.classList.add('hidden');return}qs.classList.remove('hidden');qe.innerHTML=state.queue.map(i=>\`<div class="thumb flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden relative" data-id="\${i.id}"><img src="\${i.originalUrl}" class="w-full h-full object-cover">\${i.status==='processing'?'<div class="absolute inset-0 bg-black/50 flex items-center justify-center"><div class="spinner" style="width:24px;height:24px;border-width:2px"></div></div>':''}\${i.status==='done'?'<div class="absolute bottom-0 inset-x-0 bg-green-500 text-center text-xs py-0.5">✓</div>':''}\${i.status==='error'?'<div class="absolute bottom-0 inset-x-0 bg-red-500 text-center text-xs py-0.5">✗</div>':''}</div>\`).join('');const done=state.queue.filter(i=>i.status==='done'||i.status==='error');if(!done.length){rs.classList.add('hidden');return}rs.classList.remove('hidden');re.innerHTML=done.map(renderResult).join('');re.querySelectorAll('.download-btn').forEach(b=>b.addEventListener('click',()=>{const i=state.queue.find(x=>x.id===b.dataset.id);if(i?.resultUrl)downloadResult(i)}));re.querySelectorAll('.color-picker').forEach(p=>p.addEventListener('input',e=>{const i=state.queue.find(x=>x.id===p.dataset.id);if(i?.resultUrl){const el=document.getElementById('result-'+i.id);if(el)el.style.backgroundColor=e.target.value}}));re.querySelectorAll('.bg-preset').forEach(b=>b.addEventListener('click',()=>{const el=document.getElementById('result-'+b.dataset.id);el.style.backgroundColor=b.dataset.color==='transparent'?'':b.dataset.color}))}
    function renderResult(item){const bg=item.resultUrl?\`background-image:url(\${item.resultUrl});background-size:contain;background-repeat:no-repeat;background-position:center;\`:'';if(item.status==='error')return\`<div class="glass rounded-2xl p-6 fade-in text-center py-8"><div class="text-3xl mb-2">😕</div><p class="text-red-300 text-sm">\${item.error||'Processing failed'}</p></div>\`;return\`<div class="glass rounded-2xl p-6 fade-in"><div class="flex flex-col md:flex-row gap-6"><div class="flex-1 text-center"><p class="text-xs text-white/50 mb-2 uppercase tracking-wide">Original</p><div class="rounded-xl overflow-hidden bg-black/20"><img src="\${item.originalUrl}" class="w-full max-h-72 object-contain"></div></div><div class="flex items-center text-2xl">→</div><div class="flex-1 text-center"><p class="text-xs text-white/50 mb-2 uppercase tracking-wide">Result</p><div id="result-\${item.id}" class="checker-bg rounded-xl overflow-hidden aspect-video flex items-center justify-center" style="\${bg}">\${!item.resultUrl?'<div class="spinner"></div>':''}</div></div></div><div class="mt-4 flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-2"><span class="text-xs text-white/50">BG:</span><button class="bg-preset w-7 h-7 rounded-full border-2 border-white/30 checker-bg" data-id="\${item.id}" data-color="transparent"></button><button class="bg-preset w-7 h-7 rounded-full border-2 border-white/30 bg-white" data-id="\${item.id}" data-color="#ffffff"></button><button class="bg-preset w-7 h-7 rounded-full border-2 border-white/30 bg-black" data-id="\${item.id}" data-color="#000000"></button><button class="bg-preset w-7 h-7 rounded-full border-2 border-white/30 bg-red-500" data-id="\${item.id}" data-color="#ef4444"></button><button class="bg-preset w-7 h-7 rounded-full border-2 border-white/30 bg-blue-500" data-id="\${item.id}" data-color="#3b82f6"></button><button class="bg-preset w-7 h-7 rounded-full border-2 border-white/30 bg-green-500" data-id="\${item.id}" data-color="#22c55e"></button><input type="color" class="color-picker" data-id="\${item.id}" value="#8b5cf6"></div><button class="download-btn px-5 py-2 bg-white text-purple-700 rounded-lg font-semibold text-sm hover:bg-yellow-200 transition" data-id="\${item.id}">⬇ Download PNG</button></div></div>\`}
    }
    function downloadResult(item){const c=document.createElement('canvas'),ctx=c.getContext('2d'),img=new Image();img.onload=()=>{c.width=img.width;c.height=img.height;const el=document.getElementById('result-'+item.id),bg=el?.style.backgroundColor||'';if(bg){ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height)}ctx.drawImage(img,0,0);c.toBlob(blob=>{const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=item.file.name.replace(/\\.[^.]+\$/,'')+'-no-bg.png';a.click();URL.revokeObjectURL(u)},'image/png')};img.src=item.resultUrl}
    async function processQueue(){while(true){const pending=state.queue.filter(i=>i.status==='pending');const processing=state.queue.filter(i=>i.status==='processing').length;if(!pending.length)break;if(processing>=state.maxConcurrent){await new Promise(r=>setTimeout(r,500));continue}const item=pending[0];item.status='processing';render();try{const fd=new FormData();fd.append('image',item.file);fd.append('size','auto');const res=await fetch('/api/remove-bg',{method:'POST',body:fd});if(!res.ok){const e=await res.json().catch(()=>({error:'Unknown error'}));throw new Error(e.error||'HTTP '+res.status)}const blob=await res.blob();item.resultUrl=URL.createObjectURL(blob);item.status='done';incrementUsage()}catch(e){item.status='error';item.error=e.message}render()}}
    document.addEventListener('paste',e=>{const items=e.clipboardData?.items;if(!items)return;const files=[];for(const i of items){if(i.kind==='file'&&i.type.startsWith('image/'))files.push(i.getAsFile())}if(files.length)handleFiles(files)});
  <\/script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Serve HTML
    if (path === "/" || path === "/index.html") {
      return new Response(HTML_CONTENT, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // API: Remove background
    if (path === "/api/remove-bg" && request.method === "POST") {
      return handleRemoveBg(request, env);
    }

    // Health check
    if (path === "/api/health") {
      return Response.json({ status: "ok", timestamp: Date.now() });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleRemoveBg(request: Request, env: Env): Promise<Response> {
  const apiKey = env.REMOVE_BG_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "API key not configured" }, { status: 500 });
  }

  const maxSize = parseInt(env.MAX_FILE_SIZE || "10485760", 10);

  try {
    const formData = await request.formData();
    const imageFile = formData.get("image") as File | null;
    const size = (formData.get("size") as string) || "auto";

    if (!imageFile) {
      return Response.json({ error: "No image provided" }, { status: 400 });
    }

    if (imageFile.size > maxSize) {
      return Response.json(
        { error: `File too large. Max ${maxSize / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Forward to Remove.bg
    const bgFormData = new FormData();
    bgFormData.append("image_file", imageFile, imageFile.name);
    bgFormData.append("size", size);

    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: bgFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.errors?.[0]?.title || errorText;
      } catch {
        errorMessage = `Remove.bg API error: ${response.status}`;
      }

      if (response.status === 402) {
        return Response.json(
          { error: "API credits exhausted. Please try again later.", code: "CREDITS_EXHAUSTED" },
          { status: 503 }
        );
      }

      return Response.json({ error: errorMessage }, { status: response.status });
    }

    const imageBlob = await response.blob();
    return new Response(imageBlob, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": "attachment; filename=removed-bg.png",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
