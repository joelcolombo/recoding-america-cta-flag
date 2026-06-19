# Recoding America — CTA waving flag

A decorative, interactive Three.js cloth USA flag for the "Get Involved" CTA, rendered as
monochrome cyan line-art to match the site's diagram aesthetic (no red/blue fills).

## Usage (Webflow)
1. Add the custom attribute `data-cta-flag-host` to the CTA box element.
2. Include the script before `</body>` (or as a page/site footer script):
   `<script src="https://cdn.jsdelivr.net/gh/joelcolombo/recoding-america-cta-flag@<commit>/cta-flag.prod.min.js" defer></script>`

The script self-injects a layer into that box, mounts the flag behind the content, and
lazy-loads Three.js (r137) from jsDelivr. Respects `prefers-reduced-motion`.

## Files
- `cta-flag.prod.min.js` — minified production bundle (use this)
- `cta-flag.prod.js` — readable bundle
- `flag-art.js` / `flag-three.js` / `flag-init.js` — sources
