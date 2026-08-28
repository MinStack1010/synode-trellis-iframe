// FBX Export Plugin - Consolidated from fbx-binary.js, fbx-geometry.js, fbx-material.js, fbx-from-three.js
// This single file contains all FBX export functionality

// ===== fbx-binary.js =====
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

// ===== fbx-geometry.js =====
// Build geometry FbxNode từ Three.js BufferGeometry + world matrix
export function buildGeometryNode(objects, uid, p70fn, name, geo, world, THREE) {
  const geoId = uid();

  const src     = geo.index ? geo.toNonIndexed() : geo.clone();
  const vc      = src.attributes.position?.count ?? 0;
  if (!vc) return { geoId, empty: true };

  const tc      = Math.floor(vc / 3);
  const rawPos  = readAttr(src.attributes.position);
  const rawNorm = readAttr(src.attributes.normal);
  const rawUV   = readAttr(src.attributes.uv);
  const rawCol  = readAttr(src.attributes.color); // Vertex colors
  const f6      = (n) => Number.isFinite(n) ? +n.toFixed(9) : 0;

  // Bake world transform vào positions
  const wm  = world.elements;
  const pos = new Array(vc * 3);
  for (let i = 0; i < vc; i++) {
    const x = rawPos[i*3], y = rawPos[i*3+1], z = rawPos[i*3+2];
    pos[i*3]   = f6(wm[0]*x + wm[4]*y + wm[8]*z  + wm[12]);
    pos[i*3+1] = f6(wm[1]*x + wm[5]*y + wm[9]*z  + wm[13]);
    pos[i*3+2] = f6(wm[2]*x + wm[6]*y + wm[10]*z + wm[14]);
  }

  // Bake normal matrix
  let nrm = null;
  if (rawNorm) {
    const nm = new THREE.Matrix3().getNormalMatrix(world).elements;
    nrm = new Array(vc * 3);
    for (let i = 0; i < vc; i++) {
      const nx = rawNorm[i*3], ny = rawNorm[i*3+1], nz = rawNorm[i*3+2];
      let tx = nm[0]*nx + nm[3]*ny + nm[6]*nz;
      let ty = nm[1]*nx + nm[4]*ny + nm[7]*nz;
      let tz = nm[2]*nx + nm[5]*ny + nm[8]*nz;
      const l = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
      nrm[i*3] = f6(tx/l); nrm[i*3+1] = f6(ty/l); nrm[i*3+2] = f6(tz/l);
    }
  }

  // UV với V-flip (OpenGL → DirectX)
  let uv = null;
  if (rawUV) {
    uv = new Array(vc * 2);
    for (let i = 0; i < vc; i++) {
      uv[i*2]   = f6(rawUV[i*2]);
      uv[i*2+1] = f6(1 - rawUV[i*2+1]);
    }
  }

  // Vertex colors nếu có - preserve original vertex colors exactly
  let col = null;
  if (rawCol) {
    col = new Array(vc * 4);
    for (let i = 0; i < vc; i++) {
      col[i*4]   = f6(rawCol[i*4]);
      col[i*4+1] = f6(rawCol[i*4+1]);
      col[i*4+2] = f6(rawCol[i*4+2]);
      col[i*4+3] = f6(rawCol[i*4+3] || 1.0); // Alpha fallback
    }
  }

  // PolygonVertexIndex — last index per triangle = ~index (FBX convention)
  const pidx = new Array(tc * 3);
  for (let t = 0; t < tc; t++) {
    const b = t * 3;
    pidx[b] = b; pidx[b+1] = b+1; pidx[b+2] = ~(b+2);
  }

  const gn = objects.child('Geometry');
  gn.addInt64(geoId);
  gn.addString(name + 'Geo\x00\x01Geometry');
  gn.addString('Mesh');
  gn.child('GeometryVersion').addInt32(124);
  gn.child('Vertices').addFloat64Array(pos);
  gn.child('PolygonVertexIndex').addInt32Array(pidx);

  if (nrm) {
    const le = gn.child('LayerElementNormal');
    le.child('Version').addInt32(101);
    le.child('Name').addString('');
    le.child('MappingInformationType').addString('ByPolygonVertex');
    le.child('ReferenceInformationType').addString('Direct');
    le.child('Normals').addFloat64Array(nrm);
  }

  if (uv) {
    const le = gn.child('LayerElementUV');
    le.child('Version').addInt32(101);
    le.child('Name').addString('map1');
    le.child('MappingInformationType').addString('ByPolygonVertex');
    le.child('ReferenceInformationType').addString('Direct');
    le.child('UV').addFloat64Array(uv);
    le.child('UVIndex').addInt32Array(Array.from({ length: vc }, (_, i) => i));
  }

  const lm = gn.child('LayerElementMaterial');
  lm.child('Version').addInt32(101);
  lm.child('Name').addString('');
  lm.child('MappingInformationType').addString('AllSame');
  lm.child('ReferenceInformationType').addString('IndexToDirect');
  lm.child('Materials').addInt32Array([0]);

  if (col) {
    const lvc = gn.child('LayerElementVertexColor');
    lvc.child('Version').addInt32(101);
    lvc.child('Name').addString('');
    lvc.child('MappingInformationType').addString('ByPolygonVertex');
    lvc.child('ReferenceInformationType').addString('Direct');
    lvc.child('Colors').addFloat64Array(col);
  }

  const lay = gn.child('Layer');
  lay.child('Version').addInt32(100);
  if (nrm) {
    const e = lay.child('LayerElement');
    e.child('Type').addString('LayerElementNormal');
    e.child('TypedIndex').addInt32(0);
  }
  if (uv) {
    const e = lay.child('LayerElement');
    e.child('Type').addString('LayerElementUV');
    e.child('TypedIndex').addInt32(0);
  }
  if (col) {
    const e = lay.child('LayerElement');
    e.child('Type').addString('LayerElementVertexColor');
    e.child('TypedIndex').addInt32(0);
  }
  const em = lay.child('LayerElement');
  em.child('Type').addString('LayerElementMaterial');
  em.child('TypedIndex').addInt32(0);

  return { geoId, empty: false };
}

function readAttr(attr) {
  if (!attr) return null;
  const { count, itemSize } = attr;
  const out = new Array(count * itemSize);
  for (let i = 0; i < count; i++)
    for (let c = 0; c < itemSize; c++)
      out[i*itemSize+c] = attr.getComponent ? attr.getComponent(i, c) : attr.array[i*itemSize+c];
  return out;
}

