import { FBX_VERSION, HEAD_MAGIC, FOOT_ID, SENTINEL, ByteWriter, FbxNode, p70, u32 } from './fbx-binary.js';
import { MAT_TEX_SLOTS, buildTexBytesMap, buildMaterialNodes }                         from './fbx-material.js';
import { buildGeometryNode }                                                            from './fbx-geometry.js';

export async function exportFBX(model, THREE, glbTextures, options = {}) {
  const {
    highPrecision = true,       // Use 9 decimal places for coordinates
    embedTextures = true,       // Embed textures in FBX
    preserveVertexColors = true, // Keep vertex colors if present
    optimizeGeometry = false    // Skip optimization to preserve quality
  } = options;
  model.updateMatrixWorld(true);

  // Build uuid→bytes map (fix: dùng per-slot keys đúng)
  const slotKeys = MAT_TEX_SLOTS.map(s => s.key);
  const uuidToBytes = buildTexBytesMap(model, glbTextures, slotKeys);
  console.log(`[FBX] Export options: highPrecision=${highPrecision}, embedTextures=${embedTextures}, preserveVertexColors=${preserveVertexColors}`);
  console.log(`[FBX] texture map: ${uuidToBytes.size} unique texture(s) resolved`);

  // Collect meshes
  const meshItems = [];
  model.traverse(node => {
    if (!node.isMesh || !node.geometry) return;
    meshItems.push({
      name:  sanitize(node.name || `mesh_${meshItems.length}`),
      geo:   node.geometry,
      mat:   Array.isArray(node.material) ? node.material[0] : (node.material || null),
      world: node.matrixWorld.clone(),
    });
  });
  if (!meshItems.length) throw new Error('No meshes found in model.');

  let _id = 100000;
  const uid = () => ++_id;

  const hasEmissivePerMesh = meshItems.map(({ mat }) =>
    !!(mat?.emissive && (mat.emissive.r > 0.001 || mat.emissive.g > 0.001 || mat.emissive.b > 0.001))
  );

  // Pre-count textures for Definitions node (must be exact)
  const totalTex = meshItems.reduce((acc, { mat }, i) => {
    if (!mat) return acc;
    return acc + MAT_TEX_SLOTS.filter(s => {
      if (!mat[s.key]) return false;
      if (s.skipIfBlack && !hasEmissivePerMesh[i]) return false;
      return uuidToBytes.has(mat[s.key].uuid);
    }).length;
  }, 0);

  // Build FBX tree
  const root = new FbxNode('');
  buildHeader(root, uid);
  buildGlobalSettings(root);
  buildDocuments(root, uid);
  root.child('References');
  buildDefinitions(root, meshItems.length, totalTex);

  const objects     = root.child('Objects');
  const connections = root.child('Connections');

  for (let mi = 0; mi < meshItems.length; mi++) {
    const { name, geo, mat, world } = meshItems[mi];
    const hasEmissive = hasEmissivePerMesh[mi];

    console.log(`[FBX Export] Processing mesh ${mi}/${meshItems.length}: "${name}"`);

    // Geometry
    const { geoId, empty } = buildGeometryNode(objects, uid, p70, name, geo, world, THREE);
    if (empty) { console.warn(`[FBX] mesh "${name}" has no vertices — skipped`); continue; }

    // Model
    const modelId = uid();
    buildModelNode(objects, uid, p70, modelId, name);

    // Material + textures - use original material exactly as is
    const { matId, texConnections } = buildMaterialNodes(
      objects, uid, p70, name, mat, hasEmissive, uuidToBytes, MAT_TEX_SLOTS
    );
    
    console.log(`[FBX Export] Material ID: ${matId}, Texture connections: ${texConnections.length}`);

    // Connections: vid→tex, tex→mat(channel)
    for (const { vidId, texId, fbxChannel } of texConnections) {
      const c1 = connections.child('C'); c1.addString('OO'); c1.addInt64(vidId);   c1.addInt64(texId);
      const c2 = connections.child('C'); c2.addString('OP'); c2.addInt64(texId);   c2.addInt64(matId); c2.addString(fbxChannel);
    }
    // geo→model, mat→model, model→root(0)
    const cx = connections.child('C'); cx.addString('OO'); cx.addInt64(geoId);   cx.addInt64(modelId);
    const cy = connections.child('C'); cy.addString('OO'); cy.addInt64(matId);   cy.addInt64(modelId);
    const cz = connections.child('C'); cz.addString('OO'); cz.addInt64(modelId); cz.addInt64(0);
  }

  // Serialize to binary
  const bw = new ByteWriter();
  bw.write(HEAD_MAGIC);
  bw.write(u32(FBX_VERSION));
  let off = bw.tell();
  for (const c of root.children) { c.write(bw, off); off = bw.tell(); }
  bw.write(SENTINEL);
  bw.write(FOOT_ID);
  bw.write(new Uint8Array(4));
  const p2 = bw.tell();
  const pad = ((p2 + 15) & ~15) - p2 || 16;
  bw.write(new Uint8Array(pad));
  bw.write(u32(FBX_VERSION));
  bw.write(new Uint8Array(120));
  bw.write(new Uint8Array([0xf8,0x5a,0x8c,0x6a,0xde,0xf5,0xd9,0x7e,0xec,0xe9,0x0c,0xe3,0x75,0x8f,0x29,0x0b]));

  const buf = bw.toBuffer();
  console.log(`[FBX] Export complete — ${Math.round(buf.length/1024)}KB, ${meshItems.length} mesh(es), ${totalTex} texture(s) embedded`);
  console.log(`[FBX] Quality settings: precision=${highPrecision ? 'high' : 'standard'}, textures=${embedTextures ? 'embedded' : 'external'}`);
  return { blob: new Blob([buf], { type: 'application/octet-stream' }), filename: 'trellis2-model.fbx' };
}

