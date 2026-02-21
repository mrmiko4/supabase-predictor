# 🚀 Deploy to Netlify using Netlify CLI

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- A [Netlify account](https://app.netlify.com/signup)

---

## Step 1: Install Netlify CLI

```bash
npm install -g netlify-cli
```

## Step 2: Login to Netlify

```bash
netlify login
```

A browser window will open — authorize the CLI.

## Step 3: Clone & Install Dependencies

```bash
git clone <your-repo-url>
cd <your-project-folder>
npm install
```

## Step 4: Set Environment Variables

Create a `.env` file (or set them in Netlify dashboard later):

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
```

## Step 5: Build the Project

```bash
npm run build
```

This creates the `dist/` folder.

## Step 6: Deploy

### Option A: Link to a new Netlify site & deploy

```bash
netlify init
```

Follow the prompts:
- **Create & configure a new site**
- **Build command:** `npm run build`
- **Deploy directory:** `dist`

Then deploy:

```bash
netlify deploy --prod
```

### Option B: Quick deploy without linking

```bash
netlify deploy --dir=dist --prod
```

You'll be prompted to select or create a site.

---

## Step 7: Set Environment Variables on Netlify

```bash
netlify env:set VITE_SUPABASE_URL "your_supabase_url"
netlify env:set VITE_SUPABASE_PUBLISHABLE_KEY "your_supabase_anon_key"
```

Then redeploy:

```bash
netlify deploy --prod
```

---

## 🔄 Future Deploys

After making changes:

```bash
npm run build
netlify deploy --prod
```

Or set up **continuous deployment** by connecting your Git repo in the Netlify dashboard — every push will auto-deploy.

---

## ✅ Verify

Your site will be live at the URL shown in the CLI output (e.g., `https://your-site.netlify.app`).
