@echo off
setlocal
title Eleve - local server
set "URL=http://localhost:4000"
echo ============================================
echo   ELEVE - starting local server
echo ============================================
echo Folder: %~dp0
echo.
if not exist "%~dp0server\server.js" (
  echo [X] Could not find server\server.js next to this file.
  echo     Make sure this .cmd is in the 'website interior' folder.
  goto END
)

rem --- is the site already running on port 4000? (checks IPv4 AND IPv6) ---
set "PIDON="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"TCP.*:4000 .*LISTENING"') do set "PIDON=%%p"
if defined PIDON (
  echo [!] The Eleve server is ALREADY running on %URL% ^(PID %PIDON%^).
  echo.
  choice /c RO /t 8 /d R /m "RESTART it with the latest code [R], or just Open the browser [O]"
  if errorlevel 2 (
    start "" %URL%
    echo      Leave the other Eleve window open. You can close THIS one.
    goto END
  )
  echo [..] Stopping the old server ^(PID %PIDON%^)...
  taskkill /pid %PIDON% /f >nul 2>nul
  timeout /t 1 >nul
  echo [ok] Old server stopped - starting fresh with the latest code.
  echo.
)

cd /d "%~dp0server"
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js is not installed ^(or not on PATH^).
  echo     1^) Install the LTS from https://nodejs.org
  echo     2^) Close ALL windows, then run this again.
  goto END
)
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo [ok] Node %NODEV% found.
if not exist node_modules (
  echo [..] First run: installing dependencies ^(this can take a minute^)...
  call npm install
  if errorlevel 1 ( echo [X] npm install failed - check your internet connection. & goto END )
)
echo [ok] Dependencies ready.
echo.
echo [..] Launching server and opening Chrome at %URL%
echo      KEEP THIS WINDOW OPEN. Close it to stop the site.
echo.
rem open browser shortly after the server boots
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if defined CHROME (
  start "" cmd /c "timeout /t 2 >nul & start "" "%CHROME%" --new-window %URL%"
) else (
  start "" cmd /c "timeout /t 2 >nul & start "" %URL%"
)
node server.js
echo.
echo ============================================
echo   The Eleve server has stopped.
echo   ^(You closed it, or it hit an error above.^)
echo   To start again: just run this file once more.
echo ============================================
:END
echo.
pause
