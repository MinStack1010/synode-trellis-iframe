export async function parseGlbTextures(glbUrl) {
  console.log('[GLB Parser] Starting to parse GLB from URL:', glbUrl);
  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`GLB fetch failed: ${res.status}`);
  const ab   = await res.arrayBuffer();
  const view = new DataView(ab);

  if (view.getUint32(0, true) !== 0x46546C67) throw new Error('Not a GLB file');

  let off = 12;
  let jsonChunk = null;
  let binChunk  = null;

  while (off < ab.byteLength) {
    const len  = view.getUint32(off, true);
    const type = view.getUint32(off + 4, true);
    const data = ab.slice(off + 8, off + 8 + len);
    off += 8 + len;
    if (type === 0x4E4F534A) jsonChunk = data;
    else if (type === 0x004E4942) binChunk = data;
  }

  if (!jsonChunk) throw new Error('No JSON chunk');
  const json     = JSON.parse(new TextDecoder().decode(jsonChunk));
  const images   = json.images   || [];
  const textures = json.textures || [];
  const materials = json.materials || [];

  console.log('[GLB Parser] GLB structure:', { 
    images: images.length, 
    textures: textures.length, 
    materials: materials.length 
  });

  // Log material info for debugging
  if (materials.length > 0) {
    console.log('[GLB Parser] Materials in GLB:');
    materials.forEach((mat, idx) => {
      console.log(`[GLB Parser] Material ${idx}:`, mat);
    });
  }

  // textureIndex → Uint8Array (raw jpeg/png bytes from GLB)
  const result = new Map();

  for (let ti = 0; ti < textures.length; ti++) {
    const imgIdx = textures[ti]?.source;
    if (imgIdx == null) continue;
    const imgDef = images[imgIdx];
    if (!imgDef) continue;

    let bytes = null;

    if (imgDef.bufferView != null && binChunk) {
      const bv  = json.bufferViews[imgDef.bufferView];
      bytes = new Uint8Array(binChunk, bv.byteOffset || 0, bv.byteLength);
      console.log(`[GLB Parser] Extracted texture ${ti} from bufferView, size: ${bytes.length} bytes`);
    } else if (imgDef.uri?.startsWith('data:')) {
      const b64 = imgDef.uri.split(',')[1];
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      console.log(`[GLB Parser] Extracted texture ${ti} from data URI, size: ${bytes.length} bytes`);
    } else if (imgDef.uri) {
      try {
        const base   = glbUrl.substring(0, glbUrl.lastIndexOf('/') + 1);
        const imgRes = await fetch(base + imgDef.uri);
        if (imgRes.ok) {
          bytes = new Uint8Array(await imgRes.arrayBuffer());
          console.log(`[GLB Parser] Extracted texture ${ti} from external URI, size: ${bytes.length} bytes`);
        }
      } catch (e) {
        console.warn(`[GLB Parser] Failed to load external texture ${ti}:`, e);
      }
    }

    if (bytes) result.set(ti, bytes);
  }

  console.log(`[GLB Parser] ${result.size} texture(s) extracted from GLB`);
  return result;
}
