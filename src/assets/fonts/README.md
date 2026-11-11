# Note Sans SC subset

`note-sans-sc.woff2` is a subset of Google's Noto Sans SC variable font. The source is `ofl/notosanssc/NotoSansSC[wght].ttf` in the Google Fonts repository. Its SIL Open Font License is bundled at `src/static/fonts/NotoSansSC-OFL.txt`.

The subset contains ~2,900 frequently used Han characters from `common-han.txt`, every Han character currently present in `src`, basic Latin, and app punctuation. The included variable weight range is 400–700. Characters outside the subset fall back to the device font.

The font stack prefers the platform system font on Apple devices (SF + PingFang) so they keep native typography without downloading the package; other platforms use the bundled subset for consistent CJK rendering. The embedded CSS lives in `src/styles/font.scss` and is imported by `src/styles/global.scss`.

To rebuild after adding new UI text, download the source TTF and run `pnpm font:css <path-to-source-ttf>`. To rebuild only the embedded CSS after changing the WOFF2, run `pnpm font:css`. The local `@font-face` path did not load in the WeChat developer tool, so system fallback remains necessary there.