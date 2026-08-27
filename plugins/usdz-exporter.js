const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap',
  'emissiveMap', 'aoMap', 'lightMap', 'envMap',
];

function cloneMaterial(src, THREE) {
  let dst;
  try { dst = src.clone(); } catch (_) { dst = new THREE.MeshStandardMaterial(); }
  if (!dst.isMeshStandardMaterial) dst = new THREE.MeshStandardMaterial();
  if (src.color)    dst.color.copy(src.color);
  if (src.emissive) dst.emissive.copy(src.emissive);
  dst.roughness         = src.roughness         ?? 0.5;
  dst.metalness         = src.metalness         ?? 0;
  dst.emissiveIntensity = src.emissiveIntensity  ?? 1;
  dst.opacity           = src.opacity           ?? 1;
  dst.transparent       = src.transparent       ?? false;
  dst.alphaTest         = src.alphaTest         ?? 0;
  dst.aoMapIntensity    = src.aoMapIntensity     ?? 1;
  dst.normalScale       = src.normalScale ? src.normalScale.clone() : new THREE.Vector2(1, 1);
  for (const slot of TEXTURE_SLOTS) {
    if (src[slot] != null) dst[slot] = src[slot];
  }
  return dst;
}

// Nếu texture từ GLTFLoader bị closed ImageBitmap,
// recreate từ raw bytes bằng cách tạo Blob URL rồi load lại
async function reloadTextureFromBytes(bytes, THREE) {
  if (!bytes || bytes.length === 0) return null;
  try {
    // Detect mime type
    let mime = 'image/jpeg';
    if (bytes[0]===0x89 && bytes[1]===0x50) mime = 'image/png';
    else if (bytes[0]===0x52 && bytes[1]===0x49) mime = 'image/webp';

    const blob = new Blob([bytes], { type: mime });
    const url  = URL.createObjectURL(blob);

    const tex = await new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(url, t => { URL.revokeObjectURL(url); resolve(t); }, undefined, reject);
    });
    tex.flipY = false; // GLTF convention
    tex.needsUpdate = true;
    return tex;
  } catch (_) {
    return null;
  }
}

function makeBackFaceGeo(geo, clonedGeos) {
  const clone = geo.clone();
  if (clone.index) {
    const idx = clone.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i+1]; idx[i+1] = idx[i+2]; idx[i+2] = tmp;
    }
    clone.index.needsUpdate = true;
  } else {
    for (const attr of ['position','normal','uv'].map(k => clone.attributes[k]).filter(Boolean)) {
      const sz = attr.itemSize;
      for (let i = 0; i < attr.count; i += 3) {
        for (let c = 0; c < sz; c++) {
          const a = attr.array[(i+1)*sz+c], b = attr.array[(i+2)*sz+c];
          attr.array[(i+1)*sz+c] = b; attr.array[(i+2)*sz+c] = a;
        }
        attr.needsUpdate = true;
      }
    }
  }
  if (clone.attributes.normal) {
    const nor = clone.attributes.normal;
    for (let i = 0; i < nor.array.length; i++) nor.array[i] = -nor.array[i];
    nor.needsUpdate = true;
  }
  clonedGeos.push(clone);
  return clone;
}

