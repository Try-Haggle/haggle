# Saved default address at negotiation start

Task W2026-08-31-03; owner 정행 / jeonghaeng. 2026-10-02 follow-up to staging negotiation testing. Reviewer optional; existing assignments preserved.

The account settings address book stores a default delivery address, but a carrier negotiation previously rejected missing request addresses without consulting that address book. MCP preparation also incorrectly said addresses were collected at checkout. The user-reported default was confirmed present in staging through a read-only exact-match query (one saved address, one default); no personal address data is committed here.

The shared web/MCP start service now loads only the authenticated buyer's default when a carrier request omits its address. It validates the saved fields, uses the address for the shipping quote and session fulfillment, and keeps explicit request addresses authoritative. Missing/invalid defaults retain DELIVERY_ADDRESS_REQUIRED. Guests and digital starts do not read an account address. No address is saved or overwritten, no migration, no dependency change, and no negotiation was started against staging during investigation.

Validation: 28 relevant tests passed; API typecheck, changed-file Biome and whitespace checks passed. Coverage includes web/MCP fallback, buyer/default query scope, invalid/missing address, explicit-address precedence, digital exemption, shipping quote before session creation, and manual mode with target/max inputs. Staging integration/deployment and runtime verification pending final CI at the same SHA.

The work graph lookup retains its existing HAGA-88 missing HAGA-94/HAGA-95 error. Ownership and dependencies were inspected directly; unrelated tasks were preserved.
