// Step 4+: visual scenario CATALOG. Renders every test case as a card — seller
// setup vs buyer setup vs item — so you can see at a glance WHAT each test
// probes, BEFORE spending anything. If a results JSONL exists, each card is
// annotated with the outcome so you also see how the setup moved the price.
// Pure/free: reads scenarios.ts + (optional) a results file. No DB, no DeepSeek.
//
// Run (from repo root):
//   npx tsx nego-lab/src/catalog.ts                    # all groups, overlay newest results
//   npx tsx nego-lab/src/catalog.ts --group A
//   npx tsx nego-lab/src/catalog.ts --no-results       # scenarios only, no overlay
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandGroups, GROUPS } from "./scenarios.js";
import type { NegotiationResult, ScenarioCase } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, "..", "results");

interface Args {
  group: string;
  file?: string;
  noResults: boolean;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { group: "all", noResults: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--group" || argv[i] === "-g") a.group = argv[++i] ?? a.group;
    else if (argv[i] === "--file" || argv[i] === "-f") a.file = argv[++i];
    else if (argv[i] === "--out" || argv[i] === "-o") a.out = argv[++i];
    else if (argv[i] === "--no-results") a.noResults = true;
  }
  return a;
}

/** Every results file, oldest→newest, so the catalog shows a cumulative view. */
function allJsonl(): string[] {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => join(RESULTS_DIR, f));
}

function loadResults(path: string): NegotiationResult[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as NegotiationResult);
}

