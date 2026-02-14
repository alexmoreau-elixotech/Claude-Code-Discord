; ==========================================================================
; Claude Code Assistant - NSIS Installer Script
; ==========================================================================
; Builds a Windows installer for Claude Code Assistant.
; Uses Modern UI 2 (MUI2) for a professional appearance.
;
; Cross-compilable on Linux (Ubuntu) for GitHub Actions CI.
; ==========================================================================

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

; ---------------------------------------------------------------------------
; General configuration
; ---------------------------------------------------------------------------
!define PRODUCT_NAME        "Claude Code Assistant"
!define PRODUCT_PUBLISHER   "Alexandre Moreau Inc"
!define PRODUCT_WEB_SITE    "https://github.com/AlexMoreauInc/claude-code-assistant"
!define PRODUCT_VERSION     "1.0.0"
!define PRODUCT_UNINST_KEY  "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define PRODUCT_UNINST_ROOT "HKLM"

Name "${PRODUCT_NAME}"
OutFile "ClaudeCodeAssistant-Setup.exe"
InstallDir "C:\Claude Code Assistant"
InstallDirRegKey ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}" "InstallLocation"
ShowInstDetails show
ShowUnInstDetails show
RequestExecutionLevel admin
Unicode True

; ---------------------------------------------------------------------------
; Version information embedded in the .exe
; ---------------------------------------------------------------------------
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName"     "${PRODUCT_NAME}"
VIAddVersionKey "CompanyName"     "${PRODUCT_PUBLISHER}"
VIAddVersionKey "LegalCopyright"  "Copyright (c) 2026 Alex Moreau"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} Installer"
VIAddVersionKey "FileVersion"     "${PRODUCT_VERSION}"
VIAddVersionKey "ProductVersion"  "${PRODUCT_VERSION}"

; ---------------------------------------------------------------------------
; Modern UI configuration
; ---------------------------------------------------------------------------
!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

; Header text
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT

; Welcome page
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${PRODUCT_NAME} Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of ${PRODUCT_NAME}.$\r$\n$\r$\n${PRODUCT_NAME} is a Discord bot that gives you a team of Claude Code agents, each with its own Docker container and persistent workspace.$\r$\n$\r$\nClick Next to continue."

; Finish page
!define MUI_FINISHPAGE_RUN "$INSTDIR\start.bat"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${PRODUCT_NAME} now"
!define MUI_FINISHPAGE_LINK "Visit project on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${PRODUCT_WEB_SITE}"

; ---------------------------------------------------------------------------
; Installer pages
; ---------------------------------------------------------------------------
!insertmacro MUI_PAGE_WELCOME
Page custom DockerCheckPage DockerCheckPageLeave
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; ---------------------------------------------------------------------------
; Uninstaller pages
; ---------------------------------------------------------------------------
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ---------------------------------------------------------------------------
; Language
; ---------------------------------------------------------------------------
!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------------------
; Variables
; ---------------------------------------------------------------------------
Var DockerDialog
Var DockerLabel
Var DockerStatusLabel
Var DockerFound
Var DockerInstallCheckbox

