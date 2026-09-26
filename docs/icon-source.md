# Icon outline provenance

The square contour in `resources/icon.svg` is imported directly from Apple's production template, not a hand-drawn approximation or a rounded rectangle with an estimated radius.

- Official resource index: https://developer.apple.com/design/resources/
- Download: https://devimages-cdn.apple.com/design/resources/download/iOS-27-Icon-Templates-Photoshop-Illustrator.dmg
- Source file: `iOS 27 - Icon Templates - Illustrator/App Icon Template.ai`
- Source SHA-256: `77939be3abe595f4db01c7e826439c78cbd94e90b4990cb7489105cae88f9453`
- Contour: all 40 original cubic Bézier segments and 4 straight segments from the compound icon mask; the surrounding rectangular cutout is excluded.
- Transform: uniformly scale the 1024-unit contour to 412 units, then translate by (50, 50) in our 512-unit transparent canvas. No control points are fitted or changed independently.

The template's accompanying Icon Composer project declares its square platforms as `shared`. The original template package is not redistributed. Obtain it from Apple and accept its license before running the importer:

```sh
uv run --with pymupdf python scripts/import-icon-outline.py '/path/to/App Icon Template.ai'
npm run icons
```

All platform exports use the same SVG. The source geometry is separate from OS-applied visual effects such as shadows or glass rendering.
