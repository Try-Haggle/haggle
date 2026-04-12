/**
 * Tag Garden E2E Test — 실제 DB 태그 + LLM 태그 배치 통합 테스트
 *
 * 콘솔 출력 + overview.html 현재 안건 탭에 결과 자동 삽입
 *
 * Usage:
 *   npx tsx apps/api/src/scripts/test-tag-garden-e2e.ts
 *
 * Output:
 *   docs/meetings/overview.html 의 "현재 안건" 탭 아래에 삽입
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
config({ path: resolve(import.meta.dirname, "../../../../.env") });
config({ path: resolve(import.meta.dirname, "../../.env"), override: false });

import { createDb, sql, type Database } from "@haggle/db";
import {
  placeTagsWithLlm,
  type LlmPlacementInput,
} from "../services/tag-placement-llm.service.js";
import type { TagCandidate } from "../services/tag-candidate.service.js";

const db = createDb(process.env.DATABASE_URL!) as unknown as Database;

// ─── Types ───────────────────────────────────────────────

interface TestListing {
  name: string;
  emoji: string;
  title: string;
  description: string;
  category: string | null;
  priceBand: string;
  expectedSelected: string[];
  expectedProposals: string[];
  reasoning: string;
}

interface TagRow {
  id: string; name: string; normalized_name: string;
  status: string; category: string; use_count: number;
  idf: number; parent_id: string | null;
}

interface EdgeRow { parent_name: string; child_name: string; }

interface CompareResult {
  matched: string[]; missed: string[]; extra: string[]; pct: number;
}

interface TestResult {
  listing: TestListing;
  candidates: Array<{ label: string; idf: number; source: string }>;
  ngramCandLabels: string[];
  officialCandLabels: string[];
  selectedLabels: string[];
  proposedTags: Array<{ label: string; category: string; reason: string }>;
  reasoning: string;
  selComparison: CompareResult;
  propComparison: CompareResult;
  totalPct: number;
  cost: number; ms: number; tokensIn: number; tokensOut: number;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 100;
}

function verdict(p: number): string {
  if (p >= 67) return "PASS";
  if (p >= 40) return "PARTIAL";
  if (p >= 20) return "DIVERGENT";
  return "FAIL";
}

function fuzzyMatch(a: string, b: string): boolean {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x === y || x.includes(y) || y.includes(x) || x.replace(/-/g, "") === y.replace(/-/g, "");
}

function compare(expected: string[], actual: string[]): CompareResult {
  const matched: string[] = [];
  const used = new Set<number>();
  for (const e of expected) {
    for (let i = 0; i < actual.length; i++) {
      if (!used.has(i) && fuzzyMatch(e, actual[i])) {
        matched.push(e === actual[i] ? e : `${e} ≈ ${actual[i]}`);
        used.add(i);
        break;
      }
    }
  }
  const missed = expected.filter((e) => !matched.some((m) => m.startsWith(e)));
  const extra = actual.filter((_, i) => !used.has(i));
  return { matched, missed, extra, pct: pct(matched.length, expected.length) };
}

// ─── DB 후보 수집 ────────────────────────────────────────

async function gatherCandidatesFromDB(title: string, description: string) {
  const text = `${title} ${description}`.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const words = text.split(/\s+/).filter((w) => w.length >= 2);

  const ngrams = new Set<string>();
  for (let len = 1; len <= Math.min(3, words.length); len++) {
    for (let i = 0; i <= words.length - len; i++) {
      ngrams.add(words.slice(i, i + len).join("-"));
    }
  }

  const ngramArr = [...ngrams];
  const ngramRows = ngramArr.length > 0
    ? await db.execute(sql`
        SELECT id, name, normalized_name, idf::float as idf, parent_id
        FROM tags
        WHERE normalized_name = ANY(${sql`ARRAY[${sql.join(ngramArr.map((n) => sql`${n}`), sql`,`)}]::text[]`})
        ORDER BY idf DESC
      `)
    : [];

  const ngramHits = new Set<string>();
  const ngramCands: TagCandidate[] = [];
  for (const r of ngramRows as any[]) {
    ngramHits.add(r.id);
    ngramCands.push({
      id: r.id, label: r.name, normalizedLabel: r.normalized_name,
      idf: Number(r.idf), parentIds: r.parent_id ? [r.parent_id] : [], source: ["ngram"],
    });
  }

  const officialRows = await db.execute(sql`
    SELECT id, name, normalized_name, idf::float as idf, parent_id
    FROM tags WHERE status IN ('OFFICIAL', 'EMERGING')
    ORDER BY use_count DESC, idf DESC
  `);
  const officialCands: TagCandidate[] = [];
  for (const r of officialRows as any[]) {
    if (ngramHits.has(r.id)) continue;
    officialCands.push({
      id: r.id, label: r.name, normalizedLabel: r.normalized_name,
      idf: Number(r.idf), parentIds: r.parent_id ? [r.parent_id] : [], source: ["idf"],
    });
  }

  return { candidates: [...ngramCands, ...officialCands].slice(0, 20), ngramCount: ngramCands.length };
}

// ─── DB 전체 태그 ────────────────────────────────────────

async function getAllTags(): Promise<TagRow[]> {
  const rows = await db.execute(sql`
    SELECT id, name, normalized_name, status, category, use_count, idf::float as idf, parent_id
    FROM tags ORDER BY status, use_count DESC, name
  `);
  return (rows as any[]).map((r: any) => ({
    id: r.id, name: r.name, normalized_name: r.normalized_name,
    status: r.status, category: r.category, use_count: r.use_count,
    idf: Number(r.idf), parent_id: r.parent_id,
  }));
}

async function getAllEdges(): Promise<EdgeRow[]> {
  const rows = await db.execute(sql`
    SELECT p.name AS parent_name, c.name AS child_name
    FROM tag_edges e JOIN tags p ON p.id = e.parent_tag_id JOIN tags c ON c.id = e.child_tag_id
    ORDER BY p.name, c.name
  `);
  return (rows as any[]).map((r: any) => ({ parent_name: r.parent_name, child_name: r.child_name }));
}

// ─── Test Listings ───────────────────────────────────────

const listings: TestListing[] = [
  {
    name: "AirPods Max Silver", emoji: "🎧",
    title: "AirPods Max Silver - barely used, with Smart Case",
    description: "Selling my AirPods Max in Silver. Bought from Apple Store 4 months ago. Used maybe 10 times total - I just prefer in-ear buds. Active Noise Cancellation works flawlessly, spatial audio is incredible for movies. Comes with the original Smart Case. Battery easily lasts 15+ hours. Will ship in original box with all accessories.",
    category: "Headphones", priceBand: "$200-$500",
    expectedSelected: ["apple", "headphones", "wireless", "noise-cancelling"],
    expectedProposals: ["silver", "barely-used", "airpods-max"],
    reasoning: "색상·상태·제품명이 기존 태그에 없음",
  },
  {
    name: "MacBook Pro M3 Space Black", emoji: "💻",
    title: 'MacBook Pro 14" M3 Pro 18GB/512GB Space Black - mint condition',
    description: "Upgrading to M4 so letting this go. MacBook Pro 14-inch, M3 Pro chip, 18GB unified memory, 512GB SSD. Space Black. 120 battery cycles. Always used with case and screen protector. Zero scratches. Includes original MagSafe charger + USB-C cable + original box.",
    category: "Laptops", priceBand: "$1000+",
    expectedSelected: ["macbook", "laptop", "apple", "pro"],
    expectedProposals: ["space-black", "512gb", "mint"],
    reasoning: "색상·용량·상태가 누락",
  },
  {
    name: "Jordan 1 Chicago Lost & Found", emoji: "👟",
    title: "Jordan 1 Retro High OG 'Chicago Lost and Found' Size 9.5 VNDS",
    description: "Jordan 1 Chicago Lost and Found DZ5485-612. Size 9.5 US Men's. VNDS - tried on indoors once on carpet, soles are clean. Cracked paint on midsole is factory intentional. Comes with OG all: box, extra laces, tissue paper, hang tag.",
    category: "Sneakers", priceBand: "$200-$500",
    expectedSelected: ["sneakers", "shoes", "nike", "retro"],
    expectedProposals: ["chicago", "size-9-5", "vnds"],
    reasoning: "컬러웨이·사이즈·상태가 핵심 필터",
  },
  {
    name: "Sony WH-1000XM5", emoji: "🎵",
    title: "Sony WH-1000XM5 Black - excellent condition",
    description: "Sony WH-1000XM5 wireless noise cancelling headphones in black. 30 hours battery life. LDAC and 360 Reality Audio support. Multipoint connection (2 devices). USB-C charging. Comes with original case and cable.",
    category: "Headphones", priceBand: "$100-$200",
    expectedSelected: ["sony", "headphones", "bluetooth", "noise-cancelling", "wireless"],
    expectedProposals: ["wh-1000xm5", "black"],
    reasoning: "모델명·색상이 누락",
  },
  {
    name: "Herman Miller Aeron Size B", emoji: "🪑",
    title: "Herman Miller Aeron Size B - Fully Loaded, Remastered (2021)",
    description: "WFH setup downsizing. Herman Miller Aeron Remastered (2021 model), Size B. Fully loaded: PostureFit SL, adjustable arms, tilt limiter, forward tilt. Mesh is clean with no sags or tears. All adjustments work perfectly. 12-year warranty is transferable. Local pickup only in Brooklyn.",
    category: "Furniture", priceBand: "$500-$1000",
    expectedSelected: ["furniture"],
    expectedProposals: ["size-b", "fully-loaded", "remastered"],
    reasoning: "사이즈·풀옵션·모델 세대가 핵심",
  },
];

// ─── Overview Section Generator ─────────────────────────

function generateSection(
  allTags: TagRow[],
  edges: EdgeRow[],
  results: TestResult[],
  statusCounts: Record<string, number>,
  runAt: string,
): string {
  const avgPct = Math.round(results.reduce((s, r) => s + r.totalPct, 0) / results.length);
  const totalCost = results.reduce((s, r) => s + r.cost, 0);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  const passCount = results.filter((r) => verdict(r.totalPct) === "PASS").length;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function badgeCls(p: number) {
    const v = verdict(p);
    return v === "PASS" ? "tg-pass" : v === "PARTIAL" ? "tg-partial" : "tg-fail";
  }
  function barCls(p: number) {
    return p >= 67 ? "tg-green-bar" : p >= 40 ? "tg-yellow-bar" : "tg-red-bar";
  }
  function tag(label: string, cls: string) {
    return `<span class="tg-tag ${cls}">${esc(label)}</span>`;
  }

  // Test cards (accordion)
  const cards = results.map((r, i) => {
    const v = verdict(r.totalPct);
    const ngramTags = r.ngramCandLabels.map((l) => tag(l, "tg-ngram")).join("");
    const officialTags = r.officialCandLabels.map((l) => tag(l, "tg-official")).join("");
    const expectedSel = r.listing.expectedSelected.map((l) => tag(l, "tg-expected")).join("");
    const expectedProp = r.listing.expectedProposals.map((l) => tag(l, "tg-expected")).join("");

    const actualSel = r.selectedLabels.map((l) => {
      const hit = r.selComparison.matched.some((m) => m.startsWith(l) || m.includes(l));
      return tag(l, hit ? "tg-match" : "tg-extra");
    }).join("");
    const actualProp = r.proposedTags.map((t) => {
      const hit = r.propComparison.matched.some((m) => m.includes(t.label));
      return `<span class="tg-tag ${hit ? "tg-match" : "tg-extra"}" title="${esc(t.reason)}">${esc(t.label)} <small>[${esc(t.category)}]</small></span>`;
    }).join("") || '<span style="color:var(--dim);font-size:.78rem">(없음)</span>';

    function cmpRows(cmp: CompareResult) {
      let html = "";
      if (cmp.matched.length > 0) html += `<div class="tg-cmp-detail"><span class="tg-cmp-icon" style="color:var(--green)">✓</span> ${cmp.matched.map((m) => tag(m, "tg-match")).join("")}</div>`;
      if (cmp.missed.length > 0) html += `<div class="tg-cmp-detail"><span class="tg-cmp-icon" style="color:var(--red)">✗</span> ${cmp.missed.map((m) => tag(m, "tg-missed")).join("")}</div>`;
      if (cmp.extra.length > 0) html += `<div class="tg-cmp-detail"><span class="tg-cmp-icon" style="color:var(--yellow)">+</span> ${cmp.extra.map((m) => tag(m, "tg-extra")).join("")}</div>`;
      return html;
    }

    return `
      <div class="tg-card">
        <div class="tg-card-head" onclick="this.nextElementSibling.classList.toggle('tg-open')">
          <div class="tg-card-title">
            <span>${r.listing.emoji}</span>
            <span style="color:var(--dim);font-size:.82rem">#${i + 1}</span>
            <span>${esc(r.listing.name)}</span>
          </div>
          <span class="tg-badge ${badgeCls(r.totalPct)}">${v} ${r.totalPct}%</span>
        </div>
        <div class="tg-card-body">
          <div class="tg-listing">
            <div class="tg-listing-title">${esc(r.listing.title)}</div>
            <div class="tg-listing-meta">📂 ${esc(r.listing.category ?? "미분류")} &nbsp;&nbsp; 💰 ${esc(r.listing.priceBand)}</div>
            <div class="tg-listing-desc">${esc(r.listing.description)}</div>
          </div>

          <div style="padding:12px 18px;border-bottom:1px solid var(--border);font-size:.8rem;color:var(--muted);line-height:1.8">
            <div style="margin-bottom:8px">
              <b style="color:var(--text)">태그 배치란?</b> LLM이 리스팅을 보고 두 가지를 한다:<br>
              &nbsp;&nbsp;• <b>선택</b> — DB에 이미 있는 태그 중 이 리스팅에 맞는 것을 골라냄 (예: apple, headphones)<br>
              &nbsp;&nbsp;• <b>제안</b> — DB에 없지만 필요하다고 판단한 새 태그를 제안함 (예: airpods-max, silver)
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:.72rem;color:var(--dim)">
              <span>${tag("제목/설명 매칭", "tg-ngram")} 리스팅에서 직접 찾은 후보</span>
              <span>${tag("공식/신흥", "tg-official")} DB의 OFFICIAL·EMERGING 태그</span>
              <span>${tag("예상 정답", "tg-expected")} 사람이 기대하는 정답</span>
              <span>${tag("일치", "tg-match")} 정답과 일치</span>
              <span>${tag("누락", "tg-missed")} 정답인데 놓침</span>
              <span>${tag("추가", "tg-extra")} 정답에 없지만 LLM이 추가</span>
            </div>
          </div>

          <div class="tg-section">
            <h5>📋 DB 후보 태그 (${r.candidates.length}개)</h5>
            ${r.ngramCandLabels.length > 0 ? `<div class="tg-tags"><span style="font-size:.72rem;color:var(--dim);font-weight:600;min-width:70px">🟢 매칭</span>${ngramTags}</div>` : ""}
            <div class="tg-tags"><span style="font-size:.72rem;color:var(--dim);font-weight:600;min-width:70px">🔵 공식</span>${officialTags}</div>
          </div>

          <div class="tg-compare">
            <div class="tg-compare-col">
              <h5>🎯 예상 정답</h5>
              <div class="tg-tags" style="margin-bottom:4px"><span style="font-size:.7rem;color:var(--dim)">선택</span>${expectedSel}</div>
              <div class="tg-tags"><span style="font-size:.7rem;color:var(--dim)">제안</span>${expectedProp}</div>
              <div class="tg-reason">${esc(r.listing.reasoning)}</div>
            </div>
            <div class="tg-compare-col">
              <h5>🤖 LLM 결과</h5>
              <div class="tg-tags" style="margin-bottom:4px"><span style="font-size:.7rem;color:var(--dim)">선택</span>${actualSel}</div>
              <div class="tg-tags"><span style="font-size:.7rem;color:var(--dim)">제안</span>${actualProp}</div>
              <div class="tg-reason">"${esc(r.reasoning)}"</div>
              <div class="tg-llm-meta">${r.ms}ms · ${r.tokensIn}+${r.tokensOut}tok · $${r.cost.toFixed(5)}</div>
            </div>
          </div>

          <div class="tg-grade">
            <div class="tg-grade-row">
              <span class="tg-grade-label">선택</span>
              <div class="tg-bar"><div class="tg-bar-fill ${barCls(r.selComparison.pct)}" style="width:${r.selComparison.pct}%"></div><span class="tg-bar-pct">${r.selComparison.pct}%</span></div>
            </div>
            ${cmpRows(r.selComparison)}
            <div class="tg-grade-row" style="margin-top:6px">
              <span class="tg-grade-label">제안</span>
              <div class="tg-bar"><div class="tg-bar-fill ${barCls(r.propComparison.pct)}" style="width:${r.propComparison.pct}%"></div><span class="tg-bar-pct">${r.propComparison.pct}%</span></div>
            </div>
            ${cmpRows(r.propComparison)}
            <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px">
              <span style="font-size:.85rem;font-weight:700;min-width:80px">종합</span>
              <div class="tg-bar"><div class="tg-bar-fill ${barCls(r.totalPct)}" style="width:${r.totalPct}%"></div><span class="tg-bar-pct">${r.totalPct}%</span></div>
            </div>
          </div>
        </div>
      </div>`;
  }).join("\n");

  // Tag garden collapsible
  const tagsByStatus: Record<string, TagRow[]> = {};
  for (const t of allTags) (tagsByStatus[t.status] ??= []).push(t);

  const tagStatusOrder = ["OFFICIAL", "EMERGING", "CANDIDATE"];
  const tagTables = tagStatusOrder.map((status) => {
    const tags = tagsByStatus[status] ?? [];
    const icon = status === "OFFICIAL" ? "🌳" : status === "EMERGING" ? "🌿" : "🌱";
    const rows = tags.map((t) =>
      `<tr><td>${esc(t.name)}</td><td class="mono" style="text-align:right">${t.use_count}</td><td class="mono" style="text-align:right">${t.idf.toFixed(2)}</td><td><span class="tg-cat-badge">${esc(t.category)}</span></td></tr>`
    ).join("");
    return `<div style="margin-bottom:16px"><h5 style="font-size:.88rem;font-weight:700;margin-bottom:6px">${icon} ${status} <span style="color:var(--dim);font-weight:400">(${tags.length})</span></h5>
      <table class="tg-tag-table"><thead><tr><th>이름</th><th style="text-align:right">사용</th><th style="text-align:right">IDF</th><th>카테고리</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("");

  const edgeList = edges.map((e) => `<span style="display:inline-block;margin:2px 8px 2px 0;font-size:.82rem;color:var(--muted)">${esc(e.parent_name)} <span style="color:var(--green)">→</span> ${esc(e.child_name)}</span>`).join("");

  return `
  <!-- ═══ Tag Garden E2E Dashboard (auto-generated ${runAt}) ═══ -->
  <!-- TAG_GARDEN_START -->
  <section class="section">
    <div class="section-title"><div class="icon" style="background:rgba(16,185,129,.15);">🌻</div>Tag Garden E2E 대시보드</div>
    <div class="section-desc">
      <p>실제 DB 태그(${allTags.length}개) + LLM 태그 배치 통합 테스트 결과. 5개 테스트 리스팅에 대해 gpt-4o-mini로 태그를 선택/제안하고, 예상 정답과 비교 채점. 마지막 실행: <b>${runAt}</b></p>
    </div>

    <!-- 요약 stats -->
    <div class="tg-stats">
      <div class="tg-stat ${avgPct >= 67 ? "tg-green" : avgPct >= 40 ? "tg-yellow" : ""}"><div class="tg-num">${avgPct}%</div><div class="tg-label">평균 점수</div></div>
      <div class="tg-stat tg-green"><div class="tg-num">${passCount}/${results.length}</div><div class="tg-label">PASS</div></div>
      <div class="tg-stat tg-purple"><div class="tg-num">${allTags.length}</div><div class="tg-label">전체 태그</div></div>
      <div class="tg-stat tg-blue"><div class="tg-num">$${totalCost.toFixed(4)}</div><div class="tg-label">총 비용</div></div>
      <div class="tg-stat tg-yellow"><div class="tg-num">${(totalMs / 1000).toFixed(1)}s</div><div class="tg-label">총 시간</div></div>
    </div>

    <!-- 요약 테이블 -->
    <table class="decision-table" style="margin-bottom:20px">
      <thead><tr><th></th><th>리스팅</th><th class="right">선택</th><th class="right">제안</th><th class="right">종합</th><th class="right">비용</th><th class="right">판정</th></tr></thead>
      <tbody>
        ${results.map((r) => {
          const v = verdict(r.totalPct);
          return `<tr><td>${r.listing.emoji}</td><td class="bold">${esc(r.listing.name)}</td><td class="right mono">${r.selComparison.pct}%</td><td class="right mono">${r.propComparison.pct}%</td><td class="right mono bold">${r.totalPct}%</td><td class="right mono" style="color:var(--dim)">$${r.cost.toFixed(5)}</td><td class="right"><span class="sev ${v === "PASS" ? "low" : v === "PARTIAL" ? "medium" : "critical"}">${v}</span></td></tr>`;
        }).join("")}
      </tbody>
    </table>

    <!-- 비용 분석 -->
    <div class="info-box" style="margin-bottom:16px">
      <div class="info-title">💰 비용 분석</div>
      <p>리스팅당 <b>$${(totalCost / results.length).toFixed(5)}</b> · 1,000건 예상 <b>$${(totalCost / results.length * 1000).toFixed(2)}</b> · 리스팅당 <b>${(totalMs / results.length / 1000).toFixed(1)}s</b> · 모델: gpt-4o-mini</p>
    </div>

    <!-- 개별 테스트 (아코디언) -->
    <p style="font-size:.88rem;color:var(--muted);margin-bottom:12px">📋 리스팅별 상세 — 클릭해서 펼치기</p>
    ${cards}

    <!-- Tag Garden 전체 태그 (접기) -->
    <div class="tg-garden-toggle" onclick="document.getElementById('tg-garden-body').classList.toggle('tg-open')">
      <span style="font-weight:700;font-size:.92rem">🌳 Tag Garden — 전체 태그 (${allTags.length}개)</span>
      <span style="color:var(--dim);font-size:.82rem">클릭해서 펼치기 ▾</span>
    </div>
    <div class="tg-garden-body" id="tg-garden-body">
      <div style="background:rgba(15,23,42,.3);border:1px solid var(--border);border-radius:0 0 12px 12px;padding:18px">
        ${tagTables}
        <h5 style="font-size:.88rem;font-weight:700;margin:16px 0 8px">🔗 DAG Edges (${edges.length}개)</h5>
        <div style="display:flex;flex-wrap:wrap">${edgeList}</div>
      </div>
    </div>
  </section>
  <!-- TAG_GARDEN_END -->`;
}

// ─── Runner ──────────────────────────────────────────────

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.error("OPENAI_API_KEY not set"); process.exit(1); }

  const allTags = await getAllTags();
  const edges = await getAllEdges();
  const statusCounts: Record<string, number> = {};
  for (const t of allTags) statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;

  console.log(`\n  🌻 Tag Garden E2E Test`);
  console.log(`  ──────────────────────────────────────────────────`);
  console.log(`  DB: ${allTags.length} tags (${Object.entries(statusCounts).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  console.log(`  Model: gpt-4o-mini / Max candidates: 20\n`);

  const testResults: TestResult[] = [];

  for (let i = 0; i < listings.length; i++) {
    const L = listings[i]!;
    console.log(`  ${L.emoji} #${i + 1} ${L.name} ...`);

    const { candidates } = await gatherCandidatesFromDB(L.title, L.description);
    const ngramCands = candidates.filter((c) => c.source.includes("ngram"));
    const idfCands = candidates.filter((c) => !c.source.includes("ngram"));

    const llmInput: LlmPlacementInput = {
      title: L.title, description: L.description,
      category: L.category, priceBand: L.priceBand, candidates,
    };
    const result = await placeTagsWithLlm(llmInput);

    if (!result.ok) {
      console.log(`    ❌ ERROR: ${result.error.code}`);
      testResults.push({
        listing: L,
        candidates: candidates.map((c) => ({ label: c.label, idf: c.idf, source: c.source[0] })),
        ngramCandLabels: ngramCands.map((c) => c.label),
        officialCandLabels: idfCands.map((c) => c.label),
        selectedLabels: [], proposedTags: [], reasoning: "",
        selComparison: { matched: [], missed: L.expectedSelected, extra: [], pct: 0 },
        propComparison: { matched: [], missed: L.expectedProposals, extra: [], pct: 0 },
        totalPct: 0, cost: 0, ms: 0, tokensIn: 0, tokensOut: 0, error: result.error.code,
      });
      continue;
    }

    const costUsd = (result.tokensIn * 0.15 + result.tokensOut * 0.6) / 1_000_000;
    const selectedLabels = result.selectedTagIds.map((id) => {
      const c = candidates.find((x) => x.id === id);
      return c ? c.label : id;
    });

    const selCmp = compare(L.expectedSelected, selectedLabels);
    const propCmp = compare(L.expectedProposals, result.proposedTags.map((t) => t.label));
    const totalPct = Math.round((selCmp.pct + propCmp.pct) / 2);

    const v = verdict(totalPct);
    const icon = v === "PASS" ? "✅" : v === "PARTIAL" ? "🟡" : "❌";
    console.log(`    ${icon} ${v} ${totalPct}% (선택 ${selCmp.pct}% / 제안 ${propCmp.pct}%) ${result.latencyMs}ms $${costUsd.toFixed(5)}`);

    testResults.push({
      listing: L,
      candidates: candidates.map((c) => ({ label: c.label, idf: c.idf, source: c.source[0] })),
      ngramCandLabels: ngramCands.map((c) => c.label),
      officialCandLabels: idfCands.map((c) => c.label),
      selectedLabels, proposedTags: result.proposedTags,
      reasoning: result.reasoning,
      selComparison: selCmp, propComparison: propCmp,
      totalPct, cost: costUsd, ms: result.latencyMs,
      tokensIn: result.tokensIn, tokensOut: result.tokensOut,
    });
  }

  // Summary
  const totalCost = testResults.reduce((s, r) => s + r.cost, 0);
  const totalMs = testResults.reduce((s, r) => s + r.ms, 0);
  const avgPct = Math.round(testResults.reduce((s, r) => s + r.totalPct, 0) / testResults.length);

  console.log(`\n  ══════════════════════════════════════════════════`);
  console.log(`  평균: ${avgPct}%  |  비용: $${totalCost.toFixed(4)}  |  시간: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  ══════════════════════════════════════════════════`);

  // Generate section HTML
  const runAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const sectionHtml = generateSection(allTags, edges, testResults, statusCounts, runAt);

  // Insert into overview.html
  const overviewPath = resolve(import.meta.dirname, "../../../../docs/meetings/overview.html");
  let html = readFileSync(overviewPath, "utf-8");

  // Remove previous insertion if exists
  const startMarker = "<!-- TAG_GARDEN_START -->";
  const endMarker = "<!-- TAG_GARDEN_END -->";
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);
  if (startIdx !== -1 && endIdx !== -1) {
    // Also remove the auto-generated comment line before the marker
    let removeStart = startIdx;
    const beforeStart = html.lastIndexOf("\n", startIdx - 1);
    const lineBeforeMarker = html.substring(beforeStart, startIdx);
    if (lineBeforeMarker.includes("auto-generated")) {
      removeStart = beforeStart + 1;
    }
    html = html.substring(0, removeStart) + html.substring(endIdx + endMarker.length);
  }

  // Insert before </div> of tab-current (right before <!-- TAB 3 -->)
  const insertPoint = "<!-- TAB 3: 향후 목표 -->";
  const insertIdx = html.indexOf(insertPoint);
  if (insertIdx === -1) {
    console.error("  ❌ overview.html에서 삽입 위치를 찾을 수 없습니다");
    process.exit(1);
  }

  // Find the </div> before the TAB 3 comment (closing tab-current div)
  const closingDivIdx = html.lastIndexOf("</div>", insertIdx);
  html = html.substring(0, closingDivIdx) + sectionHtml + "\n\n</div>\n\n" + html.substring(insertIdx);

  writeFileSync(overviewPath, html, "utf-8");
  console.log(`\n  📄 overview.html 업데이트 완료: ${overviewPath}\n`);

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
