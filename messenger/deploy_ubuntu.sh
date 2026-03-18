#!/bin/bash

# ==========================================================
# Maximka Messenger - Ubuntu Deployment Script (Caddy & Systemd)
# ==========================================================
# Run this script as root or with sudo to setup everything.
# Usage: sudo ./deploy_ubuntu.sh

echo "Starting Maximka Deployment on Ubuntu..."

PROJECT_DIR="/opt/maximka"

# 1. Update system and install required tools
echo "Updating packages..."
apt update && apt upgrade -y
apt install -y curl git build-essential debian-keyring debian-archive-keyring apt-transport-https

# 2. Install Node.js (v20)
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Install Caddy
echo "Installing Caddy..."
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install caddy -y

# 4. Clone / Setup Project Repository 
echo "Creating project directory at $PROJECT_DIR..."
mkdir -p $PROJECT_DIR
cp -r ./* $PROJECT_DIR/ # Copy current directory contents to /opt/maximka

# 5. Build and Start Backend
echo "Setting up Backend Server..."
cd $PROJECT_DIR/server
npm install

# 6. Create Systemd Service for Node.js Backend
echo "Creating systemd service 'maximka.service'..."
cat > /etc/systemd/system/maximka.service << EOF
[Unit]
Description=Maximka NodeJS Server
After=network.target

[Service]
Environment=NODE_ENV=production
Environment=PORT=3001
Type=simple
User=root
WorkingDirectory=$PROJECT_DIR/server
ExecStart=/usr/bin/node $PROJECT_DIR/server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

echo "Reloading systemd, starting and enabling Maximka service..."
systemctl daemon-reload
systemctl enable maximka.service
systemctl restart maximka.service

# 7. Build Frontend
echo "Building Frontend Client..."
cd $PROJECT_DIR/client
npm install
npm run build
# Built files are now in /opt/maximka/client/dist

# 8. Setup Caddyfile
echo "Configuring Caddy..."
cat > /etc/caddy/Caddyfile << EOF
lamanga.phareal.ru {
    # Reverse proxy API requests to Node.js Backend
    handle /api/* {
        reverse_proxy localhost:3001
    }
    
    # Reverse proxy Socket.IO requests
    handle /socket.io/* {
        reverse_proxy localhost:3001
    }

    # Serve the React Frontend for everything else
    handle {
        root * $PROJECT_DIR/client/dist
        try_files {path} {path}/ /index.html
        file_server
    }
}
EOF

echo "Restarting Caddy..."
systemctl restart caddy
systemctl enable caddy

echo "=========================================================="
echo "Deployment Complete!"
echo "Maximka is now running."
echo "Frontend: http://your_server_ip (or https://your_domain if configured)"
echo "Backend is run via systemctl (service name: maximka.service)."
echo "Project files are stored at $PROJECT_DIR"
echo "=========================================================="
