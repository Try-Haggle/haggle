#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const graphPath = resolve(scriptDirectory, "../docs/meetings/current-week-work-graph.json");

const graph = JSON.parse(await readFile(graphPath, "utf8"));

function fail(message) {
  console.error(`주간 작업 그래프 오류: ${message}`);
  process.exit(1);
}

function normalizeIdentity(value) {
  return value
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/^@/, "")
    .replace(/[\s._-]+/g, "");
}

function validateGraph() {
  if (graph.schemaVersion !== 1) {
    fail(`지원하지 않는 schemaVersion ${graph.schemaVersion}`);
  }

  const peopleById = new Map();
  const aliases = new Map();

  for (const person of graph.people) {
    if (peopleById.has(person.id)) {
      fail(`사람 ID가 중복됨: ${person.id}`);
    }
    peopleById.set(person.id, person);

    for (const alias of [person.id, person.displayName, ...person.aliases]) {
      const normalized = normalizeIdentity(alias);
      const existing = aliases.get(normalized);
      if (existing && existing !== person.id) {
        fail(`별칭 '${alias}'이 ${existing}, ${person.id}에 중복됨`);
      }
      aliases.set(normalized, person.id);
    }
  }

  const tasksById = new Map();
  for (const task of graph.tasks) {
    if (tasksById.has(task.id)) {
      fail(`작업 ID가 중복됨: ${task.id}`);
    }
    tasksById.set(task.id, task);

    if (!Array.isArray(task.dependsOn)) {
      fail(`${task.id}의 dependsOn은 배열이어야 함`);
    }

    if (task.status === "unassigned") {
      if (
        task.ownerId !== null ||
        task.reviewerId !== null ||
        task.reviewerAssignmentStatus !== "not_assigned" ||
        task.reviewerReason !== null
      ) {
        fail(`${task.id} 미배정 작업에는 담당자와 리뷰어를 두지 않음`);
      }
      continue;
    }

    if (typeof task.ownerId !== "string" || !peopleById.has(task.ownerId)) {
      fail(`${task.id}에 유효한 담당자 한 명이 필요함`);
    }
    if (typeof task.reviewerId !== "string" || !peopleById.has(task.reviewerId)) {
      fail(`${task.id}에 유효한 리뷰어 한 명이 필요함`);
    }
    if (task.ownerId === task.reviewerId) {
      fail(`${task.id}의 담당자와 리뷰어는 달라야 함`);
    }
    if (!["proposed", "confirmed"].includes(task.reviewerAssignmentStatus)) {
      fail(`${task.id}의 리뷰어 배정 상태는 proposed 또는 confirmed여야 함`);
    }
    if (typeof task.reviewerReason !== "string" || task.reviewerReason.length === 0) {
      fail(`${task.id}에 단일 리뷰어를 선택한 이유가 필요함`);
    }
  }

  for (const task of graph.tasks) {
    for (const dependencyId of task.dependsOn) {
      if (!tasksById.has(dependencyId)) {
        fail(`${task.id}가 없는 작업 ${dependencyId}를 기다림`);
      }
      if (dependencyId === task.id) {
        fail(`${task.id}가 자기 자신을 기다림`);
      }
    }
  }

  return { aliases, peopleById, tasksById };
}

const { aliases, peopleById, tasksById } = validateGraph();

const statusLabels = {
  planned: "예정",
  in_progress: "진행 중",
  blocked: "막힘",
  deferred: "후속",
  done: "완료",
  unassigned: "미배정",
};

function personName(personId) {
  return personId ? (peopleById.get(personId)?.displayName ?? personId) : "미배정";
}

function dueLabel(dueDate) {
  if (!dueDate) return "기한 미정";

  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (dueDate < localToday) return `${dueDate} · 기한 지남`;
  if (dueDate === localToday) return `${dueDate} · 오늘`;
  return dueDate;
}

function printHeader() {
  const { week } = graph;
  console.log(`\nHaggle 주간 작업 그래프 · ${week.meetingDate} 회의`);
  console.log(
    `회의: ${week.meetingDay} ${week.usualStartTimes.join(" 또는 ")} · ${week.scheduleNote}`,
  );
  console.log(`이번 주 끝: ${week.weekEndsAt} · 릴리스 목표: ${week.releaseTarget}`);
}

