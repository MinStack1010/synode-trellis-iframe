import { FBX_VERSION, HEAD_MAGIC, FOOT_ID, SENTINEL, ByteWriter, FbxNode, p70, u32 } from './fbx-binary.js';

// Direct GLB to FBX conversion - extracts data directly from GLB structure
export async function convertGlbToFbxDirect(glbUrl, options = {}) {
  const { highPrecision = true } = options;
  
  console.log('[GLB-to-FBX Direct] Starting direct conversion from GLB');
  
  try {
    // Parse GLB structure
    const glbData = await parseGlbStructure(glbUrl);
    console.log('[GLB-to-FBX Direct] GLB parsed:', {
      meshes: glbData.meshes.length,
      materials: glbData.materials.length,
      textures: glbData.textures.length,
      images: glbData.images.length
    });
    
    // Build FBX from GLB data
    const fbxBuffer = buildFbxFromGlb(glbData, highPrecision);
    
    console.log('[GLB-to-FBX Direct] Conversion complete');
    return { 
      blob: new Blob([fbxBuffer], { type: 'application/octet-stream' }), 
      filename: 'trellis2-model.fbx' 
    };
  } catch (error) {
    console.error('[GLB-to-FBX Direct] Conversion failed:', error);
    throw new Error(`GLB-to-FBX conversion failed: ${error.message}`);
  }
}

async function parseGlbStructure(glbUrl) {
  console.log('[GLB Parser] Fetching GLB from:', glbUrl);
  
  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`GLB fetch failed: ${res.status}`);
  
  const ab = await res.arrayBuffer();
  console.log('[GLB Parser] GLB size:', ab.byteLength, 'bytes');
  
  const view = new DataView(ab);

  if (view.getUint32(0, true) !== 0x46546C67) throw new Error('Not a GLB file');

  let off = 12;
  let jsonChunk = null;
  let binChunk = null;

  while (off < ab.byteLength) {
    const len = view.getUint32(off, true);
    const type = view.getUint32(off + 4, true);
    const data = ab.slice(off + 8, off + 8 + len);
    off += 8 + len;
    if (type === 0x4E4F534A) jsonChunk = data;
    else if (type === 0x004E4942) binChunk = data;
  }

  if (!jsonChunk) throw new Error('No JSON chunk');
  
  const json = JSON.parse(new TextDecoder().decode(jsonChunk));
  console.log('[GLB Parser] JSON parsed, keys:', Object.keys(json));

  // Extract all data from GLB
  const meshes = extractMeshes(json, binChunk);
  const materials = extractMaterials(json);
  const textures = extractTextures(json, binChunk);
  const images = extractImages(json, binChunk);

  console.log('[GLB Parser] Extraction complete:', {
    meshes: meshes.length,
    materials: materials.length,
    textures: textures.length,
    images: images.length
  });

  return { json, meshes, materials, textures, images, binChunk };
}

function extractMeshes(json, binChunk) {
  const meshes = [];
  if (!json.meshes) {
    console.warn('[GLB Parser] No meshes found in GLB');
    return meshes;
  }

  console.log('[GLB Parser] Extracting', json.meshes.length, 'meshes');

  json.meshes.forEach((meshDef, meshIdx) => {
    try {
      const mesh = {
        name: meshDef.name || `mesh_${meshIdx}`,
        primitives: []
      };

      if (meshDef.primitives) {
        meshDef.primitives.forEach((prim, primIdx) => {
          try {
            const primitive = {
              indices: null,
              attributes: {},
              material: prim.material
            };

            // Get indices
            if (prim.indices != null) {
              const accessor = json.accessors[prim.indices];
              if (!accessor) {
                console.warn(`[GLB Parser] Missing accessor for indices in mesh ${meshIdx} primitive ${primIdx}`);
              } else {
                const bufferView = json.bufferViews[accessor.bufferView];
                if (!bufferView) {
                  console.warn(`[GLB Parser] Missing bufferView for indices in mesh ${meshIdx} primitive ${primIdx}`);
                } else {
                  primitive.indices = readAccessorData(accessor, bufferView, binChunk);
                }
              }
            }

            // Get attributes
            if (prim.attributes) {
              for (const [attrName, accessorIdx] of Object.entries(prim.attributes)) {
                const accessor = json.accessors[accessorIdx];
                if (!accessor) {
                  console.warn(`[GLB Parser] Missing accessor for ${attrName} in mesh ${meshIdx} primitive ${primIdx}`);
                  continue;
                }
                const bufferView = json.bufferViews[accessor.bufferView];
                if (!bufferView) {
                  console.warn(`[GLB Parser] Missing bufferView for ${attrName} in mesh ${meshIdx} primitive ${primIdx}`);
                  continue;
                }
                primitive.attributes[attrName] = readAccessorData(accessor, bufferView, binChunk);
              }
            }

            mesh.primitives.push(primitive);
          } catch (primError) {
            console.error(`[GLB Parser] Error processing primitive ${primIdx} in mesh ${meshIdx}:`, primError);
          }
        });
      }

      meshes.push(mesh);
    } catch (meshError) {
      console.error(`[GLB Parser] Error processing mesh ${meshIdx}:`, meshError);
    }
  });

  return meshes;
}

