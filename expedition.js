'use strict';
// One scheduler for the panorama, particles, and every visible lane sprite.
window.expedition = (() => {
  const canvas = document.getElementById('expedition'), ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const members = new Map(), images = new Map(), visibleRows = new Set();
  let rows = [], sceneVisible = false, paused = false, raf = 0, last = 0, time = 0;
  let width = 0, height = 0, frameCount = 0, lastPaint = -Infinity;
  const picture = src => {
    if (images.has(src)) return images.get(src);
    // Only the game's finite companion collection and three scene images are retained.
    if (images.size >= 64) images.delete(images.keys().next().value);
    const img = new Image(); img.src = src; img.onload = () => { if (!raf) draw(); };
    images.set(src, img); return img;
  };
  const bg = picture('assets/bg-explore.webp');
  const enemies = [picture('assets/enemy-abyss_hound.png'), picture('assets/enemy-alarm_orb.png')];
  const heroName = value => /^[a-z0-9_-]{1,40}$/.test(value || '') ? value : '';
  const stateOf = lane => lane.state === 'done' ? 'done' : lane.state === 'waiting' || Number(lane.idle_sec) >= 60 ? 'thinking' : 'walking';
  function hasFinding(lane, reviews) {
    if (Number(lane.review_findings) > 0 || Number(lane.issues) > 0) return true;
    return reviews.some(r => {
      const linked = String(r.lane_id ?? r.lane ?? '') === String(lane.id);
      return linked && !['done','fixed','passed','완료','수정 완료','통과'].includes(r.state);
    });
  }
  function sync(data) {
    const lanes = Array.isArray(data.lanes) ? data.lanes : [], keep = new Set();
    lanes.forEach((lane, index) => {
      const id = String(lane.id ?? index), state = stateOf(lane), hero = heroName(lane.hero);
      keep.add(id); let member = members.get(id);
      if (!member) { member = {id, hero, state, age: 0, joinAge: 0, x: 1.15 + index * .07, departed: state === 'done'}; members.set(id, member); }
      if (member.state !== state) { member.age = 0; member.departed = false; }
      Object.assign(member, {state, hero, name: lane.name || '이름 없는 작업', finding: hasFinding(lane, Array.isArray(data.reviews) ? data.reviews : [])});
      if (hero) { picture(`assets/${hero}-0.png`); picture(`assets/${hero}-1.png`); }
    });
    for (const id of members.keys()) if (!keep.has(id)) members.delete(id);
    for (const row of rows) observer.unobserve(row);
    visibleRows.clear(); rows = Array.from(document.querySelectorAll('.lane'));
    rows.forEach(row => observer.observe(row));
    const counts = {walking:0, thinking:0, done:0}; members.forEach(m => counts[m.state]++);
    document.getElementById('scene-state').textContent = lanes.length ? `작업 ${counts.walking} · 생각·대기 ${counts.thinking} · 완료 ${counts.done}` : '원정 중인 작업이 없습니다.';
    canvas.setAttribute('aria-label', `원정대. 작업 중 ${counts.walking}명, 생각 또는 대기 ${counts.thinking}명, 완료 ${counts.done}명. 상세 내용은 아래 작업 목록에 있습니다.`);
    draw(); schedule();
  }
  function resize() {
    const box = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    width = box.width; height = box.height;
    canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.imageSmoothingEnabled = false; draw();
  }
  function sprite(img, x, floor, size, flip=false) {
    if (!img || !img.complete || !img.naturalWidth) return;
    const scale = Math.min(size/img.naturalHeight, size/img.naturalWidth);
    const w = Math.round(img.naturalWidth*scale), h = Math.round(img.naturalHeight*scale);
    ctx.save(); ctx.translate(Math.round(x),Math.round(floor)); if(flip) ctx.scale(-1,1);
    ctx.drawImage(img,-Math.round(w/2),-h,w,h); ctx.restore();
  }
  function draw() {
    if (!width || !height) return;
    ctx.clearRect(0,0,width,height); ctx.fillStyle='#242b28';ctx.fillRect(0,0,width,height);
    if (bg.complete && bg.naturalWidth) {
      const tileW=Math.max(width+100, height*bg.naturalWidth/bg.naturalHeight*1.65);
      const tileH=tileW*bg.naturalHeight/bg.naturalWidth, offset=(time*7)%tileW;
      ctx.globalAlpha=.56; ctx.drawImage(bg,-offset,-tileH*.28,tileW,tileH);ctx.drawImage(bg,tileW-offset,-tileH*.28,tileW,tileH);ctx.globalAlpha=1;
    }
    const floor=height-35;
    // Opaque ink ledge keeps silhouettes readable against the existing ruin artwork.
    ctx.fillStyle='#161e1c';ctx.beginPath();ctx.moveTo(0,floor+1);
    for(let x=0;x<=width+24;x+=24)ctx.lineTo(x,floor+3+Math.sin(x*.07)*3);
    ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.fill();
    ctx.fillStyle='#998a68';ctx.fillRect(0,floor+4,width,2);
    const active=Array.from(members.values()).filter(m=>!m.departed);
    const size=Math.min(width<500?68:105, (width-36)/Math.max(active.length,1));
    active.forEach((m,i) => {
      const target=.12+(i+.5)/Math.max(active.length,1)*.72;
      let x=target;
      if(!reduced.matches && !paused) {
        const join=Math.min(1,m.joinAge/2.5);
        x=m.state==='done'?target-Math.max(0,m.age-1.8)*.42:target+(m.x-target)*(1-join);
        if(m.state==='walking')x+=Math.sin(time*1.2+i)*.013;
      }
      const frame=m.state==='done'?1:m.state==='walking'&&!reduced.matches&&!paused?Math.floor(time*3+i)%2:0;
      const y=floor+(m.state==='walking'&&!reduced.matches&&!paused?(frame?0:-3):0);
      sprite(images.get(`assets/${m.hero}-${frame}.png`),x*width,y,size,m.state==='done'&&m.age>1.8);
      if(m.state==='thinking') {
        ctx.fillStyle='#f2e6c5';for(let dot=0;dot<3;dot++)ctx.fillRect(Math.round(x*width-9+dot*7),Math.round(y-size-10),3,3);
      }
      if(m.state==='done') {ctx.fillStyle='#d8ac66';ctx.fillRect(Math.round(x*width-12),Math.round(y-size-9),24,3);}
    });
    // Encounters occupy the foreground so the following companion cannot cover them.
    active.forEach((m,i)=>{
      if(!m.finding || time%14>=5)return;
      const x=(.12+(i+.5)/Math.max(active.length,1)*.72)*width;
      const approach=Math.min(1,(time%14)/2), ex=x+size*.6+(1-approach)*width*.35;
      sprite(enemies[Math.floor(time/14)%2],ex,floor+20,size*.65,true);
      ctx.fillStyle='#eeaa87';ctx.fillRect(Math.round(x),Math.round(floor-size-17),3,7);
    });
    // Fixed particle pool: positions are a function of time, with no allocation or trails.
    for(let i=0;i<24;i++) {
      const x=((i*137.7+time*(i%3+1)*4)%Math.max(width,1));
      const y=floor-((i*23+time*9)%Math.max(height-30,1));
      ctx.fillStyle=i%4===0?'#d5a26b88':'#e3d7bc44';ctx.fillRect(Math.floor(x),Math.floor(y),i%4===0?2:1,2);
    }
  }
  function paintRows() {
    for(const row of visibleRows) {
      const m=members.get(row.dataset.key); if(!m)continue;
      const walking=m.state==='walking'&&!reduced.matches&&!paused;
      const frame=m.state==='done'?1:walking?Math.floor(time*3)%2:0;
      row.dataset.frame=String(frame); row.dataset.motion=m.state;
      const stage=row.querySelector('.sprite-pair');
      if(stage) stage.style.transform=walking?`translate(${Math.round(Math.sin(time*2)*4)}px,${frame?-2:0}px)`:'none';
    }
  }
  function enabled() {return !document.hidden&&!reduced.matches&&!paused&&(sceneVisible||visibleRows.size>0);}
  function tick(now) {
    raf=0; if(!enabled()) {last=0;return;}
    if(now-lastPaint>=1000/30) {
      const dt=last?Math.min((now-last)/1000,.1):0;last=now;lastPaint=now;time+=dt;
      // Scene transitions also freeze while its canvas is offscreen.
      if(sceneVisible) { members.forEach(m=>{m.age+=dt;m.joinAge+=dt;if(m.state==='done'&&m.age>4.8)m.departed=true;});draw(); }
      paintRows();frameCount++;
    }
    schedule();
  }
  function schedule() {if(enabled()&&!raf)raf=requestAnimationFrame(tick);else if(!enabled()&&raf){cancelAnimationFrame(raf);raf=0;last=0;}}
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(e=>{if(e.target===canvas)sceneVisible=e.isIntersecting;else if(e.isIntersecting)visibleRows.add(e.target);else visibleRows.delete(e.target);});paintRows();schedule();
  });
  observer.observe(canvas);new ResizeObserver(resize).observe(canvas);
  function motionChange(){schedule();paintRows();draw();}
  reduced.addEventListener('change',motionChange);document.addEventListener('visibilitychange',motionChange);
  document.getElementById('motion-toggle').addEventListener('click',e=>{paused=!paused;e.currentTarget.setAttribute('aria-pressed',String(paused));e.currentTarget.textContent=paused?'움직임 재생':'움직임 멈춤';motionChange();});
  return {sync, stateOf, snapshot:()=>({time,frameCount,running:!!raf,sceneVisible,imageCount:images.size,visibleRows:visibleRows.size,members:Array.from(members.values()).map(m=>({id:m.id,state:m.state,age:m.age,departed:m.departed}))})};
})();
