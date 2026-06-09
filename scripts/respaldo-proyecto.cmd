@echo off
REM Wrapper para la Tarea Programada de Windows: respalda el proyecto a R2.
REM Corre cada 72h (ver "Petcrem - Respaldo proyecto a R2" en el Programador de tareas).
REM Se ubica solo en la raíz del repo (%~dp0 = carpeta scripts\, .. = raíz).
cd /d "%~dp0.."
call npx tsx scripts/respaldo-proyecto.ts >> "%TEMP%\petcrem-respaldo-proyecto.log" 2>&1
