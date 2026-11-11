# TMS icon font

`tms-icons.ttf` contains only the Bootstrap Icons used by `TmsIcon.vue`. The
mapping from business names to upstream icons lives in
`src/components/business/icon-manifest.json`.

After changing the manifest, run `pnpm icons:build`. This regenerates the font
and `icon-glyphs.ts`. Keep both generated files in the same change. The font
stays below 40 KB so Uni-app can inline it for WeChat mini programs.

Bootstrap Icons is distributed under the MIT license in this directory.
