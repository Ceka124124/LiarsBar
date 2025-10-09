const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;

// E-posta sağlayıcıları ve kelime listesi (Python betiğinden alınmıştır)
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

// Rastgele kullanıcı adı ve e-posta oluşturan yardımcı fonksiyon
function generateRandomEmail() {
    // kullanıcı adı: kelime + 2–4 basamaklı rastgele sayı
    const word = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
    const suffixLength = Math.floor(Math.random() * 3) + 2; // 2, 3 veya 4
    const suffix = String(Math.floor(Math.random() * 10**suffixLength)).padStart(suffixLength, '0');
    
    const name = `${word}${suffix}`;
    const provider = emailProviders[Math.floor(Math.random() * emailProviders.length)];
    return { 
        username: name, 
        email: `${name}@${provider}` 
    };
}

/**
 * !!! ÖNEMLİ: Bu, Instagram kontrolü için bir yer tutucudur.
 * Gerçek Instagram API etkileşimi için harici bir kütüphane (örneğin, instagram-private-api)
 * kullanmanız veya kendi ters mühendislik (reverse engineering) mantığınızı eklemeniz gerekir.
 * Python betiğindeki `ms4` modülü Node.js'e doğrudan çevrilemez.
 * * Bu fonksiyon, yalnızca rastgele bir sonuç döndürür.
 */
async function checkInstagram(username) {
    // Gerçek API çağrısını burada yapın.
    // Başarılı (HIT) olma olasılığı
    const isHit = Math.random() < 0.2; // %20 HIT şansı

    if (isHit) {
        return {
            status: 'HIT',
            username: username,
            email: `${username}@gmail.com`,
            followers: Math.floor(Math.random() * 1000) + 50,
            isPrivate: Math.random() < 0.5,
            info_checked: true // Gerçekte, buradan Instagram'dan gelen detayları döndürürsünüz
        };
    } else {
        return {
            status: 'BAD',
            username: username,
            info_checked: false
        };
    }
}

// Telegram'a sonuç gönderen fonksiyon
async function sendToTelegram(token, userId, message) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: userId,
            text: message,
            parse_mode: 'HTML' // Mesajınızı HTML ile biçimlendirmek isterseniz
        });
        return true;
    } catch (error) {
        console.error('Telegram Gönderme Hatası:', error.response ? error.response.data : error.message);
        return false;
    }
}

// Ana API rotası
// URL: /api/check?BotToken={token}&userid={id}&adet={max 100}
app.get('/api/check', async (req, res) => {
    // 1. Parametreleri al
    const { BotToken, userid, adet } = req.query;

    // 2. Parametre doğrulama
    if (!BotToken || !userid || !adet) {
        return res.status(400).json({
            error: "Eksik parametreler. Gerekli: BotToken, userid, adet.",
            kullanim: "/api/check?BotToken={token}&userid={id}&adet={max 100}"
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

    // 3. İstenen adet kadar kontrolü eşzamanlı olarak başlat
    for (let i = 0; i < count; i++) {
        const { username, email } = generateRandomEmail();
        // Tüm kontrolleri Promise olarak bir diziye ekle
        checkPromises.push(
            checkInstagram(username)
            .then(async (result) => {
                results.push(result);
                // Eğer HIT ise Telegram'a gönder
                if (result.status === 'HIT') {
                    const tgMessage = `
⌯ Hesap Bilgisi ⌯ 
Kullanıcı Adı: @${result.username}
E-posta: ${result.email}
Takipçi: ${result.followers}
Gizli mi: ${result.isPrivate ? 'Evet' : 'Hayır'}
Profil URL: https://www.instagram.com/${result.username}
`;
                    await sendToTelegram(BotToken, userid, tgMessage);
                }
            })
            // Hata olursa (örneğin, API isteği başarısız olursa) yine de devam et
            .catch(error => {
                results.push({
                    status: 'ERROR',
                    username: username,
                    error: error.message
                });
            })
        );
    }

    // 4. Tüm kontrollerin bitmesini bekle
    await Promise.all(checkPromises);

    // 5. Sonuçları JSON olarak döndür
    res.json({
        success: true,
        requested_count: count,
        hits: results.filter(r => r.status === 'HIT').length,
        bads: results.filter(r => r.status === 'BAD').length,
        results: results
    });
});

// Sunucuyu başlat
app.listen(port, () => {
    console.log(`Node.js Instagram API'si http://localhost:${port} adresinde çalışıyor`);
    console.log(`Kullanım örneği: http://localhost:${port}/api/check?BotToken=YOUR_TOKEN&userid=YOUR_ID&adet=10`);
});

            
