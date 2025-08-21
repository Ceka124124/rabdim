const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Dominos sunucusu çalışıyor!');
});

const rooms = {};

function createInitialRoomState() {
    return {
        players: {},
        playerCount: 0,
        dominoes: createDominoes(),
        gameStarted: false,
        hostId: null,
        turn: null,
        gameBoard: []
    };
}

function createDominoes() {
    const newDominoes = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            newDominoes.push([i, j]);
        }
    }
    return newDominoes;
}

function shuffleDominoes(dominoes) {
    for (let i = dominoes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [dominoes[i], dominoes[j]] = [dominoes[j], dominoes[i]];
    }
}

// Bir sonraki oyuncuyu belirleme
function getNextPlayerTurn(currentTurn, playerIds) {
    const currentIndex = playerIds.indexOf(currentTurn);
    const nextIndex = (currentIndex + 1) % playerIds.length;
    return playerIds[nextIndex];
}

// Domino taşı geçerliliğini kontrol etme
function isValidMove(domino, gameBoard) {
    if (gameBoard.length === 0) {
        // İlk taş her zaman geçerlidir
        return true;
    }
    const leftEnd = gameBoard[0][0];
    const rightEnd = gameBoard[gameBoard.length - 1][1];
    
    // Taşın iki ucundaki sayılardan biri, oyun tahtasının uçlarıyla eşleşmeli
    return (domino[0] === leftEnd || domino[0] === rightEnd || domino[1] === leftEnd || domino[1] === rightEnd);
}

io.on('connection', (socket) => {
    console.log(`Yeni bir oyuncu bağlandı: ${socket.id}`);

    socket.on('join-room', (data) => {
        const { username, roomId } = data;

        if (!username || !roomId) {
            socket.emit('error', 'Kullanıcı adı ve oda ID\'si gerekli.');
            return;
        }

        if (rooms[roomId] && rooms[roomId].gameStarted) {
            socket.emit('error', 'Oyun bu odada zaten başladı, katılamazsınız.');
            return;
        }

        if (!rooms[roomId]) {
            rooms[roomId] = createInitialRoomState();
            rooms[roomId].hostId = socket.id;
            socket.emit('is-host', true);
            console.log(`Oda ${roomId} oluşturuldu. Host: ${username}`);
        } else {
            socket.emit('is-host', false);
        }

        const room = rooms[roomId];
        if (room.playerCount >= 4) {
            socket.emit('error', 'Oda dolu.');
            return;
        }

        socket.join(roomId);
        room.players[socket.id] = { id: socket.id, username, hand: [], score: 0 };
        room.playerCount++;

        io.to(roomId).emit('player-update', Object.values(room.players).map(p => ({
            username: p.username,
            id: p.id,
            handSize: p.hand.length 
        })));

        socket.emit('room-joined', { username, roomId });
        console.log(`${username} oyuncusu ${roomId} odasına katıldı.`);
    });

    socket.on('shuffle-and-deal', (roomId) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('error', 'Oda bulunamadı.');
            return;
        }
        if (room.hostId !== socket.id || room.gameStarted) {
            socket.emit('error', 'Bu işlemi yapmaya yetkiniz yok.');
            return;
        }

        room.gameStarted = true;
        shuffleDominoes(room.dominoes);

        const playerIds = Object.keys(room.players);
        playerIds.forEach(playerId => {
            room.players[playerId].hand = room.dominoes.splice(0, 7);
            io.to(playerId).emit('your-hand', room.players[playerId].hand);
        });

        room.turn = playerIds[Math.floor(Math.random() * playerIds.length)];
        io.to(roomId).emit('game-state', {
            status: 'başladı',
            message: 'Oyun başladı, taşlar dağıtıldı!',
            turn: room.turn
        });

        io.to(roomId).emit('player-update', Object.values(room.players).map(p => ({
            username: p.username,
            id: p.id,
            handSize: p.hand.length
        })));
    });
    
    socket.on('place-domino', (data) => {
        const { roomId, domino } = data;
        const room = rooms[roomId];

        if (!room || room.turn !== socket.id || !room.gameStarted) {
            socket.emit('error', 'Sıra sizde değil veya oyun başlamadı.');
            return;
        }

        const playerHand = room.players[socket.id].hand;
        const dominoIndex = playerHand.findIndex(d => d[0] === domino[0] && d[1] === domino[1]);

        if (dominoIndex === -1) {
            socket.emit('error', 'Bu taş elinizde bulunmuyor.');
            return;
        }

        if (!isValidMove(domino, room.gameBoard)) {
            socket.emit('error', 'Bu taş uygun değil.');
            return;
        }
        
        // Taşı elden çıkar ve tahtaya ekle
        playerHand.splice(dominoIndex, 1);
        room.gameBoard.push(domino);

        // Kazanma kontrolü
        if (playerHand.length === 0) {
            io.to(roomId).emit('game-over', { winner: room.players[socket.id].username });
            delete rooms[roomId]; // Oyunu bitir ve odayı sil
            return;
        }

        // Sıradaki oyuncuyu belirle
        const playerIds = Object.keys(room.players);
        room.turn = getNextPlayerTurn(socket.id, playerIds);
        
        io.to(roomId).emit('turn-update', room.turn);
        io.to(roomId).emit('board-update', room.gameBoard);
        io.to(roomId).emit('player-update', Object.values(room.players).map(p => ({
            username: p.username,
            id: p.id,
            handSize: p.hand.length
        })));
    });

    socket.on('draw-domino', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.turn !== socket.id || !room.gameStarted) {
            socket.emit('error', 'Sıra sizde değil veya oyun başlamadı.');
            return;
        }

        if (room.dominoes.length > 0) {
            const drawnDomino = room.dominoes.pop();
            room.players[socket.id].hand.push(drawnDomino);
            socket.emit('domino-drawn', drawnDomino);
            
            // Sıra hala aynı oyuncuda kalabilir, çünkü taş çekmek pas geçmek sayılır
            // Ancak, taş çekince sıra otomatik olarak diğer oyuncuya geçecekse aşağıdaki satırları kullanabilirsiniz.
            // const playerIds = Object.keys(room.players);
            // room.turn = getNextPlayerTurn(socket.id, playerIds);
            // io.to(roomId).emit('turn-update', room.turn);
            
            io.to(roomId).emit('player-update', Object.values(room.players).map(p => ({
                username: p.username,
                id: p.id,
                handSize: p.hand.length
            })));

        } else {
            socket.emit('error', 'Çekilecek taş kalmadı.');
        }
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.players[socket.id]) {
                const username = room.players[socket.id].username;
                delete room.players[socket.id];
                room.playerCount--;

                if (room.hostId === socket.id) {
                    const remainingPlayers = Object.keys(room.players);
                    if (remainingPlayers.length > 0) {
                        room.hostId = remainingPlayers[0];
                        io.to(room.hostId).emit('is-host', true);
                    } else {
                        delete rooms[roomId];
                        console.log(`Oda ${roomId} silindi.`);
                        return;
                    }
                }

                io.to(roomId).emit('player-update', Object.values(room.players).map(p => ({
                    username: p.username,
                    id: p.id,
                    handSize: p.hand.length
                })));
                console.log(`${username} oyuncusu ${roomId} odasından ayrıldı.`);
                break;
            }
        }
        console.log(`Bir oyuncu ayrıldı: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
    
