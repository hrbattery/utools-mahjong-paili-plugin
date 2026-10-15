import { copyFileSync } from "node:fs";

// Ship the original-code license and third-party exceptions with every plugin build.
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  copyFileSync(new URL(`../${file}`, import.meta.url), new URL(`../dist/${file}`, import.meta.url));
}
