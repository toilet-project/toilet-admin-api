# Admin Hangul Point identity

Administrator login cards use the approved `geupddong-hangul-point` v1.0.0 Korean lockup and keep `GEUPDDONG ADMIN`. The home and shared sidebar headers use compact `급똥` text with `WORKSPACE` to reserve room for navigation. `src/main/resources/static/brand.css` owns their responsive sizing.

Assets under `static/brand/hangul-point-v1/` are self-contained exports from the approved `geupddong-brand-master-v1` package:

| Admin asset | Master source | SHA-256 of unchanged export |
| --- | --- | --- |
| `lockup-ko.svg` | `svg/lockup-ko.svg` | `9e85dd490845b8d74e490b7e9c666d5741b6e19150b4b4e8ef973161ea96a4d6` |
| `favicon.svg` | `svg/favicon-micro.svg` | `9d41ff15f04a020156273574af57d97f618d27a1028493dc404dc6ab369b7b92` |
| `favicon-32.png` | `png/favicon-32.png` | `6ce0384048e6a49cbda4b030d43ad2f3e3607b4c3929fda3609d21770e3628e4` |

`apple-touch-icon.png` is an opaque 180×180 resize of the master's 1024×1024 app icon. `/favicon.ico` packages the master's unchanged 16, 32 and 48px PNG favicon exports in an ICO container. Use the micro favicon layout for browser icons and the app-icon layout for the touch icon.

All 16 HTML entry points declare the shared brand stylesheet, SVG/PNG favicon and touch icon. The versioned asset directory and updated shell/style query versions let existing browser caches move to the new artwork. Header brand links use text; login artwork remains a shared image asset.

Preview servers/gateways allow only these named brand files; image responses preserve their binary bytes and existing authentication rules. Functional restroom markers, navigation pictograms, and Google/Kakao login actions are separate from this identity and are unchanged.

Deployment follows the existing `.github/workflows/deploy.yml`: a push to `main` builds the Spring application and Docker image, then deploys through the pinned Cloudflare Tunnel SSH transport to the mini PC. A feature-branch push or PR alone does not deploy it.
