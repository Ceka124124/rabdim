// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// 🔹 CORS ayarı
app.use(cors({
    origin: "*", // Güvenlik için burada kendi frontend domainini yazabilirsin
    methods: ["GET", "POST"]
}));

const io = new Server(server, {
    cors: {
        origin: "*", // Örn: "https://senin-frontend.web.app"
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Oyun verileri
const rooms = {};

io.on('connection', (socket) => {
    console.log(`Yeni bir kullanıcı bağlandı: ${socket.id}`);

    // Odaya katılma
    socket.on('joinRoom', (data) => {
        const { roomName, playerName } = data;
        let room = rooms[roomName];

        if (!room) {
            room = {
                players: {},
                spectators: {},
                state: 'waiting',
                currentPlayerIndex: 0,
                questions: [],
                playerAnswers: {},
                playerGuesses: {}
            };
            rooms[roomName] = room;
        }

        // Oyuncu kapasitesi dolmuşsa izleyici ekle
        if (Object.keys(room.players).length >= 2) {
            room.spectators[socket.id] = { name: playerName };
            socket.join(roomName);
            socket.emit('spectatorMode', 'İzleyici olarak bağlandınız.');
            io.to(socket.id).emit('updatePlayers', room.players);
            io.to(socket.id).emit('stateChange', { state: room.state });
            console.log(`${playerName} ${roomName} odasına izleyici olarak katıldı.`);
            return;
        }

        // Oyuncu ekle
        room.players[socket.id] = { name: playerName, score: 0 };
        socket.join(roomName);

        if (Object.keys(room.players).length === 2) {
            room.state = 'answering_p1';
            const playerIds = Object.keys(room.players);
            io.to(playerIds[0]).emit('yourTurnToAnswer', 'Sıra sizde, soruları cevaplayın.');
            io.to(playerIds[1]).emit('waitingForPartner', `${room.players[playerIds[0]].name} cevap veriyor.`);
            io.to(roomName).emit('stateChange', { state: room.state });
        }

        io.to(roomName).emit('updatePlayers', room.players);
        console.log(`${playerName} oyuncusu ${roomName} odasına katıldı.`);
    });

    // Cevap gönderme
    socket.on('submitAnswer', (data) => {
        const { roomName, answer } = data;
        const room = rooms[roomName];
        if (!room || (room.state !== 'answering_p1' && room.state !== 'answering_p2')) return;

        if (room.spectators[socket.id]) {
            socket.emit('notAllowed', 'İzleyiciler oynayamaz.');
            return;
        }

        const playerIds = Object.keys(room.players);
        const answeringPlayerId = room.state === 'answering_p1' ? playerIds[0] : playerIds[1];

        if (socket.id !== answeringPlayerId) {
            socket.emit('notYourTurn', 'Sıra sizde değil.');
            return;
        }

        room.playerAnswers[socket.id] = answer;

        if (room.state === 'answering_p1') {
            room.state = 'guessing_p2';
            io.to(playerIds[1]).emit('yourTurnToGuess', `Eşiniz ${room.players[playerIds[0]].name} cevap verdi, tahmin edin!`);
            io.to(playerIds[0]).emit('waitingForPartner', `Eşiniz ${room.players[playerIds[1]].name} tahmin ediyor.`);
        }
    });

    // Tahmin gönderme
    socket.on('submitGuess', (data) => {
        const { roomName, guess } = data;
        const room = rooms[roomName];
        if (!room || (room.state !== 'guessing_p1' && room.state !== 'guessing_p2')) return;

        if (room.spectators[socket.id]) {
            socket.emit('notAllowed', 'İzleyiciler oynayamaz.');
            return;
        }

        const playerIds = Object.keys(room.players);
        const guessingPlayerId = room.state === 'guessing_p1' ? playerIds[0] : playerIds[1];

        if (socket.id !== guessingPlayerId) {
            socket.emit('notYourTurn', 'Sıra sizde değil.');
            return;
        }

        const partnerId = playerIds.find(id => id !== guessingPlayerId);
        const correctAnswer = room.playerAnswers[partnerId];

        if (guess === correctAnswer) {
            room.players[guessingPlayerId].score += 10;
            io.to(roomName).emit('scoreUpdate', {
                player: room.players[guessingPlayerId].name,
                score: room.players[guessingPlayerId].score
            });
        }

        if (room.state === 'guessing_p2') {
            room.playerAnswers = {};
            room.playerGuesses = {};
            room.state = 'answering_p2';
            io.to(playerIds[1]).emit('yourTurnToAnswer', 'Sıra sizde, soruları cevaplayın.');
            io.to(playerIds[0]).emit('waitingForPartner', `${room.players[playerIds[1]].name} cevap veriyor.`);
        } else if (room.state === 'guessing_p1') {
            room.state = 'finished';
            const sortedPlayers = Object.values(room.players).sort((a, b) => b.score - a.score);
            const winner = sortedPlayers[0];
            io.to(roomName).emit('endGame', {
                message: `Oyun bitti! En iyi eş: ${winner.name}!`
            });
        }
        io.to(roomName).emit('stateChange', { state: room.state });
    });

    // 🔹 Canlı Yazılı Sohbet
    socket.on('chatMessage', (data) => {
        const { roomName, playerName, message } = data;
        if (!rooms[roomName]) return;

        io.to(roomName).emit('chatMessage', {
            player: playerName,
            message,
            time: new Date().toLocaleTimeString()
        });
    });

    // 🔹 Sesli Sohbet (WebRTC sinyalleme)
    socket.on('voiceOffer', (data) => {
        io.to(data.to).emit('voiceOffer', { from: socket.id, sdp: data.sdp });
    });

    socket.on('voiceAnswer', (data) => {
        io.to(data.to).emit('voiceAnswer', { from: socket.id, sdp: data.sdp });
    });

    socket.on('iceCandidate', (data) => {
        io.to(data.to).emit('iceCandidate', { from: socket.id, candidate: data.candidate });
    });

    // Bağlantı kopunca
    socket.on('disconnect', () => {
        console.log(`Kullanıcı bağlantısı kesildi: ${socket.id}`);
        for (const roomName in rooms) {
            const room = rooms[roomName];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                if (Object.keys(room.players).length === 0 && Object.keys(room.spectators).length === 0) {
                    delete rooms[roomName];
                } else {
                    io.to(roomName).emit('updatePlayers', room.players);
                }
                break;
            }
            if (room.spectators[socket.id]) {
                delete room.spectators[socket.id];
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
