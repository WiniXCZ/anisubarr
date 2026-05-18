@echo off
echo Disconnecting existing Y: drive...
net use Y: /delete /yes
echo Mapping TOWER\data as Y: under anisubarr...
net use Y: \\TOWER\data anisubarr /user:anisubarr /persistent:yes
echo Result: %errorlevel%
net use
pause
