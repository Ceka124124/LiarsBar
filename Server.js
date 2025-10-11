require('dotenv').config(); // .env dosyasındaki değişkenleri yükler
const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;

// Çevresel değişkenlerden alın
// .env dosyasında tanımlanmalıdır: BOT_TOKEN=..., USER_ID=...
const BOT_TOKEN = process.env.BOT_TOKEN;
const USER_ID = process.env.USER_ID;

// E-posta sağlayıcıları ve kelime listesi (Önceki betikten alınmıştır)
const emailProviders = ['gmail.com'];
const WORD_LIST = [
    "enesbatur","bravo","fan","delta","echo","foxtrot","golf","hotel","india","juliet",
    "kilo","lima","mike","november","oscar","papa","quebec","romeo","sierra","tango",
    "uniform","victor","whiskey","xray","yankee","zulu","comet","meteor","galaxy","nebula",
    "orbit","eclipse","horizon","sky","cloud","storm","thunder","lightning","rain","snow",
    "wind","river","ocean","mountain","valley","forest","desert","jungle","island","beach",
    "volcano","glacier","canyon","cave","oasis","prairie","swamp","marsh","cliff","dune",
    "meadow","grove","field","garden","temple","castle","fortress","citadel","palace","tower",
    "bridge","harbor","anchor","compass","lantern","torch","stone","iron","steel","bronze",
    "copper","silver","gold","diamond","ruby","emerald","sapphire","onyx","quartz","titan",
    "atlas","zeus","hera","apollo","artemis","ares","poseidon","demeter","hestia","hermes"
];

// --- Yardımcı Fonksiyonlar (Aynı Kaldı) ---

function generateRandomEmail() {
    const word = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
    const suffixLength = Math.floor(Math.random() * 3) + 2; 
    const suffix = String(Math.floor(Math.random() * 10**suffixLength)).padStart(suffixLength, '0');
    
    const name = `${word}${suffix}`;
    const provider = emailProviders[Math.floor(Math.random() * emailProviders.length)];
    return { 
        username: name, 
        email: `${name}@${provider}` 
    };
}

async function checkInstagram(username) {
    // SİMÜLASYON: Gerçek API çağrısını burada yapın.
    const isHit = Math.random() < 0.2; // %20 HIT şansı

    if (isHit) {
        return {
            status: 'HIT',
            username: username,
            email: `${username}@gmail.com`,
            followers: Math.floor(Math.random() * 1000) + 50,
            isPrivate: Math.random() < 0.5,
            info_checked: true
        };
    } else {
        return {
            status: 'BAD',
            username: username,
            info_checked: false
        };
    }
}

async function sendToTelegram(token, userId, message) {
    if (!token || !userId) {
        console.error("Telegram token veya kullanıcı kimliği eksik. Gönderim atlandı.");
        return false;
    }
    const telegramApiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: userId,
            text: message,
            parse_mode: 'HTML'
        });
        return true;
    } catch (error) {
        console.error('Telegram Gönderme Hatası:', error.response ? error.response.data : error.message);
        return false;
    }
}

// --- 1. INSTAGRAM KONTROL API'SI (Önceki /api/check) ---

/**
 * URL: /api/check?adet={max 100}
 * Parametreleri doğrudan query string'den almak yerine,
 * Telegram için gerekli BOT_TOKEN ve USER_ID'yi .env dosyasından okur.
 */
app.get('/api/check', async (req, res) => {
    const { adet } = req.query;

    // Parametre doğrulama
    if (!adet) {
        return res.status(400).json({
            error: "Eksik parametreler. Gerekli: adet (kaç adet hesap çekilecek).",
            kullanim: "/api/check?adet=10"
        });
    }

    const count = parseInt(adet);
    if (isNaN(count) || count <= 0 || count > 100) {
        return res.status(400).json({
            error: "Adet (kaç adet hesap çekilecek) 1 ile 100 arasında bir sayı olmalıdır."
        });
    }

    const results = [];
    const checkPromises = [];

    // İstenen adet kadar kontrolü eşzamanlı olarak başlat
    for (let i = 0; i < count; i++) {
        const { username, email } = generateRandomEmail();
        checkPromises.push(
            checkInstagram(username)
            .then(async (result) => {
                results.push(result);
                // Eğer HIT ise Telegram'a gönder
                if (result.status === 'HIT') {
                    const tgMessage = `
**⌯ Hesap Bilgisi ⌯** Kullanıcı Adı: @${result.username}
E-posta: ${result.email}
Takipçi: ${result.followers}
Gizli mi: ${result.isPrivate ? 'Evet' : 'Hayır'}
Profil URL: https://www.instagram.com/${result.username}
`;
                    await sendToTelegram(BOT_TOKEN, USER_ID, tgMessage);
                }
            })
            .catch(error => {
                results.push({
                    status: 'ERROR',
                    username: username,
                    error: error.message
                });
            })
        );
    }

    // Tüm kontrollerin bitmesini bekle
    await Promise.all(checkPromises);

    // Sonuçları JSON olarak döndür
    res.json({
        success: true,
        requested_count: count,
        hits: results.filter(r => r.status === 'HIT').length,
        bads: results.filter(r => r.status === 'BAD').length,
        results: results
    });
});


