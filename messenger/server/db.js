const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

let dbInstance = null;

async function initDB() {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await dbInstance.run('PRAGMA foreign_keys = ON');

  // We use IF NOT EXISTS, but during massive schema changes, 
  // you might need to drop tables manually if developing locally.
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT,
      displayName TEXT,
      statusText TEXT,
      onlineStatus TEXT DEFAULT 'offline',    -- 'online', 'offline', 'dnd', 'invisible'
      lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,                              -- Optional for 1on1
      isGroup BOOLEAN DEFAULT 0,
      avatar TEXT,
      description TEXT,
      ownerId INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ownerId) REFERENCES Users(id)
    );

    CREATE TABLE IF NOT EXISTS ChatMembers (
      chatId INTEGER,
      userId INTEGER,
      role TEXT DEFAULT 'member',             -- 'member', 'admin', 'owner'
      joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chatId, userId),
      FOREIGN KEY(chatId) REFERENCES Chats(id) ON DELETE CASCADE,
      FOREIGN KEY(userId) REFERENCES Users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS Messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER,
      senderId INTEGER,
      text TEXT,
      type TEXT DEFAULT 'text',               -- 'text', 'image', 'video', 'audio', 'doc', 'sticker', 'gif'
      mediaUrl TEXT,
      replyToId INTEGER,                      -- For replying to specific messages
      forwardedFromId INTEGER,                -- For forwarded messages
      isEdited BOOLEAN DEFAULT 0,
      isDeleted BOOLEAN DEFAULT 0,            -- True if deleted for everyone
      status TEXT DEFAULT 'sent',             -- 'sent', 'delivered', 'read'
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(chatId) REFERENCES Chats(id) ON DELETE CASCADE,
      FOREIGN KEY(senderId) REFERENCES Users(id) ON DELETE SET NULL,
      FOREIGN KEY(replyToId) REFERENCES Messages(id) ON DELETE SET NULL,
      FOREIGN KEY(forwardedFromId) REFERENCES Messages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ReadReceipts (
      chatId INTEGER,
      userId INTEGER,
      lastReadMessageId INTEGER,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chatId, userId),
      FOREIGN KEY(chatId) REFERENCES Chats(id) ON DELETE CASCADE,
      FOREIGN KEY(userId) REFERENCES Users(id) ON DELETE CASCADE,
      FOREIGN KEY(lastReadMessageId) REFERENCES Messages(id) ON DELETE SET NULL
    );
  `);

  // Create a default global chat if none exists
  const globalChat = await dbInstance.get('SELECT * FROM Chats WHERE id = 1');
  if (!globalChat) {
    await dbInstance.run('INSERT INTO Chats (id, name, isGroup, description) VALUES (1, "Global Maximka Room", 1, "Welcome to Maximka!")');
  }

  return dbInstance;
}

module.exports = { initDB };
