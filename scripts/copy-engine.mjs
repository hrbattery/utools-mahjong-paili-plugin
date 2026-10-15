import { copyFileSync } from "node:fs";

copyFileSync(
  "engine/target/wasm32-unknown-unknown/release/paili_engine.wasm",
  "src/paili_engine.wasm",
);
