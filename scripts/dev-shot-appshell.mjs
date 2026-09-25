// Render the interactive App Shell design file and screenshot each workspace by
// clicking its sidebar nav item, so we capture the full target reference set.
import net from 'node:net'; import crypto from 'node:crypto'; import http from 'node:http'; import fs from 'node:fs'
const P=9222, OUT='/tmp/fees-shots'
const hg=p=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:P,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d))}).on('error',rej)})
class WS{constructor(u){const x=new URL(u);this.h=x.hostname;this.p=x.port;this.pa=x.pathname+x.search;this.b=Buffer.alloc(0);this.f=[];this.onmessage=()=>{}}
connect(){return new Promise((res,rej)=>{this.s=net.connect(this.p,this.h,()=>{const k=crypto.randomBytes(16).toString('base64');this.s.write(`GET ${this.pa} HTTP/1.1\r\nHost: ${this.h}:${this.p}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${k}\r\nSec-WebSocket-Version: 13\r\n\r\n`)});let hs=false;this.s.on('data',c=>{if(!hs){const i=c.indexOf('\r\n\r\n');if(i<0)return;hs=true;const r=c.slice(i+4);if(r.length)this._f(r);res();return}this._f(c)});this.s.on('error',rej)})}
_f(c){this.b=Buffer.concat([this.b,c]);while(this.b.length>=2){const b0=this.b[0],b1=this.b[1],fin=(b0&0x80)!==0,op=b0&0x0f;let l=b1&0x7f,o=2;if(l===126){if(this.b.length<4)return;l=this.b.readUInt16BE(2);o=4}else if(l===127){if(this.b.length<10)return;l=Number(this.b.readBigUInt64BE(2));o=10}if(this.b.length<o+l)return;const p=this.b.slice(o,o+l);this.b=this.b.slice(o+l);if(op===8){this.s.end();return}if(op===9)continue;if(op===0||op===1||op===2){this.f.push(p);if(fin){const s=Buffer.concat(this.f).toString('utf8');this.f=[];this.onmessage(s)}}}}
send(str){const p=Buffer.from(str);const l=p.length;let h;if(l<126){h=Buffer.alloc(2);h[1]=0x80|l}else if(l<65536){h=Buffer.alloc(4);h[1]=0x80|126;h.writeUInt16BE(l,2)}else{h=Buffer.alloc(10);h[1]=0x80|127;h.writeBigUInt64BE(BigInt(l),2)}h[0]=0x81;const m=crypto.randomBytes(4);const mk=Buffer.alloc(l);for(let i=0;i<l;i++)mk[i]=p[i]^m[i&3];this.s.write(Buffer.concat([h,m,mk]))}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const ver=JSON.parse(await hg('/json/version'));const ws=new WS(ver.webSocketDebuggerUrl);await ws.connect()
let id=0;const pend=new Map();ws.onmessage=r=>{const m=JSON.parse(r);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}}
const send=(me,pa={},sid)=>new Promise(res=>{const i=++id;pend.set(i,res);const m={id:i,method:me,params:pa};if(sid)m.sessionId=sid;ws.send(JSON.stringify(m))})
const t=(await send('Target.createTarget',{url:'about:blank'})).result.targetId
const sid=(await send('Target.attachToTarget',{targetId:t,flatten:true})).result.sessionId
await send('Page.enable',{},sid);await send('Runtime.enable',{},sid)
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true},sid);return r.result?.result?.value}
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false},sid)
await send('Page.navigate',{url:'file:///Users/aadedeji/Downloads/Fees101/mockup%20redesign/App%20Shell.dc.html'},sid)
await sleep(3500)
// List clickable sidebar items (text) so we know what to drive.
const labels = await ev(`JSON.stringify([...document.querySelectorAll('a,button,[role=button],[data-nav],li')].map(e=>e.textContent.trim()).filter(x=>x&&x.length<24))`)
console.log('candidate labels:', labels)
const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync(`${OUT}/${n}.png`,Buffer.from(r.result.data,'base64'));console.log('saved',n)}
const clickByText=async txt=>ev(`(()=>{const els=[...document.querySelectorAll('a,button,[role=button],[data-nav],span,div,li')];const el=els.find(e=>e.textContent.trim()===${JSON.stringify(txt)}&&e.offsetParent!==null);if(el){el.click();return true}return false})()`)
for (const nav of ['Today','Students','Fees','Money','Discounts','School','Team & Trust']) {
  const ok = await clickByText(nav)
  await sleep(1200)
  await shot('TARGET_'+nav.replace(/[^a-z0-9]/gi,'_'))
  if(!ok) console.log('  (no click target for', nav, '- captured current view)')
}
await send('Target.closeTarget',{targetId:t});ws.s.end()
