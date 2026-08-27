import { FBX_VERSION, HEAD_MAGIC, FOOT_ID, SENTINEL, ByteWriter, FbxNode, p70, u32 } from './fbx-binary.js';

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
      console.log(`[Texture Extract] Checking material:`, mat.name, 'has map:', !!mat.map);
      const textureSlots = [
        { key: 'map',          label: 'diffuse' },
        { key: 'normalMap',    label: 'normal' },
        { key: 'roughnessMap', label: 'roughness' },
        { key: 'metalnessMap', label: 'metalness' },
        { key: 'emissiveMap',  label: 'emissive' },
        { key: 'aoMap',        label: 'ao' }
      ];
      textureSlots.forEach(slot => {
        const texture = mat[slot.key];
        if (!texture) { console.log(`[Texture Extract] No ${slot.key} texture found`); return; }
        const compositeKey = `${texture.uuid}__${slot.label}`;
        if (textureMap.has(compositeKey)) return;
        const channel = slotChannelMap[slot.label];
        console.log(`[Texture Extract] Found ${slot.key}: uuid=${texture.uuid} splitChannel=${channel || 'FULL'}`);
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
              console.log(`[Texture Extract] ${slot.label} OK size=${textureData.length} key=${compositeKey}`);
            }
          } catch (e) { console.warn(`[Texture Extract] ${slot.label} FAILED:`, e); }
        })());
      });
    });
  });

  await Promise.all(texturePromises);
  console.log(`[Texture Extract] Total textures extracted: ${textureMap.size}`);
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
    console.log('[Texture Extract] extractTextureData uuid:', texture.uuid, 'splitChannel:', splitChannel);
    const image = texture.image;
    if (!image) { console.warn('[Texture Extract] No texture.image'); return null; }
    console.log('[Texture Extract] Image type:', image.constructor.name, image.width, 'x', image.height);
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
      console.log('[Texture Extract] Fallback via image.src');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = image.src;
      return new Promise(resolve => {
        img.onload  = () => { ctx.drawImage(img, 0, 0, w, h); resolve(_canvasToPngBytes(canvas, ctx, splitChannel)); };
        img.onerror = () => { console.error('[Texture Extract] Fallback load FAILED'); resolve(null); };
      });
    }
    console.error('[Texture Extract] Unknown image type, cannot extract:', image.constructor.name);
    return null;
  } catch (e) { console.error('[Texture Extract] Error:', e); return null; }
}

// Export FBX directly from Three.js model with materials
export async function exportFBXFromModel(model, THREE, textureMap, options = {}) {
  const { highPrecision = true, embedTextures = true, preserveVertexColors = true } = options;
  
  console.log('[FBX from Three] Starting FBX export from Three.js model');
  
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
    console.log('[FBX from Three] Traversing node:', node.name, 'type:', node.type, 'isMesh:', node.isMesh, 'hasGeometry:', !!node.geometry);
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
      console.log('[FBX from Three] Added mesh:', node.name, 'vertices:', node.geometry.attributes.position?.count);
    });
  });

  console.log(`[FBX from Three] Found ${meshItems.length} meshes, ${materialMap.size} materials`);

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
      const { meshId, geoId } = buildMeshFromThree(objects, uid, meshItem, THREE, highPrecision);
      if (meshId) { meshIds.push(meshId); meshGeoIds.push(geoId); }
    } catch (error) {
      console.error(`[FBX from Three] Error building mesh ${idx}:`, error);
    }
  });

  // Build materials
  const matIdMap = new Map();
  materialMap.forEach((matData, mat) => {
    try {
      const matId = buildMaterialFromThree(objects, uid, matData.material, matData.name);
      if (matId) matIdMap.set(mat, matId);
    } catch (error) {
      console.error(`[FBX from Three] Error building material ${matData.name}:`, error);
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
      } catch (error) { console.error(`[FBX from Three] Build ${texData.name} FAILED:`, error); }
    });
  }

  // Build connections
  console.log('[FBX from Three] Building connections...');
  let connectionCount = 0;
  
  meshItems.forEach((meshItem, idx) => {
    if (!meshIds[idx]) {
      console.warn(`[FBX from Three] Skipping connection for mesh ${idx} - no meshId`);
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
      console.log(`[FBX from Three] Connected material ${matId} to mesh ${meshIds[idx]}`);
    } else {
      console.warn(`[FBX from Three] No material ID found for mesh ${idx}, using default material`);
      // Create a default material if none exists
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
      console.log(`[FBX from Three] Connected default material ${defaultMatId} to mesh ${meshIds[idx]}`);
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
          console.log(`[FBX from Three] Tex ${slot.label} -> ${slot.fbxChannel} on mat ${matId} [${compositeKey}]`);
        } else {
          console.warn(`[FBX from Three] No tex/vid for slot ${slot.label} key ${compositeKey}`);
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
      console.log(`[FBX from Three] Connected geo ${geoId} -> model ${meshId}`);
    }
  });

  console.log(`[FBX from Three] Total connections built: ${connectionCount}`);

  console.log('[FBX from Three] FBX construction complete, serializing...');
  
  const fbxBuffer = serializeFbx(root);
  
  console.log('[FBX from Three] FBX buffer size:', fbxBuffer.byteLength, 'bytes');
  
  return { 
    blob: new Blob([fbxBuffer], { type: 'application/octet-stream' }), 
    filename: 'trellis2-model.fbx' 
  };
}