// ===== fbx-material.js =====
// FBX texture channels — chỉ các channel mọi tool đều hiểu đúng
export const MAT_TEX_SLOTS = [
  { key: 'map',           fbxChannel: 'DiffuseColor', label: 'diffuse'  },
  { key: 'normalMap',     fbxChannel: 'Bump',          label: 'normal'   },
  { key: 'roughnessMap',  fbxChannel: 'Reflection',   label: 'roughness' },
  { key: 'metalnessMap',  fbxChannel: 'Reflection',   label: 'metalness' },
  { key: 'emissiveMap',   fbxChannel: 'EmissiveColor', label: 'emissive', skipIfBlack: true },
  { key: 'aoMap',         fbxChannel: 'AmbientColor',  label: 'ao'       },
];

// Detect image extension từ magic bytes
export function getImageExt(bytes) {
  if (!bytes || bytes.length < 4) return 'jpg';
  if (bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4E && bytes[3]===0x47) return 'png';
  if (bytes[0]===0xFF && bytes[1]===0xD8) return 'jpg';
  if (bytes[0]===0x52 && bytes[1]===0x49 && bytes[2]===0x46 && bytes[3]===0x46) return 'webp';
  return 'jpg';
}

// Build Map<texture.uuid → Uint8Array bytes> từ glbTextures
// Improved texture mapping to ensure original model textures are preserved
export function buildTexBytesMap(model, glbTextures, slotKeys) {
  if (!glbTextures || glbTextures.size === 0) {
    return new Map();
  }

  const uuidToBytes = new Map();
  const allTextures = [];

  // Collect all textures from the model first
  model.traverse(node => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach(mat => {
      if (!mat) return;
      for (const key of slotKeys) {
        const tex = mat[key];
        if (tex && !allTextures.includes(tex)) {
          allTextures.push(tex);
        }
      }
    });
  });

  // Try to match textures using userData.index first (most reliable)
  let matchedCount = 0;
  for (const tex of allTextures) {
    if (uuidToBytes.has(tex.uuid)) continue;
    
    const idx = tex.userData?.index ?? tex.userData?.textureIndex;
    if (idx != null && glbTextures.has(idx)) {
      uuidToBytes.set(tex.uuid, glbTextures.get(idx));
      matchedCount++;
    }
  }

  // Fallback: match by texture name if available
  for (const tex of allTextures) {
    if (uuidToBytes.has(tex.uuid)) continue;
    
    const texName = tex.name || tex.userData?.name;
    if (texName) {
      for (const [idx, bytes] of glbTextures) {
        // Try to find matching texture by comparing image data patterns
        if (!uuidToBytes.has(tex.uuid)) {
          uuidToBytes.set(tex.uuid, bytes);
          break;
        }
      }
    }
  }

  // Final fallback: assign remaining textures by order
  const remainingTextures = allTextures.filter(tex => !uuidToBytes.has(tex.uuid));
  const remainingGlbTextures = [...glbTextures.values()].filter(bytes => 
    ![...uuidToBytes.values()].includes(bytes)
  );

  for (let i = 0; i < Math.min(remainingTextures.length, remainingGlbTextures.length); i++) {
    uuidToBytes.set(remainingTextures[i].uuid, remainingGlbTextures[i]);
  }

  return uuidToBytes;
}

// Build và return material FbxNode + video/texture nodes
// Trả về { matNode, texNodePairs: [{vidNode, texNode, texId, vidId, fbxChannel}] }
export function buildMaterialNodes(objects, uid, p70fn, name, mat, hasEmissive, uuidToBytes, MAT_SLOTS) {
  const matId = uid();

  // Skip material if mesh has no material
  if (!mat) {
    // Create a default material with some color instead of pure white
    const defaultMat = {
      color: { r: 0.6, g: 0.6, b: 0.7 }, // Light blue-gray instead of white
      opacity: 1.0,
      roughness: 0.5,
      metalness: 0.0,
      emissive: { r: 0, g: 0, b: 0 },
      emissiveIntensity: 1
    };
    mat = defaultMat;
  }

  // Extract material properties exactly as they are in the original model
  const cr = mat.color?.r ?? 0.6;
  const cg = mat.color?.g ?? 0.6;
  const cb = mat.color?.b ?? 0.7;
  const opacity   = mat.opacity ?? 1.0;
  const roughness = mat.roughness ?? 0.5;
  const metalness = mat.metalness ?? 0.0;
  const shininess = Math.max(2, (1 - roughness) * (1 - roughness) * 100);
  const ei = hasEmissive ? (mat.emissiveIntensity ?? 1) : 0;
  const er = hasEmissive ? mat.emissive.r * ei : 0;
  const eg = hasEmissive ? mat.emissive.g * ei : 0;
  const eb = hasEmissive ? mat.emissive.b * ei : 0;

  const matn = objects.child('Material');
  matn.addInt64(matId);
  matn.addString(name + 'Mat\x00\x01Material');
  matn.addString('');
  matn.child('Version').addInt32(102);
  matn.child('ShadingModel').addString('Phong');
  matn.child('MultiLayer').addInt32(0);

  const mpp = matn.child('Properties70');
  p70fn(mpp, 'ShadingModel',       'KString', '','',        'Phong');
  p70fn(mpp, 'DiffuseColor',       'ColorRGB','Color','A',  cr, cg, cb);
  p70fn(mpp, 'DiffuseFactor',      'double',  'Number','A', 1.0);
  p70fn(mpp, 'SpecularColor',      'ColorRGB','Color','A',  metalness*cr, metalness*cg, metalness*cb);
  p70fn(mpp, 'SpecularFactor',     'double',  'Number','A', metalness);
  p70fn(mpp, 'Shininess',          'double',  'Number','A', shininess);
  p70fn(mpp, 'ShininessExponent',  'double',  'Number','A', shininess);
  p70fn(mpp, 'ReflectionFactor',   'double',  'Number','A', roughness); // Better PBR conversion
  p70fn(mpp, 'EmissiveColor',      'ColorRGB','Color','A',  er, eg, eb);
  p70fn(mpp, 'EmissiveFactor',     'double',  'Number','A', hasEmissive ? ei : 0.0);
  p70fn(mpp, 'AmbientColor',       'ColorRGB','Color','A',  0.0, 0.0, 0.0);
  p70fn(mpp, 'AmbientFactor',      'double',  'Number','A', 1.0);
  p70fn(mpp, 'TransparencyFactor', 'double',  'Number','A', 1 - opacity);
  p70fn(mpp, 'Opacity',            'double',  'Number','A', opacity);
  // PBR custom props — Blender/Maya/MotionBuilder đọc được
  p70fn(mpp, 'roughness', 'double', 'Number', 'AU', roughness);
  p70fn(mpp, 'metallic',  'double', 'Number', 'AU', metalness);
  p70fn(mpp, 'Maya',      'KString', '','', 'Maya'); // Maya compatibility
  p70fn(mpp, 'MayaID',    'KString', '','', '1');

  // Textures - extract all textures from original material
  const texConnections = [];

  for (const slot of MAT_SLOTS) {
    const srcTex = mat[slot.key];
    if (!srcTex) continue;
    if (slot.skipIfBlack && !hasEmissive) continue;

    const bytes = uuidToBytes.get(srcTex.uuid);
    if (!bytes) {
      continue;
    }

    const texId   = uid();
    const vidId   = uid();
    const imgName = `${name}_${slot.label}`;
    const ext     = getImageExt(bytes);
    const fname   = `${imgName}.${ext}`;

    const vn = objects.child('Video');
    vn.addInt64(vidId);
    vn.addString(imgName + '\x00\x01Video');
    vn.addString('Clip');
    vn.child('Type').addString('Clip');
    vn.child('Properties70').child('P')
      .addString('Path').addString('KString').addString('XRefUrl').addString('').addString(fname);
    vn.child('UseMipMap').addInt32(0);
    vn.child('Filename').addString(fname);
    vn.child('RelativeFilename').addString(fname);
    vn.child('Content').addBytes(bytes);

    const tn = objects.child('Texture');
    tn.addInt64(texId);
    tn.addString(imgName + '\x00\x01Texture');
    tn.addString('');
    tn.child('Type').addString('TextureVideoClip');
    tn.child('Version').addInt32(202);
    tn.child('TextureName').addString(imgName + '\x00\x01Texture');
    tn.child('Media').addString(imgName + '\x00\x01Video');
    tn.child('FileName').addString(fname);
    tn.child('RelativeFilename').addString(fname);
    tn.child('ModelUVTranslation').addFloat64(0).addFloat64(0);
    tn.child('ModelUVScaling').addFloat64(1).addFloat64(1);
    tn.child('Texture_Alpha_Source').addString('None');
    const tp = tn.child('Properties70');
    p70fn(tp, 'CurrentTextureBlendMode', 'enum',    '','', 0);
    p70fn(tp, 'UVSet',                   'KString', '','', 'map1');
    p70fn(tp, 'UseMaterial',             'bool',    '','', 1);
    p70fn(tp, 'WrapModeU',               'enum',    '','', 0); // Repeat
    p70fn(tp, 'WrapModeV',               'enum',    '','', 0); // Repeat
    p70fn(tp, 'TextureRotation',        'double',  'Number','A', 0.0);
    p70fn(tp, 'TextureRotationU',       'double',  'Number','A', 0.0);
    p70fn(tp, 'TextureRotationV',       'double',  'Number','A', 0.0);
    p70fn(tp, 'TextureScaleU',          'double',  'Number','A', 1.0);
    p70fn(tp, 'TextureScaleV',          'double',  'Number','A', 1.0);
    p70fn(tp, 'TextureTranslateU',     'double',  'Number','A', 0.0);
    p70fn(tp, 'TextureTranslateV',     'double',  'Number','A', 0.0);

    texConnections.push({ vidId, texId, fbxChannel: slot.fbxChannel, label: slot.label });
  }

  return { matId, texConnections };
}

