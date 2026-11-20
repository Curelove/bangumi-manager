/**
 * v0.8 样式 · 第 1 部分：主题令牌、动态背景装饰、通用控件与外观面板
 * 所有选择器以 .bm7- 为前缀；颜色只来自 --bm7-* 令牌。
 */
module.exports = String.raw`
/* ====================== 令牌：默认＝跟随 Obsidian ====================== */
.bm7-root{
  --bm7-bg: transparent;
  --bm7-surface: var(--background-primary);
  --bm7-surface-2: var(--background-secondary);
  --bm7-surface-3: var(--background-modifier-hover);
  --bm7-line: var(--background-modifier-border);
  --bm7-ink: var(--text-normal);
  --bm7-ink-2: var(--text-muted);
  --bm7-ink-3: var(--text-faint);
  --bm7-accent: var(--interactive-accent);
  --bm7-accent-ink: var(--text-on-accent, #fff);
  --bm7-accent-soft: color-mix(in srgb, var(--bm7-accent) 13%, transparent);
  --bm7-panel-bg: var(--bm7-surface);
  --bm7-blur: 0px;
  --bm7-live: #e5484d;
  --bm7-ok: #2f9e6e;
  --bm7-gold: #c6922a;
  --bm7-radius: 16px;
  --bm7-radius-s: 10px;
  --bm7-shadow: 0 1px 2px rgb(0 0 0 / .04), 0 10px 30px -18px rgb(0 0 0 / .26);
  --bm7-shadow-lift: 0 2px 4px rgb(0 0 0 / .06), 0 18px 40px -16px rgb(0 0 0 / .36);
  --bm7-ambient: var(--bm7-accent);
  --bm7-ambient-2: color-mix(in srgb, var(--bm7-accent) 60%, #d98a5f);
  --bm7-ambient-3: color-mix(in srgb, var(--bm7-accent) 65%, #4fa8c9);
  --bm7-px: 0;
  --bm7-py: 0;
  --bm7-rx-ink: color-mix(in srgb, var(--bm7-accent) 78%, var(--bm7-ink));
  --bm7-rx-paper: var(--bm7-panel-bg);
  --bm7-rx-hair: #4c6fe0; --bm7-rx-cloak: #a87f4c; --bm7-rx-eye: #3f62e3; --bm7-rx-blush: #f0a49a; --bm7-rx-bow: #2b2c38;
  --bm7-rx-gold: #c99b49; --bm7-rx-cream: #f7f0e2;
  --bm7-seg-bg: color-mix(in srgb, var(--bm7-ink) 6%, var(--bm7-surface-2));
  --bm7-seg-active-bg: #ffffff;
  --bm7-seg-active-ink: var(--bm7-ink);
  --bm7-seg-active-shadow: 0 2px 8px rgb(15 18 24 / .09), 0 0 0 1px rgb(15 18 24 / .05);
  position: relative;
  isolation: isolate;
  color: var(--bm7-ink);
}

.theme-dark .bm7-root,.bm7-root[data-bm7-theme="cinema"]{
  --bm7-ok:#4cc38a;--bm7-live:#ff6b6f;--bm7-gold:#e3b34f;
  --bm7-seg-bg: rgb(0 0 0 / .28);
  --bm7-seg-active-bg: color-mix(in srgb, var(--bm7-ink) 15%, var(--bm7-surface));
  --bm7-seg-active-ink: var(--bm7-ink);
  --bm7-seg-active-shadow: 0 2px 8px rgb(0 0 0 / .38), inset 0 1px 0 rgb(255 255 255 / .09);
}
.theme-light .bm7-root[data-bm7-theme="cinema"]{--bm7-ok:#4cc38a;}

/* ====================== 暖色纸本 ====================== */
.bm7-root[data-bm7-theme="paper"]{
  --bm7-bg: #f4eee3; --bm7-surface: #fffcf6; --bm7-surface-2: #f3ece0; --bm7-surface-3: #ebe2d2;
  --bm7-line: #e2d6c3; --bm7-ink: #2f2923; --bm7-ink-2: #695e51; --bm7-ink-3: #8d8071;
  --bm7-accent: #8f683d; --bm7-accent-ink: #fffaf2; --bm7-panel-bg: #fffcf6;
  --bm7-shadow: 0 1px 1px rgb(80 56 24 / .05), 0 14px 32px -20px rgb(80 56 24 / .32);
}
.theme-dark .bm7-root[data-bm7-theme="paper"]{
  --bm7-bg: #1d1915; --bm7-surface: #26211b; --bm7-surface-2: #2e2821; --bm7-surface-3: #372f27;
  --bm7-line: #3d342a; --bm7-ink: #ece3d4; --bm7-ink-2: #b8ab98; --bm7-ink-3: #8f8272;
  --bm7-accent: #c99a62; --bm7-accent-ink: #1d1915; --bm7-panel-bg: #26211b;
}

/* ====================== 封面柔光（多层色彩晕染 + 磨砂玻璃） ====================== */
.bm7-root[data-bm7-theme="glow"]{
  --bm7-bg: #f0ecf3; --bm7-surface: rgb(255 255 255 / .68); --bm7-surface-2: rgb(255 255 255 / .46); --bm7-surface-3: rgb(255 255 255 / .78);
  --bm7-line: rgb(40 30 60 / .10); --bm7-ink: #23202b; --bm7-ink-2: #595466; --bm7-ink-3: #7d778c;
  --bm7-accent: #4c62b6; --bm7-accent-ink: #fff; --bm7-panel-bg: rgb(255 255 255 / .60); --bm7-blur: 22px;
  --bm7-rx-paper: #f7f4f8;
}
.theme-dark .bm7-root[data-bm7-theme="glow"]{
  --bm7-bg: #15141b; --bm7-surface: rgb(30 28 38 / .66); --bm7-surface-2: rgb(255 255 255 / .07); --bm7-surface-3: rgb(255 255 255 / .12);
  --bm7-line: rgb(255 255 255 / .10); --bm7-ink: #efeaf5; --bm7-ink-2: #b8b2c6; --bm7-ink-3: #8a8499;
  --bm7-accent: #9aa8eb; --bm7-accent-ink: #15131a; --bm7-panel-bg: rgb(28 26 36 / .60);
  --bm7-rx-paper: #1d1b22;
}

/* ====================== 夜间影院（常暗） ====================== */
.bm7-root[data-bm7-theme="cinema"]{
  --bm7-bg: #141210; --bm7-surface: #1c1916; --bm7-surface-2: #24201b; --bm7-surface-3: #2d2822;
  --bm7-line: #332d26; --bm7-ink: #efe7da; --bm7-ink-2: #b8ac9b; --bm7-ink-3: #8c8070;
  --bm7-accent: #e0a458; --bm7-accent-ink: #1a1510; --bm7-panel-bg: #1c1916;
  --bm7-shadow: 0 1px 2px rgb(0 0 0 / .3), 0 18px 40px -20px rgb(0 0 0 / .8);
  color-scheme: dark;
}

/* ====================== 洛琪希手记 ====================== */
.bm7-root[data-bm7-theme="roxy"]{
  --bm7-bg: #f3ecdd; --bm7-surface: #fbf7ee; --bm7-surface-2: #f1e9d9; --bm7-surface-3: #e9dfcb;
  --bm7-line: #ddd0b8; --bm7-ink: #282c42; --bm7-ink-2: #585c74; --bm7-ink-3: #848698;
  --bm7-accent: #3d55b0; --bm7-accent-ink: #fbf7ee; --bm7-panel-bg: #fbf7ee;
  --bm7-rx-ink: #32468e; --bm7-rx-paper: #fbf7ee;
  --bm7-shadow: 0 1px 1px rgb(52 60 110 / .05), 0 14px 32px -20px rgb(60 52 30 / .34);
}
.theme-dark .bm7-root[data-bm7-theme="roxy"]{
  --bm7-bg: #151927; --bm7-surface: #1b2031; --bm7-surface-2: #222840; --bm7-surface-3: #2a3150;
  --bm7-line: #2f3654; --bm7-ink: #ebe8f4; --bm7-ink-2: #b3b7d1; --bm7-ink-3: #848aa8;
  --bm7-accent: #8fa2f0; --bm7-accent-ink: #141826; --bm7-panel-bg: #1b2031;
  --bm7-rx-ink: #c0ccf5; --bm7-rx-paper: #1b2031; --bm7-rx-bow: #9aa4c8; --bm7-rx-cream: #2d3554;
}

/* ====================== 晴空画集（夏日晴空水色画集 / 夏夜星穹） ====================== */
.bm7-root[data-bm7-theme="cel"]{
  --bm7-bg: #eef6fd; --bm7-surface: #ffffff; --bm7-surface-2: #e3f0fb; --bm7-surface-3: #d6e8f8;
  --bm7-line: #cadef2; --bm7-ink: #1d2d44; --bm7-ink-2: #4c627e; --bm7-ink-3: #788ea9;
  --bm7-accent: #2876de; --bm7-accent-ink: #ffffff; --bm7-panel-bg: rgb(255 255 255 / .90); --bm7-blur: 12px;
  --bm7-gold: #d48c28; --bm7-ok: #26996c;
  --bm7-shadow: 0 1px 2px rgb(28 72 132 / .05), 0 14px 32px -20px rgb(28 72 132 / .24);
}
.theme-dark .bm7-root[data-bm7-theme="cel"]{
  --bm7-bg: #0f1726; --bm7-surface: #162236; --bm7-surface-2: #1d2c45; --bm7-surface-3: #243756;
  --bm7-line: #2b4063; --bm7-ink: #eaf2ff; --bm7-ink-2: #adc0dc; --bm7-ink-3: #7c93b4;
  --bm7-accent: #6ab4ff; --bm7-accent-ink: #0e1726; --bm7-panel-bg: rgb(22 34 54 / .88); --bm7-blur: 12px;
}

/* 非「跟随」主题：把 Obsidian 变量在档案馆内部重映射，让子面板也统一换装 */
.bm7-root[data-bm7-theme="paper"], .bm7-root[data-bm7-theme="glow"], .bm7-root[data-bm7-theme="cinema"], .bm7-root[data-bm7-theme="roxy"], .bm7-root[data-bm7-theme="cel"]{
  --background-primary: var(--bm7-surface);
  --background-primary-alt: var(--bm7-surface-2);
  --background-secondary: var(--bm7-surface-2);
  --background-secondary-alt: var(--bm7-surface-3);
  --background-modifier-border: var(--bm7-line);
  --background-modifier-hover: var(--bm7-surface-3);
  --text-normal: var(--bm7-ink);
  --text-muted: var(--bm7-ink-2);
  --text-faint: var(--bm7-ink-3);
  --interactive-accent: var(--bm7-accent);
  --interactive-accent-hover: color-mix(in srgb, var(--bm7-accent) 86%, #000);
  --text-on-accent: var(--bm7-accent-ink);
  --text-accent: var(--bm7-accent);
  background: var(--bm7-bg);
}
.bm7-root:not([data-bm7-theme="follow"]) .curator-desk-topbar,
.bm7-root:not([data-bm7-theme="follow"]) .curator-workspace-mode-bar,
.bm7-root:not([data-bm7-theme="follow"]) .curator-catalog-toolbar{
  background: var(--bm7-panel-bg) !important;
  border-color: var(--bm7-line) !important;
  -webkit-backdrop-filter: blur(var(--bm7-blur));
  backdrop-filter: blur(var(--bm7-blur));
}
.bm7-root:not([data-bm7-theme="follow"]) .curator-filter-pill.is-active,
.bm7-root:not([data-bm7-theme="follow"]) .curator-top-btn.is-3d-entry{
  background: var(--bm7-accent) !important; border-color: var(--bm7-accent) !important; color: var(--bm7-accent-ink) !important;
}

/* ====================== 背景装饰层 ====================== */
.bm7-decor{position:absolute;inset:0;z-index:-1;pointer-events:none;overflow:hidden;border-radius:inherit;}
.bm7-decor-glow{position:absolute;inset:0 0 auto 0;height:min(1480px,100%);
  -webkit-mask-image:linear-gradient(to bottom,#000 0,#000 62%,transparent 100%);mask-image:linear-gradient(to bottom,#000 0,#000 62%,transparent 100%);}
.bm7-decor-glow-img{position:absolute;inset:-120px;background-size:cover;background-position:center 28%;filter:blur(76px) saturate(1.55);opacity:.54;transform:scale(1.12);transition:opacity .92s ease;}
.bm7-decor-glow-img.is-ghost{animation:bm7-fade-out .92s ease forwards;}
.theme-dark .bm7-decor-glow-img{opacity:.48;}
.bm7-decor-glow-orb{position:absolute;border-radius:50%;filter:blur(64px);opacity:.48;will-change:transform,opacity;transition:background .8s ease;}
.bm7-decor-glow-orb.is-orb1{width:540px;height:420px;left:-90px;top:-80px;
  background:radial-gradient(circle,color-mix(in srgb,var(--bm7-ambient) 68%,transparent) 0%,transparent 72%);
  transform:translate3d(calc(var(--bm7-px,0) * 22px),calc(var(--bm7-py,0) * 16px),0);}
.bm7-decor-glow-orb.is-orb2{width:480px;height:420px;right:-80px;top:60px;
  background:radial-gradient(circle,color-mix(in srgb,var(--bm7-ambient-2) 62%,transparent) 0%,transparent 72%);
  transform:translate3d(calc(var(--bm7-px,0) * -26px),calc(var(--bm7-py,0) * 18px),0);}
.bm7-decor-glow-orb.is-orb3{width:460px;height:360px;left:24%;top:280px;
  background:radial-gradient(circle,color-mix(in srgb,var(--bm7-ambient-3) 50%,transparent) 0%,transparent 74%);
  transform:translate3d(calc(var(--bm7-px,0) * 16px),calc(var(--bm7-py,0) * -18px),0);}
.theme-dark .bm7-decor-glow-orb{opacity:.36;}
.bm7-decor-glow-veil{position:absolute;inset:0;background:radial-gradient(120% 74% at 22% 0%,transparent 0,color-mix(in srgb,var(--bm7-bg) 56%,transparent) 70%,var(--bm7-bg) 100%);}
.bm7-root[data-bm7-motion="on"] .bm7-decor-glow-img{animation:bm7-drift 42s ease-in-out infinite alternate;}
.bm7-root[data-bm7-motion="on"] .bm7-decor-glow-orb.is-orb1{animation:bm7-orb-breathe 11s ease-in-out infinite alternate;}
.bm7-root[data-bm7-motion="on"] .bm7-decor-glow-orb.is-orb2{animation:bm7-orb-breathe 14s ease-in-out 1.8s infinite alternate-reverse;}

.bm7-decor-paper{position:absolute;inset:0;opacity:.55;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .28 0 0 0 0 .18 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E"),
    radial-gradient(140% 90% at 50% 0%,transparent 55%,rgb(120 90 40 / .08) 100%);}
.theme-dark .bm7-decor-paper{opacity:.35;}
.bm7-decor-stars{position:absolute;top:0;right:0;width:min(1160px,96%);color:var(--bm7-accent);opacity:.52;}
.bm7-decor-stars svg{width:100%;height:auto;display:block;}
.bm7-star{opacity:var(--o,.6);}
.bm7-root[data-bm7-motion="on"] .bm7-star{animation:bm7-twinkle 5.2s ease-in-out infinite;animation-delay:var(--d,0s);}
.bm7-root[data-bm7-motion="on"] .bm7-startrail-arc{animation:bm7-dash 16s linear infinite;}
.bm7-root[data-bm7-motion="on"] .bm7-startrail-arc2{animation:bm7-dash 24s linear infinite reverse;}

/* 跟随 Obsidian 动态：顶部环境主色轻柔光晕 */
.bm8-decor-follow{position:absolute;inset:0 0 auto 0;height:380px;opacity:.42;
  background:radial-gradient(72% 88% at 26% 0%,color-mix(in srgb,var(--bm7-ambient) 34%,transparent) 0%,transparent 76%),
    radial-gradient(56% 74% at 82% 8%,color-mix(in srgb,var(--bm7-ambient-2) 26%,transparent) 0%,transparent 78%);}
.bm7-root[data-bm7-motion="on"] .bm8-decor-follow{animation:bm7-orb-breathe 9s ease-in-out infinite alternate;}

/* 暖色纸本动态：午后窗边暖阳树影轻晃 */
.bm8-decor-sunleaf{position:absolute;top:-36px;right:-24px;width:min(580px,68%);height:340px;opacity:.48;transform-origin:100% 0%;
  background:
    radial-gradient(64% 68% at 78% 18%,rgb(242 198 122 / .36) 0%,transparent 72%),
    repeating-linear-gradient(122deg,rgb(168 122 64 / .07) 0 18px,transparent 18px 46px);
  -webkit-mask-image:radial-gradient(88% 84% at 82% 16%,#000 22%,transparent 88%);
  mask-image:radial-gradient(88% 84% at 82% 16%,#000 22%,transparent 88%);}
.theme-dark .bm8-decor-sunleaf{opacity:.28;}
.bm7-root[data-bm7-motion="on"] .bm8-decor-sunleaf{animation:bm8-sunleaf-sway 11s ease-in-out infinite alternate;}

/* 夜间影院动态：琥珀放映机柔光束与微尘 */
.bm8-decor-cinema{position:absolute;inset:0;overflow:hidden;}
.bm8-cinema-beam{position:absolute;top:-80px;width:460px;height:480px;transform-origin:50% 0%;pointer-events:none;opacity:.22;
  background:conic-gradient(from 162deg at 50% 0%,transparent 0deg,rgb(236 174 88 / .34) 16deg,rgb(236 174 88 / .08) 32deg,transparent 48deg);
  filter:blur(22px);}
.bm8-cinema-beam.is-b1{right:8%;}
.bm8-cinema-beam.is-b2{left:14%;opacity:.14;transform:scaleX(-1);}
.bm8-cinema-motes{position:absolute;inset:0 0 auto 0;height:360px;opacity:.26;
  background-image:radial-gradient(circle at 22% 28%,rgb(255 214 148 / .65) 0 1.2px,transparent 2px),
    radial-gradient(circle at 68% 18%,rgb(255 214 148 / .55) 0 1.4px,transparent 2.2px),
    radial-gradient(circle at 82% 42%,rgb(255 214 148 / .45) 0 1px,transparent 1.8px);
  background-size:280px 180px;}
.bm7-root[data-bm7-motion="on"] .bm8-cinema-beam.is-b1{animation:bm8-beam-sway 13s ease-in-out infinite alternate;}
.bm7-root[data-bm7-motion="on"] .bm8-cinema-motes{animation:bm8-motes-float 18s linear infinite;}

/* 晴空画集（cel）：晴空水色渐变 + 流云光斑 + 赛璐璐网点 + 原画定位标 */
.bm8-decor-cel{position:absolute;inset:0;overflow:hidden;color:var(--bm7-accent);}
.bm8-cel-sky{position:absolute;inset:0 0 auto 0;height:440px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--bm7-accent) 15%,transparent) 0%,color-mix(in srgb,#7fd2ff 10%,transparent) 52%,transparent 100%);}
.theme-dark .bm8-cel-sky{
  background:linear-gradient(180deg,rgb(58 118 214 / .22) 0%,rgb(38 72 138 / .10) 56%,transparent 100%);}
.bm8-cel-cloud{position:absolute;border-radius:999px;filter:blur(26px);opacity:.62;}
.bm8-cel-cloud.is-c1{top:-34px;right:6%;width:360px;height:132px;background:radial-gradient(closest-side,rgb(255 255 255 / .92),transparent);}
.bm8-cel-cloud.is-c2{top:42px;left:12%;width:280px;height:104px;background:radial-gradient(closest-side,rgb(255 250 235 / .78),transparent);}
.theme-dark .bm8-cel-cloud.is-c1{background:radial-gradient(closest-side,rgb(110 176 255 / .22),transparent);}
.theme-dark .bm8-cel-cloud.is-c2{background:radial-gradient(closest-side,rgb(142 132 246 / .18),transparent);}
.bm8-cel-halftone{position:absolute;top:0;right:0;width:360px;height:220px;opacity:.22;
  background-image:radial-gradient(currentColor 1.15px,transparent 1.25px);
  background-size:11px 11px;
  -webkit-mask-image:radial-gradient(90% 90% at 92% 8%,#000 10%,transparent 76%);
  mask-image:radial-gradient(90% 90% at 92% 8%,#000 10%,transparent 76%);}
.bm8-cel-marks-wrap{position:absolute;top:0;right:0;width:min(560px,72%);opacity:.75;}
.bm8-cel-marks{width:100%;height:auto;display:block;}
.bm7-root[data-bm7-motion="on"] .bm8-cel-cloud.is-c1{animation:bm8-cloud-drift 22s ease-in-out infinite alternate;}
.bm7-root[data-bm7-motion="on"] .bm8-cel-cloud.is-c2{animation:bm8-cloud-drift 28s ease-in-out 2s infinite alternate-reverse;}
.bm7-root[data-bm7-motion="on"] .bm8-cel-spark{transform-box:fill-box;transform-origin:center;animation:bm7-twinkle 4.6s ease-in-out infinite;}
.bm7-root[data-bm7-motion="on"] .bm8-cel-spark.is-s2{animation-delay:1.7s;}

/* ====================== 洛琪希钢笔淡彩肖像 ====================== */
.bm7-roxy-art{display:block;width:100%;height:auto;color:var(--bm7-rx-ink);overflow:visible;}
.bm7-roxy-art .bm7-rx-occ,.bm7-roxy-art .bm7-rx-hl{fill:var(--bm7-rx-paper);}
.bm7-roxy-art .bm7-rx-wash{opacity:.30;mix-blend-mode:multiply;}
.theme-dark .bm7-roxy-art .bm7-rx-wash{opacity:.24;mix-blend-mode:screen;}
.bm7-roxy-art .bm7-rx-blush-ink{stroke:#d77a72;}
.bm7-roxy-art .bm7-rx-ahoge{transform-origin:118px 56px;}
.bm7-roxy-art .bm7-rx-eyes{transform-origin:120px 148px;}
.bm7-roxy-art .bm7-rx-astrolabe{transform-origin:120px 144px;}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap.is-drawing [pathLength]{stroke-dasharray:1;stroke-dashoffset:1;animation:bm7-draw .85s cubic-bezier(.35,.1,.25,1) forwards;}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap.is-drawing .bm7-rx-g2 [pathLength]{animation-delay:.1s;}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap.is-drawing .bm7-rx-g3 [pathLength]{animation-delay:.2s;}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap.is-drawing .bm7-rx-g4 [pathLength]{animation-delay:.3s;}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap.is-drawing .bm7-rx-g5 [pathLength],
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap.is-drawing .bm7-rx-g6 [pathLength]{animation-delay:.38s;}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap.is-drawing .bm7-rx-wash,
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap.is-drawing .bm7-rx-lid,
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap.is-drawing ellipse{animation:bm7-fade-in .55s ease .42s both;}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap .bm7-roxy-art{animation:bm7-breathe 7.2s ease-in-out 1.1s infinite;transform-origin:50% 92%;}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap .bm7-rx-ahoge{animation:bm7-ahoge-sway 5.4s ease-in-out 1.1s infinite;}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap .bm7-rx-eyes{animation:bm7-rx-blink 7.4s ease-in-out 2.2s infinite;}
.bm7-root[data-bm7-motion="on"] .bm7-roxy-art-wrap .bm7-rx-astrolabe{animation:bm7-astrolabe-turn 68s linear infinite;}

/* ====================== 通用控件 ====================== */
.bm7-ico{flex-shrink:0;display:block;}
.bm7-badge-icon{width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  color:var(--bm7-accent);background:color-mix(in srgb,var(--bm7-accent) 11%,var(--bm7-surface));border:1px solid color-mix(in srgb,var(--bm7-accent) 18%,transparent);}
.bm7-num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum";}
.bm7-grow{flex:1 1 auto;}
.bm7-root .bm7-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 13px;border-radius:var(--bm7-radius-s);
  border:1px solid var(--bm7-line);background:var(--bm7-surface);color:var(--bm7-ink);font-size:12.5px;font-weight:600;line-height:1;cursor:pointer;
  white-space:nowrap;box-shadow:none;transition:background .15s ease,border-color .15s ease,transform .15s ease,box-shadow .15s ease;}
.bm7-root .bm7-btn:hover{border-color:color-mix(in srgb,var(--bm7-accent) 45%,var(--bm7-line));background:var(--bm7-surface-3);}
.bm7-root .bm7-btn:active{transform:translateY(1px);}
.bm7-root .bm7-btn:focus-visible{outline:2px solid var(--bm7-accent);outline-offset:2px;}
.bm7-root .bm7-btn.is-primary{background:var(--bm7-accent);border-color:transparent;color:var(--bm7-accent-ink);box-shadow:0 6px 16px -8px color-mix(in srgb,var(--bm7-accent) 80%,transparent);}
.bm7-root .bm7-btn.is-primary:hover{background:color-mix(in srgb,var(--bm7-accent) 88%,#000);}
.bm7-root .bm7-btn.is-ghost{background:transparent;border-color:transparent;color:var(--bm7-ink-2);}
.bm7-root .bm7-btn.is-ghost:hover{background:var(--bm7-surface-3);color:var(--bm7-ink);}
.bm7-root .bm7-btn.is-icon{width:32px;padding:0;color:var(--bm7-ink-2);}
.bm7-root .bm7-btn.is-icon:hover{color:var(--bm7-ink);}
.bm7-root .bm7-btn:disabled{opacity:.5;cursor:default;}
.bm7-root .bm7-link{background:none !important;border:none !important;padding:4px 0;color:var(--bm7-accent);font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:none !important;}
.bm7-root .bm7-link:hover{text-decoration:underline;}
.bm7-root .bm7-input{height:32px;padding:0 11px;border-radius:var(--bm7-radius-s);border:1px solid var(--bm7-line);background:var(--bm7-surface);color:var(--bm7-ink);font-size:12.5px;min-width:0;}
.bm7-root .bm7-input:focus{outline:none;border-color:var(--bm7-accent);box-shadow:0 0 0 3px var(--bm7-accent-soft);}

/* 微凹槽底轨 + 柔和投影悬浮胶囊（强力免疫 Obsidian 默认 button 灰框） */
.bm7-root .bm7-seg{display:inline-flex;align-items:center;gap:3px;padding:3.5px;border-radius:11px;
  background:color-mix(in srgb,var(--bm7-ink) 6.5%,transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / .05);max-width:100%;}
.bm7-root .bm7-seg.is-scroll{overflow-x:auto;scrollbar-width:none;}
.bm7-root .bm7-seg.is-scroll::-webkit-scrollbar{display:none;}
.bm7-root .bm7-seg-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:29px;padding:0 12px;
  border:none !important;border-radius:8px !important;background:transparent !important;color:var(--bm7-ink-2) !important;
  font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:none !important;flex-shrink:0;
  transition:background .16s ease,color .16s ease,box-shadow .16s ease;}
.bm7-root .bm7-seg-btn:hover{color:var(--bm7-ink) !important;background:color-mix(in srgb,var(--bm7-surface) 42%,transparent) !important;}
.bm7-root .bm7-seg-btn.is-active{background:var(--bm7-surface) !important;color:var(--bm7-ink) !important;
  box-shadow:0 1px 2px rgb(0 0 0 / .08),0 3px 10px -4px rgb(0 0 0 / .20) !important;}
.bm7-root .bm7-seg.is-small .bm7-seg-btn{height:27px;padding:0 10px;font-size:12px;}
.bm7-seg-count{font-size:12px;font-weight:650;color:var(--bm7-ink-3);font-variant-numeric:tabular-nums;}
.bm7-seg-btn.is-active .bm7-seg-count{color:var(--bm7-accent);}

.bm7-chips{display:flex;flex-wrap:wrap;gap:5px;min-width:0;}
.bm7-chip{display:inline-flex;align-items:center;max-width:100%;padding:2px 9px;border-radius:999px;font-size:12px;line-height:19px;color:var(--bm7-ink-2);
  background:color-mix(in srgb,var(--bm7-ink) 6%,transparent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bm7-chip.is-glass{background:color-mix(in srgb,var(--bm7-surface) 62%,transparent);border:1px solid color-mix(in srgb,var(--bm7-line) 80%,transparent);
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:var(--bm7-ink);}
.bm7-chip[data-k="tag"]{color:var(--bm7-accent);background:var(--bm7-accent-soft);}

.bm7-toggle{display:flex;align-items:center;gap:12px;padding:9px 2px;cursor:pointer;position:relative;min-width:0;}
.bm7-toggle input{position:absolute;opacity:0;pointer-events:none;}
.bm7-toggle-text{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;}
.bm7-toggle-label{font-size:13px;font-weight:650;color:var(--bm7-ink);white-space:normal;overflow-wrap:anywhere;}
.bm7-toggle-hint{font-size:12px;color:var(--bm7-ink-3);line-height:1.48;white-space:normal;overflow-wrap:anywhere;}
.bm7-toggle-track{flex-shrink:0;width:36px;height:21px;border-radius:999px;background:color-mix(in srgb,var(--bm7-ink) 16%,transparent);position:relative;transition:background .18s ease;}
.bm7-toggle-thumb{position:absolute;top:2.5px;left:2.5px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgb(0 0 0 / .25);transition:transform .2s cubic-bezier(.3,1.4,.5,1);}
.bm7-toggle input:checked ~ .bm7-toggle-track{background:var(--bm7-accent);}
.bm7-toggle input:checked ~ .bm7-toggle-track .bm7-toggle-thumb{transform:translateX(15px);}
.bm7-toggle input:focus-visible ~ .bm7-toggle-track{outline:2px solid var(--bm7-accent);outline-offset:2px;}
.bm7-toggle.is-disabled{opacity:.5;cursor:not-allowed;}

.bm7-portal-host{position:fixed !important;top:0;left:0;width:0;height:0;overflow:visible;z-index:10040;pointer-events:none;background:transparent !important;border:none !important;box-shadow:none !important;}
.bm7-pop{position:fixed;z-index:10045;pointer-events:auto;max-width:calc(100vw - 16px);border-radius:14px;border:1px solid var(--bm7-line);background:var(--bm7-surface);color:var(--bm7-ink);
  box-shadow:0 24px 60px -20px rgb(0 0 0 / .45),0 2px 6px rgb(0 0 0 / .08);animation:bm7-pop-in .16s ease;box-sizing:border-box;}
.bm7-root[data-bm7-theme="glow"] .bm7-pop{background:color-mix(in srgb,var(--bm7-bg) 92%,var(--background-primary));-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);}
.bm7-pop.is-leaving{opacity:0;transform:translateY(-4px);transition:opacity .14s ease,transform .14s ease;}
.bm7-pop-inner{padding:12px 14px;display:flex;flex-direction:column;gap:3px;max-height:min(74vh,600px);overflow-y:auto;overflow-x:hidden;min-width:0;}
.bm7-pop.is-sheet{position:fixed;left:0;right:0;bottom:0;top:auto !important;width:100% !important;max-width:100vw;max-height:84vh;display:flex;flex-direction:column;overflow:hidden;border-radius:18px 18px 0 0;border-bottom:none;box-shadow:0 -8px 40px rgb(0 0 0 / .38),0 20px 50px rgb(0 0 0 / .45);animation:bm7-sheet-in .22s cubic-bezier(.2,.9,.3,1);z-index:10080;}
.bm7-sheet-bar{position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-height:38px;padding:8px 44px 6px;border-bottom:1px solid color-mix(in srgb,var(--bm7-line) 75%,transparent);}
.bm7-sheet-grab{position:absolute;top:6px;left:50%;transform:translateX(-50%);width:36px;height:4px;border-radius:999px;background:color-mix(in srgb,var(--bm7-ink) 20%,transparent);}
.bm7-sheet-title{font-size:13px;font-weight:700;color:var(--bm7-ink);margin-top:4px;}
.bm7-root .bm7-sheet-close,button.bm7-sheet-close{position:absolute !important;right:10px;top:50%;transform:translateY(-50%);width:30px !important;height:30px !important;min-height:30px !important;padding:0 !important;border-radius:999px !important;border:1px solid var(--bm7-line) !important;background:var(--bm7-surface-2) !important;color:var(--bm7-ink-2) !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;box-shadow:none !important;cursor:pointer;}
.bm7-pop.is-sheet .bm7-pop-inner{flex:1 1 auto;max-height:none;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 14px calc(26px + env(safe-area-inset-bottom, 0px));}
@media (max-width: 480px){
  .bm7-theme-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
  .bm7-theme-preview{height:58px;}
  .bm7-root .bm7-theme-card,button.bm7-theme-card{padding:7px !important;gap:6px;}
  .bm7-theme-desc{font-size:11.5px;line-height:1.4;}
  .bm8-motion-tier-row{flex-direction:column;align-items:stretch;gap:6px;}
  .bm8-motion-tier-seg .bm7-seg{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));}
}
.bm7-pop-title{font-size:12px;font-weight:700;color:var(--bm7-ink-3);padding:4px 2px 6px;white-space:normal;overflow-wrap:anywhere;}
.bm7-pop-note{margin:6px 2px;font-size:12px;color:var(--bm7-ink-3);line-height:1.5;white-space:normal;overflow-wrap:anywhere;}
.bm7-root .bm7-menu-item{display:flex;align-items:center;gap:9px;width:100%;min-height:34px;height:auto !important;padding:6px 10px;border:none !important;border-radius:8px;
  background:transparent !important;color:var(--bm7-ink) !important;font-size:13px;cursor:pointer;box-shadow:none !important;text-align:left;white-space:normal !important;}
.bm7-root .bm7-menu-item:hover{background:var(--bm7-surface-3) !important;}
.bm7-root .bm7-menu-item.is-danger{color:var(--bm7-live) !important;}

.bm7-empty{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:18px 4px;color:var(--bm7-ink-3);font-size:12.5px;line-height:1.6;}
.bm7-progress{display:block;height:4px;border-radius:999px;background:color-mix(in srgb,var(--bm7-ink) 10%,transparent);overflow:hidden;margin-top:6px;}
.bm7-progress-fill{display:block;height:100%;background:var(--bm7-accent);border-radius:inherit;transition:width .3s ease;}

/* 封面 */
.bm7-cover{position:relative;overflow:hidden;background:color-mix(in srgb,var(--bm7-ink) 8%,transparent);}
.bm7-cover img{display:block;width:100%;height:100%;object-fit:cover;}
.bm7-cover-fallback{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.6em;font-weight:800;color:rgb(255 255 255 / .92);
  background:linear-gradient(150deg,hsl(var(--bm7-fb-hue) 40% 62%),hsl(calc(var(--bm7-fb-hue) + 40) 36% 42%));}

/* 外观选择（严格防折行穿模：覆盖 Obsidian 全局 button white-space:nowrap 与固定高度） */
.bm7-appearance{display:flex;flex-direction:column;gap:12px;min-width:0;width:100%;}
.bm7-theme-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(154px,1fr));gap:10px;min-width:0;}
.bm7-root .bm7-theme-card, button.bm7-theme-card{
  position:relative;display:flex !important;flex-direction:column !important;align-items:stretch !important;justify-content:flex-start !important;
  gap:8px;padding:9px !important;border-radius:13px !important;border:1.5px solid var(--bm7-line) !important;
  background:var(--bm7-surface) !important;cursor:pointer;text-align:left !important;box-shadow:none !important;
  height:auto !important;min-height:0 !important;min-width:0 !important;max-width:100%;
  white-space:normal !important;line-height:1.45 !important;overflow:hidden;
  transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease;
}
.bm7-root .bm7-theme-card:hover, button.bm7-theme-card:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--bm7-accent) 42%,var(--bm7-line)) !important;}
.bm7-root .bm7-theme-card.is-active, button.bm7-theme-card.is-active{border-color:var(--bm7-accent) !important;box-shadow:0 0 0 3px var(--bm7-accent-soft) !important;}
.bm7-theme-preview{position:relative;display:block;width:100%;height:76px;flex-shrink:0;border-radius:9px;overflow:hidden;border:1px solid rgb(0 0 0 / .06);}
.bm7-tp-bg{position:absolute;inset:0;}
.bm7-tp-panel{position:absolute;left:10px;top:12px;width:54%;height:50px;border-radius:7px;box-shadow:0 4px 10px -6px rgb(0 0 0 / .3);}
.bm7-tp-accent{position:absolute;left:18px;bottom:20px;width:32px;height:8px;border-radius:4px;}
.bm7-tp-roxy{position:absolute;right:1px;top:1px;width:62px;--bm7-rx-ink:#32468e;--bm7-rx-paper:#f6f0e3;}
.bm7-tp-glowblob{position:absolute;right:-10px;top:-14px;width:86px;height:86px;border-radius:50%;background:radial-gradient(circle,#e5a3b8,#8f9de0 60%,transparent 72%);filter:blur(6px);opacity:.9;}
.bm7-tp-glowblob2{position:absolute;left:18px;bottom:-18px;width:72px;height:72px;border-radius:50%;background:radial-gradient(circle,#7dc7d9,transparent 70%);filter:blur(7px);opacity:.7;}
.bm8-tp-celdots{position:absolute;right:0;top:0;width:68px;height:52px;opacity:.34;background-image:radial-gradient(#2c7be5 1.1px,transparent 1.2px);background-size:7px 7px;-webkit-mask-image:radial-gradient(90% 90% at 100% 0%,#000 18%,transparent 82%);mask-image:radial-gradient(90% 90% at 100% 0%,#000 18%,transparent 82%);}
.bm8-tp-celcloud{position:absolute;right:8px;bottom:8px;width:54px;height:22px;border-radius:999px;background:radial-gradient(closest-side,rgb(255 255 255 / .95),transparent);filter:blur(2px);}
.bm7-theme-meta{display:flex;flex-direction:column;gap:4px;padding:0 2px 2px;min-width:0;width:100%;white-space:normal !important;}
.bm7-theme-name{display:flex;align-items:center;flex-wrap:wrap;gap:5px;font-size:13px;font-weight:700;color:var(--bm7-ink);min-width:0;white-space:normal !important;}
.bm7-theme-name-text{min-width:0;overflow-wrap:anywhere;}
.bm7-theme-tag{font-size:12px;font-weight:600;padding:0 6px;border-radius:999px;color:var(--bm7-accent);background:var(--bm7-accent-soft);line-height:18px;flex-shrink:0;}
.bm7-theme-tag.is-lite{color:var(--bm7-ink-2);background:color-mix(in srgb,var(--bm7-ink) 8%,transparent);}
.bm7-theme-desc{display:block;font-size:12px;line-height:1.48;color:var(--bm7-ink-2);min-width:0;max-width:100%;white-space:normal !important;overflow-wrap:anywhere;word-break:break-word;}
.bm7-theme-check{position:absolute;top:14px;left:14px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--bm7-accent);color:var(--bm7-accent-ink);box-shadow:0 2px 6px rgb(0 0 0 / .2);}
.bm7-appearance-toggles{display:flex;flex-direction:column;gap:2px;padding-top:4px;border-top:1px solid var(--bm7-line);min-width:0;}
.bm8-motion-tier-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;padding:9px 2px;min-width:0;}
.bm8-motion-tier-seg{flex-shrink:0;max-width:100%;}
.bm7-root[data-bm7-motion-tier="lite"] .bm7-decor *,
.bm7-root[data-bm7-motion-tier="lite"] .bm7-ep.is-next,
.bm7-root[data-bm7-motion-tier="lite"] .bm7-rxnote-steam{animation:none !important;}

/* ====================== 动画 ====================== */
@keyframes bm7-fade-in{from{opacity:0}to{opacity:1}}
@keyframes bm7-fade-out{from{opacity:1}to{opacity:0}}
@keyframes bm7-pop-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
@keyframes bm7-sheet-in{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes bm7-drift{0%{transform:scale(1.1) translate3d(0,0,0)}100%{transform:scale(1.2) translate3d(-2.2%,1.4%,0)}}
@keyframes bm7-orb-breathe{0%{opacity:.38}100%{opacity:.58}}
@keyframes bm7-twinkle{0%,100%{opacity:var(--o,.6);transform:scale(.84)}50%{opacity:1;transform:scale(1.12)}}
@keyframes bm7-dash{to{stroke-dashoffset:-150}}
@keyframes bm7-draw{to{stroke-dashoffset:0}}
@keyframes bm7-breathe{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-2px) rotate(-.45deg)}}
@keyframes bm7-ahoge-sway{0%,100%{transform:rotate(0deg)}50%{transform:rotate(4.2deg)}}
@keyframes bm7-rx-blink{0%,94%,100%{transform:scaleY(1)}96.5%{transform:scaleY(.12)}}
@keyframes bm7-astrolabe-turn{from{transform:translate(120px,144px) rotate(0deg)}to{transform:translate(120px,144px) rotate(360deg)}}
@keyframes bm8-sunleaf-sway{0%{transform:rotate(0deg) translate3d(0,0,0)}100%{transform:rotate(2.2deg) translate3d(-12px,8px,0)}}
@keyframes bm8-beam-sway{0%{transform:rotate(-2.5deg);opacity:.18}100%{transform:rotate(2.5deg);opacity:.30}}
@keyframes bm8-motes-float{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(-36px,-28px,0)}}
@keyframes bm8-cloud-drift{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(-28px,6px,0) scale(1.06)}}
.bm7-root[data-bm7-motion-tier="off"] *,
.bm7-root[data-bm7-motion="off"] *{animation:none !important;transition:none !important;}
.bm7-root[data-bm7-motion-tier="off"] .bm7-roxy-art-wrap.is-drawing [pathLength],
.bm7-root[data-bm7-motion="off"] .bm7-roxy-art-wrap.is-drawing [pathLength]{stroke-dashoffset:0 !important;}
@media (prefers-reduced-motion: reduce){
  .bm7-root:not([data-bm7-motion-tier="full"]):not([data-bm7-motion-tier="lite"]) *{animation:none !important;transition:none !important;}
  .bm7-root:not([data-bm7-motion-tier="full"]):not([data-bm7-motion-tier="lite"]) .bm7-roxy-art-wrap.is-drawing [pathLength]{stroke-dashoffset:0 !important;}
}
`;
