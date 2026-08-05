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

The OFL permits bundling and redistribution. **The full OFL 1.1 text is not yet
included here** — it was not available offline when the font was added. Before
distributing Aria outside this machine, drop `OFL.txt` from
https://openfontlicense.org (or the Figtree repository) into this folder, since
the OFL requires the license text to travel with the font.

Used for lyrics only, via `--font-lyrics` in `src/app.css`. Figtree is also what
Cider uses for its lyrics view, which is where the look comes from.

## SF Pro (SFProText-*.woff2, SFProDisplay-*.woff2)

San Francisco is Apple's system typeface, provided under the Apple Developer
Font Licence. Apple permits its use in user interfaces but restricts
redistribution, so these files are bundled for local/personal builds only and
should be removed before distributing this app to anyone else.

Sourced from the SF Pro OTF release, converted to WOFF2 and subset to Latin +
Latin-Ext (17.5 MB -> 563 KB). Weights: Text 400/500/600/700,
Display 500/600/700/800.
