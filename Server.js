// server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyaları sunmak için
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Ana sayfa: Kod gönderme formu
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Node.js Kod Sunucusu</title>
            <style>
                body { font-family: sans-serif; padding: 20px; }
                h1 { color: #333; }
                form { border: 1px solid #ccc; padding: 20px; border-radius: 8px; max-width: 600px; margin-top: 20px; }
                input[type="text"], textarea { width: 100%; padding: 10px; margin: 8px 0; box-sizing: border-box; }
                button { background-color: #4CAF50; color: white; padding: 14px 20px; margin: 8px 0; border: none; cursor: pointer; width: 100%; }
                button:hover { opacity: 0.8; }
                a { color: #007BFF; text-decoration: none; }
            </style>
        </head>
        <body>
            <h1>Yeni Bir Kod Sunucusu Oluştur</h1>
            <p>Aşağıdaki formu kullanarak kendi kod ID'nizi ve kod içeriğinizi girin. Her ID için özel bir sunucu sayfası oluşturulacaktır.</p>
            <form action="/publish" method="POST">
                <label for="id"><b>Sunucu ID'si:</b></label>
                <input type="text" id="id" name="id" required placeholder="Örn: benim-sunucum">
                
                <label for="code"><b>Kod İçeriği:</b></label>
                <textarea id="code" name="code" rows="10" required placeholder="Örn: const express = require('express'); ..."></textarea>
                
                <button type="submit">Yayınla</button>
            </form>
        </body>
        </html>
    `);
});

// Kod yayınlama endpoint'i
app.post('/publish', (req, res) => {
    const { id, code } = req.body;

    if (!id || !code) {
        return res.status(400).send('ID ve kod içeriği zorunludur.');
    }

    // Her ID için ayrı bir Socket.IO namespace oluştur
    const namespace = io.of(`/${id}`);
    console.log(`Yeni bir namespace oluşturuldu: /${id}`);

    namespace.on('connection', (socket) => {
        console.log(`Bir kullanıcı /${id} sunucusuna bağlandı.`);

        // Bağlanan kullanıcıya kodu gönder
        socket.emit('code-content', code);

        socket.on('disconnect', () => {
            console.log(`Bir kullanıcı /${id} sunucusundan ayrıldı.`);
        });
    });

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Başarılı</title>
            <style>
                body { font-family: sans-serif; padding: 20px; }
            </style>
        </head>
        <body>
            <h1>Kodunuz Başarıyla Yayınlandı!</h1>
            <p>Sunucunuz hazır. Aşağıdaki bağlantıya tıklayarak kodunuza erişin:</p>
            <a href="/server/${id}">http://localhost:3000/server/${id}</a>
        </body>
        </html>
    `);
});

// Her ID için ayrı bir sunucu sayfası
app.get('/server/:id', (req, res) => {
    const id = req.params.id;
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Sunucu: ${id}</title>
            <style>
                body { font-family: sans-serif; padding: 20px; }
                pre { background-color: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
            </style>
        </head>
        <body>
            <h1>Sunucu ID: ${id}</h1>
            <p>Bu sunucuya ait kod içeriği aşağıdadır:</p>
            <pre id="code-display"></pre>
            
            <script src="/socket.io/socket.io.js"></script>
            <script>
                // URL'den ID'yi al
                const id = window.location.pathname.split('/').pop();
                
                // Belirli bir namespace'e bağlan
                const socket = io('/' + id);
                
                socket.on('connect', () => {
                    console.log('Sunucuya bağlandı!');
                });
                
                socket.on('code-content', (code) => {
                    document.getElementById('code-display').textContent = code;
                    console.log('Kod içeriği alındı:', code);
                });

                socket.on('disconnect', () => {
                    console.log('Sunucudan ayrıldı.');
                });
            </script>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor.`);
});

bbyList());
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
