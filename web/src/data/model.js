// The curated baseline as the page shows it: data/wallets.json, resolved.
//
// The data holds one row per product, connection path and family. The page
// keeps that unit: every row is shown with its five cells, each with its
// value, reason and evidence. Hardware "via" rows (a device reached through a
// software wallet) are folded under the device's direct row of the same
// family, so a family's table lists software wallets, then devices, and each
// device opens to the software wallets that reach it.
//
// Nothing here changes a value: a cell's value, reason and evidence are the
// data's, and a reference the data cannot resolve is reported as a problem
// rather than filled in.

export const CAPABILITY_ORDER = Object.freeze(['connects', 'signs-format', 'readable', 'deterministic', 'on-chain']);
export const VALUE_ORDER = Object.freeze(['check', 'warning', 'cross', 'not-yet-measured']);
export const STATE_ORDER = Object.freeze(['tested', 'documented', 'unconfirmed', 'limited', 'legacy']);

const byId = (list) => new Map(list.map((x) => [x.id, x]));

/** The label of a row: the product, then its path for hardware. */
export function rowLabel(row, products, rows) {
  const product = products.get(row.product);
  const name = product?.name ?? row.product;
  if (row.path.type === 'via') {
    const host = rows.get(row.path.host);
    const hostName = host ? (products.get(host.product)?.name ?? host.product) : row.path.host;
    return `${name} · via ${hostName}`;
  }
  return product?.type === 'hardware' ? `${name} · direct` : name;
}

/**
 * Builds the view model of the curated data. Returns the lookup maps, one
 * entry per family (software rows, hardware rows each with its via rows, via
 * rows whose device has no direct row in that family) and the problems found
 * (an unresolved reference, a missing cell).
 */
export function buildModel(data) {
  const problems = [];
  const products = byId(data.products);
  const rows = byId(data.rows);
  const evidence = byId(data.evidence);
  const values = byId(data.values);
  const states = byId(data.states);
  const capabilities = CAPABILITY_ORDER.map((id) => {
    const c = data.capabilities.find((x) => x.id === id);
    if (!c) problems.push(`capability ${id} is not defined`);
    return c ?? { id, label: id, description: '' };
  });

  const views = new Map();
  for (const row of data.rows) {
    const product = products.get(row.product);
    if (!product) problems.push(`row ${row.id}: product ${row.product} is not defined`);
    const cells = CAPABILITY_ORDER.map((cap) => {
      const cell = row.cells?.[cap];
      if (!cell) {
        problems.push(`row ${row.id}: no ${cap} cell`);
        return { capability: cap, value: null, reason: null, evidence: [] };
      }
      if (!values.has(cell.value)) problems.push(`row ${row.id}: ${cap} has an unknown value ${cell.value}`);
      if (typeof cell.reason !== 'string' || !/\S/.test(cell.reason)) problems.push(`row ${row.id}: ${cap} has no reason`);
      const ev = (cell.evidence ?? []).map((id) => {
        const e = evidence.get(id);
        if (!e) problems.push(`row ${row.id}: ${cap} cites unknown evidence ${id}`);
        return e ?? { id, kind: 'missing', title: `missing evidence ${id}`, date: '', description: '' };
      });
      if (ev.length === 0) problems.push(`row ${row.id}: ${cap} cites no evidence`);
      return { capability: cap, value: cell.value, reason: cell.reason, evidence: ev };
    });
    if (!states.has(row.state)) problems.push(`row ${row.id}: unknown state ${row.state}`);
    views.set(row.id, {
      id: row.id,
      row,
      product,
      family: row.family,
      label: rowLabel(row, products, rows),
      path: row.path.type,
      host: row.path.type === 'via' ? row.path.host : null,
      hardware: product?.type === 'hardware',
      legacy: row.state === 'legacy',
      state: row.state,
      group: row.group,
      kind: row.kind,
      notes: row.notes ?? [],
      cells,
      via: [],
      devicesThrough: [],
    });
  }

  const families = data.families.map((f) => ({ ...f, software: [], hardware: [], orphanVia: [] }));
  const familyById = byId(families);
  for (const v of views.values()) {
    const fam = familyById.get(v.family);
    if (!fam) { problems.push(`row ${v.id}: unknown family ${v.family}`); continue; }
    if (v.path === 'via') {
      const host = views.get(v.host);
      if (!host) problems.push(`row ${v.id}: host row ${v.host} is not defined`);
      else host.devicesThrough.push(v);
      const device = views.get(`${v.row.product}--${v.family}`);
      if (device && device.path === 'direct') device.via.push(v);
      else fam.orphanVia.push(v);
    } else if (v.hardware) {
      fam.hardware.push(v);
    } else {
      fam.software.push(v);
    }
  }
  // Order: the data's own order within each list, with legacy rows moved
  // last (a stable sort), so a legacy wallet is never the first one read.
  const legacyLast = (a, b) => Number(a.legacy) - Number(b.legacy);
  for (const f of families) {
    f.software.sort(legacyLast);
    f.hardware.sort(legacyLast);
    for (const d of f.hardware) d.via.sort(legacyLast);
  }

  return { data, products, rows, evidence, values, states, capabilities, views, families, problems };
}

/** Counts used by the page's summary line and by the tests. */
export function modelCounts(model) {
  let cells = 0, via = 0, direct = 0;
  const byValue = Object.fromEntries(VALUE_ORDER.map((v) => [v, 0]));
  for (const v of model.views.values()) {
    if (v.path === 'via') via++; else direct++;
    for (const c of v.cells) { cells++; if (c.value in byValue) byValue[c.value]++; }
  }
  return { products: model.products.size, rows: model.views.size, direct, via, cells, evidence: model.evidence.size, byValue };
}

/** A product's popularity as one line, never summed across its rows. */
export function popularityText(product) {
  const p = product?.popularity;
  if (!p) return '';
  return p.read ? `${p.text} (read ${p.read})` : p.text;
}

/** Curated rows whose product carries the given name (case and spacing
 *  ignored), for comparing a detected wallet with the row of the name it
 *  reports. The match is by reported name only: it says nothing about which
 *  software answered. */
export function rowsForReportedName(model, family, productId) {
  if (!productId) return [];
  const id = `${productId}--${family}`;
  const v = model.views.get(id);
  return v ? [v] : [];
}
