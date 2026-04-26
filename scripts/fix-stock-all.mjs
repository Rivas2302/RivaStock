import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf8'));
const PROJECT  = config.projectId;
const DB_ID    = config.firestoreDatabaseId;
const API_KEY  = config.apiKey;
const DB_BASE  = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DB_ID}/documents`;

const REFRESH_TOKEN = 'AMf-vBxPYmu6QFGETTV0CgetjCWyzmGB36O7YVToW9llIGYnfw1YYn42GgqKSIgt2eUqXFZ8KlEiSSN1q4NKmYraijB4n6xTLxMJCt_seLiE180a4_EM2SOzY0wkJwUI-rPPm9YtEd65XBPC-aNz1Af4QQCmVprfjNlaYv_73kATCTIri14exIdIFfqsZYTtd261ALvgRsya9KzI0GB2tTjDWQbrVKHbtT-xgcGb6SrT0vWaTOwy8KWwy881KWVVglpSD8NYvDFn';
const FIX_CUTOFF = '2026-04-26T20:00:00.000Z';

// ── Firestore field helpers ──────────────────────────────────────────────────
function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(fsVal) } };
  if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k,w]) => [k, fsVal(w)])) } };
  return { stringValue: String(v) };
}

function fromFsVal(fv) {
  if (!fv) return null;
  if ('nullValue'    in fv) return null;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('doubleValue'  in fv) return fv.doubleValue;
  if ('stringValue'  in fv) return fv.stringValue;
  if ('arrayValue'   in fv) return (fv.arrayValue.values || []).map(fromFsVal);
  if ('mapValue'     in fv) return Object.fromEntries(Object.entries(fv.mapValue.fields || {}).map(([k,w]) => [k, fromFsVal(w)]));
  return null;
}

function docToObj(doc) {
  const id = doc.name.split('/').pop();
  return { id, ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k,v]) => [k, fromFsVal(v)])) };
}

// ── Auth: exchange refresh token → ID token ──────────────────────────────────
async function getIdToken() {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  console.log(`Autenticado como UID: ${data.user_id}`);
  return { token: data.id_token, uid: data.user_id };
}

// ── Firestore helpers ────────────────────────────────────────────────────────
// UID resolved after auth
let OWNER_UID = null;

async function listAll(token, col) {
  const docs = [];
  const url = `${DB_BASE}:runQuery`;
  let offset = 0;
  while (true) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: col }],
        // Filter by ownerUid so Firestore security rules are satisfied
        where: {
          fieldFilter: {
            field: { fieldPath: 'ownerUid' },
            op: 'EQUAL',
            value: { stringValue: OWNER_UID },
          }
        },
        limit: 300,
        offset,
      }
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.text(); throw new Error(`listAll ${col}: ${e}`); }
    const rows = await res.json();
    const batch = rows.filter(r => r.document).map(r => docToObj(r.document));
    docs.push(...batch);
    if (batch.length < 300) break;
    offset += batch.length;
  }
  return docs;
}

async function patchDoc(token, col, id, fields) {
  const fieldPaths = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const url = `${DB_BASE}/${col}/${id}?${fieldPaths}`;
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k,v]) => [k, fsVal(v)])) };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`patch ${col}/${id}: ${e}`); }
}

async function deleteDoc(token, col, id) {
  const url = `${DB_BASE}/${col}/${id}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const e = await res.text(); throw new Error(`delete ${col}/${id}: ${e}`); }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function fixAllPendingStock() {
  const { token, uid } = await getIdToken();
  OWNER_UID = uid;

  const allSales = await listAll(token, 'sales');

  const toFix = allSales.filter(s => {
    const isUnpaid = s.status === 'No Pagado' || s.status === 'Pendiente';
    const isLegacy = !s.createdAt || s.createdAt < FIX_CUTOFF;
    return isUnpaid && isLegacy;
  });

  console.log(`\nTotal ventas a corregir: ${toFix.length}`);
  toFix.forEach(s => console.log(`  [${s.date}] ${s.productName} x${s.quantity} | status: ${s.status} | createdAt: ${s.createdAt || 'ninguno'}`));

  if (toFix.length === 0) {
    console.log('Nada que corregir.');
    return;
  }

  // Agrupar descuentos por producto
  const deductions = {};
  for (const sale of toFix) {
    deductions[sale.productId] = (deductions[sale.productId] || 0) + sale.quantity;
  }

  const products = await listAll(token, 'products');

  console.log('\nCorrigiendo stock:');
  for (const [productId, qty] of Object.entries(deductions)) {
    const product = products.find(p => p.id === productId);
    if (!product) {
      console.log(`  SKIP: producto ${productId} no encontrado`);
      continue;
    }
    const newStock = Math.max(0, product.stock - qty);
    console.log(`  ${product.name}: ${product.stock} -> ${newStock} (descontar ${qty})`);
    await patchDoc(token, 'products', productId, { stock: newStock });
  }

  console.log('\nMarcando ventas como procesadas...');
  const now = new Date().toISOString();
  for (const sale of toFix) {
    if (!sale.createdAt) {
      await patchDoc(token, 'sales', sale.id, { createdAt: now });
    }
  }

  console.log('\nListo. Revisá el stock en la app.');
}

fixAllPendingStock().catch(console.error);
