const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { initDB } = require('./db');
const { router: authRouter, verifyToken } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

// Setup uploads folders
const dirs = ['uploads', 'stickers', 'avatars'];
dirs.forEach(d => {
  const p = path.join(__dirname, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p);
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (req.path.includes('/api/users/profile')) {
      cb(null, 'avatars/');
    } else {
      cb(null, 'uploads/');
    }
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

app.use('/uploads', express.static('uploads'));
app.use('/stickers', express.static('stickers'));
app.use('/avatars', express.static('avatars'));

// Routes
app.use('/api/auth', authRouter);

// Database initialization
let db;
initDB().then(database => {
  db = database;
}).catch(console.error);

// Auth Middleware for API
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
};

app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.get('/api/chats', authMiddleware, async (req, res) => {
  try {
    const chats = await db.all(`
      SELECT c.* FROM Chats c
      JOIN ChatMembers cm ON c.id = cm.chatId
      WHERE cm.userId = ?
    `, [req.user.id]);
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/chats', authMiddleware, async (req, res) => {
  const { name, isGroup, userIds } = req.body; // userIds expects [creatorId, targetId] for 1on1
  
  if (!name && isGroup) return res.status(400).json({ error: 'Group chat name required' });

  try {
    // If it's a 1on1, check if one already exists between these precise two members
    if (!isGroup && userIds && userIds.length === 2) {
       const u1 = userIds[0];
       const u2 = userIds[1];
       const existingDirect = await db.get(`
         SELECT c.id FROM Chats c
         JOIN ChatMembers m1 ON c.id = m1.chatId
         JOIN ChatMembers m2 ON c.id = m2.chatId
         WHERE c.isGroup = 0 AND m1.userId = ? AND m2.userId = ?
       `, [u1, u2]);
       
       if (existingDirect) {
          const chat = await db.get('SELECT * FROM Chats WHERE id = ?', [existingDirect.id]);
          return res.status(200).json(chat);
       }
    }

    const result = await db.run('INSERT INTO Chats (name, isGroup, ownerId) VALUES (?, ?, ?)', [name || null, isGroup ? 1 : 0, req.user.id]);
    const chatId = result.lastID;
    
    // Add creator
    await db.run('INSERT INTO ChatMembers (chatId, userId, role) VALUES (?, ?, "owner")', [chatId, req.user.id]);
    
    // Add other users if provided
    if (userIds && Array.isArray(userIds)) {
      for (const uid of userIds) {
         if (uid !== req.user.id) {
           await db.run('INSERT INTO ChatMembers (chatId, userId, role) VALUES (?, ?, "member")', [chatId, uid]);
         }
      }
    }
    
    const newChat = await db.get('SELECT * FROM Chats WHERE id = ?', [chatId]);
    res.status(201).json(newChat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// User Search
app.get('/api/users/search', authMiddleware, async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);
  try {
    const users = await db.all(`
      SELECT id, username, displayName, avatar, statusText, onlineStatus, lastSeen
      FROM Users 
      WHERE username LIKE ? OR displayName LIKE ?
      LIMIT 20
    `, [`%${q}%`, `%${q}%`]);
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Search error' });
  }
});

// Update Profile
app.post('/api/users/profile', authMiddleware, upload.single('avatar'), async (req, res) => {
  const { displayName, statusText } = req.body;
  let avatarUrl = req.file ? `/avatars/${req.file.filename}` : undefined;
  
  try {
    const user = await db.get('SELECT * FROM Users WHERE id = ?', [req.user.id]);
    const nextAvatar = avatarUrl || user.avatar;
    const nextName = displayName || user.displayName;
    const nextStatus = statusText !== undefined ? statusText : user.statusText;
    
    await db.run(`
      UPDATE Users SET displayName = ?, statusText = ?, avatar = ? WHERE id = ?
    `, [nextName, nextStatus, nextAvatar, req.user.id]);
    
    res.json({ success: true, user: { ...user, displayName: nextName, statusText: nextStatus, avatar: nextAvatar } });
  } catch (e) {
    res.status(500).json({ error: 'Database update error' });
  }
});

// Socket.IO setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Track which sockets belong to which user (userId -> Set<socketId>)
const userSocketsMap = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Auth error'));
  const user = verifyToken(token);
  if (!user) return next(new Error('Invalid token'));
  socket.user = user;
  next();
});

io.on('connection', async (socket) => {
  const userId = socket.user.id;
  
  if (!userSocketsMap.has(userId)) {
    userSocketsMap.set(userId, new Set());
    // Marking user online
    if (db) {
       await db.run('UPDATE Users SET onlineStatus = "online" WHERE id = ?', [userId]);
       io.emit('userPresence', { userId, status: 'online' });
    }
  }
  userSocketsMap.get(userId).add(socket.id);

  socket.on('joinChat', async (chatId) => {
    // Leave previous chat rooms
    socket.rooms.forEach(room => {
      if (room !== socket.id) socket.leave(room);
    });
    
    socket.join(chatId.toString());
    
    // Fetch older messages (now supporting more fields)
    if (db) {
      try {
        const messages = await db.all(`
          SELECT m.*, u.displayName as sender, u.avatar 
          FROM Messages m 
          LEFT JOIN Users u ON m.senderId = u.id 
          WHERE m.chatId = ? 
          ORDER BY m.createdAt ASC LIMIT 100
        `, [chatId]);
        
        socket.emit('chatHistory', messages);
      } catch (err) {}
    }
  });

  socket.on('sendMessage', async (data) => {
    const { chatId, text, type, mediaUrl, replyToId } = data;
    if (!chatId) return;

    try {
      const result = await db.run(
        'INSERT INTO Messages (chatId, senderId, text, type, mediaUrl, replyToId) VALUES (?, ?, ?, ?, ?, ?)',
        [chatId, userId, text || '', type || 'text', mediaUrl || null, replyToId || null]
      );

      // fetch user display name for broadcast
      const userObj = await db.get('SELECT displayName, avatar FROM Users WHERE id = ?', [userId]);

      const msgObj = {
        id: result.lastID,
        chatId,
        senderId: userId,
        sender: userObj ? userObj.displayName : 'Unknown',
        avatar: userObj ? userObj.avatar : null,
        text: text || '',
        type: type || 'text',
        mediaUrl: mediaUrl || null,
        replyToId: replyToId || null,
        isEdited: 0,
        isDeleted: 0,
        status: 'sent',
        createdAt: new Date().toISOString()
      };

      io.to(chatId.toString()).emit('message', msgObj);
    } catch (err) {}
  });

  socket.on('typing', ({ chatId, isTyping }) => {
    socket.to(chatId.toString()).emit('typingIndicator', { chatId, userId, isTyping });
  });

  socket.on('editMessage', async ({ messageId, chatId, newText }) => {
    if (!db) return;
    try {
      const msg = await db.get('SELECT * FROM Messages WHERE id = ? AND senderId = ?', [messageId, userId]);
      if (msg && !msg.isDeleted) {
         await db.run('UPDATE Messages SET text = ?, isEdited = 1 WHERE id = ?', [newText, messageId]);
         io.to(chatId.toString()).emit('messageUpdated', { id: messageId, chatId, text: newText, isEdited: 1 });
      }
    } catch(e) {}
  });

  socket.on('deleteMessage', async ({ messageId, chatId, forEveryone }) => {
    if (!db) return;
    try {
      const msg = await db.get('SELECT * FROM Messages WHERE id = ? AND senderId = ?', [messageId, userId]);
      if (msg) {
         if (forEveryone) {
           await db.run('UPDATE Messages SET isDeleted = 1, text = "This message was deleted", mediaUrl = NULL WHERE id = ?', [messageId]);
           io.to(chatId.toString()).emit('messageDeleted', { id: messageId, chatId });
         } else {
           // For deleting just for self, we'd need a separate table or complex join logic.
           // Due to schema simplicity, let's just do a soft delete for everyone if they own it.
         }
      }
    } catch(e) {}
  });

  socket.on('readMessage', async ({ chatId, messageId }) => {
    if (!db) return;
    try {
       await db.run(`
         INSERT INTO ReadReceipts (chatId, userId, lastReadMessageId) VALUES (?, ?, ?)
         ON CONFLICT(chatId, userId) DO UPDATE SET lastReadMessageId = ?, updatedAt = CURRENT_TIMESTAMP
       `, [chatId, userId, messageId, messageId]);
       
       socket.to(chatId.toString()).emit('messagesRead', { chatId, userId, lastReadMessageId: messageId });
    } catch(e) {}
  });

  socket.on('disconnect', async () => {
    if (userSocketsMap.has(userId)) {
      const sockets = userSocketsMap.get(userId);
      sockets.delete(socket.id);
      
      if (sockets.size === 0) {
        userSocketsMap.delete(userId);
        // Mark user offline
        if (db) {
           await db.run('UPDATE Users SET onlineStatus = "offline", lastSeen = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
           io.emit('userPresence', { userId, status: 'offline', lastSeen: new Date().toISOString() });
        }
      }
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Maximka server running on port ${PORT}`);
});
