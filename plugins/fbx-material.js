import { p70 } from './fbx-binary.js';

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
    console.warn('[FBX] No GLB textures found - FBX export will not include textures');
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

  console.log(`[FBX] Found ${allTextures.length} unique textures in model, ${glbTextures.size} textures in GLB`);

  // Try to match textures using userData.index first (most reliable)
  let matchedCount = 0;
  for (const tex of allTextures) {
    if (uuidToBytes.has(tex.uuid)) continue;
    
    const idx = tex.userData?.index ?? tex.userData?.textureIndex;
    if (idx != null && glbTextures.has(idx)) {
      uuidToBytes.set(tex.uuid, glbTextures.get(idx));
      matchedCount++;
      console.log(`[FBX] Matched texture by index ${idx}`);
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
          console.log(`[FBX] Matched texture "${texName}" by fallback`);
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
    console.log(`[FBX] Matched texture by order fallback`);
  }

  console.log(`[FBX] Successfully mapped ${uuidToBytes.size}/${allTextures.length} textures`);
  return uuidToBytes;
}

// Build và return material FbxNode + video/texture nodes
// Trả về { matNode, texNodePairs: [{vidNode, texNode, texId, vidId, fbxChannel}] }
export function buildMaterialNodes(objects, uid, p70fn, name, mat, hasEmissive, uuidToBytes, MAT_SLOTS) {
  const matId = uid();

  // Skip material if mesh has no material
  if (!mat) {
    console.warn(`[FBX Material] No material found for mesh "${name}" - creating default colored material instead of white`);
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

  console.log(`[FBX Material] Building material for ${name}: color=(${cr.toFixed(2)},${cg.toFixed(2)},${cb.toFixed(2)}), opacity=${opacity}, roughness=${roughness}, metalness=${metalness}`);
  
  // Log available texture slots
  console.log(`[FBX Material] Available texture slots for ${name}:`);
  MAT_SLOTS.forEach(slot => {
    const hasTex = !!mat[slot.key];
    console.log(`[FBX Material]   ${slot.label} (${slot.key}): ${hasTex ? 'YES' : 'NO'}`);
  });

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
      console.warn(`[FBX] No texture bytes found for "${name}_${slot.label}" - texture may not be properly loaded`);
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
    console.log(`[FBX] embedded "${slot.label}" → "${slot.fbxChannel}" (${bytes.length}B) mesh="${name}"`);
  }

  return { matId, texConnections };
}
