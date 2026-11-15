import * as THREE from "three";
const { Notice } = require("obsidian");
const {
  pluginAssetExists,
  readPluginAssetBinary,
  writePluginAssetBinary,
  removePluginAsset,
  fetchBinaryCrossPlatform
} = require("./platform-env");

/**
 * 白昼原画室 · 双风格典藏精装模型与 PBR 材质扩展包服务
 * ------------------------------------------------------------------
 * 支持三种实时热切换的三维档案外观：
 *   1. "standard"         —— 标准轻量原画夹（内置零膨胀工艺版：45° 斜切装裱卡窗 + 三孔定位卡头 + 斜拼金属框）
 *   2. "hd_cel_folio"     —— 赛璐珞原画装裱夹（精装扩展包：cel-folio-hd.glb + 棉纸/亚麻/拉丝黄铜法线贴图）
 *   3. "hd_collector_box" —— 典藏精装 BD 礼盒（精装扩展包：collector-box-hd.glb + 炭黑书布硬壳外函 + 书脊烫金箍带 + 织锦书签带）
 *
 * 内置零外部依赖 GLB 2.0 二进制解析器，所有展架卡片共享同一套 GPU BufferGeometry 原型，显存占用极低。
 */

const PACK_SUBDIR = "assets/atelier-hd-pack";
const PACK_FILES = ["manifest.json", "cel-folio-hd.glb", "collector-box-hd.glb"];

const MIRROR_BASES = [
  "https://cdn.jsdelivr.net/gh/Curelove/bangumi-manager@main/assets/atelier-hd-pack",
  "https://fastly.jsdelivr.net/gh/Curelove/bangumi-manager@main/assets/atelier-hd-pack",
  "https://raw.githubusercontent.com/Curelove/bangumi-manager/main/assets/atelier-hd-pack"
];

const STYLE_CATALOG = [
  {
    id: "standard",
    shortLabel: "标准原画夹",
    label: "标准轻量原画夹（内置）",
    requiresPack: false,
    desc: "随插件内置的清透原画装裱夹，含 45° 斜切卡纸内窗与原画定位孔卡头，零额外空间占用。"
  },
  {
    id: "hd_cel_folio",
    shortLabel: "精装原画夹",
    label: "赛璐珞原画装裱夹（精装扩展）",
    file: "cel-folio-hd.glb",
    requiresPack: true,
    desc: "Blender 精雕圆润倒角模型：三孔原画定位卡头、白芯斜切卡窗、三维包边拉丝黄铜护角与特种棉纸肌理。"
  },
  {
    id: "hd_collector_box",
    shortLabel: "典藏精装盒",
    label: "典藏精装 BD 礼盒（亚麻书函）",
    file: "collector-box-hd.glb",
    requiresPack: true,
    desc: "实体限定版硬壳书函质感：深炭亚麻布面外函、书脊烫金箍带、微露多折内胆册页与朱砂丝绸抽拉带。"
  }
];

// 进程级缓存：避免进入 3D 展厅或滚动卡片池时重复解析 GLB
const _prototypeCache = {
  loaded: false,
  loadingPromise: null,
  hd_cel_folio: null,
  hd_collector_box: null
};

async function checkAtelierHdPackStatus(plugin) {
  const celOk = await pluginAssetExists(plugin, `${PACK_SUBDIR}/cel-folio-hd.glb`);
  const boxOk = await pluginAssetExists(plugin, `${PACK_SUBDIR}/collector-box-hd.glb`);
  let totalBytes = 0;
  if (celOk && boxOk) {
    try {
      const hasManifest = await pluginAssetExists(plugin, `${PACK_SUBDIR}/manifest.json`);
      if (hasManifest) {
        const ab = await readPluginAssetBinary(plugin, `${PACK_SUBDIR}/manifest.json`);
        const txt = new TextDecoder("utf-8").decode(new Uint8Array(ab));
        const meta = JSON.parse(txt);
        totalBytes = Number(meta?.totalBytes) || 437388;
      } else {
        totalBytes = 437388;
      }
    } catch (_) {
      totalBytes = 437388;
    }
  }
  return {
    installed: Boolean(celOk && boxOk),
    celInstalled: Boolean(celOk),
    boxInstalled: Boolean(boxOk),
    totalBytes,
    sizeLabel: totalBytes > 0 ? `${(totalBytes / 1024).toFixed(0)} KB` : "约 428 KB"
  };
}

