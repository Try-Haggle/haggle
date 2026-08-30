import "./lock-env.js";
import "./patch.js";

import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateRun, formatDuration, USD_PER_ROUND_CALL } from "../../src/cost.js";
import { closeLabContext, createLabContext } from "../../src/harness.js";
import { expandGroups } from "../../src/scenarios.js";
import type { NegotiationResult, ScenarioCase } from "../../src/types.js";
import { setFewShot } from "./patch.js";
import { runOne } from "./run-one.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PUBLIC = join(ROOT, "public");
const FEWSHOT_PATH = join(ROOT, "fewshot.md");
const RESULTS_DIR = join(ROOT, "results");
const PORT = Number(process.env.FEWSHOT_LAB_PORT ?? 4177);

mkdirSync(RESULTS_DIR, { recursive: true });

function loadFewShotFile(): string {
  return readFileSync(FEWSHOT_PATH, "utf8");
}

function saveFewShotFile(text: string): void {
  writeFileSync(FEWSHOT_PATH, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function pickCases(group: string): ScenarioCase[] {
  return expandGroups(group);
}

type CompareJob = {
  id: string;
  status: "running" | "done" | "error";
  startedAt: string;
  estimate: ReturnType<typeof estimateRun> & { variants: number };
  results: NegotiationResult[];
  error?: string;
};

const jobs = new Map<string, CompareJob>();
let running = false;

function summarize(results: NegotiationResult[]) {
  const byVariant = (variant: string) =>
    results.filter((r) => r.attributes.variant === variant && r.finalPrice != null);
  const prices = (rows: NegotiationResult[]) => rows.map((r) => r.finalPrice as number);
  const span = (vals: number[]) =>
    vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null;
  const accepted = (variant: string) =>
    results.filter((r) => r.attributes.variant === variant && r.outcome === "ACCEPTED").length;
  const total = (variant: string) => results.filter((r) => r.attributes.variant === variant).length;
  const base = prices(byVariant("baseline"));
  const shot = prices(byVariant("fewshot"));
  return {
    baselineAccepts: accepted("baseline"),
    fewshotAccepts: accepted("fewshot"),
    baselineTotal: total("baseline"),
    fewshotTotal: total("fewshot"),
    baselinePriceSpan: span(base),
    fewshotPriceSpan: span(shot),
    storageMovedMoreWithFewshot:
      span(base) != null && span(shot) != null
        ? (span(shot) as number) > (span(base) as number)
        : null,
  };
}

async function runCompare(job: CompareJob, cases: ScenarioCase[], repeat: number): Promise<void> {
  running = true;
  const fewshot = loadFewShotFile();
  saveFewShotFile(fewshot);
  const ctx = await createLabContext();
  const outPath = join(RESULTS_DIR, `${job.id}.jsonl`);
  try {
    for (const c of cases) {
      for (let i = 0; i < repeat; i++) {
        setFewShot("");
        const baseline = await runOne(ctx, c, "baseline", i);
        job.results.push(baseline);
        appendFileSync(outPath, `${JSON.stringify(baseline)}\n`);

        setFewShot(fewshot);
        const treated = await runOne(ctx, c, "fewshot", i);
        job.results.push(treated);
        appendFileSync(outPath, `${JSON.stringify(treated)}\n`);
        setFewShot("");
      }
    }
    job.status = "done";
    writeFileSync(
      join(RESULTS_DIR, `${job.id}.summary.json`),
      JSON.stringify(
        {
          job: { id: job.id, estimate: job.estimate },
          summary: summarize(job.results),
          results: job.results,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
  } finally {
    setFewShot("");
    await closeLabContext(ctx);
    running = false;
  }
}

const server = createHttpServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(join(PUBLIC, "index.html")));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    const dbUrl = process.env.DATABASE_URL ?? "";
    json(res, 200, {
      ok: dbUrl.includes("haggle_negolab") && Boolean(process.env.DEEPSEEK_API_KEY),
      dbOk: dbUrl.includes("haggle_negolab"),
      keyOk: Boolean(process.env.DEEPSEEK_API_KEY),
      running,
      jobs: [...jobs.values()].map((j) => ({
        id: j.id,
        status: j.status,
        startedAt: j.startedAt,
        done: j.results.length,
        error: j.error,
      })),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/fewshot") {
    json(res, 200, { text: loadFewShotFile() });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/fewshot") {
    const body = JSON.parse((await readBody(req)) || "{}") as { text?: string };
    if (typeof body.text !== "string") {
      json(res, 400, { error: "text required" });
      return;
    }
    saveFewShotFile(body.text);
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/estimate") {
    const body = JSON.parse((await readBody(req)) || "{}") as { group?: string; repeat?: number };
    const group = body.group ?? "D";
    const repeat = Math.max(1, Number(body.repeat) || 1);
    const cases = pickCases(group);
    const est = estimateRun(cases, repeat);
    json(res, 200, {
      group,
      cases: cases.map((c) => ({ id: c.id, label: c.label, attributes: c.item.attributes })),
      estimate: {
        ...est,
        variants: 2,
        negotiations: est.negotiations * 2,
        maxRoundCalls: est.maxRoundCalls * 2,
        estUsd: est.estUsd * 2,
        estSeconds: est.estSeconds * 2,
        estDuration: formatDuration(est.estSeconds * 2),
        usdPerRound: USD_PER_ROUND_CALL,
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/jobs") {
    json(res, 200, {
      jobs: [...jobs.values()].map((j) => ({
        id: j.id,
        status: j.status,
        startedAt: j.startedAt,
        summary: summarize(j.results),
        results: j.results,
        error: j.error,
      })),
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
    const id = url.pathname.slice("/api/jobs/".length);
    const job = jobs.get(id);
    if (!job) {
      json(res, 404, { error: "not found" });
      return;
    }
    json(res, 200, { ...job, summary: summarize(job.results) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    const files = readdirSync(RESULTS_DIR)
      .filter((f) => f.endsWith(".summary.json"))
      .sort()
      .reverse();
    json(res, 200, { files });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    if (running) {
      json(res, 409, { error: "이미 실행 중입니다." });
      return;
    }
    const body = JSON.parse((await readBody(req)) || "{}") as {
      group?: string;
      repeat?: number;
      confirm?: boolean;
      fewshot?: string;
    };
    if (!body.confirm) {
      json(res, 400, { error: "confirm=true 가 필요합니다. 비용 확인 후 다시 누르세요." });
      return;
    }
    if (typeof body.fewshot === "string") saveFewShotFile(body.fewshot);
    const group = body.group ?? "D";
    const repeat = Math.max(1, Number(body.repeat) || 1);
    const cases = pickCases(group);
    const est = estimateRun(cases, repeat);
    const id = new Date().toISOString().replace(/[:.]/g, "-");
    const job: CompareJob = {
      id,
      status: "running",
      startedAt: new Date().toISOString(),
      estimate: {
        ...est,
        variants: 2,
        negotiations: est.negotiations * 2,
        maxRoundCalls: est.maxRoundCalls * 2,
        estUsd: est.estUsd * 2,
        estSeconds: est.estSeconds * 2,
      },
      results: [],
    };
    jobs.set(id, job);
    void runCompare(job, cases, repeat);
    json(res, 202, { id, estimate: job.estimate });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

const lockedUrl = (globalThis as { __fewshotLabDatabaseUrl?: string }).__fewshotLabDatabaseUrl;
if (lockedUrl) process.env.DATABASE_URL = lockedUrl;

if (!(process.env.DATABASE_URL ?? "").includes("haggle_negolab")) {
  console.error("Refusing to start: export DATABASE_URL to the local haggle_negolab DB.");
  process.exit(1);
}

setFewShot("");
server.listen(PORT, "127.0.0.1", () => {
  console.log(`fewshot-lab  http://127.0.0.1:${PORT}`);
  console.log("이 서버는 로컬 전용이다. git에 올리지 말 것.");
});
