/// <reference types="vite/client" />

declare module "*.wasm?url&inline" {
  const dataUrl: string;
  export default dataUrl;
}
