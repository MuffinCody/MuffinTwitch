// Erzeugt latest.json für den Tauri-Updater aus dem signierten Windows-Installer.
// Aufruf (nach `npm run release:win`):  node scripts/make-latest-json.mjs [notes.txt]
// Die .sig-Datei enthält nur die öffentliche Signatur – keine Geheimnisse.
import { readFileSync, writeFileSync } from "node:fs";

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const version = conf.version;
const exe = `MuffinTwitch_${version}_x64-setup.exe`;
const sig = readFileSync(`src-tauri/target/release/bundle/nsis/${exe}.sig`, "utf8").trim();
const notes = process.argv[2] ? readFileSync(process.argv[2], "utf8").trim() : `MuffinTwitch ${version}`;

const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: sig,
      url: `https://github.com/MuffinCody/MuffinTwitch/releases/download/v${version}/${exe}`,
    },
  },
};
writeFileSync("latest.json", JSON.stringify(latest, null, 2) + "\n");
console.log(`latest.json für v${version} geschrieben.`);
