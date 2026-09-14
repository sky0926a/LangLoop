import { build } from "vite";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await build({
  build: { outDir: "dist/extension", rollupOptions: { input: "panel.html" } },
});
await build({
  build: {
    outDir: "dist/extension",
    emptyOutDir: false,
    lib: {
      entry: "src/background.ts",
      formats: ["es"],
      fileName: () => "background.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
await build({
  build: {
    outDir: "dist/extension",
    emptyOutDir: false,
    lib: {
      entry: "src/page-entry.ts",
      formats: ["iife"],
      name: "LangLoopPage",
      fileName: () => "page.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
await mkdir("public", { recursive: true });
const manifest = {
  manifest_version: 3,
  name: "LangLoop",
  version: pkg.version,
  minimum_chrome_version: "116",
  description: "Read, write, and learn with your own AI provider.",
  key: (await readFile("public/identity.txt", "utf8")).trim(),
  permissions: [
    "activeTab",
    "scripting",
    "storage",
    "sidePanel",
    "contextMenus",
  ],
  host_permissions: ["http://*/*", "https://*/*"],
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["page.js"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  icons: { 16: "icon.png", 32: "icon.png", 48: "icon.png", 128: "icon.png" },
  web_accessible_resources: [
    { resources: ["icon.png"], matches: ["http://*/*", "https://*/*"] },
  ],
  action: { default_title: "Open LangLoop", default_icon: "icon.png" },
  side_panel: { default_path: "panel.html" },
  options_page: "panel.html?settings",
  background: { service_worker: "background.js", type: "module" },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};
await writeFile(
  "dist/extension/manifest.json",
  JSON.stringify(manifest, null, 2),
);
for (const f of [
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
  "README.md",
  "README.zh-TW.md",
  "PRIVACY.md",
])
  await copyFile(f, "dist/extension/" + f);

await copyFile("docs/install.txt", "dist/extension/INSTALL.txt");