function buildMeshFromThree(objects, uid, meshItem, THREE, highPrecision) {
  const meshId = uid();
  const geoId  = uid();
  const geometry = meshItem.geometry;
  const worldMatrix = meshItem.worldMatrix;
  const positions = geometry.attributes.position;
  const normals   = geometry.attributes.normal;
  const uvs       = geometry.attributes.uv;
  const colors    = geometry.attributes.color;

  if (!positions) {
    console.warn(`[FBX from Three] Mesh ${meshItem.name} has no positions`);
    return { meshId: null, geoId: null };
  }

  const vertexCount = positions.count;
  const f6 = (n) => Number.isFinite(n) ? (highPrecision ? +n.toFixed(9) : +n.toFixed(6)) : 0;

  // === BUILD POLYVERTEX ORDER FIRST ===
  // polyVertexSrcIndex[pv] = vertex index nguồn cho từng góc tam giác (theo đúng thứ tự polygon-vertex).
  // Tất cả layer (normal/uv/color) ByPolygonVertex phải đi theo cùng thứ tự này Babylon mới match đúng.
  const index = geometry.index;
  let triangleCount = vertexCount / 3;
  let polyIndices, polyVertexSrcIndex;
  if (index) {
    triangleCount = index.count / 3;
    polyIndices = new Array(triangleCount * 3);
    polyVertexSrcIndex = new Array(triangleCount * 3);
    for (let t = 0; t < triangleCount; t++) {
      const i0 = index.getX(t * 3), i1 = index.getX(t * 3 + 1), i2 = index.getX(t * 3 + 2);
      polyIndices[t * 3] = i0; polyIndices[t * 3 + 1] = i1; polyIndices[t * 3 + 2] = ~i2;
      polyVertexSrcIndex[t * 3] = i0; polyVertexSrcIndex[t * 3 + 1] = i1; polyVertexSrcIndex[t * 3 + 2] = i2;
    }
  } else {
    triangleCount = vertexCount / 3;
    polyIndices = new Array(triangleCount * 3);
    polyVertexSrcIndex = new Array(triangleCount * 3);
    for (let t = 0; t < triangleCount; t++) {
      const i0 = t * 3, i1 = t * 3 + 1, i2 = t * 3 + 2;
      polyIndices[t * 3] = i0; polyIndices[t * 3 + 1] = i1; polyIndices[t * 3 + 2] = ~i2;
      polyVertexSrcIndex[t * 3] = i0; polyVertexSrcIndex[t * 3 + 1] = i1; polyVertexSrcIndex[t * 3 + 2] = i2;
    }
  }
  const polyVertexCount = triangleCount * 3;
  console.log(`[FBX from Three] Building mesh ${meshItem.name}: verts=${vertexCount} tris=${triangleCount} polyVerts=${polyVertexCount}`);

  // Positions (per-vertex, tham chiếu bởi polyIndices)
  const posArray = new Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const v = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).applyMatrix4(worldMatrix);
    posArray[i * 3] = f6(v.x); posArray[i * 3 + 1] = f6(v.y); posArray[i * 3 + 2] = f6(v.z);
  }

  // Normals - ByPolygonVertex (3 normal per tri)
  let normArray = null;
  if (normals) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
    normArray = new Array(polyVertexCount * 3);
    for (let pv = 0; pv < polyVertexCount; pv++) {
      const vi = polyVertexSrcIndex[pv];
      const n = new THREE.Vector3(normals.getX(vi), normals.getY(vi), normals.getZ(vi))
                    .applyMatrix3(normalMatrix).normalize();
      normArray[pv * 3] = f6(n.x); normArray[pv * 3 + 1] = f6(n.y); normArray[pv * 3 + 2] = f6(n.z);
    }
  }

  // UV - ByPolygonVertex, flip V, IndexToDirect + identity indices
  let uvArray = null;
  let uvIndexArray = null;
  if (uvs) {
    uvArray = new Array(polyVertexCount * 2);
    uvIndexArray = new Array(polyVertexCount);
    for (let pv = 0; pv < polyVertexCount; pv++) {
      const vi = polyVertexSrcIndex[pv];
      uvArray[pv * 2]     = f6(uvs.getX(vi));
      uvArray[pv * 2 + 1] = f6(1 - uvs.getY(vi)); // FBX V ngược glTF
      uvIndexArray[pv]    = pv;
    }
  }

  // Vertex colors - ByPolygonVertex
  let colorArray = null;
  if (colors) {
    colorArray = new Array(polyVertexCount * 4);
    for (let pv = 0; pv < polyVertexCount; pv++) {
      const vi = polyVertexSrcIndex[pv];
      colorArray[pv * 4]     = f6(colors.getX(vi));
      colorArray[pv * 4 + 1] = f6(colors.getY(vi));
      colorArray[pv * 4 + 2] = f6(colors.getZ(vi));
      colorArray[pv * 4 + 3] = colors.itemSize === 4 ? f6(colors.getW(vi)) : 1.0;
    }
  }

  console.log(`[FBX from Three] Polygon indices: ${polyIndices.length} elements (${triangleCount} tris)`);

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
    le.child('UVIndex').addInt32Array(uvIndexArray); // identity index, polyVertexCount phần tử
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
  p70(mp, 'Lcl Translation', 'Lcl Translation', '', 'A', 0.0, 0.0, 0.0);
  p70(mp, 'Lcl Rotation', 'Lcl Rotation', '', 'A', 0.0, 0.0, 0.0);
  p70(mp, 'Lcl Scaling', 'Lcl Scaling', '', 'A', 1.0, 1.0, 1.0);
  model.child('Shading').addString('Y');
  model.child('Culling').addString('CullingOff');

  console.log(`[FBX from Three] Mesh ${meshItem.name} OK: meshId=${meshId} geoId=${geoId}`);
  return { meshId, geoId };
}

