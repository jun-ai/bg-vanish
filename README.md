# BG Vanish — Image Background Remover

Instantly remove image backgrounds, powered by Remove.bg API. Deployed on Cloudflare Workers.

## Features

- 🖼️ Drag & drop or paste image upload
- ⚡ AI-powered background removal (Remove.bg)
- 🎨 Replace background with solid color or custom image
- 📦 Bulk upload (up to 5 images)
- 📱 Fully responsive, works on mobile
- 🆓 Free tier: 5 removals/day (client-side tracking)
- 🔒 No data stored, all in-memory processing

## Project Structure

```
bg-remover/
├── src/worker/index.ts   # Cloudflare Worker (backend + inline HTML)
├── public/index.html      # Standalone frontend for reference
├── wrangler.toml          # Cloudflare config
├── package.json
└── tsconfig.json
```

## Setup

### 1. Get Remove.bg API Key

Sign up at [remove.bg](https://www.remove.bg/api) and get your API key.

### 2. Install & Configure

```bash
npm install
npx wrangler login
npx wrangler secret put REMOVE_BG_API_KEY
```

### 3. Run Locally

```bash
npx wrangler dev
```

Open `http://localhost:8787` in your browser.

### 4. Deploy

```bash
npx wrangler deploy
```

## Cost Estimate

- **Cloudflare Workers**: Free tier covers 100k requests/day
- **Remove.bg API**: Free tier = 1 credit/month, paid plans start at $0.09/image
- **No storage costs** (in-memory only)

## Customization

- **Free limit**: Change `FREE_LIMIT` in the HTML (default: 5/day)
- **Max concurrent**: Change `maxConcurrent` (default: 2)
- **Max file size**: Set `MAX_FILE_SIZE` env var in wrangler.toml (default: 10MB)

## License

MIT
