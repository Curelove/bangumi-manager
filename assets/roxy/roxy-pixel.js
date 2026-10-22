/**
 * Roxy Migurdia (Hatless Cloak Outfit) Chibi SVG Rig Component for HyperFrames + GSAP
 * File path: ./template/roxy-pixel.js
 * Supported states: 'idle' | 'explain' | 'warn' | 'blocked' | 'surprised' | 'panic' | 'success'
 */
(function (global) {
  class RoxyPixelAvatar {
    constructor(container, options = {}) {
      if (typeof container === 'string') container = document.querySelector(container);
      this.scale = options.scale || 1;
      this.state = options.state || 'explain';
      this.talking = options.talking !== undefined ? Boolean(options.talking) : false;
      this.time = 0;

      this.wrapper = document.createElement('div');
      this.wrapper.style.cssText = `width:${220 * this.scale}px;height:${250 * this.scale}px;display:inline-block;position:relative;user-select:none;`;
      if (container) {
        if (container instanceof HTMLCanvasElement && container.parentElement) {
          container.parentElement.replaceChild(this.wrapper, container);
        } else {
          container.innerHTML = '';
          container.appendChild(this.wrapper);
        }
      }
      this.initSVG();
      this.setState(this.state, this.talking);
    }

    initSVG() {
      this.wrapper.innerHTML = `
        <svg viewBox="0 0 220 250" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
          <defs>
            <radialGradient id="magicGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#e0f2fe" stop-opacity="0.95"/>
              <stop offset="50%" stop-color="#38bdf8" stop-opacity="0.6"/>
              <stop offset="100%" stop-color="#0284c7" stop-opacity="0"/>
            </radialGradient>
            <linearGradient id="hairGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#6f86e8"/>
              <stop offset="100%" stop-color="#485bc2"/>
            </linearGradient>
            <linearGradient id="cloakGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#b5966e"/>
              <stop offset="100%" stop-color="#8c6f4d"/>
            </linearGradient>
          </defs>
          <ellipse id="rx-shadow" cx="105" cy="234" rx="44" ry="8" fill="rgba(2,6,23,0.55)"/>
          <g id="rx-root">
            <path d="M 66,85 Q 55,130 68,165 Q 105,172 142,165 Q 155,130 144,85 Z" fill="#3b4ba3" stroke="#1e1b2e" stroke-width="2.5"/>
            <g id="rx-braid" style="transform-origin: 132px 110px;">
              <ellipse cx="140" cy="122" rx="9" ry="11" fill="url(#hairGrad)" stroke="#1e1b2e" stroke-width="2.2"/>
              <ellipse cx="144" cy="138" rx="8.5" ry="10" fill="url(#hairGrad)" stroke="#1e1b2e" stroke-width="2.2"/>
              <ellipse cx="147" cy="153" rx="8" ry="9.5" fill="url(#hairGrad)" stroke="#1e1b2e" stroke-width="2.2"/>
              <ellipse cx="149" cy="167" rx="7" ry="8.5" fill="url(#hairGrad)" stroke="#1e1b2e" stroke-width="2.2"/>
              <path d="M 149,174 L 138,169 L 140,179 Z M 149,174 L 160,169 L 158,179 Z" fill="#1e1d24" stroke="#0f172a" stroke-width="1.5"/>
              <path d="M 147,175 L 143,188 M 151,175 L 156,188" stroke="#1e1d24" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M 145,175 Q 149,195 156,198 Q 155,183 152,175 Z" fill="#5b70d6" stroke="#1e1b2e" stroke-width="2"/>
            </g>
            <path d="M 64,125 Q 48,175 54,204 Q 105,216 156,204 Q 162,175 146,125 Z" fill="#5c4730" stroke="#1e1b2e" stroke-width="2.5"/>
            <g id="rx-legs">
              <rect x="85" y="176" width="14" height="24" rx="4" fill="#ffe9dc" stroke="#1e1b2e" stroke-width="2"/>
              <rect x="85" y="182" width="14" height="5" fill="#26252e"/>
              <rect x="111" y="176" width="14" height="24" rx="4" fill="#ffe9dc" stroke="#1e1b2e" stroke-width="2"/>
              <rect x="111" y="182" width="14" height="5" fill="#26252e"/>
              <path d="M 83,195 L 101,195 L 101,228 L 81,228 Q 81,210 83,195 Z" fill="#f5f2eb" stroke="#1e1b2e" stroke-width="2.2"/>
              <path d="M 81,220 Q 91,215 101,220 L 101,228 L 81,228 Z" fill="#8c6f4d" stroke="#1e1b2e" stroke-width="2"/>
              <circle cx="85" cy="203" r="2" fill="#d97706"/><circle cx="85" cy="210" r="2" fill="#d97706"/>
              <path d="M 109,195 L 127,195 Q 129,210 129,228 L 109,228 Z" fill="#f5f2eb" stroke="#1e1b2e" stroke-width="2.2"/>
              <path d="M 109,220 Q 119,215 129,220 L 129,228 L 109,228 Z" fill="#8c6f4d" stroke="#1e1b2e" stroke-width="2"/>
              <circle cx="125" cy="203" r="2" fill="#d97706"/><circle cx="125" cy="210" r="2" fill="#d97706"/>
            </g>
            <g id="rx-torso">
              <path d="M 78,150 L 132,150 L 138,182 L 72,182 Z" fill="#292833" stroke="#1e1b2e" stroke-width="2.2"/>
              <path d="M 88,122 L 122,122 L 126,178 L 116,178 L 113,148 L 97,148 L 94,178 L 84,178 Z" fill="#f0ece1" stroke="#1e1b2e" stroke-width="1.8"/>
              <path d="M 78,118 Q 60,155 58,198 L 82,198 Q 86,162 93,124 Z" fill="url(#cloakGrad)" stroke="#1e1b2e" stroke-width="2.2"/>
              <path d="M 60,193 L 82,193 L 91,130" fill="none" stroke="#f0ece1" stroke-width="3.5"/>
              <path d="M 132,118 Q 150,155 152,198 L 128,198 Q 124,162 117,124 Z" fill="url(#cloakGrad)" stroke="#1e1b2e" stroke-width="2.2"/>
              <path d="M 150,193 L 128,193 L 119,130" fill="none" stroke="#f0ece1" stroke-width="3.5"/>
              <g id="rx-chest-straps">
                <rect x="94" y="126" width="22" height="6" rx="2" fill="#f5f2eb" stroke="#1e1b2e" stroke-width="1.6"/>
                <circle cx="97" cy="129" r="1.5" fill="#1e1d24"/><circle cx="113" cy="129" r="1.5" fill="#1e1d24"/>
                <rect x="94" y="135" width="22" height="6" rx="2" fill="#f5f2eb" stroke="#1e1b2e" stroke-width="1.6"/>
                <circle cx="97" cy="138" r="1.5" fill="#1e1d24"/><circle cx="113" cy="138" r="1.5" fill="#1e1d24"/>
                <rect x="94" y="144" width="22" height="6" rx="2" fill="#f5f2eb" stroke="#1e1b2e" stroke-width="1.6"/>
                <circle cx="97" cy="147" r="1.5" fill="#1e1d24"/><circle cx="113" cy="147" r="1.5" fill="#1e1d24"/>
              </g>
              <path d="M 74,114 Q 62,132 58,152 L 92,156 L 96,120 Z" fill="url(#cloakGrad)" stroke="#1e1b2e" stroke-width="2.2"/>
              <path d="M 59,148 L 91,152" stroke="#f0ece1" stroke-width="3.5"/>
              <path d="M 136,114 Q 148,132 152,152 L 118,156 L 114,120 Z" fill="url(#cloakGrad)" stroke="#1e1b2e" stroke-width="2.2"/>
              <path d="M 151,148 L 119,152" stroke="#f0ece1" stroke-width="3.5"/>
              <path d="M 76,108 L 94,122 L 105,118 L 116,122 L 134,108 L 128,124 L 82,124 Z" fill="#c4a882" stroke="#1e1b2e" stroke-width="2.2"/>
            </g>
            <g id="rx-arm-left" style="transform-origin: 72px 132px;">
              <path d="M 66,132 L 54,162 L 68,166 L 76,138 Z" fill="#f5f2eb" stroke="#1e1b2e" stroke-width="2"/>
              <rect x="52" y="156" width="16" height="8" rx="2" transform="rotate(14 60 160)" fill="#26252e" stroke="#1e1b2e" stroke-width="1.8"/>
              <circle cx="58" cy="167" r="5.5" fill="#ffe9dc" stroke="#1e1b2e" stroke-width="1.8"/>
            </g>
            <g id="rx-arm-right" style="transform-origin: 138px 132px;">
              <g id="rx-staff">
                <line x1="162" y1="62" x2="156" y2="226" stroke="#cbd5e1" stroke-width="5" stroke-linecap="round"/>
                <circle id="rx-staff-glow" cx="162" cy="56" r="24" fill="url(#magicGlow)" opacity="0"/>
                <path d="M 152,66 Q 162,74 172,66 L 168,56 L 156,56 Z" fill="#94a3b8" stroke="#1e1b2e" stroke-width="2"/>
                <polygon id="rx-staff-gem" points="162,40 172,54 162,64 152,54" fill="#38bdf8" stroke="#1e1b2e" stroke-width="2"/>
                <polygon points="162,43 168,53 162,59" fill="#bae6fd"/>
              </g>
              <path d="M 134,136 L 154,152 L 162,142 L 142,128 Z" fill="#f5f2eb" stroke="#1e1b2e" stroke-width="2"/>
              <rect x="148" y="140" width="14" height="8" rx="2" transform="rotate(-35 155 144)" fill="#26252e" stroke="#1e1b2e" stroke-width="1.8"/>
              <circle cx="159" cy="147" r="5.5" fill="#ffe9dc" stroke="#1e1b2e" stroke-width="1.8"/>
            </g>
            <g id="rx-head" style="transform-origin: 105px 112px;">
              <path d="M 68,66 Q 66,106 85,115 Q 105,122 125,115 Q 144,106 142,66 Z" fill="#ffe9dc" stroke="#1e1b2e" stroke-width="2.4"/>
              <ellipse id="rx-blush-l" cx="79" cy="98" rx="6.5" ry="3.5" fill="#fda4af" opacity="0.65"/>
              <ellipse id="rx-blush-r" cx="131" cy="98" rx="6.5" ry="3.5" fill="#fda4af" opacity="0.65"/>
              <g id="rx-eyes-normal">
                <path d="M 74,82 Q 83,77 92,83" fill="none" stroke="#1e1b2e" stroke-width="3.2" stroke-linecap="round"/>
                <rect x="77" y="82" width="12" height="14" rx="6" fill="#1e3a8a"/>
                <rect x="78" y="84" width="10" height="11" rx="5" fill="#3b82f6"/>
                <ellipse cx="83" cy="91" rx="3.5" ry="3.5" fill="#93c5fd"/>
                <circle cx="80" cy="85" r="2.6" fill="#ffffff"/><circle cx="86" cy="92" r="1.2" fill="#ffffff"/>
                <path d="M 118,83 Q 127,77 136,82" fill="none" stroke="#1e1b2e" stroke-width="3.2" stroke-linecap="round"/>
                <rect x="121" y="82" width="12" height="14" rx="6" fill="#1e3a8a"/>
                <rect x="122" y="84" width="10" height="11" rx="5" fill="#3b82f6"/>
                <ellipse cx="127" cy="91" rx="3.5" ry="3.5" fill="#93c5fd"/>
                <circle cx="124" cy="85" r="2.6" fill="#ffffff"/><circle cx="130" cy="92" r="1.2" fill="#ffffff"/>
              </g>
              <g id="rx-eyes-closed" style="display:none;">
                <path d="M 74,90 Q 83,95 92,89" fill="none" stroke="#1e1b2e" stroke-width="3" stroke-linecap="round"/>
                <path d="M 118,89 Q 127,95 136,90" fill="none" stroke="#1e1b2e" stroke-width="3" stroke-linecap="round"/>
              </g>
              <g id="rx-eyes-happy" style="display:none;">
                <path d="M 74,91 Q 83,80 92,91" fill="none" stroke="#1e1b2e" stroke-width="3.2" stroke-linecap="round"/>
                <path d="M 118,91 Q 127,80 136,91" fill="none" stroke="#1e1b2e" stroke-width="3.2" stroke-linecap="round"/>
              </g>
              <g id="rx-eyes-shock" style="display:none;">
                <ellipse cx="83" cy="89" rx="7.5" ry="8.5" fill="#ffffff" stroke="#1e1b2e" stroke-width="2.5"/>
                <circle cx="83" cy="89" r="3.5" fill="#2563eb"/><circle cx="81" cy="87" r="1.5" fill="#ffffff"/>
                <ellipse cx="127" cy="89" rx="7.5" ry="8.5" fill="#ffffff" stroke="#1e1b2e" stroke-width="2.5"/>
                <circle cx="127" cy="89" r="3.5" fill="#2563eb"/><circle cx="125" cy="87" r="1.5" fill="#ffffff"/>
              </g>
              <g id="rx-mouth-group">
                <path id="rx-mouth-calm" d="M 101,106 Q 105,107 109,106" fill="none" stroke="#9f584a" stroke-width="2.2" stroke-linecap="round"/>
                <path id="rx-mouth-talk" d="M 100,104 Q 105,113 110,104 Z" fill="#f43f5e" stroke="#9f584a" stroke-width="1.8" style="display:none;"/>
                <ellipse id="rx-mouth-o" cx="105" cy="107" rx="4" ry="4.5" fill="#f43f5e" stroke="#9f584a" stroke-width="1.8" style="display:none;"/>
                <path id="rx-mouth-wavy" d="M 98,107 Q 101.5,104 105,107 Q 108.5,110 112,107" fill="none" stroke="#9f584a" stroke-width="2.2" stroke-linecap="round" style="display:none;"/>
              </g>
              <path d="M 60,74 Q 58,40 105,38 Q 152,40 150,74 Q 156,82 162,85 Q 148,92 142,84 L 140,108 Q 134,92 135,74 Q 128,86 122,90 Q 120,74 114,68 Q 110,85 105,89 Q 100,85 96,68 Q 90,74 88,90 Q 82,86 75,74 Q 76,92 70,108 L 68,84 Q 62,92 48,85 Q 54,82 60,74 Z" fill="url(#hairGrad)" stroke="#1e1b2e" stroke-width="2.4" stroke-linejoin="round"/>
              <path d="M 78,56 Q 92,50 102,55 M 112,55 Q 124,50 134,57" fill="none" stroke="#93bbf5" stroke-width="3.5" stroke-linecap="round" opacity="0.8"/>
              <line id="rx-brow-l" x1="74" y1="74" x2="90" y2="75" stroke="#1e1b2e" stroke-width="2.6" stroke-linecap="round"/>
              <line id="rx-brow-r" x1="120" y1="75" x2="136" y2="74" stroke="#1e1b2e" stroke-width="2.6" stroke-linecap="round"/>
              <g id="rx-ahoge" style="transform-origin: 105px 39px;">
                <path d="M 105,39 Q 112,14 128,22 Q 116,24 109,39 Z" fill="#6f86e8" stroke="#1e1b2e" stroke-width="2.2" stroke-linejoin="round"/>
              </g>
            </g>
            <g id="rx-fx-warn" style="display:none; transform-origin: 48px 55px;">
              <rect x="34" y="34" width="28" height="36" rx="8" fill="#ef4444" stroke="#ffffff" stroke-width="2.5"/>
              <rect x="45" y="40" width="6" height="14" rx="3" fill="#ffffff"/>
              <circle cx="48" cy="61" r="3.2" fill="#ffffff"/>
            </g>
            <g id="rx-fx-blocked" style="display:none;">
              <path d="M 140,48 Q 145,26 150,48 A 6,6 0 1,1 140,48 Z" fill="#38bdf8" stroke="#1e3a8a" stroke-width="2"/>
              <path d="M 42,42 Q 35,42 35,35 Q 35,28 44,28 Q 48,20 58,22 Q 68,20 70,29 Q 78,30 76,37 Q 76,42 68,42 Z" fill="#475569" stroke="#1e293b" stroke-width="2"/>
            </g>
            <g id="rx-fx-surprised" style="display:none;">
              <path d="M 46,48 L 58,56 M 42,64 L 56,66 M 164,48 L 152,56" stroke="#facc15" stroke-width="3.5" stroke-linecap="round"/>
            </g>
            <g id="rx-fx-panic" style="display:none;">
              <ellipse cx="46" cy="58" rx="4" ry="6" transform="rotate(-30 46 58)" fill="#60a5fa"/>
              <ellipse cx="164" cy="58" rx="4" ry="6" transform="rotate(30 164 58)" fill="#60a5fa"/>
              <circle cx="52" cy="44" r="3" fill="#93c5fd"/>
            </g>
            <g id="rx-fx-stars" style="display:none;">
              <path d="M 45,65 L 48,73 L 56,76 L 48,79 L 45,87 L 42,79 L 34,76 L 42,73 Z" fill="#fde047" stroke="#ca8a04" stroke-width="1"/>
              <path d="M 178,85 L 180,91 L 186,93 L 180,95 L 178,101 L 176,95 L 170,93 L 176,91 Z" fill="#fde047" stroke="#ca8a04" stroke-width="1"/>
              <circle cx="162" cy="32" r="3.5" fill="#7dd3fc"/>
              <circle cx="180" cy="52" r="2.5" fill="#bae6fd"/>
            </g>
          </g>
        </svg>
      `;
      this.q = (sel) => this.wrapper.querySelector(sel);
    }

    setState(newState, isTalking = this.talking) {
      this.state = newState;
      this.talking = Boolean(isTalking);
      this.render(this.time);
    }

    setTalking(isTalking) {
      this.talking = Boolean(isTalking);
      this.render(this.time);
    }

    update(timeInSeconds) {
      this.time = timeInSeconds;
      this.render(this.time);
    }

    render(t) {
      const st = this.state;
      const isBlink = (t % 3.8) > 3.64;

      const eyesNormal = this.q('#rx-eyes-normal');
      const eyesClosed = this.q('#rx-eyes-closed');
      const eyesHappy = this.q('#rx-eyes-happy');
      const eyesShock = this.q('#rx-eyes-shock');
      eyesNormal.style.display = 'none';
      eyesClosed.style.display = 'none';
      eyesHappy.style.display = 'none';
      eyesShock.style.display = 'none';

      if (st === 'blocked') eyesClosed.style.display = 'block';
      else if (st === 'success') eyesHappy.style.display = 'block';
      else if (st === 'surprised' || st === 'panic') eyesShock.style.display = 'block';
      else {
        if (isBlink) eyesClosed.style.display = 'block';
        else eyesNormal.style.display = 'block';
      }

      const browL = this.q('#rx-brow-l');
      const browR = this.q('#rx-brow-r');
      if (st === 'warn') {
        browL.setAttribute('y1', '71'); browL.setAttribute('y2', '77');
        browR.setAttribute('y1', '77'); browR.setAttribute('y2', '71');
      } else if (st === 'blocked' || st === 'panic') {
        browL.setAttribute('y1', '77'); browL.setAttribute('y2', '72');
        browR.setAttribute('y1', '72'); browR.setAttribute('y2', '77');
      } else if (st === 'surprised' || st === 'success') {
        browL.setAttribute('y1', '69'); browL.setAttribute('y2', '70');
        browR.setAttribute('y1', '70'); browR.setAttribute('y2', '69');
      } else {
        browL.setAttribute('y1', '74'); browL.setAttribute('y2', '75');
        browR.setAttribute('y1', '75'); browR.setAttribute('y2', '74');
      }

      const mCalm = this.q('#rx-mouth-calm');
      const mTalk = this.q('#rx-mouth-talk');
      const mO = this.q('#rx-mouth-o');
      const mWavy = this.q('#rx-mouth-wavy');
      mCalm.style.display = 'none'; mTalk.style.display = 'none';
      mO.style.display = 'none'; mWavy.style.display = 'none';

      const mouthOpenBeat = this.talking && (Math.sin(t * 20) > -0.1);
      if (st === 'surprised') mO.style.display = 'block';
      else if (st === 'panic' || st === 'blocked') {
        if (mouthOpenBeat) mO.style.display = 'block';
        else mWavy.style.display = 'block';
      } else if (st === 'success') mTalk.style.display = 'block';
      else {
        if (mouthOpenBeat) mTalk.style.display = 'block';
        else mCalm.style.display = 'block';
      }

      const breathY = Math.sin(t * 3.2) * 2;
      const talkBounceY = this.talking ? Math.abs(Math.sin(t * 14)) * -3.5 : 0;
      const shakeX = (st === 'warn' || st === 'panic') ? Math.sin(t * 35) * 2.2 : 0;
      const slumpY = st === 'blocked' ? 4 : 0;

      this.q('#rx-root').setAttribute('transform', `translate(${shakeX}, ${breathY + talkBounceY + slumpY})`);

      let headRot = Math.sin(t * 2) * 1.5;
      let ahogeRot = Math.sin(t * 4.5) * 8;
      if (st === 'blocked') { headRot = -6; ahogeRot = 22; }
      if (st === 'surprised') { headRot = 0; ahogeRot = -25; }
      if (st === 'panic') { headRot = Math.sin(t * 22) * 6; ahogeRot = Math.sin(t * 30) * 25; }
      this.q('#rx-head').style.transform = `rotate(${headRot}deg)`;
      this.q('#rx-ahoge').style.transform = `rotate(${ahogeRot}deg)`;
      this.q('#rx-braid').style.transform = `rotate(${Math.sin(t * 2.8) * 4}deg)`;

      let armLRot = Math.sin(t * 3) * 3;
      let armRRot = Math.sin(t * 3) * -3;
      let staffGlowOp = 0;

      if (st === 'explain') {
        armRRot = -22 + Math.sin(t * 6) * 6;
        staffGlowOp = 0.65 + Math.sin(t * 10) * 0.25;
      } else if (st === 'warn') {
        armLRot = 55 + Math.sin(t * 12) * 5;
        armRRot = -10;
      } else if (st === 'blocked') {
        armLRot = -10; armRRot = 12;
      } else if (st === 'surprised') {
        armLRot = 35; armRRot = -25;
      } else if (st === 'panic') {
        armLRot = 45 + Math.sin(t * 25) * 25;
        armRRot = -35 + Math.cos(t * 25) * 25;
      } else if (st === 'success') {
        armLRot = 25;
        armRRot = -32 + Math.sin(t * 5) * 4;
        staffGlowOp = 0.9;
      }

      this.q('#rx-arm-left').style.transform = `rotate(${armLRot}deg)`;
      this.q('#rx-arm-right').style.transform = `rotate(${armRRot}deg)`;
      this.q('#rx-staff-glow').setAttribute('opacity', staffGlowOp);

      this.q('#rx-fx-warn').style.display = st === 'warn' ? 'block' : 'none';
      this.q('#rx-fx-blocked').style.display = st === 'blocked' ? 'block' : 'none';
      this.q('#rx-fx-surprised').style.display = st === 'surprised' ? 'block' : 'none';
      this.q('#rx-fx-panic').style.display = st === 'panic' ? 'block' : 'none';
      this.q('#rx-fx-stars').style.display = (st === 'explain' || st === 'success') ? 'block' : 'none';

      if (st === 'warn') {
        const s = 1 + Math.sin(t * 16) * 0.12;
        this.q('#rx-fx-warn').style.transform = `scale(${s})`;
      }
    }
  }

  global.RoxyPixelAvatar = RoxyPixelAvatar;
})(window);