// Step 4: turn a results JSONL file into a self-contained, clickable HTML
// report. No external deps — the data is embedded and rendered by vanilla JS,
// so the .html opens offline with a double-click. Generating it is FREE.
//
// Run (from repo root):
//   npx tsx nego-lab/src/report.ts                 # newest results/*.jsonl
//   npx tsx nego-lab/src/report.ts --file results/2026-07-19T01-09-34-011Z.jsonl
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NegotiationResult } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, "..", "results");

function parseArgs(argv: string[]): { file?: string; out?: string } {
  const out: { file?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" || argv[i] === "-f") out.file = argv[++i];
    else if (argv[i] === "--out" || argv[i] === "-o") out.out = argv[++i];
  }
  return out;
}

function newestJsonl(): string {
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  if (!files.length) throw new Error(`no *.jsonl in ${RESULTS_DIR}. Run the runner first.`);
  return join(RESULTS_DIR, files[files.length - 1]);
}

function loadResults(path: string): NegotiationResult[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as NegotiationResult);
}

function main() {
  const { file, out } = parseArgs(process.argv.slice(2));
  const inputPath = file
    ? file.startsWith("/")
      ? file
      : join(process.cwd(), file)
    : newestJsonl();
  const results = loadResults(inputPath);
  if (!results.length) throw new Error(`no results in ${inputPath}`);

  const html = renderHtml(results, inputPath);
  const outPath = out ? out : inputPath.replace(/\.jsonl$/, ".html");
  writeFileSync(outPath, html);
  console.log(`\nReport written: ${outPath}`);
  console.log(`Open it:        open "${outPath}"\n`);
}