function extractMaterials(json) {
  const materials = [];
  if (!json.materials) return materials;

  json.materials.forEach((matDef, matIdx) => {
    const material = {
      name: matDef.name || `material_${matIdx}`,
      pbrMetallicRoughness: matDef.pbrMetallicRoughness || {},
      normalTexture: matDef.normalTexture,
      occlusionTexture: matDef.occlusionTexture,
      emissiveTexture: matDef.emissiveTexture,
      emissiveFactor: matDef.emissiveFactor || [0, 0, 0],
      alphaMode: matDef.alphaMode || 'OPAQUE',
      alphaCutoff: matDef.alphaCutoff || 0.5,
      doubleSided: matDef.doubleSided || false
    };
    materials.push(material);
  });

  return materials;
}

function extractTextures(json, binChunk) {
  const textures = [];
  if (!json.textures) return textures;

  json.textures.forEach((texDef, texIdx) => {
    const texture = {
      source: texDef.source,
      sampler: texDef.sampler
    };
    textures.push(texture);
  });

  return textures;
}

function extractImages(json, binChunk) {
  const images = [];
  if (!json.images) return images;

  json.images.forEach((imgDef, imgIdx) => {
    let data = null;

    if (imgDef.bufferView != null && binChunk) {
      const bufferView = json.bufferViews[imgDef.bufferView];
      data = new Uint8Array(binChunk, bufferView.byteOffset || 0, bufferView.byteLength);
    } else if (imgDef.uri?.startsWith('data:')) {
      const b64 = imgDef.uri.split(',')[1];
      const bin = atob(b64);
      data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    }

    images.push({
      name: imgDef.name || `image_${imgIdx}`,
      mimeType: imgDef.mimeType || 'image/jpeg',
      data: data
    });
  });

  return images;
}

function readAccessorData(accessor, bufferView, binChunk) {
  try {
    const componentType = accessor.componentType;
    const type = accessor.type;
    const count = accessor.count;
    const byteOffset = accessor.byteOffset || 0;
    const bufferByteOffset = (bufferView.byteOffset || 0) + byteOffset;

    if (!binChunk || bufferByteOffset >= binChunk.byteLength) {
      console.warn('[GLB Parser] Invalid buffer access for accessor');
      return null;
    }

    const dataLength = bufferView.byteLength - byteOffset;
    if (dataLength <= 0) {
      console.warn('[GLB Parser] Zero or negative data length for accessor');
      return null;
    }

    const data = new Uint8Array(binChunk, bufferByteOffset, dataLength);
    
    // Convert to appropriate typed array based on component type
    let typedArray;
    switch (componentType) {
      case 5120: // BYTE
        typedArray = new Int8Array(data.buffer, data.byteOffset, data.length);
        break;
      case 5121: // UNSIGNED_BYTE
        typedArray = new Uint8Array(data.buffer, data.byteOffset, data.length);
        break;
      case 5122: // SHORT
        typedArray = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
        break;
      case 5123: // UNSIGNED_SHORT
        typedArray = new Uint16Array(data.buffer, data.byteOffset, data.length / 2);
        break;
      case 5125: // UNSIGNED_INT
        typedArray = new Uint32Array(data.buffer, data.byteOffset, data.length / 4);
        break;
      case 5126: // FLOAT
        typedArray = new Float32Array(data.buffer, data.byteOffset, data.length / 4);
        break;
      default:
        console.warn('[GLB Parser] Unknown component type:', componentType, 'defaulting to FLOAT');
        typedArray = new Float32Array(data.buffer, data.byteOffset, data.length / 4);
    }

    return {
      data: typedArray,
      componentType,
      type,
      count,
      min: accessor.min,
      max: accessor.max
    };
  } catch (error) {
    console.error('[GLB Parser] Error reading accessor data:', error);
    return null;
  }
}