// ─── FBX tree builders ────────────────────────────────────────────────────────

function buildHeader(root, uid) {
  const hdr = root.child('FBXHeaderExtension');
  hdr.child('FBXHeaderVersion').addInt32(1003);
  hdr.child('FBXVersion').addInt32(FBX_VERSION);
  hdr.child('EncryptionType').addInt32(0);
  const ts = hdr.child('CreationTimeStamp');
  ts.child('Version').addInt32(1000); ts.child('Year').addInt32(2026);
  ts.child('Month').addInt32(1);      ts.child('Day').addInt32(1);
  ts.child('Hour').addInt32(0);       ts.child('Minute').addInt32(0);
  ts.child('Second').addInt32(0);     ts.child('Millisecond').addInt32(0);
  hdr.child('Creator').addString('TRELLIS2');
  hdr.child('SceneInfo').addString('GlobalInfo\x00\x01SceneInfo').addString('UserData')
    .child('MetaData').child('Version').addInt32(100);
  root.child('FileId').addBytes(new Uint8Array([
    0x28,0xb3,0x2a,0xeb,0xb6,0x24,0xcc,0xc2,0xbf,0xc8,0xb0,0x2a,0xa9,0x2b,0xfc,0xf1
  ]));
  root.child('CreationTime').addString('1970-01-01 10:00:00:000');
  root.child('Creator').addString('TRELLIS2');
}

function buildGlobalSettings(root) {
  const gs  = root.child('GlobalSettings');
  gs.child('Version').addInt32(1000);
  const gsp = gs.child('Properties70');
  p70(gsp, 'UpAxis',          'int',    'Integer', '', 1);
  p70(gsp, 'UpAxisSign',      'int',    'Integer', '', 1);
  p70(gsp, 'FrontAxis',       'int',    'Integer', '', 2);
  p70(gsp, 'FrontAxisSign',   'int',    'Integer', '', 1);
  p70(gsp, 'CoordAxis',       'int',    'Integer', '', 0);
  p70(gsp, 'CoordAxisSign',   'int',    'Integer', '', 1);
  p70(gsp, 'OriginalUpAxis',  'int',    'Integer', '', -1);
  p70(gsp, 'UnitScaleFactor', 'double', 'Number',  'A', 1.0);
  p70(gsp, 'TimeMode',        'enum',    '',        '', 6); // Custom FPS
  p70(gsp, 'TimeSpanStart',   'KTime',  'Time',    '', 0);
  p70(gsp, 'TimeSpanStop',    'KTime',  'Time',    '', 46186158000);
  p70(gsp, 'CustomFrameRate', 'double',  'Number',  'A', 30.0);
}

function buildDocuments(root, uid) {
  const docs = root.child('Documents');
  docs.child('Count').addInt32(1);
  const doc = docs.child('Document');
  doc.addInt64(uid()); doc.addString(''); doc.addString('Scene');
  const dp = doc.child('Properties70');
  p70(dp, 'SourceObject',        'object',  '', '', '');
  p70(dp, 'ActiveAnimStackName', 'KString', '', '', '');
  doc.child('RootNode').addInt64(0);
}

function buildDefinitions(root, meshCount, totalTex) {
  const defs = root.child('Definitions');
  defs.child('Version').addInt32(100);
  defs.child('Count').addInt32(1 + meshCount * 3 + totalTex * 2);
  const dm = defs.child('ObjectType'); dm.addString('Model');    dm.child('Count').addInt32(meshCount);
  const dg = defs.child('ObjectType'); dg.addString('Geometry'); dg.child('Count').addInt32(meshCount);
  const da = defs.child('ObjectType'); da.addString('Material'); da.child('Count').addInt32(meshCount);
  if (totalTex > 0) {
    const dt = defs.child('ObjectType'); dt.addString('Texture'); dt.child('Count').addInt32(totalTex);
    const dv = defs.child('ObjectType'); dv.addString('Video');   dv.child('Count').addInt32(totalTex);
  }
}

function buildModelNode(objects, uid, p70fn, modelId, name) {
  const mn = objects.child('Model');
  mn.addInt64(modelId);
  mn.addString(name + '\x00\x01Model');
  mn.addString('Mesh');
  mn.child('Version').addInt32(232);
  const mp = mn.child('Properties70');
  p70fn(mp, 'RotationActive',        'bool',         '', '',  1);
  p70fn(mp, 'InheritType',           'enum',         '', '',  1);
  p70fn(mp, 'ScalingMax',            'Vector3D',     'Vector', '', 0.0, 0.0, 0.0);
  p70fn(mp, 'DefaultAttributeIndex', 'int',          'Integer', '', 0);
  p70fn(mp, 'Lcl Translation',       'Lcl Translation', '', 'A', 0.0, 0.0, 0.0);
  p70fn(mp, 'Lcl Rotation',          'Lcl Rotation',    '', 'A', 0.0, 0.0, 0.0);
  p70fn(mp, 'Lcl Scaling',           'Lcl Scaling',     '', 'A', 1.0, 1.0, 1.0);
  mn.child('Shading').addString('Y');
  mn.child('Culling').addString('CullingOff');
}

function sanitize(n) {
  return String(n).replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'mesh';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
