# Third-party notices

## shanten-dp 0.3.2

- Author: tomohxx
- Source: https://github.com/tomohxx/shanten-dp-rust
- Package: https://crates.io/crates/shanten-dp/0.3.2
- License: MIT, reproduced in `public/licenses/shanten-dp-MIT.txt`.
- Usage: compiled into `src/paili_engine.wasm`; unmodified upstream calculation algorithm, with an original scalar ABI wrapper in `engine/src/lib.rs`.

The Rust dependency graph is pinned in `engine/Cargo.lock`. Runtime transitive dependencies include bitflags (MIT OR Apache-2.0) and thiserror (MIT OR Apache-2.0). Their MIT notices are included in `public/licenses/`.

## Local recognition samples

- Tenhou tile source: `https://cdn.tenhou.net/2/t/{tile}.gif`, starting from the user-provided `2m.gif`.
- Public Mahjong Soul screenshot sources and original URLs are recorded in `samples/majsoul-sources.json`.
- Additional public Tenhou/Mahjong Soul screenshots are recorded in `samples/real-screenshot-sources.json` and `samples/shape-holdout-sources.json`, including original URLs, reviewed crops and image hashes.
- Downloaded images and derived sample PNGs stay under ignored `samples/private/`; they are not bundled in the plugin or covered by the shanten-dp MIT license. Generated manifests preserve source URLs and SHA-256 digests.
- `sharp` is a development dependency used by sample/template preparation and tests; its license is Apache-2.0. It is not imported into the plugin runtime.

## Local recognition templates

- Four libraries are retained under `assets/`: Mahjong Soul standard, Cat Saint, Birdie and Fishie, and Tenhou standard. Each source folder includes `source.json` with provenance and original file hashes.
- Mahjong Soul standard was copied from the user's riichi.moe `tiles/discard tiles/mjp_default/hand.png` download. Cat Saint came from the public Mahjong Soul web client resources. Birdie and Fishie came from the riichi.moe Unity texture extraction mirror. Exact URLs, where available, are in the source metadata.
- The 37 Tenhou GIFs were copied byte-for-byte from the existing local cache of `https://cdn.tenhou.net/2/t/{tile}.gif`.
- `assets/recognition-templates/` contains 148 lossless PNG crops and a manifest of source rectangles and SHA-256 digests. `src/generated/tile-templates.json` contains derived glyph/color descriptors embedded in the plugin for offline matching. Original atlases and individual PNGs are not bundled; descriptors are derived from these third-party images.
- These game images and derivatives are not covered by shanten-dp's MIT license. The source records document provenance, not a redistribution license grant. The visible hand editor continues to use original text/CSS tiles.

## Reference application

- Article: https://zenn.dev/tomohxx/articles/1ef63a4d438aba
- Application source: https://github.com/tomohxx/pairi
- Inspected commit: `6da8b46bc8b68fa936985dfb6f9bdce604c211e7`

No license file was found in that application snapshot. This prototype does not copy its UI, React components, WASM wrapper, or tile SVG files. The reusable licensed dependency is shanten-dp, listed above.
