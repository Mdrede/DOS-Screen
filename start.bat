@echo off
title DOS Screen Server
color 0A

echo.
echo  ==========================================
echo    DOS Screen - Restaurant Display System
echo  ==========================================
echo.

:: Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Python is not installed!
    echo.
    echo  Download from: https://python.org
    echo  Make sure to check "Add Python to PATH"
    echo.
    pause
    exit /b 1
)

echo  Installing / updating dependencies...
echo.
pip install -r requirements.txt --quiet --upgrade
echo.
echo  ==========================================
echo.
echo  Server is starting...
echo  Open Admin Panel: http://localhost:5000/admin
echo  TV Screens open:  http://YOUR-IP:5000
echo.
echo  Press Ctrl+C to stop the server
echo  ==========================================
echo.

python server.py

pause
