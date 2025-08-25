const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// ---- DATA STRUCTURES ----
let lobbies = {}; // { roomId: {users: [...], settings: {...}, gameState: {...}} }
let users = {};   // { socket.id: username }

// ---- CARD GAME HELPERS ----
const CARD_TYPES = ['A', 'K', 'Q', 'J', '10', '9', '8', '7'];
function getRandomCard() {
    return CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)];
}
function getRandomHand(n = 5) {
    return Array(n).fill().map(getRandomCard);
}

// ---- SOCKET.IO ----
io.on('connection', (socket) => {
    console.log(`[SOCKET] Connected: ${socket.id}`);

    // Kullanıcı giriş (tek username ile)
    socket.on('login', (username, cb) => {
        if (Object.values(users).includes(username)) {
            cb({success: false, error: 'Bu kullanıcı adı kullanılıyor.'});
            return;
        }
        users[socket.id] = username;
        cb({success: true, username});
        socket.emit('lobby-list', getLobbyList());
    });

    // Lobi listesini gönder
    socket.on('get-lobbies', () => {
        socket.emit('lobby-list', getLobbyList());
    });

    // Oda oluşturma (gelişmiş ayarlar ile)
    /*
      settings = {
        maxUsers: Number,
        maxCards: Number,
        rounds: Number,
        spectatorMode: Boolean
      }
    */
    socket.on('create-room', (settings, cb) => {
        // Basit validasyon
        if (!settings ||
            typeof settings.maxUsers !== 'number' ||
            typeof settings.maxCards !== 'number' ||
            typeof settings.rounds !== 'number' ||
            typeof settings.spectatorMode !== 'boolean'
        ) {
            cb({success: false, error: 'Geçersiz ayarlar.'});
            return;
        }
        // Max değerler sınırlandırılabilir
        if (settings.maxUsers < 2 || settings.maxUsers > 12) {
            cb({success: false, error: 'Kullanıcı sayısı 2-12 arasında olmalı.'});
            return;
        }
        if (settings.maxCards < 1 || settings.maxCards > 10) {
            cb({success: false, error: 'Kart sayısı 1-10 arasında olmalı.'});
            return;
        }
        if (settings.rounds < 1 || settings.rounds > 20) {
            cb({success: false, error: 'Raunt sayısı 1-20 arasında olmalı.'});
            return;
        }

        let roomId = 'room_' + Math.random().toString(36).substr(2, 6);
        lobbies[roomId] = {
            users: [],
            settings,
            gameState: {
                started: false,
                tableCard: null,
                hands: {},
                placedCards: {},
                originalCards: {},
                bluff: false,
                spectators: [],
                round: 1,
                scores: {},
                roundActive: false
            }
        };
        cb({success: true, roomId});
        io.emit('lobby-list', getLobbyList());
    });

    // Random oda aç/gir
    socket.on('join-random-room', () => {
        let roomId = findAvailableRoom();
        if (!roomId) {
            // Varsayılan ayarlar ile yeni oda
            roomId = createNewRoom({
                maxUsers: 6,
                maxCards: 5,
                rounds: 5,
                spectatorMode: true
            });
        }
        joinRoom(socket, roomId);
    });

    // Odaya katıl
    socket.on('join-room', (roomId, cb) => {
        if (lobbies[roomId]) {
            // Oda dolu mu kontrol et
            if (lobbies[roomId].users.length >= lobbies[roomId].settings.maxUsers) {
                cb && cb({success: false, error: 'Oda dolu.'});
                return;
            }
            joinRoom(socket, roomId);
            cb && cb({success: true, roomId});
        } else {
            cb && cb({success: false, error: 'Oda bulunamadı.'});
        }
    });

    // Kart koyma
    socket.on('place-cards', ({roomId, cards}, cb) => {
        let lobby = lobbies[roomId];
        if (!lobby || !lobby.gameState.started || !lobby.gameState.roundActive) return;

        // Sadece max 2 kart koy
        if (!Array.isArray(cards) || cards.length < 1 || cards.length > 2) {
            cb && cb({success: false, error: 'Max 2 kart koyabilirsiniz.'});
            return;
        }

        // Kullanıcı kartlarını masa üstüne koyar (kartlar "?")
        lobby.gameState.placedCards[socket.id] = cards.map(() => '?');
        lobby.gameState.originalCards[socket.id] = cards;
        checkAllPlaced(socket, roomId);
        cb && cb({success: true});
    });

    // Blöf basma
    socket.on('bluff', (roomId) => {
        let lobby = lobbies[roomId];
        if (!lobby || !lobby.gameState.started || !lobby.gameState.roundActive) return;

        lobby.gameState.bluff = true;
        const blufferId = socket.id;
        const tableCard = lobby.gameState.tableCard;
        const order = lobby.users.filter(uid => !lobby.gameState.spectators.includes(uid)); // Sadece aktif oyuncular
        let reveal = {};
        for (let uid of order) {
            reveal[users[uid]] = lobby.gameState.originalCards[uid];
        }
        io.to(roomId).emit('reveal-cards', reveal);

        // Blöf basan oyuncudan önce kart koyanları bul
        const blufferIndex = order.indexOf(blufferId);
        let beforeBluffer = order.slice(0, blufferIndex);

        // Eğer blöf basan oyuncudan önce koyanlardan herhangi biri hedef kartı koymuşsa blöf basan yanar
        let blufferBomb = false;
        for (let uid of beforeBluffer) {
            if (lobby.gameState.originalCards[uid] && lobby.gameState.originalCards[uid].includes(tableCard)) {
                blufferBomb = true;
                break;
            }
        }

        let bombTargets = [];
        if (blufferBomb) {
            // Blöf basan yanar
            bombTargets = [blufferId];
        } else {
            // Blöf basan oyuncudan önce koyanlardan hiçbiri hedef kart koymadıysa, hedef kart koymayanlar yanar
            for (let uid of beforeBluffer) {
                if (!lobby.gameState.originalCards[uid] || !lobby.gameState.originalCards[uid].includes(tableCard)) {
                    bombTargets.push(uid);
                }
            }
        }

        // İzleyici modu kapalıysa kimse yanmaz
        if (!lobby.settings.spectatorMode) bombTargets = [];

        // Bomba sayacı başlat
        if (bombTargets.length > 0) {
            let countdown = 3;
            let interval = setInterval(() => {
                io.to(roomId).emit('bomb-timer', {targets: bombTargets.map(uid => users[uid]), countdown});
                countdown--;
                if (countdown < 0) {
                    clearInterval(interval);
                    // Patlama: izleme moduna geçiş
                    bombTargets.forEach(uid => {
                        if (!lobby.gameState.spectators.includes(uid)) {
                            lobby.gameState.spectators.push(uid);
                            io.to(uid).emit('spectator-mode');
                        }
                    });
                    // Tur sonu
                    finishRound(roomId);
                }
            }, 1000);
        } else {
            // Bomba yoksa direkt tur sonu
            finishRound(roomId);
        }
    });

    // Kullanıcı çıkışı
    socket.on('disconnect', () => {
        let username = users[socket.id];
        delete users[socket.id];
        // Odalardan çıkar
        for (let roomId in lobbies) {
            let i = lobbies[roomId].users.indexOf(socket.id);
            if (i !== -1) lobbies[roomId].users.splice(i, 1);
            // Oda boşsa sil
            if (lobbies[roomId].users.length === 0) delete lobbies[roomId];
        }
        io.emit('lobby-list', getLobbyList());
        console.log(`[SOCKET] Disconnected: ${socket.id}`);
    });

    // İzleyici modunu kapat/aç (oda ayarlarında güncelle)
    socket.on('toggle-spectator-mode', ({roomId, value}, cb) => {
        let lobby = lobbies[roomId];
        if (!lobby) {
            cb && cb({success: false, error: 'Oda bulunamadı.'});
            return;
        }
        lobby.settings.spectatorMode = !!value;
        cb && cb({success: true});
        io.emit('lobby-list', getLobbyList());
    });
});