function renderHtml(results: NegotiationResult[], source: string): string {
  const data = JSON.stringify(results);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>nego-lab report</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#2a2f3a; --fg:#e6e8ec; --mut:#9aa4b2; --accent:#5b9dff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  header { padding:20px 24px; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 4px; font-size:18px; }
  .meta { color:var(--mut); font-size:12px; }
  main { display:grid; grid-template-columns: 1fr 460px; gap:0; align-items:start; }
  section { padding:20px 24px; }
  #detail { position:sticky; top:0; border-left:1px solid var(--line); height:100vh; overflow:auto; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.05em; color:var(--mut); margin:24px 0 10px; }
  h2:first-child { margin-top:0; }
  table { border-collapse:collapse; width:100%; }
  th,td { border:1px solid var(--line); padding:6px 8px; text-align:center; font-variant-numeric:tabular-nums; }
  th { color:var(--mut); font-weight:600; }
  td.lbl,th.lbl { text-align:left; color:var(--fg); }
  .cell { cursor:pointer; }
  .cell:hover { outline:2px solid var(--accent); outline-offset:-2px; }
  .bar { height:14px; background:var(--accent); border-radius:3px; }
  .barrow td { text-align:left; }
  .barwrap { background:#0b0d11; border-radius:3px; width:100%; }
  .pill { display:inline-block; padding:1px 7px; border-radius:99px; font-size:11px; }
  .ok { background:#12351f; color:#4ade80; }
  .no { background:#3a1720; color:#f87171; }
  .round { border:1px solid var(--line); border-radius:6px; padding:8px 10px; margin:8px 0; background:var(--panel); }
  .round .h { display:flex; justify-content:space-between; color:var(--mut); font-size:12px; margin-bottom:4px; }
  .buyer { border-left:3px solid #5b9dff; }
  .seller { border-left:3px solid #f0a35b; }
  .muted { color:var(--mut); }
  code { background:#0b0d11; padding:1px 5px; border-radius:4px; }
  .empty { color:var(--mut); font-style:italic; }
</style>
</head>
<body>
<header>
  <h1>nego-lab report</h1>
  <div class="meta">source: <code>${source.replace(/</g, "&lt;")}</code></div>
  <div class="meta" id="topsum"></div>
</header>
<main>
  <section id="charts"></section>
  <section id="detail"><h2>Detail</h2><p class="empty">Click any cell or row to inspect the negotiation(s).</p></section>
</main>
<script>
const DATA = ${data};
const fmt = (n) => n==null ? "—" : "$"+Number(n).toFixed(0);
const money = (m) => m==null ? "—" : "$"+(Number(m)/100).toFixed(2);
const avg = (a) => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;

// group by group key
const groups = {};
for (const r of DATA) (groups[r.group] ||= []).push(r);

const totalRounds = DATA.reduce((a,r)=>a+r.rounds,0);
const totalTokens = DATA.reduce((a,r)=>a+r.transcript.reduce((s,x)=>s+(x.llmTokensUsed||0),0),0);
document.getElementById("topsum").textContent =
  DATA.length+" negotiations · "+totalRounds+" rounds · "+totalTokens.toLocaleString()+" tokens · est $"+(totalRounds*0.01).toFixed(2);

const PRESETS = ["hunter","closer","verifier","balancer"];
const charts = document.getElementById("charts");
const detail = document.getElementById("detail");

function accepted(list){ return list.filter(r=>r.outcome==="ACCEPTED"); }
function avgPrice(list){ const p = accepted(list).map(r=>r.finalPrice).filter(x=>x!=null); return avg(p); }

// ---- heatmap color scale ----
function colorFor(v, lo, hi){
  if (v==null) return "transparent";
  const t = hi>lo ? (v-lo)/(hi-lo) : .5;
  const r = Math.round(40+t*120), g = Math.round(120-t*40), b = Math.round(220-t*160);
  return "rgb("+r+","+g+","+b+")";
}

function renderHeatmap(list){
  const cells = {};
  let lo=Infinity, hi=-Infinity;
  for (const s of PRESETS) for (const b of PRESETS){
    const sub = list.filter(r=>r.sellerAgent===s && r.buyerAgent===b);
    const v = avgPrice(sub);
    cells[s+"|"+b] = {v, sub};
    if (v!=null){ lo=Math.min(lo,v); hi=Math.max(hi,v); }
  }
  let h = '<h2>A · Agent matrix — avg accepted price (seller ↓ × buyer →)</h2><table><tr><th class="lbl">seller \\ buyer</th>';
  for (const b of PRESETS) h += '<th>'+b+'</th>';
  h += '</tr>';
  for (const s of PRESETS){
    h += '<tr><th class="lbl">'+s+'</th>';
    for (const b of PRESETS){
      const c = cells[s+"|"+b];
      const bg = colorFor(c.v, lo, hi);
      h += '<td class="cell" style="background:'+bg+'" data-sel="'+s+'" data-buy="'+b+'">'+
           (c.v!=null?fmt(c.v):'<span class="muted">—</span>')+'</td>';
    }
    h += '</tr>';
  }
  h += '</table>';
  return h;
}

function renderSweep(key, title, list){
  // one row per case (label = the swept level); avg over repeats
  const byCase = {};
  for (const r of list) (byCase[r.caseId] ||= []).push(r);
  const rows = Object.entries(byCase).map(([id,sub])=>({
    id, label: sub[0].label||id, price: avgPrice(sub),
    accRate: accepted(sub).length/sub.length, n: sub.length, sub
  }));
  const prices = rows.map(r=>r.price).filter(x=>x!=null);
  const lo = Math.min(...prices, Infinity), hi = Math.max(...prices, -Infinity);
  let h = '<h2>'+key+' · '+title+'</h2><table><tr><th class="lbl">level</th><th>avg price</th><th>accept</th><th>n</th><th class="lbl">relative</th></tr>';
  for (const r of rows){
    const t = hi>lo && r.price!=null ? (r.price-lo)/(hi-lo) : .5;
    const w = r.price!=null ? Math.round(6+t*94) : 0;
    h += '<tr class="cell" data-case="'+r.id+'"><td class="lbl">'+r.label+'</td>'+
         '<td>'+fmt(r.price)+'</td>'+
         '<td>'+Math.round(r.accRate*100)+'%</td>'+
         '<td>'+r.n+'</td>'+
         '<td class="lbl"><div class="barwrap"><div class="bar" style="width:'+w+'%"></div></div></td></tr>';
  }
  h += '</table>';
  return h;
}

const SWEEP_TITLES = { B:"Battery health sweep", C:"Scratches sweep", D:"Storage sweep", E:"Buyer pressure sweep" };

let html = "";
if (groups.A) html += renderHeatmap(groups.A);
for (const k of ["B","C","D","E"]) if (groups[k]) html += renderSweep(k, SWEEP_TITLES[k], groups[k]);
if (!html) html = '<p class="empty">No recognized groups in this file.</p>';
charts.innerHTML = html;

// ---- detail rendering ----
function renderRuns(runs, heading){
  let h = '<h2>Detail</h2><div class="meta">'+heading+'</div>';
  for (const r of runs){
    const okCls = r.outcome==="ACCEPTED" ? "ok" : "no";
    h += '<div style="margin:14px 0 4px"><b>'+r.caseId+'</b> <span class="muted">#'+r.repeatIndex+'</span> '+
         '<span class="pill '+okCls+'">'+r.outcome+'</span> '+
         '<b>'+(r.finalPrice!=null?"$"+r.finalPrice:"—")+'</b></div>';
    h += '<div class="meta">seller='+r.sellerAgent+' buyer='+r.buyerAgent+
         ' · ask $'+r.askPrice+' / floor $'+r.floorPrice+' · budget $'+r.budgetMax+' target $'+r.targetPrice+
         ' · '+r.rounds+' rounds</div>';
    h += '<div class="meta">attrs: '+Object.entries(r.attributes).map(([k,v])=>k+"="+v).join(", ")+'</div>';
    if (r.error) h += '<div class="pill no" style="margin-top:6px">ERROR: '+r.error+'</div>';
    for (const rd of r.transcript){
      const side = rd.senderRole==="BUYER" ? "buyer" : "seller";
      const tok = rd.llmTokensUsed!=null ? rd.llmTokensUsed+" tok" : "";
      h += '<div class="round '+side+'"><div class="h"><span>r'+rd.roundNo+' · '+rd.senderRole+' · '+rd.messageType+
           (rd.decision?' → '+rd.decision:'')+'</span><span>'+money(rd.priceMinor)+
           (rd.counterPriceMinor!=null?' → '+money(rd.counterPriceMinor):'')+' · '+tok+'</span></div>'+
           '<div>'+(rd.message?rd.message.replace(/</g,"&lt;"):'<span class="muted">(no message)</span>')+'</div></div>';
    }
  }
  return h;
}

charts.addEventListener("click", (e)=>{
  const cell = e.target.closest("[data-case],[data-sel]");
  if (!cell) return;
  let runs=[], heading="";
  if (cell.dataset.case){
    runs = DATA.filter(r=>r.caseId===cell.dataset.case);
    heading = cell.dataset.case+" — "+runs.length+" run(s)";
  } else {
    const s=cell.dataset.sel, b=cell.dataset.buy;
    runs = groups.A.filter(r=>r.sellerAgent===s && r.buyerAgent===b);
    heading = s+"(seller) × "+b+"(buyer) — "+runs.length+" run(s)";
  }
  detail.innerHTML = renderRuns(runs, heading);
  detail.scrollTop = 0;
});
</script>
</body>
</html>`;
}

main();
