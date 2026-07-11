/* Haggle Docs — shared shell.
   Single source of truth for the feature-level nav. Works over file:// (no fetch).
   Each page:
     - has <nav class="side">…<div id="site-features"></div><div id="page-toc" class="toc"></div></nav>
     - marks its sections with <section id="…" data-nav="Label" [data-nav-sub] [data-todo]>
*/

const FEATURES = [
  { title: "Start Here — 협상 엔진", href: "negotiation-engine-start-here.html", icon: "🚀", status: "live" },
  { title: "Negotiation Engine (SOT)", href: "negotiation-engine.html", icon: "⚙️", status: "live" },
  { title: "Trust & Reputation", href: "#", icon: "🛡️", status: "soon" },
  { title: "Disputes", href: "#", icon: "⚖️", status: "soon" },
  { title: "Adaptive Review (ARP)", href: "#", icon: "⏳", status: "soon" },
  { title: "Tag Lifecycle", href: "#", icon: "🏷️", status: "soon" },
  { title: "Smart Contracts", href: "#", icon: "🔗", status: "soon" },
  { title: "Payments (USDC)", href: "#", icon: "💵", status: "soon" },
];

function currentFile() {
  const parts = location.pathname.split("/");
  return parts[parts.length - 1] || "index.html";
}

function renderFeatures() {
  const host = document.getElementById("site-features");
  if (!host) return;
  const here = currentFile();
  const label = document.createElement("div");
  label.className = "nav-label";
  label.textContent = "Features";
  host.appendChild(label);

  for (const f of FEATURES) {
    const disabled = f.status !== "live";
    const a = document.createElement("a");
    a.className = "feat" + (disabled ? " disabled" : "") + (f.href === here ? " active" : "");
    a.href = disabled ? "javascript:void 0" : f.href;
    a.innerHTML =
      `<span class="fi">${f.icon}</span><span>${f.title}</span>` +
      (disabled ? `<span class="soon">soon</span>` : "");
    host.appendChild(a);
  }
}

function renderToc() {
  const host = document.getElementById("page-toc");
  if (!host) return;
  const sections = [...document.querySelectorAll("main [data-nav]")];
  if (!sections.length) return;

  const label = document.createElement("div");
  label.className = "nav-label";
  label.textContent = "On this page";
  host.appendChild(label);

  let n = 0;
  for (const s of sections) {
    const a = document.createElement("a");
    const isSub = s.hasAttribute("data-nav-sub");
    a.className = isSub ? "sub" : "";
    a.href = "#" + s.id;
    if (!isSub) {
      n++;
      const num = String(n).padStart(2, "0");
      a.innerHTML = `<span class="n">${num}</span>${s.getAttribute("data-nav")}`;
    } else {
      a.textContent = s.getAttribute("data-nav");
    }
    if (s.hasAttribute("data-todo")) {
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.title = "더 조사 필요";
      a.appendChild(dot);
    }
    host.appendChild(a);
  }

  // scroll-spy active highlight
  const links = [...host.querySelectorAll("a")];
  const map = new Map(links.map((a) => [a.getAttribute("href"), a]));
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          const a = map.get("#" + e.target.id);
          if (a) {
            links.forEach((l) => l.classList.remove("active"));
            a.classList.add("active");
          }
        }
      });
    },
    { rootMargin: "-25% 0px -65% 0px" },
  );
  sections.forEach((s) => obs.observe(s));
}

document.addEventListener("DOMContentLoaded", () => {
  renderFeatures();
  renderToc();
});
