// server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyaları sunmak için "public" klasörünü kullan
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Her ID için kod içeriğini tutan basit bir bellek veritabanı
const codeStore = {};

// ---
// ## 1. Ana Sayfa: Kod Giriş Formu
// ---
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Node.js Kod Sunucusu</title>
            <style>
                body { font-family: sans-serif; padding: 20px; background-color: #f4f4f9; color: #333; }
                .container { max-width: 800px; margin: auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                h1 { color: #2c3e50; text-align: center; }
                p { text-align: center; color: #7f8c8d; }
                form { display: flex; flex-direction: column; gap: 15px; }
                label { font-weight: bold; color: #555; }
                input[type="text"], textarea { 
                    width: 100%; 
                    padding: 10px; 
                    border: 1px solid #ccc; 
                    border-radius: 5px; 
                    box-sizing: border-box; 
                    font-family: monospace; 
                }
                button { 
                    background-color: #3498db; 
                    color: white; 
                    padding: 12px 20px; 
                    border: none; 
                    border-radius: 5px; 
                    cursor: pointer; 
                    font-size: 16px; 
                    transition: background-color 0.3s;
                }
                button:hover { background-color: #2980b9; }
                .link-box { 
                    margin-top: 20px; 
                    padding: 15px; 
                    background-color: #e8f5e9; 
                    border: 1px solid #c8e6c9; 
                    border-radius: 5px; 
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Yeni Bir Kod Sunucusu Oluştur</h1>
                <p>Kendi ID'nizi ve kodunuzu girerek özel bir sunucu sayfası oluşturun.</p>
                <form action="/publish" method="POST">
                    <label for="id">Sunucu ID'si:</label>
                    <input type="text" id="id" name="id" required placeholder="Örn: benim-projem">
                    
                    <label for="code">Kod İçeriği:</label>
                    <textarea id="code" name="code" rows="15" required placeholder="const http = require('http'); ..."></textarea>
                    
                    <button type="submit">Yayınla</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// ---
// ## 2. Kod Yayınlama ve Link Oluşturma
// ---
app.post('/publish', (req, res) => {
    const { id, code } = req.body;

    if (!id || !code) {
        return res.status(400).send('ID ve kod içeriği zorunludur.');
    }

    // Kod içeriğini bellekte sakla
    codeStore[id] = code;
    console.log(`Yeni kod kaydedildi: ID -> ${id}`);

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Başarılı</title>
            <style>
                body { font-family: sans-serif; padding: 20px; text-align: center; }
                .container { max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ccc; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Kodunuz Başarıyla Yayınlandı!</h1>
                <p>Sunucunuz hazır. Aşağıdaki bağlantıya tıklayarak kodunuza erişin:</p>
                <a href="/server/${id}">http://localhost:3000/server/${id}</a>
            </div>
        </body>
        </html>
    `);
});

// ---
// ## 3. Özel ID Sunucu Sayfası
// ---
app.get('/server/:id', (req, res) => {
    const id = req.params.id;
    if (!codeStore[id]) {
        return res.status(404).send('Bu ID ile kayıtlı bir kod bulunamadı.');
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Sunucu: ${id}</title>
            <style>
                body { font-family: sans-serif; padding: 20px; background-color: #2c3e50; color: #ecf0f1; }
                .container { max-width: 900px; margin: auto; padding: 20px; }
                h1 { color: #3498db; text-align: center; }
                pre { 
                    background-color: #34495e; 
                    padding: 15px; 
                    border-radius: 8px; 
                    overflow-x: auto; 
                    white-space: pre-wrap;
                    word-wrap: break-word;
                }
                code { color: #f1c40f; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Sunucu ID: ${id}</h1>
                <p>Bu sunucuya ait kod içeriği:</p>
                <pre id="code-display"><code>${codeStore[id]}</code></pre>
            </div>
        </body>
        </html>
    `);
});

// ---
// ## 4. Socket.IO Namespace ve Bağlantı Yönetimi
// ---
io.on('connection', (socket) => {
    console.log('Bir kullanıcı genel sunucuya bağlandı.');
    
    socket.on('disconnect', () => {
        console.log('Genel sunucudan bir kullanıcı ayrıldı.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor.`);
});
