# Third-party notices

## License scope

The root `LICENSE` applies to original project code, including the Rust ABI wrapper and original plugin logo. It does not relicense third-party code, artwork, game images, crops, or recognition data derived from game images. Those materials retain their respective rights and license terms described below. The build includes this notice, the root `LICENSE`, and `public/licenses/` in the plugin package.

## shanten-dp 0.3.2

- Author: tomohxx
- Source: https://github.com/tomohxx/shanten-dp-rust
- Package: https://crates.io/crates/shanten-dp/0.3.2
- License: MIT, reproduced in `public/licenses/shanten-dp-MIT.txt`.
- Usage: compiled into `src/paili_engine.wasm`; unmodified upstream calculation algorithm, with an original scalar ABI wrapper in `engine/src/lib.rs`.

The Rust dependency graph is pinned in `engine/Cargo.lock`. Runtime transitive dependencies include bitflags (MIT OR Apache-2.0) and thiserror (MIT OR Apache-2.0). Their MIT notices are included in `public/licenses/`.

## Local recognition templates and samples

- Four libraries are retained under `assets/`: Mahjong Soul standard, Cat Saint, Birdie and Fishie, and Tenhou standard. Each source folder includes `source.json` with provenance and original file hashes.
- Mahjong Soul standard was copied from the user's riichi.moe `tiles/discard tiles/mjp_default/hand.png` download. Cat Saint came from the public Mahjong Soul web client resources. Birdie and Fishie came from the riichi.moe Unity texture extraction mirror. Exact URLs, where available, are in the source metadata.
- Tenhou tile source: `https://cdn.tenhou.net/2/t/{tile}.gif`, starting from the user-provided `2m.gif`. The 37 template GIFs were copied byte-for-byte from the existing local cache.
- Templates: `assets/recognition-templates/` contains 148 lossless PNG crops and a manifest of source rectangles and SHA-256 digests. `src/generated/tile-templates.json` contains derived glyph/color descriptors embedded in the plugin for offline matching.
- Samples: public Mahjong Soul screenshot sources and original URLs are recorded in `samples/majsoul-sources.json`. Additional Tenhou/Mahjong Soul screenshots are recorded in `samples/real-screenshot-sources.json` and `samples/shape-holdout-sources.json`, including original URLs, reviewed crops and image hashes.
- Source distribution: original atlases, Tenhou tile GIFs, 148 cropped template PNGs, and derived recognition descriptors are tracked in this repository and remain in its existing Git history. Making the repository public exposes these files and their historical versions.
- Plugin distribution: original atlases, tile GIFs, and individual template PNGs are not bundled. Downloaded screenshots and derived sample PNGs stay under ignored `samples/private/` and are not bundled either. The plugin embeds the derived recognition descriptors; source manifests retain provenance and SHA-256 digests.
- No explicit redistribution grant for these game images, crops, or derived recognition descriptors was verified during the 2026-10-15 review. They are excluded from the root MIT license as well as shanten-dp's MIT license. Public availability, cropping, and feature extraction are not recorded here as permission to redistribute. See `docs/ASSET_REVIEW.md` for the review scope and unresolved status.

## Display tile artwork

- Author/source: lietxia, https://github.com/lietxia/mahjong_graphic, commit `3e275804ff58325306710bef3a7406860444bc6a`.
- The 37 SVGs in `public/tiles/mahjong-graphic/` are unmodified copies of `Vectors 矢量图/SVG/{tile}.svg`, including the three red fives and white dragon. File hashes and upstream paths are recorded in `assets/mahjong-graphic/source.json`.
- License: upstream M+ Font License, reproduced verbatim in `public/licenses/mahjong-graphic-Mplus.txt` and distributed with the plugin. It permits use, copying, modification and redistribution, including commercial use, without warranty.
- Upstream credits some glyphs to SyaoranHinata/I.Mahjong and GL-MahjongTile; see its `readme.md`.
- Usage: offline display in the hand editor, tile palette, discards and waits. These SVGs are separate from the recognition template library.

## Development tooling

- `sharp`: Apache-2.0; used to prepare recognition samples/templates and process images in tests. It is not imported into the plugin runtime.

## Reference application

- Article: https://zenn.dev/tomohxx/articles/1ef63a4d438aba
- Application source: https://github.com/tomohxx/pairi
- Inspected commit: `6da8b46bc8b68fa936985dfb6f9bdce604c211e7`

No license file was found in that application snapshot. This prototype does not copy its UI, React components, WASM wrapper, or tile SVG files. The reusable licensed dependency is shanten-dp, listed above.