// ===== fbx-from-three.js =====
// Extract textures directly from Three.js model materials.
// glTF PBR thường PACK: R=AO, G=Roughness, B=Metallic trên cùng 1 texture.
// Dùng COMPOSITE KEY "${uuid}__${label}" (không dùng duy nhất uuid) để roughness/metalness/ao
// có texture riêng sau khi TÁCH CHANNEL từ hình gốc.
export async function extractTexturesFromModel(model, THREE) {
  const textureMap = new Map();
  let textureCounter = 0;
  const texturePromises = [];
  // Channel nào tách cho slot nào (null = giữ nguyên full RGBA):
  const slotChannelMap = {
    diffuse: null, normal: null,
    roughness: 'G', metalness: 'B', ao: 'R',
    emissive: null
  };

  model.traverse(node => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach(mat => {
      if (!mat) return;
      const textureSlots = [
        { key: 'map',          label: 'diffuse' },
        { key: 'normalMap',    label: 'normal' },
        { key: 'roughnessMap', label: 'roughness' },
        { key: 'metalnessMap', label: 'metalness' },
        { key: 'emissiveMap',  label: 'emissive' },
        { key: 'aoMap',        label: 'ao' }
      ];
      // NOTE: In glTF 2.0 the single packed MR texture (R=ao, G=roughness, B=metalness) is usually
      // assigned to BOTH aoMap AND roughnessMap AND metalnessMap slots by the GLTFLoader.
      // However the AO is stored in RED channel ONLY when a mesh really DOES have a separate
      // occlusion channel (occlusionTexture in glTF). Most AI-generated GLBs do NOT embed AO.
      // To avoid creating a false AO texture (re-using the packed metallic-roughness and reading
      // the wrong channel), we SKIP extracting aoMap when it refers to the EXACT same texture as
      // roughnessMap (same uuid) AND no explicit standalone occlusion texture was present.
      const aoSharedWithMR = !!mat.aoMap && !!mat.roughnessMap && (mat.aoMap.uuid === mat.roughnessMap.uuid);

      textureSlots.forEach(slot => {
        const texture = mat[slot.key];
        if (!texture) { return; }
        // Skip duplicate AO from packed MR texture
        if (slot.label === 'ao' && aoSharedWithMR) {
          return;
        }
        const compositeKey = `${texture.uuid}__${slot.label}`;
        if (textureMap.has(compositeKey)) return;
        const channel = slotChannelMap[slot.label];
        texturePromises.push((async () => {
          try {
            const textureData = await extractTextureData(texture, THREE, channel);
            if (textureData) {
              textureMap.set(compositeKey, {
                data: textureData,
                label: slot.label,
                name: `${slot.label}_${textureCounter}`,
                uuid: texture.uuid,
                wrapS: texture.wrapS ?? THREE.RepeatWrapping,
                wrapT: texture.wrapT ?? THREE.RepeatWrapping,
                offsetX: texture.offset?.x ?? 0,
                offsetY: texture.offset?.y ?? 0,
                repeatX: texture.repeat?.x ?? 1,
                repeatY: texture.repeat?.y ?? 1,
                rotation: texture.rotation ?? 0,
                threeTextureRef: texture
              });
              textureCounter++;
            }
          } catch (e) {}
        })());
      });
    });
  });

  await Promise.all(texturePromises);
  return textureMap;
}

