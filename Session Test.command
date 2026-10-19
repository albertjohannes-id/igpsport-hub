#!/bin/zsh
cd -- "${0:A:h}"
./.venv/bin/python backend/apex_local.py
echo
read '?Press Enter to close...'