function buildFbxFromGlb(glbData, highPrecision) {
  try {
    console.log('[FBX Builder] Starting FBX construction from GLB data');
    
    const root = new FbxNode('');
    let _id = 100000;
    const uid = () => ++_id;

    // Build FBX header
    buildFbxHeader(root, uid);
    buildGlobalSettings(root);
    buildDocuments(root, uid);
    root.child('References');

    // Count objects
    const meshCount = glbData.meshes.length;
    const materialCount = glbData.materials.length;
    const textureCount = glbData.textures.length;
    const videoCount = glbData.images.length;

    console.log('[FBX Builder] Object counts:', { meshCount, materialCount, textureCount, videoCount });

    buildDefinitions(root, meshCount, materialCount, textureCount, videoCount);

    const objects = root.child('Objects');
    const connections = root.child('Connections');

    // Build meshes
    const meshIds = [];
    glbData.meshes.forEach((mesh, meshIdx) => {
      try {
        const meshId = buildMeshNode(objects, uid, mesh, glbData, highPrecision);
        if (meshId) meshIds.push(meshId);
      } catch (meshError) {
        console.error(`[FBX Builder] Error building mesh ${meshIdx}:`, meshError);
      }
    });

    // Build materials
    const materialIds = [];
    glbData.materials.forEach((material, matIdx) => {
      try {
        const matId = buildMaterialNode(objects, uid, material, glbData);
        if (matId) materialIds.push(matId);
      } catch (matError) {
        console.error(`[FBX Builder] Error building material ${matIdx}:`, matError);
      }
    });

    // Build textures and videos
    const textureIds = [];
    const videoIds = [];
    glbData.textures.forEach((texture, texIdx) => {
      try {
        const image = glbData.images[texture.source];
        if (!image || !image.data) {
          console.warn(`[FBX Builder] Skipping texture ${texIdx} - no image data`);
          return;
        }

        const vidId = uid();
        const texId = uid();
        videoIds.push(vidId);
        textureIds.push(texId);

        buildVideoNode(objects, uid, vidId, image);
        buildTextureNode(objects, uid, texId, image.name);
      } catch (texError) {
        console.error(`[FBX Builder] Error building texture ${texIdx}:`, texError);
      }
    });

    // Build connections
    // Connect meshes to materials
    glbData.meshes.forEach((mesh, meshIdx) => {
      if (!meshIds[meshIdx]) return;
      
      mesh.primitives.forEach((prim, primIdx) => {
        if (prim.material != null && materialIds[prim.material]) {
          const cx = connections.child('C');
          cx.addString('OO');
          cx.addInt64(materialIds[prim.material]);
          cx.addInt64(meshIds[meshIdx]);
        }
      });
    });

    // Connect textures to materials
    glbData.materials.forEach((material, matIdx) => {
      if (!materialIds[matIdx]) return;
      
      const matId = materialIds[matIdx];
      
      // Diffuse texture
      if (material.pbrMetallicRoughness?.baseColorTexture != null) {
        const texIdx = material.pbrMetallicRoughness.baseColorTexture.index;
        if (textureIds[texIdx] && videoIds[texIdx]) {
          connectTexture(connections, videoIds[texIdx], textureIds[texIdx], matId, 'DiffuseColor');
        }
      }
      
      // Normal texture
      if (material.normalTexture != null) {
        const texIdx = material.normalTexture.index;
        if (textureIds[texIdx] && videoIds[texIdx]) {
          connectTexture(connections, videoIds[texIdx], textureIds[texIdx], matId, 'Bump');
        }
      }
      
      // Roughness texture
      if (material.pbrMetallicRoughness?.roughnessTexture != null) {
        const texIdx = material.pbrMetallicRoughness.roughnessTexture.index;
        if (textureIds[texIdx] && videoIds[texIdx]) {
          connectTexture(connections, videoIds[texIdx], textureIds[texIdx], matId, 'Reflection');
        }
      }
      
      // Metalness texture
      if (material.pbrMetallicRoughness?.metallicTexture != null) {
        const texIdx = material.pbrMetallicRoughness.metallicTexture.index;
        if (textureIds[texIdx] && videoIds[texIdx]) {
          connectTexture(connections, videoIds[texIdx], textureIds[texIdx], matId, 'Reflection');
        }
      }
      
      // Emissive texture
      if (material.emissiveTexture != null) {
        const texIdx = material.emissiveTexture.index;
        if (textureIds[texIdx] && videoIds[texIdx]) {
          connectTexture(connections, videoIds[texIdx], textureIds[texIdx], matId, 'EmissiveColor');
        }
      }
    });

    // Connect meshes to root
    meshIds.forEach(meshId => {
      const cx = connections.child('C');
      cx.addString('OO');
      cx.addInt64(meshId);
      cx.addInt64(0);
    });

    console.log('[FBX Builder] FBX construction complete, serializing...');
    
    // Serialize to binary
    return serializeFbx(root);
  } catch (error) {
    console.error('[FBX Builder] Fatal error in FBX construction:', error);
    throw new Error(`FBX construction failed: ${error.message}`);
  }
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
  hdr.child('Creator').addString('TRELLIS2 GLB-to-FBX');
  hdr.child('SceneInfo').addString('GlobalInfo\x00\x01SceneInfo').addString('UserData')
    .child('MetaData').child('Version').addInt32(100);
  root.child('FileId').addBytes(new Uint8Array([
    0x28,0xb3,0x2a,0xeb,0xb6,0x24,0xcc,0xc2,0xbf,0xc8,0xb0,0x2a,0xa9,0x2b,0xfc,0xf1
  ]));
  root.child('CreationTime').addString('1970-01-01 10:00:00:000');
  root.child('Creator').addString('TRELLIS2 GLB-to-FBX');
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

function buildMeshNode(objects, uid, mesh, glbData, highPrecision) {
  try {
    const meshId = uid();
    const geoId = uid();

    // Build geometry from first primitive
    if (mesh.primitives.length === 0) {
      console.warn(`[FBX Builder] Mesh ${mesh.name} has no primitives, skipping`);
      return null;
    }

    const prim = mesh.primitives[0];
    const positions = prim.attributes.POSITION?.data;
    const normals = prim.attributes.NORMAL?.data;
    const uvs = prim.attributes.TEXCOORD_0?.data;
    const indices = prim.indices?.data;

    if (!positions || positions.length === 0) {
      console.warn(`[FBX Builder] Mesh ${mesh.name} has no position data, skipping`);
      return null;
    }

    const vertexCount = positions.length / 3;
    const f6 = (n) => Number.isFinite(n) ? (highPrecision ? +n.toFixed(9) : +n.toFixed(6)) : 0;

    console.log(`[FBX Builder] Building mesh ${mesh.name}: ${vertexCount} vertices`);

    // Convert positions
    const posArray = new Array(vertexCount * 3);
    for (let i = 0; i < vertexCount * 3; i++) {
      posArray[i] = f6(positions[i]);
    }

    // Convert normals
    let normArray = null;
    if (normals && normals.length > 0) {
      normArray = new Array(vertexCount * 3);
      for (let i = 0; i < vertexCount * 3; i++) {
        normArray[i] = f6(normals[i]);
      }
    }

    // Convert UVs (flip V)
    let uvArray = null;
    if (uvs && uvs.length > 0) {
      uvArray = new Array(vertexCount * 2);
      for (let i = 0; i < vertexCount; i++) {
        uvArray[i * 2] = f6(uvs[i * 2]);
        uvArray[i * 2 + 1] = f6(1 - uvs[i * 2 + 1]);
      }
    }

    // Build polygon indices
    let triangleCount = vertexCount / 3;
    if (indices && indices.length > 0) {
      triangleCount = indices.length / 3;
    }
    
    const polyIndices = new Array(triangleCount * 3);
    for (let t = 0; t < triangleCount; t++) {
      const i0 = indices ? indices[t * 3] : t * 3;
      const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
      const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;
      polyIndices[t * 3] = i0;
      polyIndices[t * 3 + 1] = i1;
      polyIndices[t * 3 + 2] = ~(i2);
    }

    // Build geometry node
    const geo = objects.child('Geometry');
    geo.addInt64(geoId);
    geo.addString(mesh.name + 'Geo\x00\x01Geometry');
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
      le.child('ReferenceInformationType').addString('Direct');
      le.child('UV').addFloat64Array(uvArray);
      le.child('UVIndex').addInt32Array(Array.from({ length: vertexCount }, (_, i) => i));
    }

    const lm = geo.child('LayerElementMaterial');
    lm.child('Version').addInt32(101);
    lm.child('Name').addString('');
    lm.child('MappingInformationType').addString('AllSame');
    lm.child('ReferenceInformationType').addString('IndexToDirect');
    lm.child('Materials').addInt32Array([0]);

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
    
    const em = lay.child('LayerElement');
    em.child('Type').addString('LayerElementMaterial');
    em.child('TypedIndex').addInt32(0);

    // Build model node
    const model = objects.child('Model');
    model.addInt64(meshId);
    model.addString(mesh.name + '\x00\x01Model');
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

    return meshId;
  } catch (error) {
    console.error(`[FBX Builder] Error building mesh node for ${mesh.name}:`, error);
    return null;
  }
}

