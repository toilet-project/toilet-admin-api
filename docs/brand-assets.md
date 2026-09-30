# Admin Hangul Point identity

Administrator login cards and sidebar headers use the public service's Jua wordmark in `#17683a`. The two-character font subset is self-hosted at `static/brand/jua/geupddong.ttf`, with its Google Fonts OFL license alongside it. Login cards keep `GEUPDDONG ADMIN`; the expanded sidebar keeps `WORKSPACE`. `src/main/resources/static/brand.css` owns their sizing. Body text keeps the existing UI font.

Assets under `static/brand/hangul-point-v1/` are self-contained exports from the approved `geupddong-brand-master-v1` package:

| Admin asset | Master source | SHA-256 of unchanged export |
| --- | --- | --- |
| `lockup-ko.svg` | `svg/lockup-ko.svg` | `9e85dd490845b8d74e490b7e9c666d5741b6e19150b4b4e8ef973161ea96a4d6` |
| `favicon.svg` | `svg/favicon-micro.svg` | `9d41ff15f04a020156273574af57d97f618d27a1028493dc404dc6ab369b7b92` |
| `favicon-32.png` | `png/favicon-32.png` | `6ce0384048e6a49cbda4b030d43ad2f3e3607b4c3929fda3609d21770e3628e4` |

`apple-touch-icon.png` is an opaque 180×180 resize of the master's 1024×1024 app icon. `/favicon.ico` packages the master's unchanged 16, 32 and 48px PNG favicon exports in an ICO container. Use the micro favicon layout for browser icons and the app-icon layout for the touch icon.

All 17 HTML entry points declare the shared brand stylesheet, SVG/PNG favicon and touch icon. Header and login wordmarks use the same text/font/color; the exported lockup remains available as an archived brand asset. Versioned stylesheet references refresh existing browser caches.

Preview servers/gateways allow only these named brand files; image responses preserve their binary bytes and existing authentication rules. Functional restroom markers, navigation pictograms, and Google/Kakao login actions are separate from this identity and are unchanged.

Deployment follows the existing `.github/workflows/deploy.yml`: a push to `main` builds the Spring application and Docker image, then deploys through the pinned Cloudflare Tunnel SSH transport to the mini PC. A feature-branch push or PR alone does not deploy it.
