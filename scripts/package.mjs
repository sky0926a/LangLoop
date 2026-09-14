import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
rmSync("dist/langloop-extension.zip", { force: true });
execFileSync("zip", ["-qr", "../langloop-extension.zip", "."], {
  cwd: "dist/extension",
});
console.log("Created dist/langloop-extension.zip");
