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
  define: { "process.env.NEXT_PUBLIC_API_URL": JSON.stringify("/api") },
  css: { postcss: local("../../") },
  resolve: { alias: { "@": local("../../src") } },
  server: {
    host: "127.0.0.1",
    port: 4181,
    strictPort: true,
    fs: { allow: [local("../../../../")] },
  },
});
await server.listen();
