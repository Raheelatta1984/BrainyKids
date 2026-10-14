# BrainyKids

BrainyKids Challenge Mode, built with Next.js and the App Router.

This repository currently includes a minimal landing page. Add the challenge
application under `src/app` as it is developed.

## Local development

Use a supported Node.js LTS version, such as Node.js 22.

```sh
npm ci
npm run dev
```

Open http://localhost:3000.

## Verify a production build

```sh
npm run lint
npm run typecheck
npm run build
npm start
```

The landing page does not require environment variables or a database connection.

## Deploy on Vercel

Import this repository with these project settings:

- **Framework Preset:** Next.js
- **Root Directory:** the repository root (leave the field empty/default)
- **Build Command:** `npm run build` (the Next.js default)
- **Output Directory:** leave at the Next.js default; do not set it to `out`

Commit the source files and deploy the branch containing them. If Vercel's
production branch is `main`, merge the changes into `main` before deploying.
Redeploying a commit that does not include `src/app` will reproduce the original
error.

### Why the original build failed

Next.js needs an `app` or `pages` directory, either at the repository root or
inside `src`. The initial repository contained package/configuration files but
neither directory, so `next build` failed with:

```text
Couldn't find any `pages` or `app` directory. Please create one under the project root
```

`src/app/layout.tsx` now supplies the required root layout (including `<html>` and
`<body>`), and `src/app/page.tsx` supplies the `/` route. The npm deprecation and
configuration warnings in the original log were not the cause of this failure.
