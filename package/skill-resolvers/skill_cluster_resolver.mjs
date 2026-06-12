#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const home = process.env.HOME || "";
const indexPath = process.env.SKILL_CLUSTER_INDEX || path.join(home, ".agents", "skill-clusters", "skill-index.json");

function main() {
  if (!fs.existsSync(indexPath)) {
    console.log(JSON.stringify({ continue: true, temperance: "skill-index-missing", indexPath }));
    return;
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  console.log(JSON.stringify({ continue: true, temperance: "skill-index-present", skills: Object.keys(index.skills || {}).length }));
}

main();