// ---- HELPERS ----
function getLobbyList() {
    return Object.keys(lobbies).map(roomId => ({
        roomId,
        users: lobbies[roomId].users.map(uid => users[uid]),
        started: lobbies[roomId].gameState?.started,
        settings: lobbies[roomId].settings,
        round: lobbies[roomId].gameState?.round,
        spectators: lobbies[roomId].gameState?.spectators.map(uid => users[uid])
    }));
}

function findAvailableRoom() {
    // Boş oda bul (oda ayarına göre)
    for (let roomId in lobbies) {
        const lobby = lobbies[roomId];
        if (
            lobby.users.length < lobby.settings.maxUsers &&
            !lobby.gameState.started
        ) return roomId;
    }
    return null;
}

function createNewRoom(settings) {
    let roomId = 'room_' + Math.random().toString(36).substr(2, 6);
    lobbies[roomId] = {
        users: [],
        settings,
        gameState: {
            started: false,
            tableCard: null,
            hands: {},
            placedCards: {},
            originalCards: {},
            bluff: false,
            spectators: [],
            round: 1,
            scores: {},
            roundActive: false
        }
    };
    return roomId;
}

function joinRoom(socket, roomId) {
    let lobby = lobbies[roomId];
    if (!lobby.users.includes(socket.id)) lobby.users.push(socket.id);
    socket.join(roomId);

    // Oyun başlamadıysa ve oda dolmuşsa veya en az 2 kişi varsa başlat
    if (!lobby.gameState.started &&
        lobby.users.length >= 2 &&
        (lobby.users.length === lobby.settings.maxUsers)
    ) {
        startGame(roomId);
    }

    io.emit('lobby-list', getLobbyList());
}

