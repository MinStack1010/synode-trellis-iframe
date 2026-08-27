import { p70 } from './fbx-binary.js';

// FBX texture channels — chỉ các channel mọi tool đều hiểu đúng
export const MAT_TEX_SLOTS = [
  { key: 'map',         fbxChannel: 'DiffuseColor', label: 'diffuse'  },
  { key: 'normalMap',   fbxChannel: 'Bump',          label: 'normal'   },
  { key: 'emissiveMap', fbxChannel: 'EmissiveColor', label: 'emissive', skipIfBlack: true },
  { key: 'aoMap',       fbxChannel: 'AmbientColor',  label: 'ao'       },
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
// Dùng userData.index nếu có (Three.js r140+ GLTFLoader), fallback theo thứ tự gặp
export function buildTexBytesMap(model, glbTextures, slotKeys) {
  if (!glbTextures || glbTextures.size === 0) return new Map();

  const uuidToBytes = new Map();

  // Pass 1: dùng userData.index nếu GLTFLoader đã set
  model.traverse(node => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach(mat => {
      if (!mat) return;
      for (const key of slotKeys) {
        const tex = mat[key];
        if (!tex || uuidToBytes.has(tex.uuid)) continue;
        const idx = tex.userData?.index ?? tex.userData?.textureIndex;
        if (idx != null && glbTextures.has(idx)) {
          uuidToBytes.set(tex.uuid, glbTextures.get(idx));
        }
      }
    });
  });

  // Pass 2: fallback — assign theo thứ tự unique textures gặp, dùng glbTextures keys theo thứ tự
  const unusedIdxs = [...glbTextures.keys()].filter(k => {
    // tìm key nào chưa được dùng bởi pass 1
    for (const [, bytes] of uuidToBytes) {
      if (glbTextures.get(k) === bytes) return false;
    }
    return true;
  });

  let fallbackCursor = 0;
  model.traverse(node => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach(mat => {
      if (!mat) return;
      for (const key of slotKeys) {
        const tex = mat[key];
        if (!tex || uuidToBytes.has(tex.uuid)) continue;
        // Assign theo thứ tự glbTextures
        const allKeys = [...glbTextures.keys()];
        if (fallbackCursor < allKeys.length) {
          uuidToBytes.set(tex.uuid, glbTextures.get(allKeys[fallbackCursor]));
          fallbackCursor++;
        }
      }
    });
  });

  return uuidToBytes;
}

// Build và return material FbxNode + video/texture nodes
// Trả về { matNode, texNodePairs: [{vidNode, texNode, texId, vidId, fbxChannel}] }
export function buildMaterialNodes(objects, uid, p70fn, name, mat, hasEmissive, uuidToBytes, MAT_SLOTS) {
  const matId = uid();

  const cr = mat?.color?.r ?? 0.8;
  const cg = mat?.color?.g ?? 0.8;
  const cb = mat?.color?.b ?? 0.8;
  const opacity   = mat?.opacity   ?? 1;
  const roughness = mat?.roughness ?? 0.5;
  const metalness = mat?.metalness ?? 0;
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
  p70fn(mpp, 'ReflectionFactor',   'double',  'Number','A', 0.0);
  p70fn(mpp, 'EmissiveColor',      'ColorRGB','Color','A',  er, eg, eb);
  p70fn(mpp, 'EmissiveFactor',     'double',  'Number','A', hasEmissive ? ei : 0.0);
  p70fn(mpp, 'AmbientColor',       'ColorRGB','Color','A',  0.0, 0.0, 0.0);
  p70fn(mpp, 'AmbientFactor',      'double',  'Number','A', 1.0);
  p70fn(mpp, 'TransparencyFactor', 'double',  'Number','A', 1 - opacity);
  p70fn(mpp, 'Opacity',            'double',  'Number','A', opacity);
  // PBR custom props — Blender/Maya đọc được
  p70fn(mpp, 'roughness', 'double', 'Number', 'AU', roughness);
  p70fn(mpp, 'metallic',  'double', 'Number', 'AU', metalness);

  // Textures
  const texConnections = [];

  for (const slot of MAT_SLOTS) {
    const srcTex = mat?.[slot.key];
    if (!srcTex) continue;
    if (slot.skipIfBlack && !hasEmissive) continue;

    const bytes = uuidToBytes.get(srcTex.uuid);
    if (!bytes) {
      console.warn(`[FBX] No bytes for "${name}_${slot.label}" — slot skipped`);
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
    p70fn(tp, 'WrapModeU',               'enum',    '','', 0);
    p70fn(tp, 'WrapModeV',               'enum',    '','', 0);

    texConnections.push({ vidId, texId, fbxChannel: slot.fbxChannel, label: slot.label });
    console.log(`[FBX] embedded "${slot.label}" → "${slot.fbxChannel}" (${bytes.length}B) mesh="${name}"`);
  }

  return { matId, texConnections };
}
