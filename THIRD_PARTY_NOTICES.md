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
- Downloaded images and derived sample PNGs stay under ignored `samples/private/`; they are not bundled in the plugin or covered by the shanten-dp MIT license. Generated manifests preserve source URLs and SHA-256 digests.
- `sharp` is a development dependency used only by the sample preparation scripts; its license is Apache-2.0. It is not imported into the plugin runtime.

## Reference application

- Article: https://zenn.dev/tomohxx/articles/1ef63a4d438aba
- Application source: https://github.com/tomohxx/pairi
- Inspected commit: `6da8b46bc8b68fa936985dfb6f9bdce604c211e7`

No license file was found in that application snapshot. This prototype does not copy its UI, React components, WASM wrapper, or tile SVG files. The reusable licensed dependency is shanten-dp, listed above.