async function buildExportGroup(srcNode, THREE, texBytesMap, clonedGeos) {
  const { Group, Mesh, Object3D } = THREE;
  const group = new Group();
  group.name = srcNode.name;
  group.position.copy(srcNode.position);
  group.quaternion.copy(srcNode.quaternion);
  group.scale.copy(srcNode.scale);

  for (const child of srcNode.children) {
    if (child.isMesh) {
      const rawMats = Array.isArray(child.material) ? child.material : [child.material];

      // Clone material và inject lại textures từ raw bytes nếu cần
      const fixedMats = await Promise.all(rawMats.map(async m => {
        const c = cloneMaterial(m, THREE);
        c.side = THREE.FrontSide;
        // Thử reload từng texture slot nếu image bị closed
        for (const slot of TEXTURE_SLOTS) {
          const tex = c[slot];
          if (!tex) continue;
          const img = tex.image;
          // Kiểm tra image có accessible không
          let broken = false;
          try {
            if (img instanceof ImageBitmap && (img.width === 0 || img.height === 0)) broken = true;
          } catch (_) { broken = true; }

          if (broken || !img) {
            const uuid = tex.uuid;
            const bytes = texBytesMap?.get(uuid);
            if (bytes) {
              const newTex = await reloadTextureFromBytes(bytes, THREE);
              if (newTex) c[slot] = newTex;
            }
          }
        }
        return c;
      }));

      const frontMat = Array.isArray(child.material) ? fixedMats : fixedMats[0];
      const frontMesh = new Mesh(child.geometry, frontMat);
      frontMesh.name = child.name;
      frontMesh.position.copy(child.position);
      frontMesh.quaternion.copy(child.quaternion);
      frontMesh.scale.copy(child.scale);
      group.add(frontMesh);

      const backGeo  = makeBackFaceGeo(child.geometry, clonedGeos);
      const backMats = fixedMats.map(m => { const c = cloneMaterial(m, THREE); c.side = THREE.FrontSide; return c; });
      const backMesh = new Mesh(backGeo, Array.isArray(child.material) ? backMats : backMats[0]);
      backMesh.name = child.name + '_back';
      backMesh.position.copy(child.position);
      backMesh.quaternion.copy(child.quaternion);
      backMesh.scale.copy(child.scale);
      group.add(backMesh);

    } else if (!child.isLight && !child.isCamera) {
      if (child.children?.length > 0) {
        group.add(await buildExportGroup(child, THREE, texBytesMap, clonedGeos));
      } else {
        const pt = new Object3D();
        pt.name = child.name;
        pt.position.copy(child.position);
        pt.quaternion.copy(child.quaternion);
        pt.scale.copy(child.scale);
        group.add(pt);
      }
    }
  }
  return group;
}

// glbTextures: Map<textureIndex, Uint8Array> từ parseGlbTextures()
export async function exportUSDZ(model, THREE, glbTextures) {
  const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');

  // Build uuid→bytes map cho USDZ texture reload
  // Map: texture.uuid → Uint8Array
  const texBytesMap = new Map();
  if (glbTextures?.size > 0) {
    let autoIdx = 0;
    model.traverse(node => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(mat => {
        if (!mat) return;
        for (const slot of TEXTURE_SLOTS) {
          const tex = mat[slot];
          if (!tex || texBytesMap.has(tex.uuid)) continue;
          // Dùng userData.index nếu có
          const idx = tex.userData?.index ?? tex.userData?.textureIndex ?? autoIdx;
          if (glbTextures.has(idx)) {
            texBytesMap.set(tex.uuid, glbTextures.get(idx));
            autoIdx = Math.max(autoIdx, idx) + 1;
          } else {
            // fallback: lấy theo thứ tự
            const bytes = glbTextures.get(autoIdx);
            if (bytes) texBytesMap.set(tex.uuid, bytes);
            autoIdx++;
          }
        }
      });
    });
  }

  let maxTex = 1024;
  model.traverse(node => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach(mat => {
      if (!mat) return;
      TEXTURE_SLOTS.forEach(slot => {
        const tex = mat[slot];
        if (tex?.image) {
          const w = tex.image.width || tex.image.naturalWidth || 0;
          const h = tex.image.height || tex.image.naturalHeight || 0;
          maxTex = Math.max(maxTex, w, h);
        }
      });
    });
  });
  const maxTextureSize = Math.min(maxTex, 4096);

  const clonedGeos = [];
  const exportRoot = await buildExportGroup(model, THREE, texBytesMap, clonedGeos);

  try {
    const exporter = new USDZExporter();
    const result = await exporter.parseAsync(exportRoot, { maxTextureSize, quickLookCompatible: false });
    if (!result || (result.byteLength ?? result.length) === 0)
      throw new Error('USDZExporter returned empty result.');
    const bytes = result instanceof Uint8Array ? result : new Uint8Array(result);
    return new Blob([bytes], { type: 'model/vnd.usdz+zip' });
  } finally {
    clonedGeos.forEach(g => g.dispose());
    clonedGeos.length = 0;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
