#!/bin/zsh
cd "$(dirname "$0")" || exit 1
echo 'iGPSPORT Hub • Open http://127.0.0.1:5173 in your browser.'
echo 'Saved sessions are reused. Transfers require confirmation.'
npm start
