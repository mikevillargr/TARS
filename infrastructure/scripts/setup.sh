#!/usr/bin/env bash
set -euo pipefail

# TARS server bootstrap — run once on fresh Hostinger KVM4
# Usage: curl -sL https://raw.githubusercontent.com/mikevillargr/TARS/main/infrastructure/scripts/setup.sh | bash

echo "==> Updating system packages"
apt-get update && apt-get upgrade -y

echo "==> Installing Docker"
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

echo "==> Installing Docker Compose v2"
apt-get install -y docker-compose-plugin

echo "==> Installing additional tools"
apt-get install -y git curl wget nginx certbot python3-certbot-nginx

echo "==> Creating tars user"
useradd -m -s /bin/bash tars 2>/dev/null || echo "user tars already exists"
usermod -aG docker tars
mkdir -p /home/tars/repos

echo "==> Installing Node.js 20"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> Cloning TARS repo"
git clone https://github.com/mikevillargr/TARS.git /opt/tars || \
  (cd /opt/tars && git fetch && git checkout main)

echo "==> Copying .env template"
if [ ! -f /opt/tars/.env ]; then
  cp /opt/tars/.env.example /opt/tars/.env
  echo ""
  echo "  !! Edit /opt/tars/.env before starting services !!"
  echo ""
fi

echo "==> Setting up SSH key for GitHub Actions deploys"
mkdir -p /root/.ssh
if [ ! -f /root/.ssh/id_ed25519_deploy ]; then
  ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519_deploy -N "" -C "tars-deploy"
  echo ""
  echo "  Add this deploy key to GitHub Actions secrets (SSH_PRIVATE_KEY):"
  cat /root/.ssh/id_ed25519_deploy
  echo ""
fi

echo ""
echo "==> Bootstrap complete."
echo ""
echo "Next steps:"
echo "  1. Edit /opt/tars/.env with your secrets"
echo "  2. Generate password hash:"
echo "     docker run --rm python:3.11-slim python -c \\"
echo "       \"import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt()).decode())\""
echo "  3. Start services:"
echo "     cd /opt/tars && docker compose -f infrastructure/docker/docker-compose.prod.yml up -d"
echo "  4. Run migrations:"
echo "     docker compose -f infrastructure/docker/docker-compose.prod.yml exec harness alembic upgrade head"
