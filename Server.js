// server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyaları sunar
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Bellekte çalışan kod süreçlerini tutmak için
const runningProcesses = {};

// Kullanıcıdan kod almak için anasayfa
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Node.js Hosting Servisi</title>
            <style>
                body { font-family: sans-serif; padding: 20px; background-color: #282c34; color: #abb2bf; }
                .container { max-width: 800px; margin: auto; background: #333741; padding: 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
                h1 { color: #61afef; text-align: center; }
                p { text-align: center; color: #5c6370; }
                form { display: flex; flex-direction: column; gap: 15px; }
                label { font-weight: bold; color: #c678dd; }
                input[type="text"], textarea { 
                    width: 100%; padding: 10px; border: 1px solid #4b5263; border-radius: 5px; box-sizing: border-box; 
                    background-color: #3b4048; color: #abb2bf; font-family: monospace; 
                }
                button { 
                    background-color: #98c379; color: #282c34; padding: 12px 20px; border: none; border-radius: 5px; 
                    cursor: pointer; font-size: 16px; font-weight: bold; transition: background-color 0.3s;
                }
                button:hover { background-color: #83b169; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Kendi Node.js Kodunu Yayınla</h1>
                <p>Aşağıdaki forma kodunuzu girin. Kodunuz ayrı bir süreçte çalıştırılacak ve çıktısı size gösterilecektir.</p>
                <form action="/publish" method="POST">
                    <label for="id">Proje ID'si:</label>
                    <input type="text" id="id" name="id" required placeholder="Örn: ilk-projem">
                    
                    <label for="code">Kod İçeriği:</label>
                    <textarea id="code" name="code" rows="15" required placeholder="console.log('Merhaba Dünya!');"></textarea>
                    
                    <button type="submit">Yayınla ve Çalıştır</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// Kodun yayınlandığı ve çalıştırıldığı yer
app.post('/publish', (req, res) => {
    const { id, code } = req.body;

    if (!id || !code) {
        return res.status(400).send('ID ve kod içeriği zorunludur.');
    }

    // Önceki süreci durdur (eğer varsa)
    if (runningProcesses[id] && !runningProcesses[id].killed) {
        runningProcesses[id].kill();
        console.log(`Eski süreç durduruldu: ${id}`);
    }

    // Kodu bir dosyaya kaydet
    const filePath = path.join(__dirname, 'hosted-code', `${id}.js`);
    fs.writeFileSync(filePath, code, 'utf-8');

    // Ayrı bir Node.js süreci başlat
    const child = fork(filePath, { silent: true });
    runningProcesses[id] = child;
    console.log(`Yeni süreç başlatıldı: ${id}`);

    // Süreç çıktısını (stdout) yakala ve Socket.IO ile gönder
    const namespace = io.of(`/${id}`);
    child.stdout.on('data', (data) => {
        namespace.emit('log', data.toString());
    });

    // Süreç hata çıktısını (stderr) yakala
    child.stderr.on('data', (data) => {
        namespace.emit('log', `HATA: ${data.toString()}`);
    });

    // Süreç sonlandığında temizle
    child.on('exit', (code, signal) => {
        console.log(`Süreç sonlandı: ${id}, Çıkış Kodu: ${code}`);
        namespace.emit('log', `\n--- Süreç sonlandı (Çıkış Kodu: ${code}) ---`);
        delete runningProcesses[id];
        // Dosyayı sil
        fs.unlinkSync(filePath);
    });

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Yayın Başarılı</title>
            <style>
                body { font-family: sans-serif; padding: 20px; text-align: center; }
                .container { max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ccc; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Kodunuz Çalıştırılıyor!</h1>
                <p>Projeniz başarıyla başlatıldı. Canlı çıktıyı görmek için aşağıdaki bağlantıya tıklayın:</p>
                <a href="/server/${id}">http://localhost:3000/server/${id}</a>
            </div>
        </body>
        </html>
    `);
});

// Çalıştırılan kodun çıktısını gösteren sayfa
app.get('/server/:id', (req, res) => {
    const id = req.params.id;
    if (!runningProcesses[id]) {
        return res.status(404).send('Bu ID ile çalışan bir kod bulunamadı.');
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Sunucu Çıktısı: ${id}</title>
            <style>
                body { font-family: monospace; padding: 20px; background-color: #1e1e1e; color: #d4d4d4; }
                .container { max-width: 900px; margin: auto; }
                h1 { color: #569cd6; text-align: center; }
                .console { 
                    background-color: #252526; 
                    border: 1px solid #3c3c3c; 
                    padding: 15px; 
                    border-radius: 8px; 
                    min-height: 400px; 
                    overflow-y: scroll;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Proje Çıktısı: ${id}</h1>
                <p>Aşağıda kodunuzun canlı konsol çıktısını görebilirsiniz:</p>
                <div class="console" id="console-output"></div>
            </div>
            
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const id = window.location.pathname.split('/').pop();
                const socket = io('/' + id);
                const consoleOutput = document.getElementById('console-output');
                
                socket.on('connect', () => {
                    consoleOutput.innerHTML += '<span style="color: #9cdb84;">--- Sunucuya bağlandı. Canlı çıkış bekleniyor... ---</span><br>';
                });
                
                socket.on('log', (data) => {
                    consoleOutput.innerHTML += data.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '<br>';
                    consoleOutput.scrollTop = consoleOutput.scrollHeight; // En aşağı kaydır
                });

                socket.on('disconnect', () => {
                    consoleOutput.innerHTML += '<span style="color: #f07178;">--- Sunucu bağlantısı kesildi ---</span><br>';
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
