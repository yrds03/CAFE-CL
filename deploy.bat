@echo off
title CAFE CL - Auto Bump SW & Deploy ke GitHub Pages
cd /d "%~dp0"
set /p MSG="Catatan update (kosongkan untuk default): "
if "%MSG%"=="" set MSG=Perbaikan dan pembaruan otomatis CAFE CL
node scripts/deploy.mjs %MSG%
pause
