import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Send, LogOut, MessageSquare, Plus, Image as ImageIcon, Smile, X, Search, Settings } from 'lucide-react';
import Auth from './Auth';
import ProfileModal from './ProfileModal';
import './App.css';

const API_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('maximka_token'));
  const [socket, setSocket] = useState(null);
  
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatName, setNewChatName] = useState('');
  
  const [showProfile, setShowProfile] = useState(false);
  
  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Presence map: userId -> status
  const [presenceMap, setPresenceMap] = useState({});

  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (token && !user) {
      try {
        if (!token.includes('.')) throw new Error('Malformed token');
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser({ id: payload.id, username: payload.username, displayName: payload.username });
        // Assume online until proven otherwise, will be updated by server if needed
      } catch (e) {
         handleLogout();
      }
    }
  }, [token]);

  useEffect(() => {
    if (user && token) {
      fetchChats();
      
      const newSocket = io(API_URL, { auth: { token } });
      setSocket(newSocket);

      newSocket.on('message', (msg) => {
        setMessages((prev) => [...prev, msg]);
      });

      newSocket.on('chatHistory', (history) => {
        setMessages(history);
      });
      
      newSocket.on('userPresence', ({ userId, status, lastSeen }) => {
        setPresenceMap(prev => ({...prev, [userId]: { status, lastSeen }}));
      });
      
      newSocket.on('connect_error', (err) => {
        if (err.message.includes('Auth')) handleLogout();
      });

      return () => {
        newSocket.disconnect();
      };
    }
  }, [user, token]);

  const fetchChats = async () => {
    try {
      const res = await fetch(`${API_URL}/api/chats`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setChats(data);
        if (data.length > 0 && !activeChat) joinChat(data[0]);
      }
    } catch (e) {}
  };

  // Debounced search
  useEffect(() => {
    const delay = setTimeout(async () => {
      if (searchQuery.length > 1) {
        try {
          const res = await fetch(`${API_URL}/api/users/search?q=${searchQuery}`, {
             headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) setSearchResults(await res.json());
        } catch(e){}
      } else {
        setSearchResults([]);
      }
    }, 400);
    return () => clearTimeout(delay);
  }, [searchQuery, token]);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!newChatName.trim()) return;
    try {
      const res = await fetch(`${API_URL}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: newChatName, isGroup: true, userIds: [] })
      });
      if (res.ok) {
        const chat = await res.json();
        setChats([...chats, chat]);
        setShowNewChat(false);
        setNewChatName('');
        joinChat(chat);
      }
    } catch (e) {}
  };

  const startDirectChat = async (targetUser) => {
    setSearchQuery('');
    setSearchResults([]);
    try {
      const res = await fetch(`${API_URL}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: null, isGroup: false, userIds: [user.id, targetUser.id] })
      });
      if (res.ok) {
        const chat = await res.json();
        chat.name = targetUser.displayName;
        setChats([...chats, chat]);
        joinChat(chat);
      }
    } catch (e) {}
  };

  const joinChat = (chat) => {
    setActiveChat(chat);
    setMessages([]);
    if (socket) socket.emit('joinChat', chat.id);
  };

  const handleLogout = () => {
    localStorage.removeItem('maximka_token');
    setToken(null);
    setUser(null);
    setChats([]);
    setActiveChat(null);
    setMessages([]);
    if (socket) socket.disconnect();
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (message.trim() && socket && activeChat) {
      socket.emit('sendMessage', { chatId: activeChat.id, text: message, type: 'text' });
      setMessage('');
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeChat || !socket) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    setUploading(true);
    try {
      const res = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.url) {
        socket.emit('sendMessage', { chatId: activeChat.id, type: 'image', mediaUrl: data.url });
      }
    } catch (e) {} finally {
      setUploading(false);
      e.target.value = ''; 
    }
  };

  const sendSticker = (stickerUrl) => {
    if (socket && activeChat) {
      socket.emit('sendMessage', { chatId: activeChat.id, type: 'sticker', mediaUrl: stickerUrl });
    }
  };

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!user) {
    return <Auth onLogin={(u, t) => { setUser(u); setToken(t); }} />;
  }

  return (
    <div className="app-container">
      <div className="messenger-layout">
        
        <aside className="sidebar">
          <div className="sidebar-header" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageSquare color="#6366f1" size={24} />
                <h2 style={{ fontSize: '1.2rem' }}>Maximka</h2>
              </div>
              <button onClick={() => setShowNewChat(true)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }} title="New Group Chat">
                <Plus size={20} />
              </button>
            </div>
            
            <div style={{ position: 'relative' }}>
               <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: 12 }} />
               <input 
                 type="text" 
                 className="input-field" 
                 placeholder="Search users..." 
                 value={searchQuery}
                 onChange={e => setSearchQuery(e.target.value)}
                 style={{ width: '100%', paddingLeft: '34px', fontSize: '0.9rem', padding: '10px 10px 10px 34px' }}
               />
               
               {searchResults.length > 0 && (
                 <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '8px', zIndex: 100, marginTop: '4px', maxHeight: '300px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                   {searchResults.map(su => (
                     <div key={su.id} className="user-item" onClick={() => startDirectChat(su)}>
                       <div className="user-avatar" style={{ backgroundImage: su.avatar ? `url(${API_URL}${su.avatar})` : 'none', backgroundSize: 'cover' }}>
                         {!su.avatar && su.displayName?.[0]?.toUpperCase()}
                       </div>
                       <div className="user-info">
                         <span className="user-name">{su.displayName}</span>
                         <span className="user-status" style={{ color: 'var(--text-muted)' }}>{su.username}</span>
                       </div>
                     </div>
                   ))}
                 </div>
               )}
            </div>
          </div>
          
          <div className="users-list">
            <div className="users-title">Chats</div>
            {chats.map((chat) => (
              <div 
                key={chat.id} 
                className={`user-item ${activeChat?.id === chat.id ? 'active' : ''}`}
                onClick={() => joinChat(chat)}
                style={{ 
                  background: activeChat?.id === chat.id ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                  borderLeft: activeChat?.id === chat.id ? '3px solid var(--primary)' : '3px solid transparent'
                }}
              >
                <div className="user-avatar" style={{ background: 'var(--bg-darker)', backgroundImage: chat.avatar ? `url(${API_URL}${chat.avatar})` : 'none', backgroundSize: 'cover' }}>
                  {!chat.avatar && (chat.isGroup ? '#' : chat.name?.[0]?.toUpperCase())}
                </div>
                <div className="user-info">
                  <span className="user-name">{chat.name || 'Personal Chat'}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="sidebar-footer" style={{ padding: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => setShowProfile(true)}>
               <div className="user-avatar me" style={{ backgroundImage: user.avatar ? `url(${API_URL}${user.avatar})` : 'none', backgroundSize: 'cover' }}>
                 {!user.avatar && user.displayName?.charAt(0).toUpperCase()}
               </div>
               <div style={{ display: 'flex', flexDirection: 'column' }}>
                 <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{user.displayName}</span>
                 <span style={{ fontSize: '0.75rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>Edit Profile <Settings size={10} /></span>
               </div>
             </div>
             <button onClick={handleLogout} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }} title="Logout">
                <LogOut size={18} />
             </button>
          </div>
        </aside>

        <main className="chat-area">
          {activeChat ? (
            <>
              <header className="chat-header">
                <div className="chat-title">
                  <div className="user-avatar" style={{ marginRight: '12px', background: 'var(--bg-darker)' }}>
                    {activeChat.isGroup ? '#' : activeChat.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {activeChat.name || 'Personal Chat'}
                      {!activeChat.isGroup && (
                         <span title="Online presence placeholder" style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'rgb(16, 185, 129)' }}></span>
                      )}
                    </h3>
                    <p>{activeChat.isGroup ? 'Group Chat' : 'End-to-End Chat'}</p>
                  </div>
                </div>
              </header>

              <div className="messages-container">
               {messages.length === 0 && (
                  <div className="system-message">No messages here yet. Start the conversation!</div>
                )}
                {messages.map((msg) => {
                  const isMe = msg.senderId === user.id;
                  return (
                    <div key={msg.id} className={`message-wrapper ${isMe ? 'me' : 'other'}`}>
                      {!isMe && (
                         <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', marginLeft: '4px' }}>
                           {activeChat.isGroup && (
                             <img src={msg.avatar ? `${API_URL}${msg.avatar}` : ''} style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--bg-panel)', display: msg.avatar ? 'block' : 'none' }} alt="" />
                           )}
                           <span className="message-sender">{msg.sender}</span>
                         </div>
                      )}
                      <div className="message-bubble" style={{ minWidth: '80px' }}>
                        {msg.type === 'text' && msg.text}
                        {msg.type === 'image' && (
                          <div style={{ marginTop: '4px' }}>
                            <img src={`${API_URL}${msg.mediaUrl}`} alt="attachment" style={{ maxWidth: '100%', maxHeight: '250px', borderRadius: '8px' }} />
                          </div>
                        )}
                        {msg.type === 'sticker' && (
                          <div style={{ fontSize: '48px', lineHeight: 1, marginTop: '4px' }}>{msg.mediaUrl}</div>
                        )}
                        
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                          <span className="message-time">{formatTime(msg.createdAt)}</span>
                          {isMe && <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.65rem', marginLeft: '4px' }}>✓✓</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="input-area">
                <form className="input-form" onSubmit={handleSendMessage}>
                  <input type="file" accept="image/*" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileUpload} />
                  
                  <button type="button" className="btn-icon" title="Upload Photo" disabled={uploading} onClick={() => fileInputRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px' }}>
                    <ImageIcon size={22} color={uploading ? 'gray' : 'var(--text-muted)'} />
                  </button>

                  <button type="button" className="btn-icon" title="Send Sticker" onClick={() => sendSticker('🔥')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px' }}>
                    <Smile size={22} color="var(--text-muted)" />
                  </button>

                  <input type="text" className="chat-input" placeholder="Type a message..." value={message} onChange={(e) => setMessage(e.target.value)} />
                  
                  <button type="submit" className="btn-send" disabled={(!message.trim() && !uploading)}>
                    <Send size={20} />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexDirection: 'column', gap: '16px' }}>
              <MessageSquare size={48} opacity={0.2} />
              <p>Select a chat or find a user to start messaging</p>
            </div>
          )}
        </main>
        
        {showNewChat && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '400px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ margin: 0 }}>Create Group Chat</h3>
                <button onClick={() => setShowNewChat(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><X size={20} /></button>
              </div>
              <form onSubmit={handleCreateGroup}>
                <input type="text" className="input-field" style={{ width: '100%', marginBottom: '16px' }} placeholder="Group Name" value={newChatName} onChange={e => setNewChatName(e.target.value)} autoFocus />
                <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={!newChatName.trim()}>Create Group</button>
              </form>
            </div>
          </div>
        )}
        
        {showProfile && (
           <ProfileModal 
             user={user} 
             token={token} 
             API_URL={API_URL} 
             onClose={() => setShowProfile(false)} 
             onUpdate={(updatedUser) => setUser(updatedUser)} 
           />
        )}
      </div>
    </div>
  );
}

export default App;
