// MSP-benzeri Multiplayer Sunucu — Node.js + Express + Socket.IO + WebRTC signaling
// NOT: 18+ açık saçık içerik desteklenmez. Çekirdek sosyal MMO özellikleri içerir.
// Özellikler: JWT giriş, çoklu oda/map, hareket/koşu, oturma, emote/parti, pet takip,
// coin toplama, kıyafet/ yüz tipi, metin sohbeti, WebRTC sesli sohbet için signaling.
// Basit hile önleme ve sunucu otoritesi.

/*
Kurulum
=======
1) package.json oluştur: (aşağıya kopyala) ve `npm i` çalıştır.
2) .env dosyası oluştur: JWT_SECRET="değiştir-beni" ORIGIN="http://localhost:5173" PORT=3000
3) `node server.js`

package.json
------------
{
  "name": "msp-like-server",
  "version": "0.1.0",
  "type": "module",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "nanoid": "^5.0.7",
    "socket.io": "^4.7.5"
  }
}
*/

// server.js
import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import { customAlphabet } from 'nanoid'

const PORT = process.env.PORT || 3000
const ORIGIN = process.env.ORIGIN || 'http://localhost:5173'
const JWT_SECRET = process.env.JWT_SECRET || 'change-me'
const nanoid = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 8)

// In-memory veri (PoC). Prod için DB bağla.
const users = new Map() // username -> {id, username, passHash, avatar}
const sessions = new Map() // userId -> {username}

// Kozmetik katalogları
const FACE_TYPES = ['oval','kare','yuvarlak','kalp','uzun','elmas']
const OUTFITS = ['casual_1','casual_2','party_1','party_2','formal_1','sport_1']
const EMOTES = ['wave','dance1','dance2','sit','laugh','clap','party']

// 7 adet map
const MAPS = [
  { id: 'plaza', name: 'Şehir Plazası', max: 60 },
  { id: 'beach', name: 'Sahil', max: 40 },
  { id: 'club',  name: 'Gece Kulübü', max: 50 },
  { id: 'park',  name: 'Park', max: 40 },
  { id: 'mall',  name: 'AVM',  max: 60 },
  { id: 'studio',name: 'Dans Stüdyosu', max: 30 },
  { id: 'roof',  name: 'Çatı Parti', max: 35 }
]

// Oda durumu
const rooms = new Map() // roomId -> RoomState

function createRoom(mapId) {
  const map = MAPS.find(m=>m.id===mapId) || MAPS[0]
  const id = map.id
  if (rooms.has(id)) return rooms.get(id)
  const state = {
    id,
    mapId: id,
    players: new Map(), // socketId -> PlayerState
    coins: new Map(),   // coinId -> {x,y,value}
    seats: new Map(),   // seatId -> {x,y,occupiedBy:null|socketId}
    party: { active: false, song: null }
  }
  // 12 sabit oturak
  for (let i=0;i<12;i++) state.seats.set(`seat_${i}`, { x: 2+i*1.5, y: 2, occupiedBy: null })
  rooms.set(id, state)
  return state
}
MAPS.forEach(m=>createRoom(m.id))

// Yardımcılar
function signToken(user){ return jwt.sign({ uid:user.id, un:user.username }, JWT_SECRET, { expiresIn:'7d' }) }
function verifyToken(token){ try{ return jwt.verify(token, JWT_SECRET) }catch{ return null } }

// Basit hız sınırlayıcı (Socket event başına)
class RateLimiter { constructor(limit, windowMs){ this.limit=limit; this.windowMs=windowMs; this.events=[] }
  ok(){ const now=Date.now(); this.events=this.events.filter(t=>now-t<this.windowMs); if(this.events.length>=this.limit) return false; this.events.push(now); return true }
}

// Express App
const app = express()
app.use(cors({ origin: ORIGIN, credentials: true }))
app.use(express.json())
app.use(cookieParser())