// Oyun başlat
function startGame(roomId) {
    let lobby = lobbies[roomId];
    lobby.gameState.started = true;
    lobby.gameState.round = 1;
    startRound(roomId);
}

// Tur başlat
function startRound(roomId) {
    let lobby = lobbies[roomId];
    lobby.gameState.tableCard = getRandomCard();
    lobby.gameState.hands = {};
    lobby.gameState.placedCards = {};
    lobby.gameState.originalCards = {};
    lobby.gameState.bluff = false;
    lobby.gameState.roundActive = true;

    // Sadece aktif oyuncular
    const activePlayers = lobby.users.filter(uid => !lobby.gameState.spectators.includes(uid));
    activePlayers.forEach(uid => {
        // Herkese maxCards random kart ver
        lobby.gameState.hands[uid] = getRandomHand(lobby.settings.maxCards);
        io.to(uid).emit('your-hand', lobby.gameState.hands[uid]);
    });
    io.to(roomId).emit('game-round', {
        tableCard: lobby.gameState.tableCard,
        round: lobby.gameState.round,
        players: activePlayers.map(uid => users[uid])
    });
}

// Tüm oyuncular kart koydu mu?
function checkAllPlaced(socket, roomId) {
    let lobby = lobbies[roomId];
    if (!lobby) return;
    // Sadece aktif oyuncular
    const activePlayers = lobby.users.filter(uid => !lobby.gameState.spectators.includes(uid));
    if (Object.keys(lobby.gameState.placedCards).length === activePlayers.length) {
        // Masa üstündeki kartlar (hepsi "?")
        io.to(roomId).emit('table-cards', lobby.gameState.placedCards);
        // Turda blöf yapılmazsa otomatik tur sonu
        setTimeout(() => finishRound(roomId), 10000);
    }
}

// Tur bitişi ve yeni tur başlama
function finishRound(roomId) {
    let lobby = lobbies[roomId];
    if (!lobby || !lobby.gameState.roundActive) return;
    lobby.gameState.roundActive = false;

    // Skorları güncelle vs. (isteğe göre eklenebilir)
    if (lobby.gameState.round < lobby.settings.rounds) {
        lobby.gameState.round++;
        setTimeout(() => startRound(roomId), 3000);
    } else {
        // Oyun bitti!
        io.to(roomId).emit('game-ended', {
            spectators: lobby.gameState.spectators.map(uid => users[uid])
        });
    }
}

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
