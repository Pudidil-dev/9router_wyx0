import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToPool(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function poolToRow(p) {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, p) {
  const r = poolToRow(p);
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProxyPools(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  const sql = `SELECT * FROM proxyPools${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const list = db.all(sql, params).map(rowToPool);
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return list;
}

export async function getProxyPoolById(id) {
  const db = await getAdapter();
  return rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]));
}

export async function createProxyPool(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: data.id || uuidv4(),
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    ...Object.fromEntries(Object.entries(data).filter(([key]) => !["id", "name", "proxyUrl", "noProxy", "type", "isActive", "strictProxy", "testStatus", "lastTestedAt", "lastError", "createdAt", "updatedAt"].includes(key))),
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, pool);
  return pool;
}

function normalizeProxyIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

export async function mergeProxyPool(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const incomingType = data.type || "http";
  const incomingUrl = data.proxyUrl || "";
  let result = null;
  let action = "created";

  db.transaction(() => {
    let existing = data.id ? rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [data.id])) : null;
    if (!existing && incomingUrl) {
      const pools = db.all(`SELECT * FROM proxyPools`).map(rowToPool);
      existing = pools.find((p) => (
        normalizeProxyIdentity(p.proxyUrl) === normalizeProxyIdentity(incomingUrl)
        && normalizeProxyIdentity(p.type || "http") === normalizeProxyIdentity(incomingType)
      )) || null;
    }

    if (existing) {
      const merged = {
        ...existing,
        ...data,
        id: existing.id,
        type: incomingType,
        noProxy: data.noProxy !== undefined ? data.noProxy : existing.noProxy,
        strictProxy: data.strictProxy !== undefined ? data.strictProxy === true : existing.strictProxy === true,
        isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
        testStatus: data.testStatus || existing.testStatus || "unknown",
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      upsert(db, merged);
      result = merged;
      action = "merged";
      return;
    }

    const pool = {
      id: uuidv4(),
      name: data.name,
      proxyUrl: incomingUrl,
      noProxy: data.noProxy || "",
      type: incomingType,
      isActive: data.isActive !== undefined ? data.isActive : true,
      strictProxy: data.strictProxy === true,
      testStatus: data.testStatus || "unknown",
      lastTestedAt: data.lastTestedAt || null,
      lastError: data.lastError || null,
      createdAt: now,
      updatedAt: now,
    };
    upsert(db, pool);
    result = pool;
  });

  return { pool: result, action };
}

export async function updateProxyPool(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProxyPool(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  return removed;
}