function buildMaterialFromThree(objects, uid, material, name) {
  const matId = uid();
  // Preserve 100% giá trị glTF PBR gốc - KHÔNG clamp, KHÔNG convert sai.
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

  console.log(`[FBX from Three] PBR material ${name}: base=(${baseR.toFixed(2)} ${baseG.toFixed(2)} ${baseB.toFixed(2)}) rough=${roughness.toFixed(3)} metal=${metalness.toFixed(3)} opa=${opacity.toFixed(3)}`);

  const mat = objects.child('Material');
  mat.addInt64(matId);
  mat.addString(name + '\x00\x01Material');
  mat.addString('');
  mat.child('Version').addInt32(103);
  mat.child('ShadingModel').addString('Standard');   // Autodesk PBR chuẩn (Babylon nhận)
  mat.child('MultiLayer').addInt32(0);
  const mpp = mat.child('Properties70');

  p70(mpp, 'ShadingModel',     'KString',  '',     '',   'Standard');
  // Base color = material.color (như glTF baseColorFactor, Babylon sẽ nhân với diffuse sample)
  p70(mpp, 'DiffuseColor',     'ColorRGB', 'Color','A',  baseR, baseG, baseB);
  p70(mpp, 'DiffuseFactor',    'double',   'Number','A', 1.0);
  p70(mpp, 'BaseColor',        'ColorRGB', 'Color','',   baseR, baseG, baseB);
  // Metallic
  p70(mpp, 'Metalness',        'double',   'Number','A', metalness);
  p70(mpp, 'Metallic',         'double',   'Number','',  metalness);
  p70(mpp, 'ReflectionColor',  'ColorRGB', 'Color','A',  metalness, metalness, metalness);
  p70(mpp, 'ReflectionFactor', 'double',   'Number','A', metalness);
  // Roughness
  p70(mpp, 'Roughness',        'double',   'Number','A', roughness);
  // Specular default 1 (standard glTF dielectric)
  p70(mpp, 'SpecularColor',    'ColorRGB', 'Color','A',  1, 1, 1);
  p70(mpp, 'SpecularFactor',   'double',   'Number','A', 1.0);
  p70(mpp, 'Shininess',        'double',   'Number','A', Math.max(2, (1 - roughness) * 100));
  // Emissive
  p70(mpp, 'EmissiveColor',    'ColorRGB', 'Color','A',  emR, emG, emB);
  p70(mpp, 'EmissiveFactor',   'double',   'Number','A', 1.0);
  p70(mpp, 'EmissiveIntensity','double',   'Number','',  emissiveIntensity);
  // Ambient = AO factor default 1
  p70(mpp, 'AmbientColor',     'ColorRGB', 'Color','A',  1, 1, 1);
  p70(mpp, 'AmbientFactor',    'double',   'Number','A', 1.0);
  // Opacity / Transparency
  p70(mpp, 'Opacity',            'double',   'Number','A', opacity);
  p70(mpp, 'TransparencyFactor', 'double',   'Number','A', 1 - opacity);
  p70(mpp, 'TransparentColor',   'ColorRGB', 'Color','A',  1 - opacity, 1 - opacity, 1 - opacity);
  // Normal / Bump scale
  p70(mpp, 'BumpFactor',   'double', 'Number','A', 1.0);
  p70(mpp, 'NormalScaleX', 'double', 'Number','',  normalScale.x ?? 1);
  p70(mpp, 'NormalScaleY', 'double', 'Number','',  normalScale.y ?? 1);
  if (doubleSided) p70(mpp, 'TwoSided', 'bool', '', 'A', 1);

  console.log(`[FBX from Three] PBR material ${name} OK matId=${matId}`);
  return matId;
}

