@echo off
setlocal
cd /d "%~dp0"
title Publish Atlas Nav to GitHub

where git >nul 2>nul || (echo [ERROR] Git was not found. Install Git for Windows, then try again.& pause & exit /b 1)
where gh >nul 2>nul || (echo [ERROR] GitHub CLI was not found. Install it from https://cli.github.com/ then try again.& pause & exit /b 1)

echo Checking GitHub login...
gh auth status >nul 2>nul
if errorlevel 1 (
  echo.
  echo Sign in to GitHub in the browser window that opens next.
  gh auth login --web --git-protocol https
  if errorlevel 1 (echo [ERROR] GitHub login failed.& pause & exit /b 1)
)

if not exist .git (
  echo Initializing local Git repository...
  git init
  git branch -M main
)

git add .
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "feat: initial Atlas Nav release"
  if errorlevel 1 (echo [ERROR] Git commit failed. Check your Git username and email configuration.& pause & exit /b 1)
) else (
  echo No uncommitted changes to add.
)

echo.
echo Creating public GitHub repository: atlas-nav
rem If this name is already taken in your GitHub account, edit the command below.
gh repo create atlas-nav --public --source=. --remote=origin --push
if errorlevel 1 (
  echo.
  echo [ERROR] Repository creation or push failed.
  echo The repository name may already exist, or the GitHub connection may have failed.
  pause
  exit /b 1
)

echo.
echo Atlas Nav has been published. Opening the repository...
gh repo view --web
pause
