import React, { useState, useRef } from 'react';
import { Settings, Save, X, Camera } from 'lucide-react';

export default function ProfileModal({ user, token, API_URL, onClose, onUpdate }) {
  const [displayName, setDisplayName] = useState(user.displayName || user.username);
  const [statusText, setStatusText] = useState(user.statusText || '');
  const [avatarPreview, setAvatarPreview] = useState(user.avatar ? `${API_URL}${user.avatar}` : null);
  const [loading, setLoading] = useState(false);
  
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    const formData = new FormData();
    formData.append('displayName', displayName);
    formData.append('statusText', statusText);
    
    if (fileInputRef.current?.files[0]) {
      formData.append('avatar', fileInputRef.current.files[0]);
    }
    
    try {
      const res = await fetch(`${API_URL}/api/users/profile`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        onUpdate(data.user);
        onClose();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={20} /> Edit Profile
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ alignSelf: 'center', position: 'relative', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
            <div className="user-avatar" style={{ width: '80px', height: '80px', fontSize: '2rem' }}>
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                user.displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div style={{ position: 'absolute', bottom: -5, right: -5, background: 'var(--primary)', padding: '6px', borderRadius: '50%' }}>
               <Camera size={14} color="white" />
            </div>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept="image/*" />
          </div>
          
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Display Name</label>
            <input 
              type="text" 
              className="input-field" 
              style={{ width: '100%', marginTop: '4px' }}
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              required
            />
          </div>
          
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Status Text / Bio</label>
            <input 
              type="text" 
              className="input-field" 
              style={{ width: '100%', marginTop: '4px' }}
              placeholder="What's on your mind?"
              value={statusText}
              onChange={e => setStatusText(e.target.value)}
            />
          </div>
          
          <button type="submit" className="btn-primary" style={{ marginTop: '10px' }} disabled={loading}>
            <Save size={18} /> {loading ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </div>
    </div>
  );
}
