@echo off
echo === SMB write test ===
echo.
echo Current net use:
net use
echo.
echo Testing write to Y:\ root...
echo test > "Y:\.write_test.txt" && echo OK && del "Y:\.write_test.txt" || echo FAIL - no write access to Y:\
echo.
echo Testing write to Y:\incomplete_anime...
if exist "Y:\incomplete_anime" (
    echo test > "Y:\incomplete_anime\.write_test.txt" && echo OK && del "Y:\incomplete_anime\.write_test.txt" || echo FAIL - no write access to Y:\incomplete_anime
) else (
    echo Y:\incomplete_anime does not exist!
    dir Y:\
)
echo.
pause
