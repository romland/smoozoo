#!/bin/bash

# Load environment variables from .env file
if [ -f .env ]; then
  source .env
else
  echo "🚨 Error: .env file not found. Please create it."
  exit 1
fi

# --- Deployment ---
# The script will now use the variables loaded from .env

echo "✨ Removing existing files on ${REMOTE_HOST}'s ${REMOTE_PATH}..."

ssh ${REMOTE_USER}@${REMOTE_HOST} rm -f ${REMOTE_PATH}/*

echo "🚀 Starting deployment to ${REMOTE_HOST}..."

scp -r dist/* ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}

echo "✅ Deployment finished successfully."