function buildMaterialNode(objects, uid, material, glbData) {
  try {
    const matId = uid();

    const pbr = material.pbrMetallicRoughness || {};
    const baseColor = pbr.baseColorFactor || [1, 1, 1, 1];
    const metallic = pbr.metallicFactor ?? 0;
    const roughness = pbr.roughnessFactor ?? 1;
    const emissive = material.emissiveFactor || [0, 0, 0];

    console.log(`[FBX Builder] Building material ${material.name}:`, {
      baseColor,
      metallic,
      roughness,
      emissive
    });

    const mat = objects.child('Material');
    mat.addInt64(matId);
    mat.addString(material.name + '\x00\x01Material');
    mat.addString('');
    mat.child('Version').addInt32(102);
    mat.child('ShadingModel').addString('Phong');
    mat.child('MultiLayer').addInt32(0);

    const mpp = mat.child('Properties70');
    p70(mpp, 'ShadingModel', 'KString', '', '', 'Phong');
    p70(mpp, 'DiffuseColor', 'ColorRGB', 'Color', 'A', baseColor[0], baseColor[1], baseColor[2]);
    p70(mpp, 'DiffuseFactor', 'double', 'Number', 'A', 1.0);
    p70(mpp, 'SpecularColor', 'ColorRGB', 'Color', 'A', metallic * baseColor[0], metallic * baseColor[1], metallic * baseColor[2]);
    p70(mpp, 'SpecularFactor', 'double', 'Number', 'A', metallic);
    p70(mpp, 'Shininess', 'double', 'Number', 'A', Math.max(2, (1 - roughness) * (1 - roughness) * 100));
    p70(mpp, 'ReflectionFactor', 'double', 'Number', 'A', roughness);
    p70(mpp, 'EmissiveColor', 'ColorRGB', 'Color', 'A', emissive[0], emissive[1], emissive[2]);
    p70(mpp, 'EmissiveFactor', 'double', 'Number', 'A', 1.0);
    p70(mpp, 'AmbientColor', 'ColorRGB', 'Color', 'A', 0.0, 0.0, 0.0);
    p70(mpp, 'AmbientFactor', 'double', 'Number', 'A', 1.0);
    p70(mpp, 'TransparencyFactor', 'double', 'Number', 'A', 1 - baseColor[3]);
    p70(mpp, 'Opacity', 'double', 'Number', 'A', baseColor[3]);
    p70(mpp, 'roughness', 'double', 'Number', 'AU', roughness);
    p70(mpp, 'metallic', 'double', 'Number', 'AU', metallic);

    return matId;
  } catch (error) {
    console.error(`[FBX Builder] Error building material node for ${material.name}:`, error);
    return null;
  }
}