; ---------------------------------------------------------------------------
; Custom page: Docker Desktop prerequisite check
; ---------------------------------------------------------------------------
Function DockerCheckPage
    nsDialogs::Create 1018
    Pop $DockerDialog
    ${If} $DockerDialog == error
        Abort
    ${EndIf}

    ; Title label
    ${NSD_CreateLabel} 0 0 100% 24u "Checking Prerequisites"
    Pop $DockerLabel
    CreateFont $0 "$(^Font)" "12" "700"
    SendMessage $DockerLabel ${WM_SETFONT} $0 0

    ; Check for Docker Desktop
    StrCpy $DockerFound "0"

    ; Method 1: Check file existence
    IfFileExists "$PROGRAMFILES64\Docker\Docker\Docker Desktop.exe" docker_found 0
    IfFileExists "$PROGRAMFILES\Docker\Docker\Docker Desktop.exe" docker_found 0

    ; Method 2: Check registry
    ReadRegStr $0 HKLM "SOFTWARE\Docker Inc.\Docker" "AppPath"
    ${If} $0 != ""
        Goto docker_found
    ${EndIf}

    ; Method 3: Check 64-bit registry view
    SetRegView 64
    ReadRegStr $0 HKLM "SOFTWARE\Docker Inc.\Docker" "AppPath"
    SetRegView 32
    ${If} $0 != ""
        Goto docker_found
    ${EndIf}

    ; Docker not found — offer to install
    StrCpy $DockerFound "0"
    ${NSD_CreateLabel} 0 32u 100% 40u \
        "Docker Desktop is required but was not found on this system.$\r$\n$\r$\n\
Docker Desktop will be downloaded (~500 MB) and installed. This may take several minutes."
    Pop $DockerStatusLabel

    ${NSD_CreateCheckbox} 0 80u 100% 16u "Install Docker Desktop automatically (recommended)"
    Pop $DockerInstallCheckbox
    ${NSD_Check} $DockerInstallCheckbox

    ${NSD_CreateLink} 0 104u 100% 16u "Or download manually: https://www.docker.com/products/docker-desktop/"
    Pop $0
    ${NSD_OnClick} $0 OnDockerLinkClick

    Goto docker_check_done

docker_found:
    StrCpy $DockerFound "1"
    ${NSD_CreateLabel} 0 32u 100% 32u \
        "Docker Desktop is installed. You are ready to proceed."
    Pop $DockerStatusLabel

docker_check_done:
    nsDialogs::Show
FunctionEnd

Function OnDockerLinkClick
    ExecShell "open" "https://www.docker.com/products/docker-desktop/"
FunctionEnd

Function DockerCheckPageLeave
    ${If} $DockerFound == "1"
        ; Docker already installed, continue
        Return
    ${EndIf}

    ; Check if user wants auto-install
    ${NSD_GetState} $DockerInstallCheckbox $0
    ${If} $0 != ${BST_CHECKED}
        ; User unchecked the box — warn and continue
        MessageBox MB_YESNO|MB_ICONEXCLAMATION \
            "Docker Desktop is not installed. ${PRODUCT_NAME} will not work without it.$\r$\n$\r$\nContinue installation anyway?" \
            IDYES continue_without_docker
        Abort ; Go back to the page
continue_without_docker:
        Return
    ${EndIf}

    ; Download and install Docker Desktop
    DetailPrint "Downloading Docker Desktop installer..."
    NSISdl::download "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" "$TEMP\DockerDesktopInstaller.exe"
    Pop $0
    ${If} $0 != "success"
        MessageBox MB_YESNO|MB_ICONEXCLAMATION \
            "Failed to download Docker Desktop ($0).$\r$\n$\r$\nYou can install Docker Desktop manually later.$\r$\nContinue with ${PRODUCT_NAME} installation?" \
            IDYES continue_without_docker_dl
        Abort
continue_without_docker_dl:
        Return
    ${EndIf}

    DetailPrint "Installing Docker Desktop (this may take a few minutes)..."
    ; Run Docker Desktop installer with install flag and auto-accept
    nsExec::ExecToLog '"$TEMP\DockerDesktopInstaller.exe" install --quiet --accept-license'
    Pop $0
    ${If} $0 == "0"
        DetailPrint "Docker Desktop installed successfully."
        Delete "$TEMP\DockerDesktopInstaller.exe"
        MessageBox MB_OK|MB_ICONINFORMATION \
            "Docker Desktop has been installed.$\r$\n$\r$\nYou may need to restart your computer and start Docker Desktop before using ${PRODUCT_NAME}."
    ${Else}
        DetailPrint "Docker Desktop installer returned code: $0"
        Delete "$TEMP\DockerDesktopInstaller.exe"
        MessageBox MB_OK|MB_ICONEXCLAMATION \
            "Docker Desktop installation may not have completed successfully (exit code: $0).$\r$\n$\r$\nPlease verify Docker Desktop is installed before using ${PRODUCT_NAME}."
    ${EndIf}
FunctionEnd

