// Ambient declaration for global stylesheet side-effect imports
// (e.g. `import "./globals.css"`). Next.js only ships types for
// *.module.css / *.module.scss, not bare global *.css — without this,
// TS reports 2882 ("Cannot find module ... for side-effect import")
// under moduleResolution: "bundler".
//
// CSS Modules are unaffected: `*.module.css` is a more specific match,
// so `import styles from "./x.module.css"` keeps Next's typed declaration.
declare module "*.css";