function printTask(task, options = {}) {
  const { includeOwner = false, reviewMode = false } = options;
  console.log(`\n- [${statusLabels[task.status] ?? task.status}] ${task.title} (${task.id})`);
  if (includeOwner) console.log(`  담당자: ${personName(task.ownerId)}`);
  if (!reviewMode && task.reviewerId) {
    const assignmentLabel =
      task.reviewerAssignmentStatus === "confirmed" ? "확정" : "다음 회의 확인 제안";
    console.log(`  리뷰어: ${personName(task.reviewerId)} · 정확히 1명 · ${assignmentLabel}`);
    console.log(`  리뷰어 선택 이유: ${task.reviewerReason}`);
  }
  console.log(`  영역: ${task.domains.join(", ")} · 기한: ${dueLabel(task.dueDate)}`);
  console.log(`  결과: ${task.outcome}`);

  if (reviewMode) {
    console.log(
      `  리뷰 배정: ${task.reviewerAssignmentStatus === "confirmed" ? "확정" : "다음 회의 확인 제안"}`,
    );
    console.log(`  내가 리뷰하는 이유: ${task.reviewerReason}`);
    console.log(`  리뷰할 내용: ${task.reviewBrief}`);
    console.log(`  확인할 증거: ${task.evidence.join(" / ")}`);
  } else {
    console.log(`  다음 행동: ${task.nextAction}`);
    if (task.dependsOn.length > 0) {
      const dependencies = task.dependsOn.map((dependencyId) => {
        const dependency = tasksById.get(dependencyId);
        return `${dependency.title} [${statusLabels[dependency.status] ?? dependency.status}, ${personName(dependency.ownerId)}]`;
      });
      console.log(`  기다리는 일: ${dependencies.join(" / ")}`);
    }
  }

  if (task.verifiedEvidence?.length > 0) {
    console.log(`  지금까지 확인된 증거: ${task.verifiedEvidence.join(" / ")}`);
  }
  if (task.remainingGaps?.length > 0) {
    console.log(`  아직 남은 검증: ${task.remainingGaps.join(" / ")}`);
  }
  if (task.discoveredIssues?.length > 0) {
    console.log(`  연결 작업에서 발견된 문제: ${task.discoveredIssues.join(" / ")}`);
  }
}

function printUnassigned() {
  const unassigned = graph.tasks.filter((task) => task.status === "unassigned");
  console.log(`\n팀 확인이 필요한 미배정 작업 (${unassigned.length})`);
  if (unassigned.length === 0) {
    console.log("- 없음");
    return;
  }

  for (const task of unassigned) {
    console.log(`\n- ${task.title} (${task.id})`);
    console.log(`  다음 회의 확인: ${task.nextAction}`);
    console.log(`  미배정 이유: ${task.sourceNote}`);
  }
}

function printPersonal(person) {
  printHeader();
  console.log(`\n조회한 사람: ${person.displayName}`);

  const owned = graph.tasks.filter((task) => task.ownerId === person.id);
  console.log(`\n이번 주 내가 할 일 (${owned.length})`);
  if (owned.length === 0) console.log("- 배정된 작업 없음");
  for (const task of owned) printTask(task);

  const reviews = graph.tasks.filter((task) => task.reviewerId === person.id);
  console.log(`\n내가 리뷰할 일 (${reviews.length})`);
  if (reviews.length === 0) console.log("- 배정된 리뷰 없음");
  for (const task of reviews) {
    printTask(task, { includeOwner: true, reviewMode: true });
  }

  const ownedIds = new Set(owned.map((task) => task.id));
  const downstream = graph.tasks.filter((task) =>
    task.dependsOn.some((dependencyId) => ownedIds.has(dependencyId)),
  );
  console.log(`\n내 작업을 기다리는 일 (${downstream.length})`);
  if (downstream.length === 0) console.log("- 없음");
  for (const task of downstream) {
    console.log(
      `- ${task.title} · 담당 ${personName(task.ownerId)} · 내 선행 작업: ${task.dependsOn
        .filter((dependencyId) => ownedIds.has(dependencyId))
        .map((dependencyId) => tasksById.get(dependencyId).title)
        .join(", ")}`,
    );
  }

  printUnassigned();
}

function printTeam() {
  printHeader();
  console.log("\n팀 전체 배정");
  for (const person of graph.people) {
    const owned = graph.tasks.filter((task) => task.ownerId === person.id);
    const reviews = graph.tasks.filter((task) => task.reviewerId === person.id);
    console.log(`\n${person.displayName} · 담당 ${owned.length}개 · 리뷰 ${reviews.length}개`);
    for (const task of owned) {
      console.log(
        `- [${statusLabels[task.status] ?? task.status}] ${task.title} → 리뷰 ${personName(task.reviewerId)} (${task.reviewerAssignmentStatus === "confirmed" ? "확정" : "제안"})`,
      );
    }
  }
  printUnassigned();
}

const args = process.argv.slice(2);
if (args.includes("--all")) {
  printTeam();
  process.exit(0);
}

const personFlagIndex = args.indexOf("--person");
const identity =
  personFlagIndex >= 0 ? args[personFlagIndex + 1] : args.find((arg) => !arg.startsWith("--"));

if (!identity) {
  console.log("사용법: pnpm work:me -- <내 이름 또는 별칭>");
  console.log("예시: pnpm work:me -- 정행 | Sean | Amy | --all");
  process.exit(1);
}

const normalizedIdentity = normalizeIdentity(identity);
let personId = aliases.get(normalizedIdentity);

if (!personId) {
  const mentionedPeople = new Set();
  for (const [alias, aliasPersonId] of aliases) {
    if (alias.length >= 2 && normalizedIdentity.includes(alias)) {
      mentionedPeople.add(aliasPersonId);
    }
  }
  if (mentionedPeople.size === 1) {
    personId = [...mentionedPeople][0];
  }
}

if (!personId) {
  console.error(`'${identity}'을 주간 그래프에서 찾지 못했습니다.`);
  console.error(
    `인식 가능한 사람: ${graph.people
      .map((person) => `${person.displayName}(${person.aliases.slice(1, 3).join("/")})`)
      .join(", ")}`,
  );
  process.exit(1);
}

printPersonal(peopleById.get(personId));
