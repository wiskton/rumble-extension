@echo off

set Name=rumble-speed-video-chrome-exntesion
set Project=%userprofile%\Projects\%Name%
set Temp=%userprofile%\Projects\temp
set Seven=C:\Program Files\7-Zip\7z.exe

cd %%

xcopy /s %Project% %Temp%

del %Temp%\*.bat
del %Temp%\LICENSE
del %Temp%\chrome.bat
del %Temp%\firefox.bat
del %Temp%\*.zip
del %Temp%\manifest-firefox.json

for %%a in ("%Temp%") do set "NTemp=%%~nxa"

Set "Data=%Date%-%Time:~0,5%"
set "Data=%Data:/=-%"
set "Data=%Data::=-%"
set "Data=%Data: =0%
echo %Data%

pushd "%Temp%"

"%Seven%" a -y -tzip "%Temp%\%NTemp% chrome-%Data%.zip" * -x!.git -x!*.bat

rmdir %Temp%\css
rmdir %Temp%\js 
rmdir %Temp%\icons 