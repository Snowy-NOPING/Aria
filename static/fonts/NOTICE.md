# Bundled fonts

## Figtree (`Figtree-Variable.ttf`)

Variable weight axis, 45–920. Version 2.001.

Verbatim from the font's own `name` table:

- **Copyright:** Copyright 2022 The Figtree Project Authors
  (https://github.com/erikdkennedy/figtree)
- **Designer:** Erik Kennedy
- **License:** This Font Software is licensed under the SIL Open Font License,
  Version 1.1. This license is available with a FAQ at:
  https://openfontlicense.org

The OFL permits bundling and redistribution, and requires the license text to
travel with the font. `OpenRunde-LICENSE.txt` in this folder is the full OFL 1.1
text and covers that requirement for both fonts; only its copyright line is
specific to Open Runde. Figtree's own copyright is quoted above.

Used for lyrics only, via `--font-lyrics` in `src/app.css`. Figtree is also what
Cider uses for its lyrics view, which is where the look comes from.

## Open Runde (`OpenRunde-{Regular,Medium,Semibold,Bold}.woff2`)

- **Copyright:** Copyright (c) 2016 The Inter Project Authors
  (https://github.com/rsms/inter) — Open Runde is Lauris Kern's rounded
  derivative, https://github.com/lauridskern/open-runde
- **License:** SIL Open Font License 1.1, full text in
  `OpenRunde-LICENSE.txt`.

The fallback for SF Pro. SF can't be redistributed, so a checkout that doesn't
have it needs somewhere to land, and Open Runde's rounded terminals stay far
closer to SF than Segoe UI does. It sits behind SF Pro in `--font` and
`--font-display`: an `@font-face` whose file is missing is skipped, so the stack
is the only switch involved. 800 is synthesised from Bold.

Upstream WOFF2s subset to Latin + Latin-Ext with `fontTools.subset`
(645 KB -> 288 KB), matching what was done to SF Pro.

## SF Pro (SFProText-*.woff2, SFProDisplay-*.woff2)

San Francisco is Apple's system typeface, provided under the Apple Developer
Font Licence. Apple permits its use in user interfaces but restricts
redistribution, so these files are bundled for local/personal builds only and
should be removed before distributing this app to anyone else.

Sourced from the SF Pro OTF release, converted to WOFF2 and subset to Latin +
Latin-Ext (17.5 MB -> 563 KB). Weights: Text 400/500/600/700,
Display 500/600/700/800.
