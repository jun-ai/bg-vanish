export const onRequestPost: PagesFunction<{Bindings: {REMOVE_BG_API_KEY: string; MAX_FILE_SIZE: string}}> = async (context) => {
  const { request, env } = context;
  const apiKey = env.REMOVE_BG_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const maxSize = parseInt(env.MAX_FILE_SIZE || '10485760', 10);
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;
    const size = (formData.get('size') as string) || 'auto';
    if (!imageFile) return new Response(JSON.stringify({ error: 'No image provided' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (imageFile.size > maxSize) return new Response(JSON.stringify({ error: `File too large. Max ${maxSize/1024/1024}MB` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const bgFormData = new FormData();
    bgFormData.append('image_file', imageFile, imageFile.name);
    bgFormData.append('size', size);
    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: bgFormData,
    });
    if (!response.ok) {
      const errText = await response.text();
      let msg;
      try { const j = JSON.parse(errText); msg = j.errors?.[0]?.title || errText; } catch { msg = `Remove.bg API error: ${response.status}`; }
      if (response.status === 402) return new Response(JSON.stringify({ error: 'API credits exhausted.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: msg }), { status: response.status, headers: { 'Content-Type': 'application/json' } });
    }
    const blob = await response.blob();
    return new Response(blob, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
