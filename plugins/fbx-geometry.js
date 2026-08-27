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
  const f6      = (n) => Number.isFinite(n) ? +n.toFixed(6) : 0;

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
