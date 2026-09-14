import { readFile, writeFile, readdir } from "node:fs/promises";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
let result =
  "LangLoop — third-party dependency notices\n\nRuntime dependencies bundled into the extension:\n";
for (const [dir, pkg] of Object.entries(lock.packages)) {
  if (!dir) continue;
  result += `\n${dir.replace(/^node_modules\//, "")} ${pkg.version} — ${pkg.license || "See package license"} (${pkg.dev ? "development only" : "runtime"})\n`;
  if (!pkg.dev) {
    const names = (await readdir(dir)).filter((n) =>
      /^(license|notice|copying)/i.test(n),
    );
    if (!names.length) throw new Error("License missing: " + dir);
    for (const name of names)
      result += "\n" + (await readFile(dir + "/" + name, "utf8")) + "\n";
  }
}
result += "\n" + await readFile("licenses/CLIProxyAPI.txt", "utf8");
await writeFile("THIRD_PARTY_NOTICES.txt", result);
