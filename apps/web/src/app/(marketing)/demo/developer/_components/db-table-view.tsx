"use client";

import { useMemo } from "react";
import type {
  DemoInitResponse,
  DemoRoundResponse,
  MockSessionRow,
  MockRoundRow,
  MockFactRow,
  MockTelemetryRow,
} from "@/lib/demo-types";

/* ── Helpers ────────────────────────────────── */

function simHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0").slice(0, 8);
}

function fmt(v: number): string {
  if (v > 1000) return `$${(v / 100).toFixed(0)}`;
  return `$${v}`;
}

/* ── Sub-Components ─────────────────────────── */

function TableWrapper({ title, rowCount, children }: {
  title: string;
  rowCount?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-800/30 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700/50 bg-slate-800/50 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono">
          {title}
        </h4>
        {rowCount !== undefined && (
          <span className="text-[10px] font-mono text-slate-600">
            {rowCount}행
          </span>
        )}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children, highlight }: {
  children: React.ReactNode;
  highlight?: "new" | "updated";
}) {
  const bg =
    highlight === "new"
      ? "bg-emerald-500/10"
      : highlight === "updated"
        ? "bg-amber-500/10"
        : "";

  return (
    <td className={`px-2.5 py-1.5 text-[11px] font-mono text-slate-300 whitespace-nowrap ${bg}`}>
      {children}
    </td>
  );
}

/* ── Main Component ─────────────────────────── */

interface DbTableViewProps {
  demoId: string;
  rounds: DemoRoundResponse[];
  initResponse: DemoInitResponse;
}

