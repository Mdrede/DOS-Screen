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
    echo  Download from: https://python.org
    pause
    exit /b 1
)

:: Only install if flask is missing (skips pip on normal starts)
python -c "import flask, flask_socketio" >nul 2>&1
if %errorlevel% neq 0 (
    echo  First run - Installing dependencies...
    pip install -r requirements.txt --no-index --find-links=packages/ --quiet
    echo  Done.
) else (
    echo  Dependencies OK.
)

echo.
echo  Server starting...
echo  Admin Panel : http://localhost:5000/admin
echo  ==========================================
echo.

python server.py

pause