// Kayıt
app.post('/api/register', async (req,res)=>{
  const { username, password, gender='unspecified', faceType='oval', outfit='casual_1' } = req.body||{}
  if(!username || !password) return res.status(400).json({ error:'username/password zorunlu' })
  if(users.has(username)) return res.status(409).json({ error:'kullanıcı mevcut' })
  const passHash = await bcrypt.hash(password, 10)
  const id = nanoid()
  users.set(username, { id, username, passHash, avatar: { gender, faceType, outfit } })
  const token = signToken({ id, username })
  sessions.set(id, { username })
  res.json({ token, user: { id, username, avatar: { gender, faceType, outfit }, faceTypes: FACE_TYPES, outfits: OUTFITS, emotes: EMOTES, maps: MAPS } })
})

// Giriş
app.post('/api/login', async (req,res)=>{
  const { username, password } = req.body||{}
  const u = users.get(username)
  if(!u) return res.status(401).json({ error:'geçersiz bilgiler' })
  const ok = await bcrypt.compare(password, u.passHash)
  if(!ok) return res.status(401).json({ error:'geçersiz bilgiler' })
  const token = signToken({ id:u.id, username })
  sessions.set(u.id, { username })
  res.json({ token, user: { id:u.id, username, avatar: u.avatar, faceTypes: FACE_TYPES, outfits: OUTFITS, emotes: EMOTES, maps: MAPS } })
})

// Sağlık
app.get('/health', (_req,res)=>res.json({ ok:true }))

// HTTP + Socket.IO
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: ORIGIN, credentials:true } })

io.use((socket,next)=>{
  const token = socket.handshake.auth?.token || socket.handshake.headers['x-auth-token']
  const data = verifyToken(token)
  if(!data) return next(new Error('unauthorized'))
  socket.data.user = { id: data.uid, username: data.un }
  socket.data.limiter = {
    move: new RateLimiter(30, 1000), // 30/s hareket
    chat: new RateLimiter(5, 3000),  // 5/3s
    webrtc: new RateLimiter(20, 5000)
  }
  next()
})