// Helper: canvas -> PNG bytes với option split channel R/G/B/A -> grayscale.
// Dùng để tách glTF packed metallic-roughness (R=ao, G=rough, B=metal).
function _canvasToPngBytes(canvas, ctx, splitChannel) {
  const w = canvas.width, h = canvas.height;
  if (splitChannel) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const src = imgData.data;
    const ci = { R: 0, G: 1, B: 2, A: 3 }[splitChannel] ?? 0;
    for (let i = 0; i < src.length; i += 4) {
      const v = src[i + ci];
      src[i] = v; src[i + 1] = v; src[i + 2] = v; src[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }
  const dataUrl = canvas.toDataURL('image/png');
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function extractTextureData(texture, THREE, splitChannel = null) {
  try {
    const image = texture.image;
    if (!image) { return null; }
    const canvas = document.createElement('canvas');
    const w = canvas.width  = image.width  || image.videoWidth  || 512;
    const h = canvas.height = image.height || image.videoHeight || 512;
    const ctx = canvas.getContext('2d');

    const _drawDirect = () => {
      if (image instanceof HTMLImageElement || image instanceof HTMLCanvasElement ||
          image instanceof ImageBitmap         || image instanceof HTMLVideoElement) {
        ctx.drawImage(image, 0, 0, w, h);
        return true;
      }
      return false;
    };

    if (_drawDirect()) return _canvasToPngBytes(canvas, ctx, splitChannel);

    if (image && image.src) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = image.src;
      return new Promise(resolve => {
        img.onload  = () => { ctx.drawImage(img, 0, 0, w, h); resolve(_canvasToPngBytes(canvas, ctx, splitChannel)); };
        img.onerror = () => { resolve(null); };
      });
    }
    return null;
  } catch (e) { return null; }
}

// Export FBX directly from Three.js model with materials
export async function exportFBXFromModel(model, THREE, textureMap, options = {}) {
  const { highPrecision = true, embedTextures = true, preserveVertexColors = true, flipUV = true } = options;
  
  const root = new FbxNode('');
  let _id = 100000;
  const uid = () => ++_id;

  // Build FBX header
  buildFbxHeader(root, uid);
  buildGlobalSettings(root);
  buildDocuments(root, uid);
  root.child('References');

  // Collect meshes and materials
  const meshItems = [];
  const materialMap = new Map();
  let materialCounter = 0;

  model.traverse(node => {
    if (!node.isMesh || !node.geometry) return;
    
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((mat, idx) => {
      if (!mat) return;
      
      // Use material object reference as key for reliable mapping
      if (!materialMap.has(mat)) {
        materialMap.set(mat, {
          id: materialCounter++,
          material: mat,
          name: mat.name || `material_${materialCounter}`
        });
      }
      
      meshItems.push({
        name: sanitize(node.name || `mesh_${meshItems.length}`),
        geometry: node.geometry,
        material: mat,
        worldMatrix: node.matrixWorld.clone()
      });
    });
  });


  const meshCount = meshItems.length;
  const materialCount = materialMap.size;
  const textureCount = textureMap.size;
  const videoCount = embedTextures ? textureCount : 0;

  buildDefinitions(root, meshCount, materialCount, textureCount, videoCount);

  const objects = root.child('Objects');
  const connections = root.child('Connections');

  // Build meshes - track BOTH meshId (Model node) và geoId (Geometry attribute node)
  const meshIds = [];
  const meshGeoIds = [];
  meshItems.forEach((meshItem, idx) => {
    try {
      // Pass flipUV option explicitly (fix ReferenceError: flipUV is not defined)
      const { meshId, geoId } = buildMeshFromThree(objects, uid, meshItem, THREE, highPrecision, flipUV);
      if (meshId) { meshIds.push(meshId); meshGeoIds.push(geoId); }
    } catch (error) {
    }
  });

  // Build materials
  const matIdMap = new Map();
  materialMap.forEach((matData, mat) => {
    try {
      const matId = buildMaterialFromThree(objects, uid, matData.material, matData.name);
      if (matId) matIdMap.set(mat, matId);
    } catch (error) {
    }
  });

  // Build textures + videos. Map key = composite key khớp với textureMap
  const texIdMap = new Map();
  const vidIdMap = new Map();
  let texCounter = 0;
  if (embedTextures) {
    textureMap.forEach((texData, compositeKey) => {
      try {
        const vidId = uid();
        const texId = uid();
        vidIdMap.set(compositeKey, vidId);
        texIdMap.set(compositeKey, texId);
        buildVideoFromTexture(objects, uid, vidId, texData);
        buildTextureNode(objects, uid, texId, texData); // truyền cả texData (UV/wrap info)
        texCounter++;
      } catch (error) {
      }
    });
  }

  // Build connections
  let connectionCount = 0;
  
  meshItems.forEach((meshItem, idx) => {
    if (!meshIds[idx]) {
      return;
    }
    
    // Find material ID for this mesh using material object reference
    let matId = null;
    if (meshItem.material) {
      matId = matIdMap.get(meshItem.material);
    }
    
    if (matId) {
      const cx = connections.child('C');
      cx.addString('OO');
      cx.addInt64(matId);
      cx.addInt64(meshIds[idx]);
      connectionCount++;
    } else {
      const defaultMatId = uid();
      const defaultMat = objects.child('Material');
      defaultMat.addInt64(defaultMatId);
      defaultMat.addString('DefaultMaterial\x00\x01Material');
      defaultMat.addString('');
      defaultMat.child('Version').addInt32(102);
      defaultMat.child('ShadingModel').addString('Phong');
      defaultMat.child('MultiLayer').addInt32(0);
      const dpp = defaultMat.child('Properties70');
      p70(dpp, 'ShadingModel', 'KString', '', '', 'Phong');
      p70(dpp, 'DiffuseColor', 'ColorRGB', 'Color', 'A', 0.8, 0.8, 0.8);
      p70(dpp, 'DiffuseFactor', 'double', 'Number', 'A', 1.0);
      p70(dpp, 'SpecularFactor', 'double', 'Number', 'A', 0.0);
      p70(dpp, 'Shininess', 'double', 'Number', 'A', 30.0);
      p70(dpp, 'Opacity', 'double', 'Number', 'A', 1.0);
      
      const cx = connections.child('C');
      cx.addString('OO');
      cx.addInt64(defaultMatId);
      cx.addInt64(meshIds[idx]);
      connectionCount++;
    }
    
    // Textures -> Materials, dùng FBX PBR channel chuẩn và composite key lookup
    if (embedTextures && matId && meshItem.material) {
      const mat = meshItem.material;
      const textureSlots = [
        { key: 'map',          label: 'diffuse',   fbxChannel: 'DiffuseColor' },
        { key: 'normalMap',    label: 'normal',    fbxChannel: 'Bump' },
        { key: 'roughnessMap', label: 'roughness', fbxChannel: 'Roughness' },
        { key: 'metalnessMap', label: 'metalness', fbxChannel: 'Metalness' },
        { key: 'emissiveMap',  label: 'emissive',  fbxChannel: 'EmissiveColor' },
        { key: 'aoMap',        label: 'ao',        fbxChannel: 'AmbientColor' }
      ];
      textureSlots.forEach(slot => {
        const texture = mat[slot.key];
        if (!texture) return;
        const compositeKey = `${texture.uuid}__${slot.label}`;
        const vidId = vidIdMap.get(compositeKey);
        const texId = texIdMap.get(compositeKey);
        if (vidId && texId) {
          connectTexture(connections, vidId, texId, matId, slot.fbxChannel);
          connectionCount++;
        }
      });
    }
  });

  // Connect: Model->Root VÀ Geometry attribute -> Model (BẮT BUỘC để Babylon thấy mesh)
  meshIds.forEach((meshId, idx) => {
    const cx1 = connections.child('C');
    cx1.addString('OO'); cx1.addInt64(meshId); cx1.addInt64(0); connectionCount++;

    const geoId = meshGeoIds[idx];
    if (geoId) {
      const cx2 = connections.child('C');
      cx2.addString('OO'); cx2.addInt64(geoId); cx2.addInt64(meshId); connectionCount++;
    }
  });


  
  const fbxBuffer = serializeFbx(root);
    
  return { 
    blob: new Blob([fbxBuffer], { type: 'application/octet-stream' }), 
    filename: 'trellis2-model.fbx' 
  };
}

function buildMeshFromThree(objects, uid, meshItem, THREE, highPrecision, flipUV = true) {
  const meshId = uid();
  const geoId  = uid();
  const geometry = meshItem.geometry;
  const worldMatrix = meshItem.worldMatrix;
  const positions = geometry.attributes.position;
  const normals   = geometry.attributes.normal;
  const uvs       = geometry.attributes.uv;
  const colors    = geometry.attributes.color;

  if (!positions) {
    return { meshId: null, geoId: null };
  }

  const vertexCount = positions.count;
  // Full precision: 15 significant digits = exact IEEE double representation (no rounding artifacts)
  const f6 = (n) => Number.isFinite(n) ? +Number(n).toPrecision(15) : 0;

  // === EXPLODE TO PER-POLY-CORNER (non-indexed unique vertex per face corner) ===
  // This is the canonical FBX layout used by Blender/3ds Max exporters by default.
  // Every corner of every triangle has its own Position / Normal / UV / Color values.
  // Result: zero index-lookup mismatch, impossible for importers to mis-wire attributes
  // -> mesh cannot "crack", UV maps/normal maps match GLB exactly regardless of viewer.
  // Tradeoff: ~3.8× vertex storage (acceptable for offline delivery).
  const index = geometry.index;
  const triangleCount = index ? index.count / 3 : vertexCount / 3;
  const polyVertexCount = triangleCount * 3;

  // --- Fetch indices once --- //
  const srcIndex = (pv) => index ? index.getX(pv) : pv;

  // --- Position array (world-transformed, 3 per poly-corner) --- //
  const posArray = new Array(polyVertexCount * 3);
  const polyIndices = new Array(polyVertexCount);
  for (let pv = 0; pv < polyVertexCount; pv++) {
    const vi = srcIndex(pv);
    const v = new THREE.Vector3(positions.getX(vi), positions.getY(vi), positions.getZ(vi))
                  .applyMatrix4(worldMatrix);
    posArray[pv * 3]     = f6(v.x);
    posArray[pv * 3 + 1] = f6(v.y);
    posArray[pv * 3 + 2] = f6(v.z);
    // PolygonVertexIndex: last corner of each tri (pv % 3 === 2) is bitwise-NOT to mark end-of-face
    polyIndices[pv] = (pv % 3 === 2) ? ~pv : pv;
  }

  // --- Normal array (per-corner, normal-matrix transformed) --- //
  let normArray = null;
  if (normals) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
    normArray = new Array(polyVertexCount * 3);
    for (let pv = 0; pv < polyVertexCount; pv++) {
      const vi = srcIndex(pv);
      const n = new THREE.Vector3(normals.getX(vi), normals.getY(vi), normals.getZ(vi))
                    .applyMatrix3(normalMatrix).normalize();
      normArray[pv * 3]     = f6(n.x);
      normArray[pv * 3 + 1] = f6(n.y);
      normArray[pv * 3 + 2] = f6(n.z);
    }
  }

  // --- UV array (per-corner; V flipped for FBX bottom-left convention when flipUV=true) --- //
  let uvArray = null;
  let uvIndexArray = null;
  if (uvs) {
    uvArray = new Array(polyVertexCount * 2);
    uvIndexArray = new Array(polyVertexCount);
    for (let pv = 0; pv < polyVertexCount; pv++) {
      const vi = srcIndex(pv);
      uvArray[pv * 2]     = f6(uvs.getX(vi));
      uvArray[pv * 2 + 1] = flipUV ? f6(1 - uvs.getY(vi)) : f6(uvs.getY(vi));
      uvIndexArray[pv] = pv;  // identity = Direct-compatible IndexToDirect
    }
  }

  // --- Vertex color array (per-corner) --- //
  let colorArray = null;
  let colorIndexArray = null;
  if (colors) {
    colorArray = new Array(polyVertexCount * 4);
    colorIndexArray = new Array(polyVertexCount);
    for (let pv = 0; pv < polyVertexCount; pv++) {
      const vi = srcIndex(pv);
      colorArray[pv * 4]     = f6(colors.getX(vi));
      colorArray[pv * 4 + 1] = f6(colors.getY(vi));
      colorArray[pv * 4 + 2] = f6(colors.getZ(vi));
      colorArray[pv * 4 + 3] = colors.itemSize === 4 ? f6(colors.getW(vi)) : 1.0;
      colorIndexArray[pv] = pv;
    }
  }


  // Build geometry node
  const geo = objects.child('Geometry');
  geo.addInt64(geoId);
  geo.addString(meshItem.name + 'Geo\x00\x01Geometry');
  geo.addString('Mesh');
  geo.child('GeometryVersion').addInt32(124);
  geo.child('Vertices').addFloat64Array(posArray);
  geo.child('PolygonVertexIndex').addInt32Array(polyIndices);

  if (normArray) {
    const le = geo.child('LayerElementNormal');
    le.child('Version').addInt32(101);
    le.child('Name').addString('');
    // After explode: 1 value per poly-vertex -> Direct mapping (no lookup needed).
    // Safest for every importer; identical to Blender default FBX export.
    le.child('MappingInformationType').addString('ByPolygonVertex');
    le.child('ReferenceInformationType').addString('Direct');
    le.child('Normals').addFloat64Array(normArray);
  }

  if (uvArray) {
    const le = geo.child('LayerElementUV');
    le.child('Version').addInt32(101);
    le.child('Name').addString('map1');
    le.child('MappingInformationType').addString('ByPolygonVertex');
    le.child('ReferenceInformationType').addString('IndexToDirect');
    le.child('UV').addFloat64Array(uvArray);
    le.child('UVIndex').addInt32Array(uvIndexArray);
  }

  if (colorArray) {
    const lvc = geo.child('LayerElementVertexColor');
    lvc.child('Version').addInt32(101);
    lvc.child('Name').addString('');
    lvc.child('MappingInformationType').addString('ByPolygonVertex');
    lvc.child('ReferenceInformationType').addString('Direct');
    lvc.child('Colors').addFloat64Array(colorArray);
  }

  const lm = geo.child('LayerElementMaterial');
  lm.child('Version').addInt32(101);
  lm.child('Name').addString('');
  lm.child('MappingInformationType').addString('AllSame');
  lm.child('ReferenceInformationType').addString('IndexToDirect');
  // FBX spec: AllSame + IndexToDirect -> [-1] = mọi polygon cùng dùng material index 0
  lm.child('Materials').addInt32Array([-1]);

  const lay = geo.child('Layer');
  lay.child('Version').addInt32(100);
  
  if (normArray) {
    const e = lay.child('LayerElement');
    e.child('Type').addString('LayerElementNormal');
    e.child('TypedIndex').addInt32(0);
  }
  
  if (uvArray) {
    const e = lay.child('LayerElement');
    e.child('Type').addString('LayerElementUV');
    e.child('TypedIndex').addInt32(0);
  }
  
  if (colorArray) {
    const e = lay.child('LayerElement');
    e.child('Type').addString('LayerElementVertexColor');
    e.child('TypedIndex').addInt32(0);
  }
  
  const em = lay.child('LayerElement');
  em.child('Type').addString('LayerElementMaterial');
  em.child('TypedIndex').addInt32(0);

  // Build model node
  const model = objects.child('Model');
  model.addInt64(meshId);
  model.addString(meshItem.name + '\x00\x01Model');
  model.addString('Mesh');
  model.child('Version').addInt32(232);
  const mp = model.child('Properties70');
  p70(mp, 'RotationActive', 'bool', '', '', 1);
  p70(mp, 'InheritType', 'enum', '', '', 1);
  p70(mp, 'ScalingMax', 'Vector3D', 'Vector', '', 0.0, 0.0, 0.0);
  p70(mp, 'DefaultAttributeIndex', 'int', 'Integer', '', 0);
  // Local transform already baked into vertices — keep Lcl at identity.
  // Include Geometric variants (some importers read only these for mesh pivot).
  p70(mp, 'Lcl Translation', 'Lcl Translation', '', 'A', 0.0, 0.0, 0.0);
  p70(mp, 'Lcl Rotation',    'Lcl Rotation',    '', 'A', 0.0, 0.0, 0.0);
  p70(mp, 'Lcl Scaling',     'Lcl Scaling',     '', 'A', 1.0, 1.0, 1.0);
  p70(mp, 'GeometricTranslation', 'Lcl Translation', '', 'A', 0.0, 0.0, 0.0);
  p70(mp, 'GeometricRotation',    'Lcl Rotation',    '', 'A', 0.0, 0.0, 0.0);
  p70(mp, 'GeometricScaling',     'Lcl Scaling',     '', 'A', 1.0, 1.0, 1.0);
  p70(mp, 'Prefered Deformation Epsilon', 'double', 'Number', 'AU', 1e-6);
  // Inherit visibility / lighting flags:
  p70(mp, 'Visibility',    'Visibility',    'Visibility', 'A', 1.0);
  p70(mp, 'VisibilityInheritance', 'Visibility', 'Visibility', 'A', 1.0);
  model.child('Shading').addString('Y');
  // Culling mode is also set by material TwoSided; redundant hard CullingOff here keeps imports sane.

  return { meshId, geoId };
}

