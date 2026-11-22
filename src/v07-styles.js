/**
 * v0.7 样式汇总：在 dashboard-2d-desk.js 的 getCuratorDeskStyles() 数组末尾追加
 *   require("./v07-styles.js").getV07Styles()
 * 或在插件 onload 中单独注入一个 <style id="bangumi-v07-style">。
 */
function getV07Styles() {
  const parts = [require("./v07-styles-base.js"), require("./v07-styles-stage.js")];
  try {
    const { ROXY_V8_CSS } = require("./v07-roxy-art.js");
    if (ROXY_V8_CSS) parts.push(ROXY_V8_CSS);
  } catch (_) {}
  try {
    const { ROXY_LIVE_RIG_CSS } = require("./v08-roxy-live-rig.js");
    if (ROXY_LIVE_RIG_CSS) parts.push(ROXY_LIVE_RIG_CSS);
  } catch (_) {}
  try {
    const { MOTION_AND_LENS_CSS } = require("./v08-motion-and-lens.js");
    if (MOTION_AND_LENS_CSS) parts.push(MOTION_AND_LENS_CSS);
  } catch (_) {}
  try {
    parts.push(require("./v07-styles-game.js"));
  } catch (_) {}
  try {
    const { HALLS_AESTHETIC_CSS } = require("./v08-halls-aesthetic.js");
    if (HALLS_AESTHETIC_CSS) parts.push(HALLS_AESTHETIC_CSS);
  } catch (_) {}
  try {
    const { GALLERY_SANCTUARY_CSS } = require("./v08-gallery-sanctuary.js");
    if (GALLERY_SANCTUARY_CSS) parts.push(GALLERY_SANCTUARY_CSS);
  } catch (_) {}
  try {
    const { LOCAL_MEDIA_LINKER_CSS } = require("./local-media-linker-modal.js");
    if (LOCAL_MEDIA_LINKER_CSS) parts.push(LOCAL_MEDIA_LINKER_CSS);
  } catch (_) {}
  return parts.join("\n");
}

module.exports = { getV07Styles };
