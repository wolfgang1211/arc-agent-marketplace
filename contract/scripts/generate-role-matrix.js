#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const roles = ["client", "operator", "resolver", "house", "testClient", "owner", "treasury"];
const paths = ["post", "award", "dispute", "resolve", "recovery", "fault-review", "mutual", "timeout"];
const rows = [];
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) for (const lifecycle of paths) {
  const same = [roles[i], roles[j]];
  const operatorResolver = same.includes("operator") && same.includes("resolver");
  const houseOperator = same.includes("house") && same.includes("operator");
  const clientTestClient = same.includes("client") && same.includes("testClient");
  const expected = lifecycle === "post" ? "allow" : operatorResolver ? "revert:Conflict" : houseOperator && !clientTestClient ? "revert:Conflict" : "prerequisite-dependent";
  rows.push({ id: `R-${String(rows.length + 1).padStart(3, "0")}`, equalRoles: same, distinctRoles: roles.filter((r) => !same.includes(r)), lifecycle, expected, status: "unverified", note: "Generated acceptance ledger; requires dedicated real-EVM lifecycle execution before closure." });
}
const out = { name: "v2-role-collision-matrix", generatedAt: new Date().toISOString(), roles, paths, pairCount: 21, cellCount: rows.length, counts: { unverified: rows.length }, rows };
const dir = path.resolve(__dirname, "../docs");
fs.writeFileSync(path.join(dir, "rolecollisionmatrix.json"), JSON.stringify(out, null, 2) + "\n");
const md = ["# V2 role-collision matrix", "", `Pair count: ${out.pairCount}; lifecycle paths: ${paths.length}; cells: ${out.cellCount}.`, "", "Every row is explicitly unverified until exercised by its dedicated real-EVM lifecycle test. No unverified row is counted as pass.", "", "| ID | Equal roles | Path | Expected policy | Status |", "|---|---|---|---|---|", ...rows.map((r) => `| ${r.id} | ${r.equalRoles.join(" = ")} | ${r.lifecycle} | ${r.expected} | ${r.status} |`)].join("\n") + "\n";
fs.writeFileSync(path.join(dir, "rolecollisionmatrix.md"), md);
console.log(JSON.stringify({ pairCount: out.pairCount, cellCount: out.cellCount, status: out.counts }, null, 2));
