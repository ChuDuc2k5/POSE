# TERAVA vector brand assets

The website uses the building-shaped T, geometric TERAVA lettering and REAL ESTATE tagline from the identity board supplied by the project owner.

All six website logo assets are now SVG vectors. Both the main lettering and the small tagline use paths, so they stay sharp at any display size without relying on installed fonts. The square navy, white and lavender variants share the same mark geometry.

| Asset | Placement |
| --- | --- |
| `public/brand/terava-horizontal.svg` | Full horizontal lockup on the light desktop homepage navigation |
| `public/brand/terava-wordmark.svg` | White lettering paired with a square icon on dark headers, footer and workspace surfaces |
| `public/brand/terava-mark.svg` | Standalone T/building emblem on sign-in and registration forms |
| `public/brand/terava-icon-navy.svg` | Dark footer signature, shared headers and administration sidebar |
| `public/brand/terava-icon-white.svg` | Compact homepage navigation on phones |
| `public/brand/terava-icon-lavender.svg` | Account and authentication signatures |

The browser favicon reuses `public/brand/terava-icon-navy.svg` through `metadata.icons` in `app/layout.tsx`. No duplicate PNG favicon or dedicated Apple touch icon is stored in `app/`.

Use the shared `Brand` component for linked logos and `TeravaMark` for decorative emblems. The homepage changes to the white square icon below 760px. Keep the supplied letterforms and aspect ratios; do not rebuild the main wordmark with a system font or upscale a raster screenshot.

Run `node scripts/generate-brand-assets.mjs` from `frontend/` to regenerate all six SVG files from the shared vector paths. The obsolete raster logo files have been removed.