io.on('connection', (socket)=>{
  const { id:socketId } = socket
  const { user } = socket.data
  let room = null

  // Odaya katıl
  socket.on('room:join', ({ mapId })=>{
    const target = createRoom(mapId)
    if (room?.id === target.id) return
    if (room) leaveRoom()
    room = target
    socket.join(room.id)
    const spawn = { x: Math.random()*10+3, y: Math.random()*6+3 }
    const player = {
      socketId,
      userId: user.id,
      username: user.username,
      x: spawn.x, y: spawn.y,
      vx: 0, vy: 0, speed: 3.2,
      dir: 'down', running: false,
      anim: 'idle',
      faceType: FACE_TYPES[0],
      outfit: OUTFITS[0],
      emote: null,
      seatId: null,
      coins: 0,
      pet: { name: 'Buddy', x: spawn.x-0.5, y: spawn.y-0.5, follow: true }
    }
    room.players.set(socketId, player)

    // Mevcut state'i gönder
    socket.emit('room:state', serializeRoom(room))
    // Yeni oyuncuyu yayınla
    socket.to(room.id).emit('player:join', sanitizePlayer(player))
  })

  function leaveRoom(){
    if(!room) return
    const p = room.players.get(socket.id)
    if(p?.seatId && room.seats.has(p.seatId)) room.seats.get(p.seatId).occupiedBy = null
    room.players.delete(socket.id)
    socket.to(room.id).emit('player:leave', { socketId })
    socket.leave(room.id)
    room = null
  }

  socket.on('disconnect', ()=>{
    leaveRoom()
  })

  // Hareket güncellemesi
  socket.on('player:move', (data)=>{
    if(!room) return
    if(!socket.data.limiter.move.ok()) return
    const p = room.players.get(socket.id)
    if(!p) return
    const { x, y, vx=0, vy=0, running=false, dir='down', anim='idle' } = data||{}
    // basit sınırlar
    const nx = clamp(x, 0, 100)
    const ny = clamp(y, 0, 100)
    p.x = nx; p.y = ny; p.vx = vx; p.vy = vy; p.running = !!running; p.dir = dir; p.anim = anim
    // pet takip
    const followSpeed = 0.2
    p.pet.x += (p.x - p.pet.x) * followSpeed
    p.pet.y += (p.y - p.pet.y) * followSpeed
    io.to(room.id).emit('player:update', sanitizePlayer(p))
  })

  // Emote/parti/oturma
  socket.on('player:emote', ({ emote })=>{
    if(!room) return
    if(!EMOTES.includes(emote)) return
    const p = room.players.get(socket.id)
    if(!p) return
    p.emote = emote
    io.to(room.id).emit('player:emote', { socketId, emote })
  })

  socket.on('player:sit', ({ seatId })=>{
    if(!room) return
    const p = room.players.get(socket.id)
    const seat = room.seats.get(seatId)
    if(!p || !seat) return
    if(seat.occupiedBy && seat.occupiedBy!==socket.id) return
    // toggle
    if(p.seatId === seatId){ seat.occupiedBy = null; p.seatId = null }
    else { if(p.seatId && room.seats.has(p.seatId)) room.seats.get(p.seatId).occupiedBy=null; seat.occupiedBy=socket.id; p.seatId=seatId }
    io.to(room.id).emit('player:sit', { socketId, seatId: p.seatId })
  })

  socket.on('party:toggle', ({ active, song=null })=>{
    if(!room) return
    room.party.active = !!active
    room.party.song = song
    io.to(room.id).emit('party:state', room.party)
  })

  // Kozmetik
  socket.on('avatar:update', ({ faceType, outfit })=>{
    if(!room) return
    const p = room.players.get(socket.id)
    if(!p) return
    if(faceType && FACE_TYPES.includes(faceType)) p.faceType = faceType
    if(outfit && OUTFITS.includes(outfit)) p.outfit = outfit
    io.to(room.id).emit('player:cosmetic', { socketId, faceType: p.faceType, outfit: p.outfit })
  })

  // Coin toplama
  socket.on('coin:collect', ({ coinId })=>{
    if(!room) return
    const p = room.players.get(socket.id)
    const c = room.coins.get(coinId)
    if(!p || !c) return
    const dist = Math.hypot(p.x - c.x, p.y - c.y)
    if(dist > 2.0) return // çok uzaksan alma
    room.coins.delete(coinId)
    p.coins += c.value
    io.to(room.id).emit('coin:collected', { coinId, by: socket.id, total: p.coins })
  })

  // Metin sohbet
  socket.on('chat:message', ({ text })=>{
    if(!room) return
    if(!socket.data.limiter.chat.ok()) return
    const t = (text||'').toString().slice(0, 240)
    if(!t.trim()) return
    io.to(room.id).emit('chat:message', { from: user.username, text: t, ts: Date.now() })
  })

  // WebRTC signaling (oda içi P2P sesli sohbet)
  socket.on('webrtc:signal', (payload)=>{
    if(!room) return
    if(!socket.data.limiter.webrtc.ok()) return
    const { to, desc, candidate } = payload||{}
    if(!to) return
    // yalnızca aynı odadaki hedeflere aktar
    const inSameRoom = room.players.has(to)
    if(!inSameRoom) return
    io.to(to).emit('webrtc:signal', { from: socket.id, desc, candidate })
  })
})

// Coin spawner döngüsü
setInterval(()=>{
  for(const room of rooms.values()){
    if(room.coins.size > 60) continue
    const id = 'coin_'+Math.random().toString(36).slice(2,9)
    const coin = { x: rnd(2, 98), y: rnd(2, 98), value: Math.random()<0.9 ? 1 : 5 }
    room.coins.set(id, coin)
    io.to(room.id).emit('coin:spawn', { id, ...coin })
  }
}, 3000)

// Yardımcı fonksiyonlar
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)) }
function rnd(a,b){ return Math.random()*(b-a)+a }

function sanitizePlayer(p){
  return {
    socketId: p.socketId,
    username: p.username,
    x:p.x, y:p.y, vx:p.vx, vy:p.vy, dir:p.dir, running:p.running, anim:p.anim,
    faceType:p.faceType, outfit:p.outfit, emote:p.emote, seatId:p.seatId,
    coins:p.coins, pet:p.pet
  }
}

function serializeRoom(room){
  return {
    id: room.id,
    mapId: room.mapId,
    party: room.party,
    seats: Array.from(room.seats.entries()).map(([id,s])=>({ id, ...s })),
    coins: Array.from(room.coins.entries()).map(([id,c])=>({ id, ...c })),
    players: Array.from(room.players.values()).map(sanitizePlayer)
  }
}

server.listen(PORT, ()=>{
  console.log('server on', PORT)
})
