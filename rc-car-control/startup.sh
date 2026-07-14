#!/bin/bash
# Startup script for Azure App Service
# This ensures npm dependencies are installed and the app starts properly

set -e

echo "Installing dependencies..."
npm install --production

echo "Starting Next.js application..."
npm start
