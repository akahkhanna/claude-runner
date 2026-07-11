import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

export default function ClaudeRunner3D() {
  const mountRef = useRef(null);
  const pctRef = useRef(35);
  const [pct, setPct] = useState(35);
  const [weeklyPct] = useState(42);
  const [simulating, setSimulating] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [resetMs, setResetMs] = useState(2 * 3600000 + 17 * 60000);
  const snoreRef = useRef(null);
  const soundRef = useRef(true);
  const models = [
    { name: 'Opus', pct: 52, color: '#C084FC' },
    { name: 'Sonnet', pct: 28, color: '#60A5FA' },
    { name: 'Fable', pct: 12, color: '#34D399' },
  ];

  // Keep refs in sync
  useEffect(() => { pctRef.current = pct; }, [pct]);
  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);

  // Countdown
  useEffect(() => {
    const iv = setInterval(() => setResetMs(ms => Math.max(0, ms - 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  // Snore
  const startSnore = () => {
    if (snoreRef.current) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 90;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.4;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.15;
      lfo.connect(lfoG); lfoG.connect(gain.gain);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); lfo.start();
      snoreRef.current = { ctx, osc, lfo };
    } catch {}
  };
  const stopSnore = () => {
    if (!snoreRef.current) return;
    try { snoreRef.current.osc.stop(); snoreRef.current.lfo.stop(); snoreRef.current.ctx.close(); } catch {}
    snoreRef.current = null;
  };

  useEffect(() => {
    if (pct >= 100 && soundOn) startSnore(); else stopSnore();
    return stopSnore;
  }, [pct >= 100, soundOn]);

  // ═══ Three.js — created once, never recreated ═══
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a24);
    const camera = new THREE.PerspectiveCamera(40, 280 / 180, 0.1, 100);
    camera.position.set(-0.4, 0.2, 6.2);
    camera.lookAt(0, -0.3, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(280, 180);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x8888aa, 0.7));
    const dl = new THREE.DirectionalLight(0xffeedd, 1.1);
    dl.position.set(3, 5, 4); scene.add(dl);

    const wMat = new THREE.MeshStandardMaterial({ color: 0x4a4a5a, metalness: 0.5, roughness: 0.35 });
    const sMat = new THREE.MeshStandardMaterial({ color: 0x5a5a6a, metalness: 0.4, roughness: 0.5 });

    // Wheel drum
    const R = 1.6, D = 0.55;
    const wheelG = new THREE.Group(); scene.add(wheelG);
    for (const z of [-D, D]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.07, 8, 32), wMat);
      ring.position.z = z;
      wheelG.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, R - 0.2, 4), sMat);
        sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, z);
        sp.rotation.z = a + Math.PI / 2; wheelG.add(sp);
      }
    }
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, D * 2, 10), wMat);
    hb.rotation.x = Math.PI / 2; wheelG.add(hb);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, D * 2, 3), sMat);
      rg.position.set(Math.cos(a) * (R - 0.08), Math.sin(a) * (R - 0.08), 0);
      rg.rotation.x = Math.PI / 2; wheelG.add(rg);
    }

    // Arc
    const arcG = new THREE.Group(); scene.add(arcG);
    let arcPct = -1;
    const aM = {
      g: new THREE.MeshStandardMaterial({ color: 0x34D399, emissive: 0x34D399, emissiveIntensity: 0.25, transparent: true, opacity: 0.7 }),
      y: new THREE.MeshStandardMaterial({ color: 0xFBBF24, emissive: 0xFBBF24, emissiveIntensity: 0.25, transparent: true, opacity: 0.7 }),
      r: new THREE.MeshStandardMaterial({ color: 0xF87171, emissive: 0xF87171, emissiveIntensity: 0.25, transparent: true, opacity: 0.7 }),
    };
    function updateArc(p) {
      const rp = Math.round(p);
      if (rp === arcPct) return;
      arcPct = rp;
      while (arcG.children.length) { const c = arcG.children[0]; c.geometry.dispose(); arcG.remove(c); }
      if (rp <= 0) return;
      const ang = (rp / 100) * Math.PI * 2;
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(R, 0.11, 6, Math.max(3, Math.floor(ang * 6)), ang),
        rp >= 90 ? aM.r : rp >= 70 ? aM.y : aM.g
      );
      m.rotation.z = Math.PI / 2; m.position.z = D + 0.02; arcG.add(m);
    }
    updateArc(35);

    // Stand — legs spread wide so they don't block the hamster
    const stMat = new THREE.MeshStandardMaterial({ color: 0x3a3a4a, metalness: 0.3, roughness: 0.5 });
    for (const z of [-D - 0.08, D + 0.08]) {
      for (const x of [-1, 1]) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.5, 5), stMat);
        l.position.set(x * 0.85, -1.35, z); l.rotation.z = x * 0.45; scene.add(l);
      }
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 5), stMat);
      b.position.set(0, -1.95, z); b.rotation.z = Math.PI / 2; scene.add(b);
    }

    // Hamster — single body mesh with painted texture (no overlapping patches)
    const hG = new THREE.Group();
    hG.position.set(0, -1.1, 0); hG.rotation.y = 0; hG.scale.setScalar(0.7);
    scene.add(hG);

    // Paint the fur as a texture: golden top → white belly, white face zone
    const cnv = document.createElement('canvas');
    cnv.width = 256; cnv.height = 128;
    const cx = cnv.getContext('2d');
    // Vertical gradient: golden back (top) to white belly (bottom)
    const grad = cx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#B87F42');
    grad.addColorStop(0.45, '#CE9556');
    grad.addColorStop(0.62, '#E8CBA0');
    grad.addColorStop(0.75, '#F5EFE6');
    grad.addColorStop(1, '#FAF6EF');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 256, 128);
    // Soft white face/muzzle zone (front of the body maps to u≈0.5 region)
    const fg = cx.createRadialGradient(128, 84, 4, 128, 84, 42);
    fg.addColorStop(0, '#FAF6EF');
    fg.addColorStop(0.7, 'rgba(250,246,239,0.85)');
    fg.addColorStop(1, 'rgba(250,246,239,0)');
    cx.fillStyle = fg;
    cx.fillRect(60, 30, 136, 98);
    const furTex = new THREE.CanvasTexture(cnv);

    const furMat2 = new THREE.MeshStandardMaterial({ map: furTex, roughness: 0.95 });
    const pinkInner = new THREE.MeshStandardMaterial({ color: 0xE8A5A0, roughness: 0.9 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xF5EFE6, roughness: 0.95 });
    const goldenMat = new THREE.MeshStandardMaterial({ color: 0xC98B4E, roughness: 0.95 });

    // Body + head with the exact 2D widget proportions:
    // body ellipse 10.5x7.5, head r7.5 at (-9,-3) overlapping, ears 3.2x4.2
    // Scale: 2D unit ≈ 0.048 in 3D
    const U = 0.048;
    // Body — oval like the 2D (10.5 x 7.5 x 7)
    const bod = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 20).scale(10.5*U, 7.5*U, 7*U), furMat2);
    hG.add(bod);
    // Head — nearly as big as the body, overlapping front-top like the 2D
    const hd = new THREE.Mesh(new THREE.SphereGeometry(7.5*U, 20, 16), furMat2);
    hd.position.set(-9*U, 3*U, 0);
    hG.add(hd);

    // Ears — tiny rounded nubs, barely visible (hamster ears are small)
    for (const [ex, s] of [[-13, 1], [-6, -1]]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(1.8*U, 6, 6).scale(1, 1.3, 0.5), goldenMat);
      ear.position.set(ex*U, 8.8*U, s * 2.5*U);
      hG.add(ear);
    }

    // Eyes — 2D at (-12,-4) and (-7,-4) → both sides of head in 3D
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1.5*U, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x14100a, roughness: 0.15 }));
      eye.position.set(-13*U, 4.5*U, s * 5*U); hG.add(eye);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.55*U, 4, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      shine.position.set(-13.6*U, 5*U, s * 4.7*U); hG.add(shine);
    }
    // Nose — 2D at (-9.5,-1.5) front of head
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1*U, 6, 6), pinkInner);
    nose.position.set(-16*U, 1.5*U, 0); hG.add(nose);
    // Whiskers
    const whiskMat = new THREE.LineBasicMaterial({ color: 0xd8d0c4, transparent: true, opacity: 0.5 });
    for (const s of [-1, 1]) {
      for (const dy of [-0.03, 0.02, 0.06]) {
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-15*U, 1.5*U + dy, s * 1.5*U),
          new THREE.Vector3(-19*U, dy * 2.5, s * 7*U),
        ]);
        hG.add(new THREE.Line(g, whiskMat));
      }
    }

    // Tail — 2D has a small curl at (9,2)
    const tl = new THREE.Mesh(new THREE.SphereGeometry(1.4*U, 6, 6), whiteMat);
    tl.position.set(11*U, 2*U, 0); hG.add(tl);

    // Legs — short stubby paws, not sticks
    const lgs = [];
    for (const [x, z] of [[-6, 4], [-3, -4], [5, 4], [2, -4]]) {
      const paw = new THREE.Mesh(new THREE.SphereGeometry(1.8*U, 8, 8).scale(1, 1.4, 0.8), goldenMat);
      paw.position.set(x*U, -7.5*U, z*U); hG.add(paw); lgs.push(paw);
    }

    // Ground
    const gnd = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x15151f }));
    gnd.rotation.x = -Math.PI / 2;
    gnd.position.y = -2.0;
    scene.add(gnd);

    let t = 0, lastTs = 0, raf;
    function loop(ts) {
      raf = requestAnimationFrame(loop);
      if (ts - lastTs < 33) return;
      const dt = Math.min((ts - lastTs) / 1000, 0.1);
      lastTs = ts; t += dt;
      const p = pctRef.current;
      const exh = p >= 100;
      const spd = exh ? 0 : p >= 90 ? 3 : p >= 60 ? 2 : p >= 20 ? 1 : 0.5;
      const wrs = 0.7 + spd * 1.3;

      if (!exh) wheelG.rotation.z += dt * wrs;
      updateArc(p);

      if (!exh) {
        const sr = wrs * 0.7, st2 = t * sr;
        hG.position.y = -1.1 + Math.abs(Math.sin(st2 * Math.PI * 2)) * (0.02 + spd * 0.012);
        hG.rotation.z = spd >= 2 ? Math.sin(st2 * Math.PI * 2) * 0.02 : 0;
        hG.rotation.y = 0;

        // Elliptical run cycle: each foot traces an ellipse
        // (forward on the ground = drive, lifted circle back = recovery)
        const strideLen = 0.08 + spd * 0.04;
        const liftH = 0.04 + spd * 0.02;
        const cyc = st2 * Math.PI * 2;
        const phases = [0, Math.PI, Math.PI, 0];
        const baseX = [-6*U, -3*U, 5*U, 2*U];
        for (let i = 0; i < 4; i++) {
          const ph = cyc + phases[i];
          const fx = Math.cos(ph) * strideLen;
          const fy = Math.max(0, Math.sin(ph)) * liftH;
          lgs[i].position.x = baseX[i] + fx;
          lgs[i].position.y = -7.5*U + fy;
        }
      } else {
        hG.rotation.z = THREE.MathUtils.lerp(hG.rotation.z, 0.4, dt * 2);
        hG.position.y = -1.15; hG.rotation.y = 0;
        lgs.forEach((l, i) => { l.position.y = -7*U; });
      }
      tl.rotation.y = Math.sin(t * 2) * 0.2;
      camera.position.x = -0.4 + Math.sin(t * 0.15) * 0.06;
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); renderer.dispose(); if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement); };
  }, []);

  const simulateBurn = () => {
    if (simulating) return; setSimulating(true);
    let p = pct;
    const iv = setInterval(() => {
      p += 3 + Math.random() * 4;
      if (p >= 100) { setPct(100); clearInterval(iv);
        setTimeout(() => { setPct(3); setResetMs(5 * 3600000); stopSnore();
          if (soundRef.current) { try { const ctx = new AudioContext(); [523.25,659.25,783.99,1046.5].forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,ctx.currentTime+i*.12);g.gain.linearRampToValueAtTime(.18,ctx.currentTime+i*.12+.03);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+i*.12+.5);o.connect(g).connect(ctx.destination);o.start(ctx.currentTime+i*.12);o.stop(ctx.currentTime+i*.12+.5);}); } catch {} }
          setTimeout(() => setSimulating(false), 3000);
        }, 3500);
      } else setPct(Math.round(p));
    }, 400);
  };

  const col = pct >= 90 ? '#F87171' : pct >= 70 ? '#FBBF24' : '#34D399';
  const wcol = weeklyPct >= 90 ? '#F87171' : weeklyPct >= 70 ? '#FBBF24' : '#34D399';
  const exh = pct >= 100;
  const fmt = ms => { if (ms<=0) return '0:00'; const h=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000),s=Math.floor((ms%60000)/1000); return h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`; };

  return (
    <div style={{ width:280, margin:'16px auto', fontFamily:'-apple-system,system-ui,sans-serif', userSelect:'none' }}>
      <div style={{ background:'rgba(24,24,30,0.97)', borderRadius:14, border:'1px solid rgba(255,255,255,0.07)', boxShadow:'0 8px 30px rgba(0,0,0,0.5)', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 12px 5px', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.75)' }}>🐹 Claude Runner</span>
          <button onClick={()=>{const n=!soundOn;setSoundOn(n);if(!n)stopSnore();else if(pct>=100)startSnore();}} style={{ background:'none',border:'none',cursor:'pointer',fontSize:12,color:soundOn?'#5B8DEF':'rgba(255,255,255,0.15)' }}>{soundOn?'🔔':'🔕'}</button>
        </div>
        <div ref={mountRef} style={{ width:280, height:180 }} />
        <div style={{ textAlign:'center', padding:'1px 12px 4px', fontSize:10, color:'rgba(255,255,255,0.4)', fontWeight:500 }}>{exh?'💤 Collapsed…':pct>=90?'🏃 Sprinting!':pct>=60?'😤 Running hard':pct>=20?'🐹 Jogging':'✨ Fresh'}</div>
        <div style={{ margin:'0 12px 5px', padding:'6px 8px', borderRadius:8, textAlign:'center', background:exh?'rgba(248,113,113,0.08)':'rgba(255,255,255,0.03)', border:`1px solid ${exh?'rgba(248,113,113,0.12)':'rgba(255,255,255,0.04)'}` }}>
          <div style={{ fontSize:22, fontWeight:700, letterSpacing:-1, fontVariantNumeric:'tabular-nums', fontFamily:"ui-monospace,'SF Mono',Menlo,monospace", color:exh?'#F87171':'rgba(255,255,255,0.85)' }}>{fmt(resetMs)}</div>
          <div style={{ fontSize:9, color:'rgba(255,255,255,0.35)', marginTop:1, textTransform:'uppercase', letterSpacing:0.6 }}>{exh?'Until session restores':'Session reset countdown'}</div>
        </div>
        <div style={{ padding:'0 12px 6px' }}>
          <div style={{ marginBottom:5 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}><span style={{ fontSize:9, color:'rgba(255,255,255,0.45)' }}>Session (5h)</span><span style={{ fontSize:9, fontWeight:600, color:col, fontVariantNumeric:'tabular-nums' }}>{pct}%</span></div>
            <div style={{ height:5, borderRadius:3, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}><div style={{ width:`${Math.min(pct,100)}%`, height:'100%', borderRadius:3, background:col, transition:'width 0.4s' }} /></div>
          </div>
          <div style={{ marginBottom:5 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}><span style={{ fontSize:9, color:'rgba(255,255,255,0.45)' }}>Weekly (7d)</span><span style={{ fontSize:9, fontWeight:600, color:wcol, fontVariantNumeric:'tabular-nums' }}>{weeklyPct}%</span></div>
            <div style={{ height:5, borderRadius:3, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}><div style={{ width:`${weeklyPct}%`, height:'100%', borderRadius:3, background:wcol, transition:'width 0.4s' }} /></div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', marginTop:3, fontWeight:500 }}>↻ Resets in 3d 22h</div>
          </div>
          <div style={{ paddingTop:5, borderTop:'1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize:8, color:'rgba(255,255,255,0.3)', textTransform:'uppercase', letterSpacing:0.6, marginBottom:4 }}>By model · weekly</div>
            {models.map(m=><div key={m.name} style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3 }}>
              <span style={{ fontSize:8, color:'rgba(255,255,255,0.5)', width:38, flexShrink:0 }}>{m.name}</span>
              <div style={{ flex:1, height:4, borderRadius:2, background:'rgba(255,255,255,0.06)', overflow:'hidden' }}><div style={{ width:`${m.pct}%`, height:'100%', borderRadius:2, background:m.color }} /></div>
              <span style={{ fontSize:8, fontWeight:600, color:m.color, width:22, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{m.pct}%</span>
            </div>)}
          </div>
        </div>
        <div style={{ padding:'4px 12px 8px', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
          <button onClick={simulateBurn} disabled={simulating} style={{ width:'100%', padding:'6px 0', borderRadius:7, background:simulating?'rgba(91,141,239,0.06)':'rgba(91,141,239,0.1)', border:'1px solid rgba(91,141,239,0.12)', color:simulating?'rgba(91,141,239,0.35)':'#5B8DEF', fontSize:10, fontWeight:500, cursor:simulating?'wait':'pointer' }}>
            {simulating?(exh?'💤 Waking soon…':'🔥 Burning…'):'▶ Simulate burn → collapse → reset'}
          </button>
        </div>
      </div>
    </div>
  );
}