; ---------------------------------------------------------------------------
; Installer section: main files
; ---------------------------------------------------------------------------
Section "Install" SecInstall
    SetOutPath "$INSTDIR"

    ; --- Core configuration files ---
    File "..\docker-compose.yml"
    File "..\Dockerfile.app"
    File "..\Dockerfile.project"
    File "..\package.json"
    File "..\package-lock.json"
    File "..\tsconfig.json"
    File "..\LICENSE"
    File "..\.dockerignore"

    ; --- Launcher scripts ---
    File "..\start.bat"
    File "..\stop.bat"

    ; --- Source code (needed for Docker build) ---
    SetOutPath "$INSTDIR\src"
    File /r "..\src\*.*"

    ; --- Web assets ---
    SetOutPath "$INSTDIR\web"
    File /r "..\web\*.*"

    ; --- .env.example for reference ---
    SetOutPath "$INSTDIR"
    File "..\.env.example"

    ; --- Write the uninstaller ---
    WriteUninstaller "$INSTDIR\uninstall.exe"

    ; --- Registry entries for Add/Remove Programs ---
    WriteRegStr ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}" "DisplayName"     "${PRODUCT_NAME}"
    WriteRegStr ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
    WriteRegStr ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}" "Publisher"       "${PRODUCT_PUBLISHER}"
    WriteRegStr ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}" "DisplayVersion"  "${PRODUCT_VERSION}"
    WriteRegStr ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}" "URLInfoAbout"    "${PRODUCT_WEB_SITE}"
    WriteRegDWORD ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}" "NoModify" 1
    WriteRegDWORD ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}" "NoRepair" 1

    ; Calculate installed size
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}" "EstimatedSize" $0

    ; --- Shortcuts ---
    SetShellVarContext all

    ; Desktop shortcut
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\start.bat" "" "" "" SW_SHOWMINIMIZED

    ; Start Menu folder
    CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Start ${PRODUCT_NAME}.lnk" \
        "$INSTDIR\start.bat" "" "" "" SW_SHOWMINIMIZED
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Stop ${PRODUCT_NAME}.lnk" \
        "$INSTDIR\stop.bat" "" "" ""
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Dashboard.lnk" \
        "http://localhost:3456" "" "" ""
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk" \
        "$INSTDIR\uninstall.exe" "" "" ""
SectionEnd

; ---------------------------------------------------------------------------
; Uninstaller section
; ---------------------------------------------------------------------------
Section "Uninstall"
    SetShellVarContext all

    ; --- Ask about Docker volumes ---
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Do you also want to remove Docker volumes (project data)?$\r$\n$\r$\nThis will delete all project workspaces and configuration stored in Docker volumes." \
        IDNO skip_volumes

    ; Stop running containers first
    nsExec::ExecToLog 'docker compose -f "$INSTDIR\docker-compose.yml" down -v'
    Goto volumes_done

skip_volumes:
    ; Just stop containers, keep volumes
    nsExec::ExecToLog 'docker compose -f "$INSTDIR\docker-compose.yml" down'

volumes_done:

    ; --- Remove files ---
    RMDir /r "$INSTDIR\src"
    RMDir /r "$INSTDIR\web"
    Delete "$INSTDIR\docker-compose.yml"
    Delete "$INSTDIR\Dockerfile.app"
    Delete "$INSTDIR\Dockerfile.project"
    Delete "$INSTDIR\package.json"
    Delete "$INSTDIR\package-lock.json"
    Delete "$INSTDIR\tsconfig.json"
    Delete "$INSTDIR\LICENSE"
    Delete "$INSTDIR\.dockerignore"
    Delete "$INSTDIR\.env.example"
    Delete "$INSTDIR\.env"
    Delete "$INSTDIR\start.bat"
    Delete "$INSTDIR\stop.bat"
    Delete "$INSTDIR\uninstall.exe"
    RMDir "$INSTDIR"

    ; --- Remove shortcuts ---
    Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\Start ${PRODUCT_NAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\Stop ${PRODUCT_NAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\Dashboard.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk"
    RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

    ; --- Remove registry entries ---
    DeleteRegKey ${PRODUCT_UNINST_ROOT} "${PRODUCT_UNINST_KEY}"
SectionEnd
