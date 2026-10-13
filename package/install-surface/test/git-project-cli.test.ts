import {expect, test} from "bun:test";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {runGitProjectCommand} from "../src/onboarding/git-project-cli.ts";

test("Git CLI rejects authority and observer injection with fixed errors", async () => {
  let reads = 0;
  expect((await runGitProjectCommand(["inspect", "extra"], () => {reads++; return "{}";})).code).toBe(2);
  expect(reads).toBe(0);
  for (const raw of ["{", " ".repeat(65537), JSON.stringify({capsule: {}, binding: {}, probe: {}}), JSON.stringify({capsule: {}, binding: {}, volume_proofs: []}), JSON.stringify({capsule: {}, binding: {}, mode: "execute"})]) {
    const result = await runGitProjectCommand(["inspect"], () => raw);
    expect(result.code).toBe(2); expect(result.stdout).toBe("");
  }
  const result = await runGitProjectCommand(["inspect"], () => {throw new Error("private-secret");});
  expect(result.stderr).not.toContain("private-secret");
});

test("actual main CLI inspects a disposable Git binding without Superset or authority", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "temperance-git-cli-"))); const repo = join(root, "repo"); mkdirSync(repo);
  const git = (args: string[]) => execFileSync("git", ["-C", repo, ...args], {stdio: ["ignore", "pipe", "pipe"]});
  try {
    git(["init", "-b", "main"]); writeFileSync(join(repo, "fixture"), "fixture"); git(["add", "fixture"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    git(["remote", "add", "origin", "https://github.com/example/repo.git"]);
    const capsule = {schema: "temperance.project-capsule.v1", version: {major: 1, minor: 0}, id: "repo", repository_identity: "github.com/example/repo", root_variable: "PROJECTS", relative_path: "repo", access: "read-write", approved: true};
    const binding = {schema: "temperance.host-binding.v1", version: {major: 1, minor: 0}, profile_id: "host", variables: {PROJECTS: root}, secret_references: {}, routing_aliases: [], volume_bindings: []};
    const child = Bun.spawn([process.execPath, "src/cli.ts", "git-project", "inspect"], {stdin: "pipe", stdout: "pipe", stderr: "pipe"});
    child.stdin.write(JSON.stringify({capsule, binding, mode: "write"})); child.stdin.end();
    const output = await new Response(child.stdout).text(); expect(await child.exited).toBe(0);
    const evidence = JSON.parse(output); expect(evidence.state).toBe("verified"); expect(evidence.mode).toBe("write"); expect(evidence.execution_authorized).toBe(false); expect(evidence.lease_authorized).toBe(false);
    expect(output).not.toContain(root); expect(output).not.toContain("superset");
    capsule.approved = false;
    const held = await runGitProjectCommand(["inspect"], () => JSON.stringify({capsule, binding})); expect(held.code).toBe(0); expect(JSON.parse(held.stdout).reason_code).toBe("PROJECT_NOT_APPROVED");
  } finally {rmSync(root, {recursive: true, force: true});}
});
