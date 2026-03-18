const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initDB } = require('./db');

const router = express.Router();
const JWT_SECRET = 'maximka-secret-key-change-in-production';

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const db = await initDB();
    const existing = await db.get('SELECT * FROM Users WHERE username = ?', [username]);
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // Setting displayName default to username
    const result = await db.run(
      'INSERT INTO Users (username, password, displayName) VALUES (?, ?, ?)',
      [username, hashedPassword, username]
    );

    const token = jwt.sign({ id: result.lastID, username }, JWT_SECRET);
    
    // Add user to global chat by default
    await db.run('INSERT OR IGNORE INTO ChatMembers (chatId, userId) VALUES (1, ?)', [result.lastID]);

    res.status(201).json({ 
      token, 
      user: { id: result.lastID, username, displayName: username, onlineStatus: 'online' } 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const db = await initDB();
    const user = await db.get('SELECT * FROM Users WHERE username = ?', [username]);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        displayName: user.displayName,
        avatar: user.avatar,
        statusText: user.statusText,
        onlineStatus: user.onlineStatus
      } 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = { router, verifyToken, JWT_SECRET };
