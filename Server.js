// Gerekli modülleri import edin
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { WebcastPushConnection } = require('tiktok-live-connector');

// Sunucuyu ve Socket.IO'yu kurun
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// TikTok kullanıcı adını buraya girin
// !!! Kendi kullanıcı adınızla değiştirmeyi unutmayın !!!
const tiktokUsername = 'tiktok'; 

// Bağlantı nesnesini oluşturun
const tiktokLiveConnection = new WebcastPushConnection(tiktokUsername);

// TikTok Live olaylarını dinlemeye başlayın
tiktokLiveConnection.connect().then(state => {
    console.log(`TikTok canlı yayınına başarıyla bağlandı! Kullanıcı: ${state.roomInfo.owner.uniqueId}`);
}).catch(err => {
    console.error('TikTok canlı yayınına bağlanırken bir hata oluştu:', err);
});

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

// Hata yönetimi
tiktokLiveConnection.on('streamEnd', () => {
    console.log('Canlı yayın sona erdi.');
    io.emit('streamEnd', 'Canlı yayın sona erdi.');
});

// Socket.IO bağlantısını yönetin
io.on('connection', (socket) => {
    console.log('Yeni bir istemci bağlandı');

    socket.on('disconnect', () => {
        console.log('Bir istemci bağlantısı kesildi');
    });
});

// Statik dosyalar için express.static middleware'ini kullanın (index.html için)
app.use(express.static('public'));

// Uygulamanın dinleyeceği port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});

      
