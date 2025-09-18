const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const port = 3000;

app.use(express.json());

// Base64 decode fonksiyonu
function decodeBase64(str) {
    try {
        return Buffer.from(str, 'base64').toString('utf-8');
    } catch (error) {
        console.error('Base64 decode hatası:', error);
        return null;
    }
}

// Nonce'yi çıkaran fonksiyon
function extractNonce(decodedData) {
    try {
        // JSON parse etmeyi dene
        const jsonData = JSON.parse(decodedData);
        if (jsonData.nonce) {
            return jsonData.nonce;
        }
    } catch (error) {
        // JSON değilse regex ile nonce'yi bul
        const nonceMatch = decodedData.match(/nonce["\s]*[:=]["\s]*([a-zA-Z0-9]+)/i);
        if (nonceMatch && nonceMatch[1]) {
            return nonceMatch[1];
        }
    }
    return null;
}

// Ana endpoint
app.get('/sorgu', async (req, res) => {
    try {
        const { id } = req.query;
        
        if (!id) {
            return res.status(400).json({ 
                error: 'ID parametresi gerekli', 
                usage: '/sorgu?id=YOUR_ID' 
            });
        }

        console.log(`ID ile sorgu başlatılıyor: ${id}`);

        // Starmaker sitesinden veri çek
        const response = await axios.get('https://starmaker.id.vn/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);

        // Script tag'ini bul ve base64 verisini çıkar
        let base64Data = null;
        let nonce = null;

        // info-id-sm-script-js-extra script'ini bul
        const targetScript = $('#info-id-sm-script-js-extra');
        
        if (targetScript.length > 0) {
            const scriptSrc = targetScript.attr('src');
            if (scriptSrc && scriptSrc.startsWith('data:text')) {
                // data:text/javascript;base64, kısmını kaldır
                const base64Part = scriptSrc.split(',')[1];
                if (base64Part) {
                    base64Data = base64Part;
                    const decodedData = decodeBase64(base64Data);
                    if (decodedData) {
                        nonce = extractNonce(decodedData);
                        console.log('Decoded data:', decodedData.substring(0, 200) + '...');
                        console.log('Çıkarılan nonce:', nonce);
                    }
                }
            }
        }

        // Alternatif olarak tüm script tag'lerini kontrol et
        if (!nonce) {
            $('script').each((index, element) => {
                const scriptContent = $(element).html() || '';
                const scriptSrc = $(element).attr('src') || '';
                
                // Inline script'lerde nonce ara
                if (scriptContent.includes('nonce')) {
                    const nonceMatch = scriptContent.match(/nonce["\s]*[:=]["\s]*["']([a-zA-Z0-9]+)["']/i);
                    if (nonceMatch && nonceMatch[1]) {
                        nonce = nonceMatch[1];
                        console.log('Script içeriğinden nonce bulundu:', nonce);
                        return false; // jQuery each'den çık
                    }
                }

                // data: URL'lerde base64 ara
                if (scriptSrc.startsWith('data:text') && scriptSrc.includes('base64')) {
                    const base64Part = scriptSrc.split(',')[1];
                    if (base64Part) {
                        const decodedData = decodeBase64(base64Part);
                        if (decodedData) {
                            const foundNonce = extractNonce(decodedData);
                            if (foundNonce) {
                                nonce = foundNonce;
                                base64Data = base64Part;
                                console.log('Data URL\'den nonce bulundu:', nonce);
                                return false; // jQuery each'den çık
                            }
                        }
                    }
                }
            });
        }

        if (!nonce) {
            return res.status(404).json({ 
                error: 'Nonce bulunamadı',
                debug: {
                    scriptsFound: $('script').length,
                    targetScriptFound: targetScript.length > 0,
                    base64DataFound: !!base64Data
                }
            });
        }

        // Payload hazırla
        const payload = {
            id: id,
            nonce: nonce,
            timestamp: Date.now()
        };

        console.log('Gönderilecek payload:', payload);

        // POST isteği gönder
        const apiResponse = await axios.post(`https://starmaker.id.vn/sorgu?id=${id}`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Origin': 'https://starmaker.id.vn',
                'Referer': 'https://starmaker.id.vn/'
            },
            timeout: 15000
        });

        // JSON yanıtını döndür
        res.json({
            success: true,
            data: apiResponse.data,
            debug: {
                nonce: nonce,
                base64Found: !!base64Data,
                payloadSent: payload
            }
        });

    } catch (error) {
        console.error('Hata:', error.message);
        
        let errorDetails = {
            success: false,
            error: error.message,
            type: 'unknown'
        };

        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            errorDetails.type = 'connection';
            errorDetails.message = 'Siteye bağlanılamıyor';
        } else if (error.response) {
            errorDetails.type = 'http';
            errorDetails.statusCode = error.response.status;
            errorDetails.statusText = error.response.statusText;
            errorDetails.data = error.response.data;
        } else if (error.code === 'ECONNABORTED') {
            errorDetails.type = 'timeout';
            errorDetails.message = 'İstek zaman aşımına uğradı';
        }

        res.status(500).json(errorDetails);
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'Starmaker API Proxy',
        timestamp: new Date().toISOString()
    });
});

// Ana sayfa
app.get('/', (req, res) => {
    res.json({
        service: 'Starmaker API Proxy',
        usage: 'GET /sorgu?id=YOUR_ID',
        description: 'Starmaker sitesinden nonce çeker ve API\'ye post gönderir',
        endpoints: {
            '/sorgu?id=ID': 'Ana sorgu endpoint\'i',
            '/health': 'Sistem durumu kontrolü'
        }
    });
});

// Server başlat
app.listen(port, () => {
    console.log(`🚀 Server ${port} portunda çalışıyor`);
    console.log(`📡 Kullanım: http://localhost:${port}/sorgu?id=YOUR_ID`);
    console.log(`❤️  Health check: http://localhost:${port}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Server kapatılıyor...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\nServer kapatılıyor...');
    process.exit(0);
});axios.post
