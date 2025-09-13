// Gerekli modülleri import edin
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { WebcastPushConnection } = require('tiktok-live-connector');
const cors = require('cors'); // CORS modülü eklendi

// Sunucuyu ve Socket.IO'yu kurun
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Tüm domainlerden gelen isteklere izin ver
        methods: ["GET", "POST"]
    }
});

// CORS'u Express uygulaması için etkinleştirin
app.use(cors());

// Uygulamanın dinleyeceği port
const PORT = process.env.PORT || 3000;

// Bağlantı nesnesini saklamak için bir değişken
let tiktokLiveConnection = null;

// URL'den kullanıcı adını alacak ve canlı yayına bağlanacak rota
app.get('/connect', async (req, res) => {
    const tiktokUsername = req.query.user;

    // Eğer kullanıcı adı belirtilmemişse hata gönder
    if (!tiktokUsername) {
        return res.status(400).send('Lütfen bir TikTok kullanıcı adı sağlayın. Örnek: /connect?user=tiktok');
    }

    // Eğer mevcut bir bağlantı varsa kapatın
    if (tiktokLiveConnection) {
        tiktokLiveConnection.disconnect();
        tiktokLiveConnection = null;
    }

    // Yeni bir bağlantı nesnesi oluşturun
    tiktokLiveConnection = new WebcastPushConnection(tiktokUsername);

    try {
        const state = await tiktokLiveConnection.connect();
        const username = state.roomInfo.owner.uniqueId;
        console.log(`TikTok canlı yayınına başarıyla bağlandı! Kullanıcı: ${username}`);
        io.emit('status', `"${username}" kullanıcısının canlı yayınına bağlandı.`);
        res.send(`"${username}" kullanıcısının canlı yayınına bağlandı.`);
    } catch (err) {
        console.error('TikTok canlı yayınına bağlanırken bir hata oluştu:', err);
        io.emit('status', `"${tiktokUsername}" kullanıcısının yayınına bağlanılamadı. Lütfen kullanıcının canlı yayında olduğundan emin olun.`);
        return res.status(500).send(`"${tiktokUsername}" kullanıcısının yayınına bağlanılamadı. Hata: ${err.message}`);
    }

    // TikTok Live etkinlikleri için dinleyici kurun
    // Yeni bir sohbet mesajı geldiğinde
    tiktokLiveConnection.on('chat', data => {
        console.log(`${data.uniqueId}: ${data.comment}`);
        io.emit('chat', {
            nickname: data.nickname,
            comment: data.comment
        });
    });

    // Bir kullanıcı "beğen"diğinde
    tiktokLiveConnection.on('like', data => {
        console.log(`${data.uniqueId} ${data.likeCount} kez beğendi.`);
        io.emit('like', {
            nickname: data.nickname,
            likeCount: data.likeCount
        });
    });

    // Bir hediye gönderildiğinde
    tiktokLiveConnection.on('gift', data => {
        console.log(`${data.uniqueId} bir hediye gönderdi: ${data.giftName}`);
        io.emit('gift', {
            nickname: data.nickname,
            giftName: data.giftName,
            repeatCount: data.repeatCount
        });
    });

    // Yeni bir üye katıldığında
    tiktokLiveConnection.on('member', data => {
        console.log(`${data.uniqueId} katıldı.`);
        io.emit('member', {
            nickname: data.nickname
        });
    });

    // Yayın paylaşımı
    tiktokLiveConnection.on('share', data => {
        console.log(`${data.uniqueId} yayını paylaştı.`);
        io.emit('share', {
            nickname: data.nickname
        });
    });

    // Yeni bir takipçi geldiğinde
    tiktokLiveConnection.on('follow', data => {
        console.log(`${data.uniqueId} takip etmeye başladı.`);
        io.emit('follow', {
            nickname: data.nickname
        });
    });

    // Hata yönetimi
    tiktokLiveConnection.on('streamEnd', () => {
        console.log('Canlı yayın sona erdi.');
        io.emit('streamEnd', 'Canlı yayın sona erdi.');
    });
});

// Socket.IO bağlantısını yönetin
io.on('connection', (socket) => {
    console.log('Yeni bir istemci bağlandı');

    socket.on('disconnect', () => {
        console.log('Bir istemci bağlantısı kesildi');
    });
});

server.listen(PORT, () => {
    // Sunucu varsayılan olarak tüm ağ arayüzlerini dinler.
    // Bu, sunucunun yerel ağ veya internet üzerinden erişilebilir olduğu anlamına gelir.
    console.log(`Sunucu ${PORT} portunda herkese açık olarak çalışıyor.`);
    console.log(`Bir canlı yayına bağlanmak için tarayıcınızda http://SUNUCU_IP_ADRESINIZ:${PORT}/connect?user=KULLANICI_ADI adresini ziyaret edin.`);
});
