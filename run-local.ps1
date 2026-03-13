$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

Write-Host "Opening http://localhost:5173 ..."
Start-Process "http://localhost:5173"

Write-Host "Starting Vite dev server on port 5173 ..."
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
