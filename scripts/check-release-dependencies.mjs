import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const manifest = read("package.json"), lock = read("package-lock.json");
const versions = {};
for (const name of ["next", "react", "react-dom", "workflow", "@supabase/supabase-js"]) {
  const actual = read("node_modules/" + name + "/package.json").version;
  const expected = lock.packages["node_modules/" + name]?.version;
  if (!expected || actual !== expected || manifest.dependencies[name] !== lock.packages[""].dependencies[name])
    throw new Error(`Release dependency mismatch: ${name} installed ${actual}, locked ${expected}. Run npm ci; do not rewrite the lockfile.`);
  versions[name] = actual;
}
console.log("Verified release dependencies: " + JSON.stringify(versions));
