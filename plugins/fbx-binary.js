const FBX_VERSION = 7400;
export { FBX_VERSION };

export const HEAD_MAGIC = new Uint8Array([
  0x4b,0x61,0x79,0x64,0x61,0x72,0x61,0x20,0x46,0x42,0x58,0x20,
  0x42,0x69,0x6e,0x61,0x72,0x79,0x20,0x20,0x00,0x1a,0x00
]);
export const FOOT_ID = new Uint8Array([
  0xfa,0xbc,0xab,0x09,0xd0,0xc8,0xd4,0x66,0xb1,0x76,0xfb,0x83,0x1c,0xf7,0x26,0x7e
]);
export const SENTINEL = new Uint8Array(13);

const T = {
  INT32: 0x49, INT64: 0x4c, FLOAT64: 0x44,
  BYTES: 0x52, STRING: 0x53,
  INT32_ARR: 0x69, FLOAT64_ARR: 0x64,
};

export class ByteWriter {
  constructor() { this._chunks = []; this._pos = 0; }
  write(bytes) {
    this._chunks.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    this._pos += bytes.length;
  }
  tell() { return this._pos; }
  toBuffer() {
    const out = new Uint8Array(this._pos);
    let off = 0;
    for (const c of this._chunks) { out.set(c, off); off += c.length; }
    return out;
  }
}

export function u32(n) { const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,n>>>0,true); return b; }
function i32(n)        { const b=new Uint8Array(4); new DataView(b.buffer).setInt32(0,n|0,true); return b; }
function i64(n)        { const b=new Uint8Array(8); const dv=new DataView(b.buffer); dv.setInt32(0,n&0xFFFFFFFF,true); dv.setInt32(4,Math.floor(n/0x100000000),true); return b; }
function f64(n)        { const b=new Uint8Array(8); new DataView(b.buffer).setFloat64(0,n,true); return b; }
function encStr(s)     { const enc=new TextEncoder().encode(s); const b=new Uint8Array(4+enc.length); new DataView(b.buffer).setUint32(0,enc.length,true); b.set(enc,4); return b; }
function encBytes(arr) { const b=new Uint8Array(4+arr.length); new DataView(b.buffer).setUint32(0,arr.length,true); b.set(arr,4); return b; }

function encArray(values, bpv, writeVal) {
  const count = values.length;
  const data  = new Uint8Array(count * bpv);
  const dv    = new DataView(data.buffer);
  for (let i=0; i<count; i++) writeVal(dv, i*bpv, values[i]);
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, count, true);
  new DataView(out.buffer).setUint32(8, data.length, true);
  out.set(data, 12);
  return out;
}
function encF64Arr(vals) { return encArray(vals, 8, (dv,o,v) => dv.setFloat64(o,v,true)); }
function encI32Arr(vals) { return encArray(vals, 4, (dv,o,v) => dv.setInt32(o,v|0,true)); }

export class FbxNode {
  constructor(name) { this.name=name; this.props=[]; this.children=[]; }
  addInt32(v)        { this.props.push({type:T.INT32,       data:i32(v)});      return this; }
  addInt64(v)        { this.props.push({type:T.INT64,       data:i64(v)});      return this; }
  addFloat64(v)      { this.props.push({type:T.FLOAT64,     data:f64(v)});      return this; }
  addString(s)       { this.props.push({type:T.STRING,      data:encStr(s)});   return this; }
  addBytes(b)        { this.props.push({type:T.BYTES,       data:encBytes(b)}); return this; }
  addFloat64Array(a) { this.props.push({type:T.FLOAT64_ARR, data:encF64Arr(a)});return this; }
  addInt32Array(a)   { this.props.push({type:T.INT32_ARR,   data:encI32Arr(a)});return this; }
  addChild(n)        { this.children.push(n); return this; }
  child(name)        { const n=new FbxNode(name); this.children.push(n); return n; }

  byteSize() {
    const nb = new TextEncoder().encode(this.name);
    let s = 4+4+4+1+nb.length;
    for (const p of this.props) s += 1+p.data.length;
    if (this.children.length > 0) {
      for (const c of this.children) s += c.byteSize();
      s += SENTINEL.length;
    }
    return s;
  }

  write(bw, startOffset) {
    const nb = new TextEncoder().encode(this.name);
    let pl = 0;
    for (const p of this.props) pl += 1+p.data.length;
    bw.write(u32(startOffset + this.byteSize()));
    bw.write(u32(this.props.length));
    bw.write(u32(pl));
    bw.write(new Uint8Array([nb.length]));
    bw.write(nb);
    for (const p of this.props) { bw.write(new Uint8Array([p.type])); bw.write(p.data); }
    if (this.children.length > 0) {
      let co = bw.tell();
      for (const c of this.children) { c.write(bw, co); co = bw.tell(); }
      bw.write(SENTINEL);
    }
  }
}

// Properties70 helper
export function p70(parent, name, type1, type2, flags, ...vals) {
  const p = parent.child('P');
  p.addString(name); p.addString(type1); p.addString(type2); p.addString(flags);
  for (const v of vals) {
    if (typeof v === 'number') {
      if (Number.isInteger(v) && Math.abs(v) <= 2147483647) p.addInt32(v);
      else p.addFloat64(v);
    } else p.addString(String(v));
  }
}
