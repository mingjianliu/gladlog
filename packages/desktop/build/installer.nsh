; gladlog NSIS hooks, pulled in by electron-builder through `build.nsis.include`
; (spec 2026-11-23 §6.6).
;
; customInstall runs inside the install section right after the app files are
; extracted (app-builder-lib 26 templates/nsis/installSection.nsh,
; `!ifmacrodef customInstall`). It records the language the user picked in the
; installer's language dialog so the app can adopt it on first launch:
; main/language.ts `readInstallerLanguage` reads INSTALLER_LANGUAGE_FILE from
; the exe directory, which is $INSTDIR. LCID 2052 (zh-CN) -> "zh", anything
; else -> "en".
;
; Silent installs never write it: electron-updater runs the installer with /S
; for auto-updates, and $LANGUAGE there is a default nobody chose -- writing it
; would quietly decide the language for an upgrading user (§6.6).
;
; No customUnInstall is needed: the uninstaller removes $INSTDIR wholesale
; (templates/nsis/uninstaller.nsh, `RMDir /r $INSTDIR`), this file included.

!macro customInstall
  ${IfNot} ${Silent}
    Push $0
    Push $1
    ${If} $LANGUAGE == 2052
      StrCpy $0 "zh"
    ${Else}
      StrCpy $0 "en"
    ${EndIf}
    ClearErrors
    FileOpen $1 "$INSTDIR\installer-language.txt" w
    ${IfNot} ${Errors}
      FileWrite $1 $0
      FileClose $1
    ${EndIf}
    Pop $1
    Pop $0
  ${EndIf}
!macroend
