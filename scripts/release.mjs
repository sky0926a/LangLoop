import { readFile, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Invalid package version");
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${version}`)
  throw new Error("Release tag must match package.json version");
const manifest = JSON.parse(
  await readFile("dist/extension/manifest.json", "utf8"),
);
if (manifest.version !== version)
  throw new Error("Build version does not match package.json");
const bytes = await readFile("dist/langloop-extension.zip");
const packaged = JSON.parse(
  execFileSync(
    "unzip",
    ["-p", "dist/langloop-extension.zip", "manifest.json"],
    { encoding: "utf8" },
  ),
);
if (packaged.version !== version || packaged.key !== manifest.key)
  throw new Error("ZIP manifest does not match the build");
await rm("dist/release", { recursive: true, force: true });
await mkdir("dist/release", { recursive: true });
await copyFile(
  "dist/langloop-extension.zip",
  "dist/release/langloop-extension.zip",
);
await writeFile(
  "dist/release/SHA256SUMS.txt",
  `${createHash("sha256").update(bytes).digest("hex")}  langloop-extension.zip\n`,
);
await copyFile("docs/install.txt", "dist/release/INSTALL.txt");
await writeFile(
  "dist/release/RELEASE-NOTES.md",
  `# LangLoop v${version}\n\nDownload **langloop-extension.zip** under Assets, extract it, then use Chrome Developer mode → Load unpacked. Select the folder containing manifest.json. No Node.js or separate proxy is required. Configure your AI connection after installation.\n\n請下載 Assets 中的 **langloop-extension.zip**，解壓後到 Chrome 開發人員模式「載入未封裝項目」，選擇內含 manifest.json 的資料夾。安裝後仍需設定 AI 連線。\n\nSee INSTALL.txt for installation/update steps and SHA256SUMS.txt for the package checksum. Source code archives are not prebuilt extensions. Direct subscription adapters remain experimental; authorization and inference must be tested separately. Unpacked installations do not auto-update.\n`,
);
console.log(`Prepared release assets for v${version} in dist/release/`);
