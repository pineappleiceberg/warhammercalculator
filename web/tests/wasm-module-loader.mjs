import { readFile } from "node:fs/promises";

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".wasm")) return nextLoad(url, context);

  const bytes = await readFile(new URL(url));
  const encoded = bytes.toString("base64");
  return {
    format: "module",
    shortCircuit: true,
    source: `const bytes = Uint8Array.from(atob(${JSON.stringify(encoded)}), value => value.charCodeAt(0)); export default new WebAssembly.Module(bytes);`,
  };
}