async function fetchPackFileWithMirrors(fileName) {
  let lastErr = null;
  for (const base of MIRROR_BASES) {
    const url = `${base}/${encodeURIComponent(fileName)}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      const ab = await Promise.race([
        fetchBinaryCrossPlatform(url),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 7500))
      ]);
      if (ab && ab.byteLength > 32) {
        return ab;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`无法下载扩展包文件 ${fileName}`);
}

async function downloadAtelierHdPack(plugin, options = {}) {
  const { silent = false, onProgress = null } = options;
  if (!silent) {
    new Notice("正在下载「白昼原画室 · 双风格典藏精装扩展包」…");
  }
  let completed = 0;
  for (const fileName of PACK_FILES) {
    if (typeof onProgress === "function") {
      onProgress({ step: completed + 1, total: PACK_FILES.length, fileName });
    }
    // eslint-disable-next-line no-await-in-loop
    const ab = await fetchPackFileWithMirrors(fileName);
    // eslint-disable-next-loop no-await-in-loop
    await writePluginAssetBinary(plugin, `${PACK_SUBDIR}/${fileName}`, ab);
    completed += 1;
  }
  clearAtelierPrototypeCache();
  await preloadAtelierHdPrototypes(plugin);
  if (!silent) {
    new Notice("已安装「白昼原画室 · 典藏精装模型扩展包」，可在原画装裱夹与精装礼盒间随时切换！");
  }
  return await checkAtelierHdPackStatus(plugin);
}

async function removeAtelierHdPack(plugin, options = {}) {
  const { silent = false } = options;
  clearAtelierPrototypeCache();
  for (const fileName of PACK_FILES) {
    // eslint-disable-next-line no-await-in-loop
    await removePluginAsset(plugin, `${PACK_SUBDIR}/${fileName}`);
  }
  if (plugin?.settings && plugin.settings.atelier3DModelStyle !== "standard") {
    plugin.settings.atelier3DModelStyle = "standard";
    await plugin.saveSettings();
  }
  if (!silent) {
    new Notice("已清理精装模型扩展包缓存，已自动切回内置标准原画夹。");
  }
  return await checkAtelierHdPackStatus(plugin);
}

// ==================== 零外部依赖 GLB 2.0 解析器 ====================

const COMPONENT_ARRAY = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array
};

const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16
};

function readAccessorTypedArray(gltf, binBuffer, accessorIndex) {
  const acc = gltf.accessors?.[accessorIndex];
  if (!acc) return null;
  const bv = gltf.bufferViews?.[acc.bufferView];
  if (!bv) return null;
  const TypedArr = COMPONENT_ARRAY[acc.componentType];
  const numComps = TYPE_COMPONENTS[acc.type] || 1;
  if (!TypedArr) return null;

  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const count = acc.count * numComps;
  const byteStride = bv.byteStride || 0;
  const elemBytes = TypedArr.BYTES_PER_ELEMENT;

  if (!byteStride || byteStride === numComps * elemBytes) {
    // 若未对齐字节边界则安全拷贝一份
    if (byteOffset % elemBytes === 0) {
      return { array: new TypedArr(binBuffer, byteOffset, count), itemSize: numComps };
    }
    const slice = binBuffer.slice(byteOffset, byteOffset + count * elemBytes);
    return { array: new TypedArr(slice), itemSize: numComps };
  }

  // Interleaved bufferView 解交织
  const out = new TypedArr(count);
  const dv = new DataView(binBuffer);
  for (let i = 0; i < acc.count; i++) {
    const base = byteOffset + i * byteStride;
    for (let c = 0; c < numComps; c++) {
      const off = base + c * elemBytes;
      if (acc.componentType === 5126) out[i * numComps + c] = dv.getFloat32(off, true);
      else if (acc.componentType === 5123) out[i * numComps + c] = dv.getUint16(off, true);
      else if (acc.componentType === 5125) out[i * numComps + c] = dv.getUint32(off, true);
      else if (acc.componentType === 5121) out[i * numComps + c] = dv.getUint8(off);
    }
  }
  return { array: out, itemSize: numComps };
}

function decodeEmbeddedTextureAsync(gltf, binBuffer, textureInfo, isNormalMap = false) {
  if (!textureInfo || typeof textureInfo.index !== "number") return null;
  const texDef = gltf.textures?.[textureInfo.index];
  if (!texDef || typeof texDef.source !== "number") return null;
  const imgDef = gltf.images?.[texDef.source];
  if (!imgDef || typeof imgDef.bufferView !== "number") return null;
  const bv = gltf.bufferViews?.[imgDef.bufferView];
  if (!bv) return null;

  const slice = binBuffer.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const mime = imgDef.mimeType || "image/png";
  const tex = new THREE.Texture();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = isNormalMap ? THREE.NoColorSpace : THREE.SRGBColorSpace;

  if (typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof Image !== "undefined") {
    const blob = new Blob([slice], { type: mime });
    const objUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      tex.image = img;
      tex.needsUpdate = true;
      URL.revokeObjectURL(objUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
    };
    img.src = objUrl;
  }
  return tex;
}

function mapNodeNameToAssemblyPart(nodeName) {
  const n = String(nodeName || "").toLowerCase();
  if (n.includes("carrier")) return "carrier";
  if (n.includes("substrate")) return "substrate";
  if (n.includes("cel_frame") || n.includes("frame")) return "cel-frame";
  if (n.includes("fasteners") || n.includes("screw") || n.includes("corner")) return "fasteners";
  if (n.includes("cover")) return "cover";
  return "substrate";
}

function parseGlbToPrototype(arrayBuffer) {
  const buf = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer;
  const dv = new DataView(buf);
  if (buf.byteLength < 20) throw new Error("GLB 文件过小");
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error("无效的 GLB 魔数");

  let offset = 12;
  let gltf = null;
  let binBuffer = null;

  while (offset + 8 <= buf.byteLength) {
    const chunkLen = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkType === 0x4e4f534a) {
      const jsonBytes = new Uint8Array(buf, chunkStart, chunkLen);
      gltf = JSON.parse(new TextDecoder("utf-8").decode(jsonBytes));
    } else if (chunkType === 0x004e4942) {
      binBuffer = buf.slice(chunkStart, chunkStart + chunkLen);
    }
    offset = chunkStart + chunkLen;
  }
  if (!gltf || !binBuffer) throw new Error("GLB 缺少 JSON 或 BIN 数据块");

  const matDefs = (gltf.materials || []).map((m) => {
    const pbr = m.pbrMetallicRoughness || {};
    const bc = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor : [0.95, 0.94, 0.91, 1];
    const normalMap = decodeEmbeddedTextureAsync(gltf, binBuffer, m.normalTexture, true);
    if (normalMap) {
      normalMap.userData = Object.assign({}, normalMap.userData, { sharedPrototype: true });
    }
    const normalScale = typeof m.normalTexture?.scale === "number" ? m.normalTexture.scale : 0.26;
    const rawMetalness = typeof pbr.metallicFactor === "number" ? pbr.metallicFactor : 0.05;
    const rawRoughness = typeof pbr.roughnessFactor === "number" ? pbr.roughnessFactor : 0.65;
    const isMetallic = rawMetalness >= 0.45;
    return {
      name: m.name || "AtelierMat",
      colorHex: new THREE.Color().setRGB(bc[0], bc[1], bc[2], THREE.LinearSRGBColorSpace).getHex(),
      // 无 HDR 环境贴图时限制 metalness <= 0.42 并赋予微暖漫射高光，确保拉丝黄铜/烫金配件温润明亮不发黑
      roughness: isMetallic ? Math.max(0.32, rawRoughness) : rawRoughness,
      metalness: Math.min(0.42, rawMetalness),
      emissiveHex: isMetallic ? 0x5e441e : 0x000000,
      emissiveIntensity: isMetallic ? 0.07 : 0,
      normalMap,
      normalScale
    };
  });

  const nodes = gltf.nodes || [];
  const parentMap = new Map();
  nodes.forEach((nd, idx) => {
    if (Array.isArray(nd.children)) {
      nd.children.forEach((childIdx) => parentMap.set(childIdx, idx));
    }
  });

  const computeNodeWorldMatrix = (nodeIdx) => {
    const chain = [];
    let cur = nodeIdx;
    const visited = new Set();
    while (typeof cur === "number" && nodes[cur] && !visited.has(cur)) {
      visited.add(cur);
      chain.unshift(nodes[cur]);
      cur = parentMap.get(cur);
    }
    const worldMat = new THREE.Matrix4();
    for (const nd of chain) {
      const localMat = new THREE.Matrix4();
      if (Array.isArray(nd.matrix) && nd.matrix.length === 16) {
        localMat.fromArray(nd.matrix);
      } else {
        const t = Array.isArray(nd.translation) ? nd.translation : [0, 0, 0];
        const r = Array.isArray(nd.rotation) ? nd.rotation : [0, 0, 0, 1];
        const s = Array.isArray(nd.scale) ? nd.scale : [1, 1, 1];
        localMat.compose(
          new THREE.Vector3(t[0], t[1], t[2]),
          new THREE.Quaternion(r[0], r[1], r[2], r[3]),
          new THREE.Vector3(s[0], s[1], s[2])
        );
      }
      worldMat.multiply(localMat);
    }
    return worldMat;
  };

  const parts = [];
  for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
    const node = nodes[nIdx];
    if (typeof node.mesh !== "number") continue;
    const meshDef = gltf.meshes?.[node.mesh];
    if (!meshDef || !Array.isArray(meshDef.primitives)) continue;

    const worldMat = computeNodeWorldMatrix(nIdx);
    const assemblyRole = mapNodeNameToAssemblyPart(node.name || meshDef.name);
    const subPrimitives = [];

    for (const prim of meshDef.primitives) {
      const geom = new THREE.BufferGeometry();
      const pos = readAccessorTypedArray(gltf, binBuffer, prim.attributes?.POSITION);
      if (!pos) continue;
      geom.setAttribute("position", new THREE.BufferAttribute(pos.array, pos.itemSize));

      if (typeof prim.attributes?.NORMAL === "number") {
        const nrm = readAccessorTypedArray(gltf, binBuffer, prim.attributes.NORMAL);
        if (nrm) geom.setAttribute("normal", new THREE.BufferAttribute(nrm.array, nrm.itemSize));
      }
      if (typeof prim.attributes?.TEXCOORD_0 === "number") {
        const uv = readAccessorTypedArray(gltf, binBuffer, prim.attributes.TEXCOORD_0);
        if (uv) geom.setAttribute("uv", new THREE.BufferAttribute(uv.array, uv.itemSize));
      }
      if (typeof prim.indices === "number") {
        const idx = readAccessorTypedArray(gltf, binBuffer, prim.indices);
        if (idx) geom.setIndex(new THREE.BufferAttribute(idx.array, 1));
      }
      geom.applyMatrix4(worldMat);
      if (!geom.attributes.normal) {
        geom.computeVertexNormals();
      } else {
        geom.normalizeNormals();
      }
      geom.computeBoundingSphere();
      geom.userData = Object.assign({}, geom.userData, { sharedPrototype: true });

      const matIdx = typeof prim.material === "number" ? prim.material : 0;
      subPrimitives.push({
        geometry: geom,
        matSpec: matDefs[matIdx] || {
          name: "DefaultMat",
          colorHex: 0xf4f0e8,
          roughness: 0.8,
          metalness: 0.02,
          normalMap: null,
          normalScale: 0.25
        }
      });
    }

    if (subPrimitives.length > 0) {
      parts.push({
        nodeName: node.name || meshDef.name || assemblyRole,
        assemblyRole,
        translation: Array.isArray(node.translation) ? node.translation : [0, 0, 0],
        rotation: Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1],
        scale: Array.isArray(node.scale) ? node.scale : [1, 1, 1],
        subPrimitives
      });
    }
  }

  return { parts, matDefs };
}

async function preloadAtelierHdPrototypes(plugin) {
  if (_prototypeCache.loaded && (_prototypeCache.hd_cel_folio || _prototypeCache.hd_collector_box)) {
    return _prototypeCache;
  }
  if (_prototypeCache.loadingPromise) return _prototypeCache.loadingPromise;

  _prototypeCache.loadingPromise = (async () => {
    try {
      const celExists = await pluginAssetExists(plugin, `${PACK_SUBDIR}/cel-folio-hd.glb`);
      if (celExists) {
        const celBuf = await readPluginAssetBinary(plugin, `${PACK_SUBDIR}/cel-folio-hd.glb`);
        _prototypeCache.hd_cel_folio = parseGlbToPrototype(celBuf);
      }
      const boxExists = await pluginAssetExists(plugin, `${PACK_SUBDIR}/collector-box-hd.glb`);
      if (boxExists) {
        const boxBuf = await readPluginAssetBinary(plugin, `${PACK_SUBDIR}/collector-box-hd.glb`);
        _prototypeCache.hd_collector_box = parseGlbToPrototype(boxBuf);
      }
      _prototypeCache.loaded = true;
    } catch (err) {
      console.warn("[Bangumi 3D Atelier] 加载精装 GLB 模型缓存失败，将自动回退标准内置模型:", err);
    } finally {
      _prototypeCache.loadingPromise = null;
    }
    return _prototypeCache;
  })();

  return _prototypeCache.loadingPromise;
}

function getCachedAtelierPrototype(styleId) {
  if (styleId === "hd_cel_folio") return _prototypeCache.hd_cel_folio || null;
  if (styleId === "hd_collector_box") return _prototypeCache.hd_collector_box || null;
  return null;
}

function clearAtelierPrototypeCache() {
  for (const key of ["hd_cel_folio", "hd_collector_box"]) {
    const proto = _prototypeCache[key];
    if (proto?.parts) {
      proto.parts.forEach((p) =>
        p.subPrimitives.forEach((sp) => {
          try {
            sp.geometry?.dispose?.();
          } catch (_) {}
        })
      );
    }
    if (proto?.matDefs) {
      proto.matDefs.forEach((m) => {
        try {
          m.normalMap?.dispose?.();
        } catch (_) {}
      });
    }
    _prototypeCache[key] = null;
  }
  _prototypeCache.loaded = false;
  _prototypeCache.loadingPromise = null;
}

module.exports = {
  PACK_SUBDIR,
  STYLE_CATALOG,
  checkAtelierHdPackStatus,
  downloadAtelierHdPack,
  removeAtelierHdPack,
  preloadAtelierHdPrototypes,
  getCachedAtelierPrototype,
  clearAtelierPrototypeCache
};
