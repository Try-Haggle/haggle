import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.EASYPOST_PROXY_PORT ?? 3105);
const ENV_PATH = process.env.EASYPOST_ENV_FILE ?? ".env.easypost.local";
const API_BASE = "https://api.easypost.com/v2";

function readApiKey() {
  const env = readFileSync(ENV_PATH, "utf8");
  const key = (env.match(/^EASYPOST_API_KEY=(.*)$/m)?.[1] ?? "").trim();
  if (!key) throw new Error(`EASYPOST_API_KEY is missing in ${ENV_PATH}`);
  return key;
}

const apiKey = readApiKey();
if (!/^EZTK|test/i.test(apiKey)) {
  throw new Error("Refusing to run local proxy without an EasyPost test key");
}

const auth = Buffer.from(`${apiKey}:`).toString("base64");
const shipments = new Map();
let lastShipmentId = null;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");
}

function sendJson(res, status, body) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function easypost(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const error = new Error(
      data?.error?.message ?? data?.message ?? `EasyPost HTTP ${response.status}`,
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return { status: response.status, data };
}

function defaultAddressBody(body = {}) {
  return {
    address: body.address ?? {
      street1: "417 MONTGOMERY ST",
      street2: "FLOOR 5",
      city: "SAN FRANCISCO",
      state: "CA",
      zip: "94104",
      country: "US",
      company: "Haggle Test Seller",
      phone: "415-555-0100",
    },
  };
}

function shipmentPayload(body = {}) {
  return {
    shipment: {
      from_address: body.from_address ?? {
        name: "Haggle Test Seller",
        street1: "417 MONTGOMERY ST",
        street2: "FLOOR 5",
        city: "SAN FRANCISCO",
        state: "CA",
        zip: "94104",
        country: "US",
        phone: "415-555-0100",
      },
      to_address: body.to_address ?? {
        name: "Haggle Test Buyer",
        street1: "179 N HARBOR DR",
        city: "REDONDO BEACH",
        state: "CA",
        zip: "90277",
        country: "US",
        phone: "310-555-0100",
      },
      parcel: {
        weight: body.parcel?.weight_oz ?? body.parcel?.weight ?? 12,
        length: body.parcel?.length_in ?? body.parcel?.length ?? 8,
        width: body.parcel?.width_in ?? body.parcel?.width ?? 5,
        height: body.parcel?.height_in ?? body.parcel?.height ?? 2,
      },
      is_return: body.is_return ?? undefined,
    },
  };
}

function rateSummary(epShipment) {
  return (epShipment.rates ?? []).map((rate) => ({
    id: rate.id,
    carrier: rate.carrier,
    service: rate.service,
    rate: rate.rate,
    rate_minor: Math.round(Number(rate.rate ?? 0) * 100),
    currency: rate.currency,
    delivery_days: rate.delivery_days ?? rate.est_delivery_days ?? null,
    easypost_shipment_id: epShipment.id,
  }));
}

function publicShipment(record) {
  return {
    id: record.id,
    order_id: record.order_id,
    provider_shipment_id: record.easypost_shipment_id,
    carrier: record.carrier ?? "easypost",
    status: record.status,
    source: "easypost_test_proxy",
    tracking_number: record.tracking_number ?? null,
    tracking_url: record.tracking_url ?? null,
    label_url: record.label_url ?? null,
    label_qr_code_available: false,
    selected_rate_id: record.selected_rate_id ?? null,
    rate_minor: record.rate_minor ?? null,
    refund_status: record.refund_status ?? null,
    events: record.events ?? [],
    rates: record.rates ?? [],
    metadata: {
      easypost_shipment_id: record.easypost_shipment_id,
      easypost_tracker_id: record.easypost_tracker_id,
      easypost_mode: "test",
    },
  };
}

function createRecord(epShipment, body = {}) {
  const id = body.shipment_id || body.id || `shp_local_${randomUUID().slice(0, 8)}`;
  const record = {
    id,
    order_id: body.order_id ?? "22222222-2222-4222-8222-222222222222",
    easypost_shipment_id: epShipment.id,
    carrier: "easypost",
    status: "LABEL_PENDING",
    rates: rateSummary(epShipment),
    events: [],
  };
  shipments.set(id, record);
  lastShipmentId = id;
  return record;
}

function getRecord(id) {
  const key = id === "latest" ? lastShipmentId : id;
  if (!key || !shipments.has(key)) {
    const error = new Error(
      "Shipment not found in local EasyPost proxy state. Run Rates or Create Shipment first.",
    );
    error.status = 404;
    throw error;
  }
  return shipments.get(key);
}

async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const body = req.method === "GET" ? {} : await readJson(req);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        mode: "easypost_test_proxy",
        key_masked: `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`,
        shipments_count: shipments.size,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/addresses/create_and_verify") {
      const result = await easypost("/addresses/create_and_verify", defaultAddressBody(body));
      sendJson(res, result.status, { ok: true, source: "easypost_test_proxy", ...result.data });
      return;
    }

    if (
      req.method === "POST" &&
      (url.pathname === "/shipments" || url.pathname === "/shipments/rates")
    ) {
      const result = await easypost("/shipments", shipmentPayload(body));
      const record = createRecord(result.data, body);
      sendJson(res, result.status, {
        shipment: publicShipment(record),
        rates: record.rates,
        source: "easypost_test_proxy",
        easypost_mode: result.data.mode,
      });
      return;
    }

    const prepareMatch = url.pathname.match(/^\/shipments\/([^/]+)\/prepare$/);
    if (req.method === "POST" && prepareMatch) {
      const result = await easypost("/shipments", shipmentPayload(body));
      const existingId = prepareMatch[1] || body.shipment_id;
      const record = createRecord(result.data, { ...body, id: existingId });
      sendJson(res, result.status, {
        shipment: publicShipment(record),
        rates: record.rates,
        source: "easypost_test_proxy",
        easypost_mode: result.data.mode,
      });
      return;
    }

    const getMatch = url.pathname.match(/^\/shipments\/([^/]+)$/);
    if (req.method === "GET" && getMatch) {
      const record = getRecord(getMatch[1]);
      sendJson(res, 200, { shipment: publicShipment(record), source: "easypost_test_proxy" });
      return;
    }

    const byOrderMatch = url.pathname.match(/^\/shipments\/by-order\/([^/]+)$/);
    if (req.method === "GET" && byOrderMatch) {
      const record =
        [...shipments.values()].find((shipment) => shipment.order_id === byOrderMatch[1]) ??
        getRecord("latest");
      sendJson(res, 200, { shipment: publicShipment(record), source: "easypost_test_proxy" });
      return;
    }

    const purchaseMatch = url.pathname.match(/^\/shipments\/([^/]+)\/purchase-label$/);
    if (req.method === "POST" && purchaseMatch) {
      const record = getRecord(purchaseMatch[1]);
      const rate =
        record.rates.find((candidate) => candidate.id === body.rate_id) ?? record.rates[0];
      if (!rate) throw new Error("No EasyPost rates available for this local shipment");
      const result = await easypost(`/shipments/${record.easypost_shipment_id}/buy`, {
        rate: { id: rate.id },
      });
      record.status = "LABEL_CREATED";
      record.carrier = rate.carrier;
      record.selected_rate_id = rate.id;
      record.rate_minor = rate.rate_minor;
      record.tracking_number = result.data.tracking_code ?? null;
      record.tracking_url = result.data.tracker?.public_url ?? null;
      record.label_url = result.data.postage_label?.label_url ?? null;
      record.easypost_tracker_id = result.data.tracker?.id ?? null;
      record.events.push({
        id: `evt_local_${Date.now()}`,
        shipment_id: record.id,
        status: "LABEL_CREATED",
        occurred_at: new Date().toISOString(),
        carrier_raw_status: result.data.status ?? "unknown",
        message: `EasyPost test label purchased (${rate.carrier} ${rate.service})`,
      });
      sendJson(res, result.status, {
        shipment: publicShipment(record),
        label_url: record.label_url,
        tracking_number: record.tracking_number,
        source: "easypost_test_proxy",
      });
      return;
    }

    const refundMatch = url.pathname.match(/^\/shipments\/([^/]+)\/refund$/);
    if (req.method === "POST" && refundMatch) {
      const record = getRecord(refundMatch[1]);
      const result = await easypost(`/shipments/${record.easypost_shipment_id}/refund`, {});
      record.refund_status = result.data.refund_status ?? result.data.status ?? "submitted";
      sendJson(res, result.status, {
        shipment: publicShipment(record),
        refund_status: record.refund_status,
        source: "easypost_test_proxy",
      });
      return;
    }

    const trackMatch = url.pathname.match(/^\/shipments\/([^/]+)\/track$/);
    if (req.method === "POST" && trackMatch) {
      const record = getRecord(trackMatch[1]);
      let tracker = null;
      if (record.easypost_tracker_id) {
        const result = await easypost(`/trackers/${record.easypost_tracker_id}`, null, "GET");
        tracker = result.data;
      }
      sendJson(res, 200, {
        shipment: publicShipment(record),
        tracker: tracker
          ? {
              id: tracker.id,
              mode: tracker.mode,
              status: tracker.status,
              carrier: tracker.carrier,
              public_url: tracker.public_url,
              tracking_details_count: tracker.tracking_details?.length ?? 0,
            }
          : null,
        source: "easypost_test_proxy",
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/trackers") {
      const result = await easypost("/trackers", {
        tracker: body.tracker ?? {
          tracking_code: "EZ4000000004",
          carrier: "UPS",
        },
      });
      sendJson(res, result.status, {
        tracker: {
          id: result.data.id,
          mode: result.data.mode,
          tracking_code: result.data.tracking_code,
          status: result.data.status,
          carrier: result.data.carrier,
          public_url: result.data.public_url,
          tracking_details_count: result.data.tracking_details?.length ?? 0,
        },
        source: "easypost_test_proxy",
      });
      return;
    }

    sendJson(res, 404, {
      error: "NOT_FOUND",
      message: `${req.method} ${url.pathname} is not implemented by the local EasyPost proxy`,
    });
  } catch (error) {
    sendJson(res, error.status ?? 500, {
      error: error.data?.error?.code ?? "EASYPOST_PROXY_ERROR",
      message: error.message,
      details: error.data?.error?.errors ?? undefined,
    });
  }
}

createServer(handler).listen(PORT, "127.0.0.1", () => {
  console.log(`EasyPost local proxy listening on http://127.0.0.1:${PORT}`);
  console.log(`Using ${ENV_PATH} (${apiKey.slice(0, 6)}...${apiKey.slice(-4)})`);
});