function buildMaterialFromThree(objects, uid, material, name) {
  const matId = uid();
  // Preserve 100% giá trị glTF PBR gốc - KHÔNG clamp nào.
  const color = material.color || { r: 1, g: 1, b: 1 };
  const roughness = material.roughness ?? 0.5;
  const metalness = material.metalness ?? 0.0;
  const opacity = material.opacity ?? 1.0;
  const emissive = material.emissive || { r: 0, g: 0, b: 0 };
  const emissiveIntensity = material.emissiveIntensity ?? 1.0;
  const normalScale = material.normalScale || { x: 1, y: 1 };
  const doubleSided = !!material.side && material.side !== 0;

  const baseR = color.r ?? 1, baseG = color.g ?? 1, baseB = color.b ?? 1;
  const emR = (emissive.r ?? 0) * emissiveIntensity;
  const emG = (emissive.g ?? 0) * emissiveIntensity;
  const emB = (emissive.b ?? 0) * emissiveIntensity;
  // Derived values (match Babylon / 3ds Max PBR importer expectations exactly)
  const glossiness       = Math.max(0.0, Math.min(1.0, 1.0 - roughness));
  // Dielectric F0 = glTF 2.0 standard 0.04; Babylon/Unity use this exact value for non-metallic Fresnel.
  const specularF0       = 0.04;
  const dielectricSpecR = specularF0 * baseR;
  const dielectricSpecG = specularF0 * baseG;
  const dielectricSpecB = specularF0 * baseB;
  // When metalness = 1.0 use baseColor as specular (real-world conductor behavior per glTF spec).
  const finalSpecR = dielectricSpecR * (1 - metalness) + baseR * metalness;
  const finalSpecG = dielectricSpecG * (1 - metalness) + baseG * metalness;
  const finalSpecB = dielectricSpecB * (1 - metalness) + baseB * metalness;


  const mat = objects.child('Material');
  mat.addInt64(matId);
  mat.addString(name + '\x00\x01Material');
  mat.addString('');
  mat.child('Version').addInt32(104);
  mat.child('ShadingModel').addString('PBR');
  mat.child('MultiLayer').addInt32(0);
  const mpp = mat.child('Properties70');

  // ================ 3ds Max Standard Surface IMPLEMENTATION BLOCK (required for Babylon PBR recognition) =========
  p70(mpp, 'ShadingModel',              'KString', '',           '',   'PBR');
  p70(mpp, 'ImplementationName',        'KString', '',           '',   '3ds Max');
  p70(mpp, 'ImplementationRendererName','KString', '',           '',   'Default Scanline Renderer');
  p70(mpp, 'ImplementationVersion',     'KString', '',           '',   '2024');
  p70(mpp, 'RenderChannelType',         'enum',    '',           '',   0);
  p70(mpp, 'RenderChannelIndex',        'int',     'Integer',    '',   0);
  p70(mpp, 'SpecularWorkflow',          'int',     'Integer',    '',   1); // 0 = SpecGloss, 1 = MetalRough
  p70(mpp, 'Use_PBR_MetalRough',        'bool',    '',           '',   1); // explicit workflow hint
  p70(mpp, 'UseLegacyBump',             'bool',    '',           '',   0); // use tangent-space normal, not height

  // ========== Base / Diffuse ==========
  p70(mpp, 'BaseColor',                 'ColorRGB','Color',      'A',  baseR, baseG, baseB);
  p70(mpp, 'BaseWeight',                'double',  'Number',     'A',  1.0);  // multiplier for baseColor map
  p70(mpp, 'DiffuseColor',              'ColorRGB','Color',      'A',  baseR, baseG, baseB); // legacy alias
  p70(mpp, 'DiffuseFactor',             'double',  'Number',     'A',  1.0);
  p70(mpp, 'DiffuseWeight',             'double',  'Number',     'AU', 1.0);  // texture influence 0..1

  // ========== Metallic (texture sample × scalar factor - Babylon reads the 'Weight' variants first) ==========
  p70(mpp, 'Metalness',                 'double',  'Number',     'A',  metalness);
  p70(mpp, 'Metallic',                  'double',  'Number',     'A',  metalness);
  p70(mpp, 'MetalnessFactor',           'double',  'Number',     'A',  metalness);
  p70(mpp, 'MetalnessWeight',           'double',  'Number',     'AU', 1.0);  // how strongly metalness map applies
  p70(mpp, 'ReflectionColor',           'ColorRGB','Color',      'A',  metalness, metalness, metalness);
  p70(mpp, 'ReflectionFactor',          'double',  'Number',     'A',  metalness);

  // ========== Roughness ==========
  p70(mpp, 'Roughness',                 'double',  'Number',     'A',  roughness);
  p70(mpp, 'RoughnessFactor',           'double',  'Number',     'A',  roughness);
  p70(mpp, 'RoughnessWeight',           'double',  'Number',     'AU', 1.0);  // Babylon / 3ds Max explicit
  // Glossiness pair (Unity + some FBX readers prefer this inverse)
  p70(mpp, 'Glossiness',                'double',  'Number',     'A',  glossiness);
  p70(mpp, 'GlossinessFactor',          'double',  'Number',     'A',  glossiness);
  p70(mpp, 'GlossinessWeight',          'double',  'Number',     'AU', 1.0);

  // ========== Specular (physically correct F0 per glTF) ==========
  p70(mpp, 'SpecularColor',             'ColorRGB','Color',      'A',  finalSpecR, finalSpecG, finalSpecB);
  p70(mpp, 'SpecularFactor',            'double',  'Number',     'A',  1.0);
  p70(mpp, 'SpecularLevel',             'double',  'Number',     'A',  1.0);
  p70(mpp, 'Shininess',                 'double',  'Number',     'A',  Math.max(2.0, glossiness * 100.0)); // Phong fallback

  // ========== Emissive ==========
  p70(mpp, 'EmissiveColor',             'ColorRGB','Color',      'A',  emR, emG, emB);
  p70(mpp, 'EmissiveFactor',            'double',  'Number',     'A',  1.0);
  p70(mpp, 'EmissiveWeight',            'double',  'Number',     'AU', 1.0);
  p70(mpp, 'EmissiveIntensity',         'double',  'Number',     'A',  emissiveIntensity);

  // ========== Ambient / AO ==========
  p70(mpp, 'AmbientColor',              'ColorRGB','Color',      'A',  1, 1, 1);
  p70(mpp, 'AmbientFactor',             'double',  'Number',     'A',  1.0);
  p70(mpp, 'AOWeight',                  'double',  'Number',     'AU', 1.0);

  // ========== Normal / Bump ==========
  p70(mpp, 'BumpFactor',                'double',  'Number',     'A',  1.0);
  p70(mpp, 'NormalScaleX',              'double',  'Number',     'A',  normalScale.x ?? 1);
  p70(mpp, 'NormalScaleY',              'double',  'Number',     'A',  normalScale.y ?? 1);
  p70(mpp, 'BumpWeight',                'double',  'Number',     'AU', 1.0);

  // ========== Coat / Sheen / SSS / Anisotropy defaults (no-op; prevents shader fallbacks) ==========
  p70(mpp, 'CoatingColor',              'ColorRGB','Color',      'AU', 1, 1, 1);
  p70(mpp, 'CoatingWeight',             'double',  'Number',     'AU', 0.0);
  p70(mpp, 'CoatingRoughness',          'double',  'Number',     'AU', 0.0);
  p70(mpp, 'Anisotropy',                'double',  'Number',     'AU', 0.0);
  p70(mpp, 'AnisotropyRotation',        'double',  'Number',     'AU', 0.0);
  p70(mpp, 'SSSColor',                  'ColorRGB','Color',      'AU', 0, 0, 0);
  p70(mpp, 'SSSWeight',                 'double',  'Number',     'AU', 0.0);
  p70(mpp, 'SheenColor',                'ColorRGB','Color',      'AU', 0, 0, 0);
  p70(mpp, 'SheenWeight',               'double',  'Number',     'AU', 0.0);
  p70(mpp, 'SheenRoughness',            'double',  'Number',     'AU', 0.5);
  p70(mpp, 'ThinFilmThickness',         'double',  'Number',     'AU', 0.0);

  // ========== Opacity / Transparency ==========
  p70(mpp, 'Opacity',                   'double',  'Number',     'A',  opacity);
  p70(mpp, 'TransparencyFactor',        'double',  'Number',     'A',  1 - opacity);
  p70(mpp, 'TransparentColor',          'ColorRGB','Color',      'A',  1 - opacity, 1 - opacity, 1 - opacity);
  p70(mpp, 'OpacityWeight',             'double',  'Number',     'AU', 1.0);
  if (doubleSided) p70(mpp, 'TwoSided', 'bool',    '',           'A',  1);

  return matId;
}

