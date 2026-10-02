import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(new URL("../query-weekly-work-graph.mjs", import.meta.url), "utf8");
const actualGraph = JSON.parse(
  readFileSync(
    new URL("../../docs/meetings/current-week-work-graph.json", import.meta.url),
    "utf8",
  ),
);

function runGraph(change) {
  // Isolate one real task with no dependencies; unrelated broken external-owner
  // references in the current graph must not mask the validation under test.
  const graph = structuredClone(actualGraph);
  graph.tasks = [graph.tasks.find((task) => task.id === "W2026-08-22-02")];
  graph.tasks[0].dependsOn = [];
  change?.(graph.tasks[0]);
  const directory = mkdtempSync(join(tmpdir(), "haggle-work-graph-"));
  try {
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "docs", "meetings"), { recursive: true });
    writeFileSync(join(directory, "scripts", "query-weekly-work-graph.mjs"), source);
    writeFileSync(
      join(directory, "docs", "meetings", "current-week-work-graph.json"),
      JSON.stringify(graph),
    );
    return spawnSync(
      process.execPath,
      [join(directory, "scripts", "query-weekly-work-graph.mjs"), "jeonghaengheo"],
      { encoding: "utf8" },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function withoutReviewer(task) {
  task.reviewerId = null;
  task.reviewerAssignmentStatus = null;
  // Historical reason text is retained when a reviewer has never been assigned.
}

test("an assigned task needs no reviewer and prints review as optional", () => {
  const result = runGraph(withoutReviewer);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /리뷰어 \(선택\): 미지정/);
  assert.match(result.stdout, /W2026-08-22-02/);
});

test("done and not_assigned remain valid without reviewer approval metadata", () => {
  const result = runGraph((task) => {
    withoutReviewer(task);
    task.status = "done";
    task.reviewerAssignmentStatus = "not_assigned";
    task.reviewerReason = null;
  });
  assert.equal(result.status, 0, result.stderr);
});

test("omitted reviewer fields are optional", () => {
  const result = runGraph((task) => {
    delete task.reviewerId;
    delete task.reviewerAssignmentStatus;
    delete task.reviewerReason;
  });
  assert.equal(result.status, 0, result.stderr);
});

test("existing proposed reviewer assignments remain intact and usable", () => {
  const result = runGraph();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /리뷰어 \(선택\): 인오/);
});

test("a missing owner is still rejected when no reviewer is assigned", () => {
  const result = runGraph((task) => {
    withoutReviewer(task);
    task.ownerId = null;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /유효한 담당자 한 명/);
});

test("a broken dependency is still rejected when no reviewer is assigned", () => {
  const result = runGraph((task) => {
    withoutReviewer(task);
    task.dependsOn = ["missing-task"];
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /없는 작업 missing-task/);
});

test("an explicitly assigned reviewer must still exist and differ from the owner", () => {
  const missing = runGraph((task) => {
    task.reviewerId = "unknown-person";
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /지정한 리뷰어 참조가 유효하지 않음/);
  const same = runGraph((task) => {
    task.reviewerId = task.ownerId;
  });
  assert.equal(same.status, 1);
  assert.match(same.stderr, /담당자와 리뷰어는 달라야 함/);
});
