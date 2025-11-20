const express=require("express");
const path=require("path");
const http=require("http");
const fs=require("fs");
const {Server}=require("socket.io");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});
app.use(express.json());

const publicDir=path.join(__dirname,"public");
app.use(express.static(publicDir));

const DATA_FILE=path.join(__dirname,"data.json");
const ADMIN_TOKEN=process.env.ADMIN_TOKEN||"admin123";

let usersById={};
let trades=[];

function now(){return Date.now();}
function makeId(p){return p+"_"+now().toString(36)+Math.random().toString(36).slice(2,8);}

function save(){
  fs.writeFileSync(DATA_FILE,JSON.stringify({usersById,trades},null,2));
}
function load(){
  if(fs.existsSync(DATA_FILE)){
    let d=JSON.parse(fs.readFileSync(DATA_FILE));
    usersById=d.usersById||{};
    trades=d.trades||[];
  }
}
load();

app.post("/api/join",(req,res)=>{
  const name=(req.body.name||"").trim();
  if(!name) return res.status(400).json({error:"name required"});
  const id=makeId("u");
  usersById[id]={id,name,joinedAt:now(),lastSeen:now()};
  save();
  io.emit("state:update",{users:Object.values(usersById),trades});
  res.json(usersById[id]);
});

app.get("/api/boot",(req,res)=>{
  res.json({users:Object.values(usersById),trades});
});

app.post("/api/trades",(req,res)=>{
  const {fromId,toId,give,take}=req.body;
  if(!fromId||!toId||!give||!take) return res.status(400).json({error:"missing"});
  const t={
    id:makeId("t"),
    fromId,toId,
    give,giveText:give,
    take,takeText:take,
    status:"OPEN",
    createdAt:now(),decidedAt:null
  };
  trades.push(t);
  save();
  io.emit("state:update",{users:Object.values(usersById),trades});
  res.json(t);
});

app.patch("/api/trades/:id",(req,res)=>{
  const trade=trades.find(x=>x.id===req.params.id);
  if(!trade) return res.status(404).json({error:"not found"});
  if(trade.status!=="OPEN") return res.status(400).json({error:"closed"});
  const a=req.body.action;
  if(!["accept","decline","cancel"].includes(a)) return res.status(400).json({error:"bad action"});
  trade.status=a.toUpperCase();
  trade.decidedAt=now();
  save();
  io.emit("state:update",{users:Object.values(usersById),trades});
  res.json(trade);
});

app.get("/api/admin/users",(req,res)=>{
  if((req.headers["x-admin-token"]||"")!==ADMIN_TOKEN) return res.status(401).json({error:"no"});
  res.json({users:Object.values(usersById)});
});

app.delete("/api/admin/users/:id",(req,res)=>{
  if((req.headers["x-admin-token"]||"")!==ADMIN_TOKEN) return res.status(401).json({error:"no"});
  delete usersById[req.params.id];
  trades=trades.filter(t=>t.fromId!==req.params.id && t.toId!==req.params.id);
  save();
  io.emit("state:update",{users:Object.values(usersById),trades});
  res.json({ok:true});
});

io.on("connection",sock=>{
  sock.emit("state:update",{users:Object.values(usersById),trades});
});

server.listen(3000,()=>console.log("running"));
