# Standalone PWA (No PC Server)

## Goal
- Run dashboard on Android tablet without local Flask/PC server.
- Use direct public market data + local cache fallback.

## What this app does
- URL entry: `standalone_pwa/index.html`
- Tabs:
  - KR: DIRECT -> CACHE
  - US: DIRECT -> CACHE
  - Closing: DIRECT(KR proxy) -> CACHE
- Cache TTL:
  - KR: 30 min
  - US: 30 min
  - Closing: 6 hours

## Deploy (recommended)
- Host this `standalone_pwa/` directory on any HTTPS static host:
  - GitHub Pages
  - Netlify
  - Cloudflare Pages
- Then open the HTTPS URL on tablet and install as PWA.

## Why HTTPS matters
- PWA install + Service Worker require secure context (HTTPS or localhost).
- This is why local file open (`file://`) is not recommended for final use.

## Notes
- Keys are stored in an encrypted vault (`IndexedDB + WebCrypto AES-GCM`).
- Use `Settings -> Load Keys` when you need to load saved keys into the input form again.
- This app intentionally avoids backend endpoints.
- Data quality depends on availability/policy of direct market endpoints.