/** Per-case aggregate of any runs found in the results file. */
interface CaseAgg {
  runs: number;
  accepted: number;
  avgPrice: number | null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let cases: ScenarioCase[];
  try {
    cases = expandGroups(args.group);
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // Results overlay: a single --file, or (default) ALL results files merged so
  // the catalog accumulates every group you've ever run.
  const files = args.noResults ? [] : args.file ? [args.file] : allJsonl();
  const present = files.filter((f) => existsSync(f));
  const agg = new Map<string, CaseAgg>();
  if (present.length) {
    const byCase = new Map<string, NegotiationResult[]>();
    for (const path of present) {
      for (const r of loadResults(path)) {
        const list = byCase.get(r.caseId) ?? [];
        list.push(r);
        byCase.set(r.caseId, list);
      }
    }
    for (const [id, list] of byCase) {
      const accepted = list.filter((r) => r.outcome === "ACCEPTED");
      const prices = accepted.map((r) => r.finalPrice ?? 0).filter((p) => p > 0);
      agg.set(id, {
        runs: list.length,
        accepted: accepted.length,
        avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
      });
    }
  }

  const overlay =
    present.length === 0
      ? null
      : present.length === 1
        ? (present[0].split("/").pop() ?? null)
        : `${present.length} result files`;
  const html = renderHtml(cases, agg, args.group, overlay);
  const outPath = args.out ?? join(RESULTS_DIR, "catalog.html");
  writeFileSync(outPath, html);
  console.log(`\nCatalog written: ${outPath}`);
  console.log(
    `  overlaid: ${overlay ?? "none"}  ·  cases with results: ${agg.size}/${cases.length}`,
  );
  console.log(`Open it:         open "${outPath}"\n`);
}

function renderHtml(
  cases: ScenarioCase[],
  agg: Map<string, CaseAgg>,
  selector: string,
  overlay: string | null,
): string {
  const payload = JSON.stringify({
    cases,
    agg: Object.fromEntries(agg),
    selector,
    resultsPath: overlay,
    groups: GROUPS.map((g) => ({ key: g.key, title: g.title })),
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>nego-lab · scenario catalog</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#2a2f3a; --fg:#e6e8ec; --mut:#9aa4b2;
          --sell:#f0a35b; --buy:#5b9dff; --ok:#4ade80; --no:#f87171; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  header { padding:18px 24px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); z-index:5; }
  h1 { margin:0 0 4px; font-size:18px; }
  .meta { color:var(--mut); font-size:12px; }
  .groupnav { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
  .groupnav a { color:var(--fg); text-decoration:none; font-size:12px; border:1px solid var(--line);
                padding:2px 9px; border-radius:99px; }
  .groupnav a:hover { border-color:var(--buy); }
  section { padding:8px 24px 24px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--mut);
       margin:22px 0 12px; border-bottom:1px solid var(--line); padding-bottom:6px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:14px; }
  .card { border:1px solid var(--line); border-radius:10px; background:var(--panel); overflow:hidden; }
  .card .top { display:flex; justify-content:space-between; align-items:center; gap:8px;
               padding:10px 12px; border-bottom:1px solid var(--line); }
  .cid { font-weight:600; font-size:13px; }
  .lbl { color:var(--mut); font-size:11px; }
  .sides { display:grid; grid-template-columns:1fr 1fr; }
  .side { padding:10px 12px; }
  .side.sell { border-right:1px solid var(--line); }
  .role { font-size:11px; text-transform:uppercase; letter-spacing:.04em; font-weight:700; margin-bottom:6px; }
  .role.sell { color:var(--sell); }
  .role.buy { color:var(--buy); }
  .kv { display:flex; justify-content:space-between; font-size:12px; padding:1px 0; }
  .kv .k { color:var(--mut); }
  .kv .v { font-variant-numeric:tabular-nums; }
  .item { padding:9px 12px; border-top:1px solid var(--line); background:#12151c; }
  .chips { display:flex; gap:5px; flex-wrap:wrap; margin-top:5px; }
  .chip { font-size:11px; background:#0b0d11; border:1px solid var(--line); border-radius:99px; padding:1px 8px; }
  .chip.hot { border-color:var(--sell); color:var(--sell); }
  .outcome { padding:8px 12px; border-top:1px solid var(--line); display:flex; align-items:center; gap:8px; }
  .pill { font-size:11px; padding:1px 8px; border-radius:99px; }
  .pill.ok { background:#12351f; color:var(--ok); }
  .pill.no { background:#3a1720; color:var(--no); }
  .pill.na { background:#20242e; color:var(--mut); }
  .price { font-weight:700; }
  .muted { color:var(--mut); }
</style>
</head>
<body>
<header>
  <h1>nego-lab · scenario catalog</h1>
  <div class="meta" id="sub"></div>
  <div class="groupnav" id="nav"></div>
</header>
<main id="main"></main>
<script>
const P = ${payload};
const sub = document.getElementById("sub");
sub.textContent = P.cases.length + " test cases · groups: " + P.selector +
  (P.resultsPath ? " · results overlaid from " + P.resultsPath : " · no results overlaid");

// which attribute is the "varied" axis per group (highlight it)
const SWEEP_KEY = { B:"batteryHealth", C:"scratches", D:"storage" };

const byGroup = {};
for (const c of P.cases) (byGroup[c.group] ||= []).push(c);

const nav = document.getElementById("nav");
for (const key of Object.keys(byGroup)) {
  const g = P.groups.find(x=>x.key===key);
  const a = document.createElement("a");
  a.href = "#g-"+key; a.textContent = key + " · " + (g?g.title:"") + " (" + byGroup[key].length + ")";
  nav.appendChild(a);
}

const main = document.getElementById("main");
function kv(k,v){ return '<div class="kv"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>'; }

for (const key of Object.keys(byGroup)) {
  const g = P.groups.find(x=>x.key===key);
  const sec = document.createElement("section");
  sec.id = "g-"+key;
  let h = '<h2>'+key+' · '+(g?g.title:'')+'</h2><div class="grid">';
  for (const c of byGroup[key]) {
    const hotKey = SWEEP_KEY[key];
    const a = P.agg[c.id];
    // outcome block
    let outcome;
    if (!P.resultsPath) outcome = '';
    else if (!a) outcome = '<div class="outcome"><span class="pill na">not run yet</span></div>';
    else {
      const rate = Math.round(a.accepted/a.runs*100);
      const cls = a.accepted>0 ? 'ok' : 'no';
      outcome = '<div class="outcome"><span class="pill '+cls+'">'+a.accepted+'/'+a.runs+' accepted</span>'+
                '<span class="price">'+(a.avgPrice!=null?'$'+a.avgPrice.toFixed(0):'—')+'</span>'+
                '<span class="muted">avg final</span></div>';
    }
    // attribute chips (highlight the swept one)
    const chips = Object.entries(c.item.attributes).map(([k,v])=>
      '<span class="chip'+(k===hotKey?' hot':'')+'">'+k+': '+v+'</span>').join('');
    h += '<div class="card">'+
      '<div class="top"><span class="cid">'+c.id+'</span><span class="lbl">'+(c.label||'')+'</span></div>'+
      '<div class="sides">'+
        '<div class="side sell"><div class="role sell">Seller</div>'+
          kv('agent', c.seller.agent)+
          kv('ask', '$'+c.item.askPrice)+
          kv('floor', '$'+c.item.floorPrice)+
          kv('deadline', c.item.deadlineHours+'h')+
        '</div>'+
        '<div class="side buy"><div class="role buy">Buyer</div>'+
          kv('agent', c.buyer.agent)+
          kv('budget', '$'+c.buyer.budgetMax)+
          kv('target', '$'+c.buyer.targetPrice)+
          kv('deadline', (c.buyer.deadlineHours||48)+'h')+
        '</div>'+
      '</div>'+
      '<div class="item"><span class="muted">'+c.item.title+' · '+c.item.condition+'</span>'+
        '<div class="chips">'+chips+'</div></div>'+
      outcome+
    '</div>';
  }
  h += '</div>';
  sec.innerHTML = h;
  main.appendChild(sec);
}
</script>
</body>
</html>`;
}

main();
