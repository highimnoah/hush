// Keep package.json, src-tauri/tauri.conf.json and the Rust crate version in
// sync with the Git tag that triggered a release build.
import { readFileSync, writeFileSync } from "node:fs";

const raw = process.env.RELEASE_TAG ?? "";
const version = raw.replace(/^v/, "").trim();

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid release tag: "${raw}" (expected v1.2.3)`);
  process.exit(1);
}

function updateJson(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.version = version;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

updateJson("package.json");
updateJson("src-tauri/tauri.conf.json");

const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8").replace(
  /^version = "[^"]*"/m,
  `version = "${version}"`,
);
writeFileSync(cargoPath, cargo);

const lockPath = "src-tauri/Cargo.lock";
const lock = readFileSync(lockPath, "utf8").replace(
  /(\[\[package\]\]\r?\nname = "hush"\r?\nversion = ")[^"]*(")/,
  `$1${version}$2`,
);
writeFileSync(lockPath, lock);

console.log(`Set app version to ${version}`);
