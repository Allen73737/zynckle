@echo off
setlocal
set DIRNAME=%~dp0
if "%DIRNAME%" == "" set DIRNAME=.\
set MAVEN_SKIP_RC=true
set MVN_CMD=%DIRNAME%.tools\apache-maven-3.9.6\bin\mvn.cmd
set REPO_DIR=%DIRNAME%m2-repo
if exist "%MVN_CMD%" (
    call "%MVN_CMD%" -f "%DIRNAME%pom.xml" -Dmaven.repo.local="%REPO_DIR%" %*
) else (
    mvn -f "%DIRNAME%pom.xml" -Dmaven.repo.local="%REPO_DIR%" %*
)