function buildVideoNode(objects, uid, vidId, image) {
  const vn = objects.child('Video');
  vn.addInt64(vidId);
  vn.addString(image.name + '\x00\x01Video');
  vn.addString('Clip');
  vn.child('Type').addString('Clip');
  vn.child('Properties70').child('P')
    .addString('Path').addString('KString').addString('XRefUrl').addString('').addString(image.name);
  vn.child('UseMipMap').addInt32(0);
  vn.child('Filename').addString(image.name);
  vn.child('RelativeFilename').addString(image.name);
  vn.child('Content').addBytes(image.data);
}

function buildTextureNode(objects, uid, texId, name) {
  const tn = objects.child('Texture');
  tn.addInt64(texId);
  tn.addString(name + '\x00\x01Texture');
  tn.addString('');
  tn.child('Type').addString('TextureVideoClip');
  tn.child('Version').addInt32(202);
  tn.child('TextureName').addString(name + '\x00\x01Texture');
  tn.child('Media').addString(name + '\x00\x01Video');
  tn.child('FileName').addString(name);
  tn.child('RelativeFilename').addString(name);
  tn.child('ModelUVTranslation').addFloat64(0).addFloat64(0);
  tn.child('ModelUVScaling').addFloat64(1).addFloat64(1);
  tn.child('Texture_Alpha_Source').addString('None');
  const tp = tn.child('Properties70');
  p70(tp, 'CurrentTextureBlendMode', 'enum', '', '', 0);
  p70(tp, 'UVSet', 'KString', '', '', 'map1');
  p70(tp, 'UseMaterial', 'bool', '', '', 1);
  p70(tp, 'WrapModeU', 'enum', '', '', 0);
  p70(tp, 'WrapModeV', 'enum', '', '', 0);
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