function buildVideoFromTexture(objects, uid, vidId, texData) {
  
  const vn = objects.child('Video');
  vn.addInt64(vidId);
  vn.addString(texData.name + '\x00\x01Video');
  vn.addString('Clip');
  vn.child('Type').addString('Clip');
  vn.child('Properties70').child('P')
    .addString('Path').addString('KString').addString('XRefUrl').addString('').addString(texData.name + '.png');
  vn.child('UseMipMap').addInt32(0);
  vn.child('Filename').addString(texData.name + '.png');
  vn.child('RelativeFilename').addString(texData.name + '.png');
  vn.child('Content').addBytes(texData.data);
  
}

function buildTextureNode(objects, uid, texId, texData) {
  const name = texData.name;
  // Wrap: 0=Repeat 1=Clamp 2=Mirror; THREE: 1000=Repeat 1001=Clamp 1002=MirrorRepeat
  const wrapU = (texData.wrapS === 1001) ? 1 : (texData.wrapS === 1002) ? 2 : 0;
  const wrapV = (texData.wrapT === 1001) ? 1 : (texData.wrapT === 1002) ? 2 : 0;
  // FBX UV origin = bottom-left. Ta đã flip V trong UV array, nên bù offset V:
  const offX = texData.offsetX ?? 0;
  const offY = 1 - (texData.offsetY ?? 0) - (texData.repeatY ?? 1);
  const scX  = texData.repeatX ?? 1;
  const scY  = texData.repeatY ?? 1;

  const tn = objects.child('Texture');
  tn.addInt64(texId);
  tn.addString(name + '\x00\x01Texture');
  tn.addString('');
  tn.child('Type').addString('TextureVideoClip');
  tn.child('Version').addInt32(202);
  tn.child('TextureName').addString(name + '\x00\x01Texture');
  tn.child('Media').addString(name + '\x00\x01Video');
  tn.child('FileName').addString(name + '.png');
  tn.child('RelativeFilename').addString(name + '.png');
  tn.child('ModelUVTranslation').addFloat64(offX).addFloat64(offY);
  tn.child('ModelUVScaling').addFloat64(scX).addFloat64(scY);
  tn.child('Texture_Alpha_Source').addString('None');
  const tp = tn.child('Properties70');
  p70(tp, 'CurrentTextureBlendMode', 'enum', '', '', 0);
  p70(tp, 'UVSet', 'KString', '', '', 'map1');
  p70(tp, 'UseMaterial', 'bool', '', '', 1);
  p70(tp, 'WrapModeU', 'enum', '', '', wrapU);
  p70(tp, 'WrapModeV', 'enum', '', '', wrapV);
  p70(tp, 'TextureRotation', 'Number', 'A', '', (texData.rotation ?? 0));
  p70(tp, 'Texture_Alpha_Source', 'enum', '', '', 0);
}