// --- 2. YÜK TESTİ / SALDIRI API'SI (Yeni /api/attk) ---

/**
 * URL: /api/attk?url={hedef_url}&adet={max 10}
 */
app.get('/api/attk', async (req, res) => {
    const { url, adet } = req.query;

    // 1. Parametre doğrulama (Aynı Kalır)
    if (!url || !adet) {
        return res.status(400).json({
            error: "Eksik parametreler. Gerekli: url (Hedef API) ve adet (Eşzamanlı istek sayısı).",
            kullanim: "/api/attk?url=http://localhost:3000/api/check?adet=10&adet=5"
        });
    }

    const count = parseInt(adet);
    if (isNaN(count) || count <= 0 || count > 10) {
        // Not: Politikalar gereği max 100 sınırı, 10'a düşürülmüştür.
        return res.status(400).json({
            error: "Adet (eşzamanlı istek sayısı) 1 ile 10 arasında bir sayı olmalıdır."
        });
    }

    const attackResults = [];
    const attackPromises = [];
    
    // Zaman Ölçümünü Başlat
    const startTime = process.hrtime();
    let successfulCount = 0;
    let errorCount = 0;

    // 2. Belirtilen adet kadar eşzamanlı istek başlat (Aynı Kalır)
    for (let i = 0; i < count; i++) {
        const promise = axios.get(url, {
            headers: {
                'User-Agent': `Node-LoadTester/1.0 (${i + 1}/${count})`
            },
            timeout: 15000 // İstek başına 15 saniye zaman aşımı ekleyelim
        })
        .then(response => {
            successfulCount++; // Başarılı sayacı artır
            attackResults.push({
                status: 'SUCCESS',
                statusCode: response.status,
                data_snippet: JSON.stringify(response.data).substring(0, 50) + '...'
            });
        })
        .catch(error => {
            errorCount++; // Hata sayacı artır
            attackResults.push({
                status: 'ERROR',
                statusCode: error.response ? error.response.status : 'N/A',
                message: error.message
            });
        });
        attackPromises.push(promise);
    }

    // 3. Tüm isteklerin bitmesini bekle
    await Promise.all(attackPromises);
    
    // Zaman Ölçümünü Durdur
    const endTime = process.hrtime(startTime);
    const totalTimeSeconds = endTime[0] + endTime[1] / 1e9; // Toplam saniye
    const timeFormatted = `${Math.floor(totalTimeSeconds)}sn ${Math.floor((totalTimeSeconds % 1) * 1000)}ms`;

    // 4. Sonuçları İstenen Formatla Döndür
    res.json({
        success: true,
        target_url: url,
        requested_concurrent_count: count,
        
        // İstenen Özet Formatı
        summary: {
            Başarılı: successfulCount,
            Başarısız: errorCount,
            Toplam: count,
            Gönderim_Zamanı: timeFormatted,
        },
        
        // Orijinal detaylı sonuçlar (Aynı Kalır)
        results: attackResults
    });
});

// Sunucuyu başlat
app.listen(port, () => {
    console.log(`Sunucu http://localhost:${port} adresinde çalışıyor`);
    console.log('--- Kullanım Örnekleri ---');
    console.log(`1. Kontrol API'si: http://localhost:${port}/api/check?adet=5`);
    console.log(`2. Yük Testi API'si: http://localhost:${port}/api/attk?url=http://localhost:${port}/api/check?adet=1&adet=3`);
});
            