export function DbTableView({ demoId, rounds, initResponse }: DbTableViewProps) {
  const latestRound = rounds[rounds.length - 1] ?? null;

  const sessionRow: MockSessionRow = useMemo(() => ({
    id: demoId.slice(0, 12),
    status: latestRound?.state.done ? "ACCEPTED" : rounds.length > 0 ? "ACTIVE" : "CREATED",
    current_round: latestRound?.round ?? 0,
    last_offer_price_minor: latestRound?.state.buyer_price ?? 0,
    phase: latestRound?.phase ?? "OPENING",
    updated_at: new Date().toISOString().slice(0, 19),
  }), [demoId, latestRound, rounds.length]);

  const roundRows: MockRoundRow[] = useMemo(() =>
    rounds.map((r) => ({
      round_no: r.round,
      sender_role: "BUYER_AI",
      message_type: r.final.decision.action,
      price_minor: r.state.seller_price,
      counter_price_minor: r.final.decision.price,
      decision: r.final.decision.action,
      utility_total: 0,
    })),
  [rounds]);

  const factRows: MockFactRow[] = useMemo(() => {
    let prevHash = "00000000";
    return rounds.map((r) => {
      const data = `${prevHash}:${r.round}:${r.state.buyer_price}:${r.state.seller_price}`;
      const hash = simHash(data);
      const row: MockFactRow = {
        round: r.round,
        fact_hash: hash,
        prev_hash: prevHash,
        buyer_offer: r.state.buyer_price,
        seller_offer: r.state.seller_price,
        gap: r.state.gap,
      };
      prevHash = hash;
      return row;
    });
  }, [rounds]);

  const telemetryRows: MockTelemetryRow[] = useMemo(() => {
    const rows: MockTelemetryRow[] = [];
    for (const stage of initResponse.pipeline) {
      if (stage.is_llm && stage.tokens) {
        rows.push({
          stage: stage.stage,
          prompt_tokens: stage.tokens.prompt,
          completion_tokens: stage.tokens.completion,
          latency_ms: stage.latency_ms,
          model: "grok-4-fast",
        });
      }
    }
    for (const r of rounds) {
      for (const stage of r.pipeline) {
        if (stage.is_llm && stage.tokens) {
          rows.push({
            stage: `R${r.round}:${stage.stage}`,
            prompt_tokens: stage.tokens.prompt,
            completion_tokens: stage.tokens.completion,
            latency_ms: stage.latency_ms,
            model: "grok-4-fast",
          });
        }
      }
    }
    return rows;
  }, [initResponse, rounds]);

  const latestRoundNo = latestRound?.round ?? -1;

  return (
    <div className="space-y-4" style={{ animation: "fadeInUp 0.3s ease-out" }}>
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        시뮬레이션 DB 상태
        <span className="ml-2 text-[10px] text-slate-600 normal-case font-normal">
          (실제 DB에 저장된다면 아래와 같은 형태)
        </span>
      </h3>

      {/* negotiation_sessions */}
      <TableWrapper title="negotiation_sessions" rowCount={1}>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700/50">
              <Th>id</Th><Th>status</Th><Th>current_round</Th>
              <Th>last_offer</Th><Th>phase</Th><Th>updated_at</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>{sessionRow.id}</Td>
              <Td highlight={rounds.length > 0 ? "updated" : undefined}>{sessionRow.status}</Td>
              <Td highlight={rounds.length > 0 ? "updated" : undefined}>{sessionRow.current_round}</Td>
              <Td highlight={rounds.length > 0 ? "updated" : undefined}>{fmt(sessionRow.last_offer_price_minor)}</Td>
              <Td highlight={rounds.length > 0 ? "updated" : undefined}>{sessionRow.phase}</Td>
              <Td highlight={rounds.length > 0 ? "updated" : undefined}>{sessionRow.updated_at}</Td>
            </tr>
          </tbody>
        </table>
      </TableWrapper>

      {/* negotiation_rounds */}
      <TableWrapper title="negotiation_rounds" rowCount={roundRows.length}>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700/50">
              <Th>round_no</Th><Th>sender_role</Th><Th>판매자 제안</Th>
              <Th>AI 역제안</Th><Th>decision</Th>
            </tr>
          </thead>
          <tbody>
            {roundRows.length === 0 ? (
              <tr><td colSpan={5} className="px-2.5 py-3 text-center text-[11px] text-slate-600 italic">라운드 실행 시 행이 추가됩니다</td></tr>
            ) : roundRows.map((row, i) => (
              <tr key={row.round_no} className="border-b border-slate-700/30">
                <Td highlight={i === roundRows.length - 1 ? "new" : undefined}>{row.round_no}</Td>
                <Td highlight={i === roundRows.length - 1 ? "new" : undefined}>{row.sender_role}</Td>
                <Td highlight={i === roundRows.length - 1 ? "new" : undefined}>{fmt(row.price_minor)}</Td>
                <Td highlight={i === roundRows.length - 1 ? "new" : undefined}>{fmt(row.counter_price_minor)}</Td>
                <Td highlight={i === roundRows.length - 1 ? "new" : undefined}>
                  <span className={
                    row.decision === "ACCEPT" ? "text-emerald-400" :
                    row.decision === "REJECT" ? "text-red-400" :
                    "text-cyan-400"
                  }>{row.decision}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrapper>

      {/* negotiation_round_facts */}
      <TableWrapper title="negotiation_round_facts (해시 체인)" rowCount={factRows.length}>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700/50">
              <Th>round</Th><Th>fact_hash</Th><Th>prev_hash</Th>
              <Th>buyer_offer</Th><Th>seller_offer</Th><Th>gap</Th>
            </tr>
          </thead>
          <tbody>
            {factRows.length === 0 ? (
              <tr><td colSpan={6} className="px-2.5 py-3 text-center text-[11px] text-slate-600 italic">라운드 실행 시 해시 체인이 생성됩니다</td></tr>
            ) : factRows.map((row, i) => (
              <tr key={row.round} className="border-b border-slate-700/30">
                <Td highlight={i === factRows.length - 1 ? "new" : undefined}>{row.round}</Td>
                <Td highlight={i === factRows.length - 1 ? "new" : undefined}>
                  <span className="text-cyan-400">{row.fact_hash}</span>
                </Td>
                <Td highlight={i === factRows.length - 1 ? "new" : undefined}>
                  <span className="text-slate-500">{row.prev_hash}</span>
                  {i > 0 && <span className="text-[9px] text-purple-400 ml-1">← chain</span>}
                </Td>
                <Td highlight={i === factRows.length - 1 ? "new" : undefined}>{fmt(row.buyer_offer)}</Td>
                <Td highlight={i === factRows.length - 1 ? "new" : undefined}>{fmt(row.seller_offer)}</Td>
                <Td highlight={i === factRows.length - 1 ? "new" : undefined}>{fmt(row.gap)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrapper>

      {/* llm_telemetry */}
      <TableWrapper title="llm_telemetry" rowCount={telemetryRows.length}>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700/50">
              <Th>stage</Th><Th>prompt_tok</Th><Th>compl_tok</Th>
              <Th>latency_ms</Th><Th>model</Th>
            </tr>
          </thead>
          <tbody>
            {telemetryRows.map((row, i) => {
              const isNew = rounds.length > 0 && row.stage.startsWith(`R${latestRoundNo}:`);
              return (
                <tr key={`${row.stage}-${i}`} className="border-b border-slate-700/30">
                  <Td highlight={isNew ? "new" : undefined}>{row.stage}</Td>
                  <Td highlight={isNew ? "new" : undefined}>{row.prompt_tokens.toLocaleString()}</Td>
                  <Td highlight={isNew ? "new" : undefined}>{row.completion_tokens.toLocaleString()}</Td>
                  <Td highlight={isNew ? "new" : undefined}>{row.latency_ms}</Td>
                  <Td highlight={isNew ? "new" : undefined}>{row.model}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrapper>
    </div>
  );
}