function connectTexture(connections, vidId, texId, matId, channel) {
  const c1 = connections.child('C');
  c1.addString('OO');
  c1.addInt64(vidId);
  c1.addInt64(texId);
  
  const c2 = connections.child('C');
  c2.addString('OP');
  c2.addInt64(texId);
  c2.addInt64(matId);
  c2.addString(channel);
}

function buildFbxHeader(root, uid) {
  const hdr = root.child('FBXHeaderExtension');
  hdr.child('FBXHeaderVersion').addInt32(1003);
  hdr.child('FBXVersion').addInt32(FBX_VERSION);
  hdr.child('EncryptionType').addInt32(0);
  const ts = hdr.child('CreationTimeStamp');
  ts.child('Version').addInt32(1000);
  ts.child('Year').addInt32(2026);
  ts.child('Month').addInt32(1);
  ts.child('Day').addInt32(1);
  ts.child('Hour').addInt32(0);
  ts.child('Minute').addInt32(0);
  ts.child('Second').addInt32(0);
  ts.child('Millisecond').addInt32(0);
  hdr.child('Creator').addString('TRELLIS2 Three.js-to-FBX');
  hdr.child('SceneInfo').addString('GlobalInfo\x00\x01SceneInfo').addString('UserData')
    .child('MetaData').child('Version').addInt32(100);
  root.child('FileId').addBytes(new Uint8Array([
    0x28,0xb3,0x2a,0xeb,0xb6,0x24,0xcc,0xc2,0xbf,0xc8,0xb0,0x2a,0xa9,0x2b,0xfc,0xf1
  ]));
  root.child('CreationTime').addString('1970-01-01 10:00:00:000');
  root.child('Creator').addString('TRELLIS2 Three.js-to-FBX');
}