function buildVideoFromTexture(objects, uid, vidId, texData) {
  console.log('[FBX from Three] Building video for texture:', texData.name, 'label:', texData.label, 'data size:', texData.data.length, 'bytes');
  
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
  
  console.log('[FBX from Three] Video node built for:', texData.name, 'vidId:', vidId);
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
    console.log('[FBX Serializer] Starting FBX serialization');
    
    const bw = new ByteWriter();
    bw.write(HEAD_MAGIC);
    bw.write(u32(FBX_VERSION));
    let off = bw.tell();
    
    for (const c of root.children) {
      try {
        c.write(bw, off);
        off = bw.tell();
      } catch (childError) {
        console.error('[FBX Serializer] Error writing child node:', childError);
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

    console.log('[FBX Serializer] Serialization complete, buffer size:', bw.tell());
    
    return bw.toBuffer();
  } catch (error) {
    console.error('[FBX Serializer] Fatal error in serialization:', error);
    throw new Error(`FBX serialization failed: ${error.message}`);
  }
}

function sanitize(n) {
  return String(n).replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'mesh';
}

export function downloadBlob(blob, filename) {
  console.log('[Download] Starting download for:', filename, 'size:', blob.size, 'bytes, type:', blob.type);
  
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; 
  a.download = filename; 
  a.style.display = 'none';
  document.body.appendChild(a); 
  a.click(); 
  a.remove();
  
  console.log('[Download] Download initiated for:', filename);
  
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}