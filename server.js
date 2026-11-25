// Battle Stations server: zero dependencies. HTTP + Server-Sent Events. Run: node server.js  (PORT env optional)
// The server is the referee: each player only ever receives their OWN fleet plus public information.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const NAMES=['Submarine','Destroyer','Missile Destroyer','Light Cruiser','Battlecruiser','Battleship','Frigate'];
const CNT=[2,2,1,2,2,1,2],PTS=[1,1,3,2,3,2,1];
const BT=[[3,4,5],[0,4,5,6],[0,1,2,3,5],[1,2,6],[1,2,3,5,6],[1,2,3,4,5],[0,1]]; // BT[a] = ship types that type a beats (Table 1)
const LOG_SHIPS=false; // false: the public log names only destroyed ships (survivors stay hidden); true: log every revealed ship type
const AB=['S','D','MD','LC','BC','B','F'];
const SIDE=['Yellow','Blue'];
const games=new Map();
const rnd=n=>crypto.randomBytes(n).toString('hex');
const cleanName=s=>String(s==null?'':s).replace(/[^\p{L}\p{N} _.\-]/gu,'').trim().slice(0,16)||'Player';
const swp=(b,s)=>{b=[...b];if(s[0]>=0&&s[1]>=0)[b[s[0]],b[s[1]]]=[b[s[1]],b[s[0]]];return b};
function shuffle(){const a=[];CNT.forEach((c,t)=>{for(let i=0;i<c;i++)a.push(t)});
  for(let i=11;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
function validBoard(b){return Array.isArray(b)&&b.length===12&&CNT.every((c,t)=>b.filter(x=>x===t).length===c)}
function newGame(name,priv){
  return{id:rnd(3).toUpperCase(),status:'waiting',names:[name,''],seats:[rnd(8),null],made:0,priv:!!priv,
    boards:[shuffle(),shuffle()],ready:[0,0],turn:1,orders:[null,null],ev:[5,5],des:[[],[]],
    rep:null,repN:0,phase:'orders',proceed:[0,0],log:[],winner:null,why:'',clients:[],born:Date.now(),t:Date.now()}}
const L=v=>Number.isInteger(v)&&v>=0&&v<12,NL=v=>v===-1||L(v);
function checkOrders(g,s,o){ // returns normalised orders or an error string
  if(!o||typeof o!=='object')return'Bad orders';
  const sw=Array.isArray(o.swap)&&o.swap.length===2?[o.swap[0],o.swap[1]]:[-1,-1];
  if(!NL(sw[0])||!NL(sw[1])||(sw[0]<0)!==(sw[1]<0))return'Bad swap';
  if(sw[0]>=0){if(g.turn<2)return'No swapping in turn one';if(sw[0]===sw[1])return'Pick two different ships';
    if(g.boards[s][sw[0]]<0||g.boards[s][sw[1]]<0)return'Ships can only swap with other ships'}
  const b=swp(g.boards[s],sw),r={swap:sw,f1:-1,f2:-1,ev:-1,t1:-1,t2:-1};
  for(const k of[1,2]){const f=o['f'+k],t=o['t'+k];if(!NL(f)||!NL(t))return'Bad orders';
    if(f>=0){if(b[f]<0)return'A Fire token needs a ship on its lane';if(t<0)return'Aim Fire '+k+' at an enemy lane';r['f'+k]=f;r['t'+k]=t}}
  if(r.f1>=0&&r.f1===r.f2)return'Fire 1 and Fire 2 cannot be on the same lane';
  if(!NL(o.ev))return'Bad orders';
  if(o.ev>=0){if(b[o.ev]<0)return'Evasion needs a ship on its lane';if(o.ev===r.f1||o.ev===r.f2)return'Evasion cannot share a lane with a Fire token';
    if(g.ev[s]<1)return'No Evasion tokens left';r.ev=o.ev}
  return r}
function resolve(g){
  const O=g.orders,b=[0,1].map(p=>swp(g.boards[p],O[p].swap)),rep=[];
  for(const p of[0,1])if(O[p].ev>=0)g.ev[p]--;
  for(const k of[1,2]){const kills=[];
    for(const p of[0,1]){const q=1-p,Lf=O[p]['f'+k],T=O[p]['t'+k];if(Lf<0||b[p][Lf]<0)continue; // Fire 2 ship destroyed in the Fire 1 phase is gone
      const a=b[p][Lf],d=b[q][T];let res='empty';
      if(d>=0){res=O[q].ev===T?'evaded':BT[a].includes(d)?'destroyed':'survived';if(res==='destroyed')kills.push([q,T,p,d])}
      rep.push({k,p,L:Lf,a,T,d,res})}
    for(const[q,T,p,d]of kills){b[q][T]=-1;g.des[p].push(d)}} // all attacks of a phase are simultaneous; removal after the phase
  const tn=g.turn;g.boards=b;g.orders=[null,null];g.turn++;g.rep=rep;g.repN++;g.phase='results';g.proceed=[0,0];
  g.log.push({h:1,t:'Turn '+tn});
  if(!rep.length)g.log.push({t:'No shots fired.'});
  for(const r of rep){const out=r.res==='empty'?'empty lane':r.res==='destroyed'?'destroyed '+NAMES[r.d]:r.res;
    g.log.push({t:LOG_SHIPS?`Fire ${r.k}: ${SIDE[r.p]} ${AB[r.a]} L${r.L+1} → ${r.d>=0?AB[r.d]+' ':''}L${r.T+1}: ${r.res}`:`Fire ${r.k}: ${SIDE[r.p]} L${r.L+1} → L${r.T+1}: ${out}`})}
  const A=b[0].filter(x=>x>=0),B=b[1].filter(x=>x>=0),sc=p=>g.des[p].reduce((s,t)=>s+PTS[t],0);
  if(!A.length||!B.length){g.winner=A.length?0:B.length?1:-1;g.why=A.length||B.length?'All enemy ships destroyed':'Both fleets destroyed';g.status='over'}
  else if(A.every(a=>B.every(c=>!BT[a].includes(c)&&!BT[c].includes(a)))){ // stalemate: nobody can hurt anybody
    g.winner=sc(0)>sc(1)?0:sc(1)>sc(0)?1:-1;g.why=`Stalemate. Points: Yellow ${sc(0)}, Blue ${sc(1)}`;g.status='over'}
  if(g.status==='over')g.log.push({h:1,t:(g.winner<0?'Draw':SIDE[g.winner]+' wins')+' – '+g.why});}
function act(g,s,p){
  const op=p.op;
  if(g.status==='setup'){
    if(op==='board'){if(g.ready[s])return'You are already ready';if(!validBoard(p.board))return'Bad fleet';g.boards[s]=p.board.slice();g.t=Date.now();return}
    if(op==='ready'){g.ready[s]=1;if(g.ready[0]&&g.ready[1]){g.status='play';g.log.push({h:1,t:'Game started'})}g.t=Date.now();return}
    return'Not available now'}
  if(g.status!=='play')return'Game is not in progress';
  if(op==='proceed'){if(g.phase!=='results')return'Nothing to proceed from';g.proceed[s]=1;
    if(g.proceed[0]&&g.proceed[1]){g.phase='orders';g.rep=null;g.proceed=[0,0]}g.t=Date.now();return}
  if(g.phase!=='orders')return'Both players must press Proceed first';
  if(op==='lock'){if(g.orders[s])return'Orders already locked';const r=checkOrders(g,s,p.orders);if(typeof r==='string')return r;
    g.orders[s]=r;if(g.orders[0]&&g.orders[1])resolve(g);g.t=Date.now();return}
  if(op==='unlock'){if(!g.orders[s])return'Nothing to unlock';g.orders[s]=null;return}
  return'Unknown action'}
function view(g,seat){const o=1-seat,over=g.status==='over';
  return{id:g.id,you:seat,names:g.names,priv:g.priv,status:g.status,turn:g.turn,board:g.boards[seat],enemy:g.boards[o].map(t=>t>=0?1:0),
    efull:over?g.boards[o]:null,ready:g.ready,locked:g.orders.map(x=>!!x),mine:g.orders[seat],ev:g.ev,des:g.des,winner:g.winner,why:g.why,
    rep:g.rep,phase:g.phase,proceed:g.proceed,log:g.log.slice(-300),repN:g.repN,online:[0,1].map(i=>g.clients.some(c=>c.seat===i))}}
function send(g){for(const c of g.clients)c.res.write('data: '+JSON.stringify(view(g,c.seat))+'\n\n')}
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf','.jpg':'image/jpeg','.png':'image/png'};
function handle(req,res){
  const url=new URL(req.url,'http://x'),q=url.searchParams;
  const json=(o,code=200)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(o))};
  if(url.pathname==='/api/lobby'){ // open games: waiting, public, creator still connected (or created in the last 15 s)
    const now=Date.now();
    return json({games:[...games.values()].filter(g=>g.status==='waiting'&&!g.priv&&(g.clients.some(c=>c.seat===g.made)||now-g.born<15000))
      .sort((a,b)=>b.born-a.born).slice(0,50).map(g=>({id:g.id,name:g.names[g.made]}))});}
  if(url.pathname==='/api/events'){
    const tk=q.get('token'),g=games.get(String(q.get('id')||'').toUpperCase()),seat=g&&tk?g.seats.indexOf(tk):-1;
    if(!g||seat<0)return json({error:'Unknown game or seat'},404);
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
    const c={seat,res};g.clients.push(c);send(g);
    const ka=setInterval(()=>res.write(': ka\n\n'),20000);
    req.on('close',()=>{clearInterval(ka);g.clients=g.clients.filter(x=>x!==c);send(g)});return;}
  if(req.method==='POST'&&url.pathname.startsWith('/api/')){
    let b='';req.on('data',d=>{b+=d;if(b.length>5e3)req.destroy()});
    req.on('end',()=>{let p;try{p=JSON.parse(b||'{}')}catch{return json({error:'Bad request'},400)}
      if(!p||typeof p!=='object'||Array.isArray(p))return json({error:'Bad request'},400);
      if(url.pathname==='/api/create'){const g=newGame(cleanName(p.name),p.priv);games.set(g.id,g);return json({id:g.id,token:g.seats[0],seat:0})}
      const g=games.get(String(p.id||'').toUpperCase());if(!g)return json({error:'Game not found'},404);
      if(url.pathname==='/api/join'){
        if(g.seats[1])return json({error:'Game is full'},409);
        g.seats[1]=rnd(8);g.names[1]=cleanName(p.name);g.status='setup';g.t=Date.now();send(g);return json({id:g.id,token:g.seats[1],seat:1})}
      if(url.pathname==='/api/act'){
        const seat=typeof p.token==='string'&&p.token?g.seats.indexOf(p.token):-1;if(seat<0)return json({error:'Bad token'},403);
        const e=act(g,seat,p);send(g);return json(e?{error:e}:{ok:1})}
      json({error:'Not found'},404)});return;}
  let rel;try{rel=decodeURIComponent(url.pathname)}catch{return json({error:'Bad request'},400)}
  const pub=path.join(__dirname,'public'),f=path.join(pub,url.pathname==='/'?'index.html':rel);
  if(!f.startsWith(pub+path.sep))return json({error:'Forbidden'},403);
  fs.readFile(f,(e,d)=>{if(e)return json({error:'Not found'},404);res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d)});
}
if(require.main===module){
  http.createServer((req,res)=>{try{handle(req,res)}catch(e){console.error(e);try{if(res.headersSent)res.end();else{res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":"Bad request"}')}}catch{}}})
    .listen(process.env.PORT||3000,()=>console.log('Battle Stations on port '+(process.env.PORT||3000)));
  process.on('uncaughtException',e=>console.error('uncaught:',e)); // one bad request must never kill every running game
  setInterval(()=>{const now=Date.now();for(const[id,g]of games){const w=g.status==='waiting';if(w&&g.clients.some(c=>c.seat===g.made))g.t=now;
    if(now-g.t>(w?10*6e4:6*36e5))games.delete(id)}},6e4);
}
module.exports={resolve,checkOrders,newGame,act,view,BT};