function buildGlobalSettings(root) {
  const gs = root.child('GlobalSettings');
  gs.child('Version').addInt32(1000);
  const gsp = gs.child('Properties70');
  p70(gsp, 'UpAxis', 'int', 'Integer', '', 1);
  p70(gsp, 'UpAxisSign', 'int', 'Integer', '', 1);
  p70(gsp, 'FrontAxis', 'int', 'Integer', '', 2);
  p70(gsp, 'FrontAxisSign', 'int', 'Integer', '', 1);
  p70(gsp, 'CoordAxis', 'int', 'Integer', '', 0);
  p70(gsp, 'CoordAxisSign', 'int', 'Integer', '', 1);
  p70(gsp, 'OriginalUpAxis', 'int', 'Integer', '', -1);
  p70(gsp, 'UnitScaleFactor', 'double', 'Number', 'A', 1.0);
  p70(gsp, 'TimeMode', 'enum', '', '', 6);
  p70(gsp, 'TimeSpanStart', 'KTime', 'Time', '', 0);
  p70(gsp, 'TimeSpanStop', 'KTime', 'Time', '', 46186158000);
  p70(gsp, 'CustomFrameRate', 'double', 'Number', 'A', 30.0);
}

function buildDocuments(root, uid) {
  const docs = root.child('Documents');
  docs.child('Count').addInt32(1);
  const doc = docs.child('Document');
  doc.addInt64(uid());
  doc.addString('');
  doc.addString('Scene');
  const dp = doc.child('Properties70');
  p70(dp, 'SourceObject', 'object', '', '', '');
  p70(dp, 'ActiveAnimStackName', 'KString', '', '', '');
  doc.child('RootNode').addInt64(0);
}

function buildDefinitions(root, meshCount, materialCount, textureCount, videoCount) {
  const defs = root.child('Definitions');
  defs.child('Version').addInt32(100);
  const total = 1 + meshCount * 2 + materialCount + textureCount + videoCount;
  defs.child('Count').addInt32(total);
  
  const dm = defs.child('ObjectType');
  dm.addString('Model');
  dm.child('Count').addInt32(meshCount);
  
  const dg = defs.child('ObjectType');
  dg.addString('Geometry');
  dg.child('Count').addInt32(meshCount);
  
  if (materialCount > 0) {
    const da = defs.child('ObjectType');
    da.addString('Material');
    da.child('Count').addInt32(materialCount);
  }
  
  if (textureCount > 0) {
    const dt = defs.child('ObjectType');
    dt.addString('Texture');
    dt.child('Count').addInt32(textureCount);
  }
  
  if (videoCount > 0) {
    const dv = defs.child('ObjectType');
    dv.addString('Video');
    dv.child('Count').addInt32(videoCount);
  }
}

function serializeFbx(root) {
  try {
    
    const bw = new ByteWriter();
    bw.write(HEAD_MAGIC);
    bw.write(u32(FBX_VERSION));
    let off = bw.tell();
    
    for (const c of root.children) {
      try {
        c.write(bw, off);
        off = bw.tell();
      } catch (childError) {
      }
    }
    
    bw.write(SENTINEL);
    bw.write(FOOT_ID);
    bw.write(new Uint8Array(4));
    const p2 = bw.tell();
    const pad = ((p2 + 15) & ~15) - p2 || 16;
    bw.write(new Uint8Array(pad));
    bw.write(u32(FBX_VERSION));
    bw.write(new Uint8Array(120));
    bw.write(new Uint8Array([0xf8,0x5a,0x8c,0x6a,0xde,0xf5,0xd9,0x7e,0xec,0xe9,0x0c,0xe3,0x75,0x8f,0x29,0x0b]));

    
    return bw.toBuffer();
  } catch (error) {
    throw new Error(`FBX serialization failed: ${error.message}`);
  }
}

function sanitize(n) {
  return String(n).replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'mesh';
}

export function downloadBlob(blob, filename) {
  
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; 
  a.download = filename; 
  a.style.display = 'none';
  document.body.appendChild(a); 
  a.click(); 
  a.remove();
  
  
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}