@echo off
cd /d "%~dp0"
echo Starting Atlas Nav...
where node >nul 2>nul || (echo Node.js is not installed or not in PATH.& pause & exit /b 1)
if not exist "node_modules\express" (
  echo Installing dependencies...
  call npm ci
  if errorlevel 1 (echo Dependency installation failed.& pause & exit /b 1)
)
start "Atlas Nav" cmd /c "timeout /t 2 /nobreak ^>nul ^& start http://localhost:3000"
call npm start
pause
