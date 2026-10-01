import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const apiRequire = createRequire(new URL("../../../api/package.json", import.meta.url));
const webRequire = createRequire(new URL("../../package.json", import.meta.url));
const { createServer } = await import(apiRequire.resolve("vite"));
const { default: react } = await import(webRequire.resolve("@vitejs/plugin-react"));
const local = (name) => fileURLToPath(new URL(name, import.meta.url));
const server = await createServer({
  configFile: false,
  root: local("./"),
  plugins: [react()],
  css: { postcss: local("../../") },
  resolve: {
    alias: [
      { find: "@/lib/api-client", replacement: local("./api.ts") },
      { find: "next/navigation", replacement: local("./navigation.ts") },
      { find: "next/link", replacement: local("./link.tsx") },
      { find: "@", replacement: local("../../src") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 4179,
    strictPort: true,
    fs: { allow: [local("../../../../")] },
  },
});
await server.listen();
