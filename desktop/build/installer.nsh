; The Line Rush Windows installer: its look and its words, on top of electron-builder's assisted NSIS
; installer (app-builder-lib/templates/nsis). electron-builder includes this file before its own script,
; so the MUI settings here win over its defaults, and the custom* macros are its hooks into the pages.
; App updates run the installer with "--updated /S": silent, no pages, so nothing here may wait for a click.
; The pictures are drawn by installer-art/make.py.

!include WordFunc.nsh

; ---- look: the welcome and finish pages, and the band at the top of the other pages, are dark like the game
!define MUI_BGCOLOR 08080A
!define MUI_TEXTCOLOR F4F4F6
!define MUI_FINISHPAGE_LINK_COLOR 2BD4FF
; an unthemed check box on the finish page: Windows' themed one ignores the light text color
!define MUI_FORCECLASSICCONTROLS
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

; the player's name: their Windows account name with a capital first letter ("will" -> "Will"),
; or nothing when it isn't really a name
Var lrName
!ifndef BUILD_UNINSTALLER
  Var lrWelcomeTitle
  Var lrWelcomeText
  Var lrDoneTitle
  Var lrHangTight
  !define MUI_ABORTWARNING
  !define MUI_ABORTWARNING_TEXT "Stop setting up Line Rush? Nothing has been changed yet, and you can run setup again any time."
!else
  Var lrByeTitle
  Var lrSeeYouTitle
  !define MUI_UNABORTWARNING
  !define MUI_UNABORTWARNING_TEXT "Keep Line Rush? Nothing has been removed."
!endif

!macro lrReadName
  Push $R0
  Push $R1
  Push $R2
  StrCpy $lrName ""
  ReadEnvStr $R0 USERNAME
  StrLen $R1 $R0
  StrCpy $R2 $R0 1 -1
  ; stock and built-in accounts aren't anyone's name; machine accounts end in $
  ${If} $R1 > 0
  ${AndIf} $R1 <= 20
  ${AndIf} $R2 != "$$"
  ${AndIf} $R0 != "User"
  ${AndIf} $R0 != "Users"
  ${AndIf} $R0 != "Owner"
  ${AndIf} $R0 != "Admin"
  ${AndIf} $R0 != "Administrator"
  ${AndIf} $R0 != "Guest"
  ${AndIf} $R0 != "Default"
  ${AndIf} $R0 != "SYSTEM"
  ${AndIf} $R0 != "PC"
    StrCpy $R1 $R0 1
    StrCpy $R2 $R0 "" 1
    System::Call 'user32::CharUpperW(w r11 r11)'
    StrCpy $lrName "$R1$R2"
    ; an & would underline the next letter in the pages' labels: no name rather than a mangled one
    StrCpy $R1 0
    ${Do}
      StrCpy $R2 $lrName 1 $R1
      ${If} $R2 == "&"
        StrCpy $lrName ""
      ${EndIf}
      IntOp $R1 $R1 + 1
    ${LoopUntil} $R2 == ""
  ${EndIf}
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

; ---- installer ----
!macro customInit
  !insertmacro lrReadName
  ${If} $lrName != ""
    StrCpy $lrWelcomeTitle "Hey $lrName, welcome to Line Rush!"
    StrCpy $lrDoneTitle "You're all set, $lrName!"
    StrCpy $lrHangTight "Hang tight, $lrName. This only takes a moment."
  ${Else}
    StrCpy $lrWelcomeTitle "Welcome to Line Rush!"
    StrCpy $lrDoneTitle "You're all set!"
    StrCpy $lrHangTight "Hang tight. This only takes a moment."
  ${EndIf}
  StrCpy $lrWelcomeText "Thanks for grabbing Line Rush, the rhythm game you play with just two buttons.$\r$\n$\r$\nSetup puts it on this computer, with a shortcut on your desktop and in the Start menu. After that it keeps itself up to date, so you only do this once.$\r$\n$\r$\nClick Next to get started."

  ; Line Rush is already here: welcome them back and say what changes
  Push $R0
  Push $R1
  ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ${If} $R0 == ""
    ReadRegStr $R0 HKLM "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ${EndIf}
  ${If} $R0 != ""
    ${If} $lrName != ""
      StrCpy $lrWelcomeTitle "Welcome back, $lrName!"
    ${Else}
      StrCpy $lrWelcomeTitle "Welcome back!"
    ${EndIf}
    ${VersionCompare} "${VERSION}" "$R0" $R1
    ${If} $R1 == 1
      StrCpy $R1 "This updates Line Rush from $R0 to ${VERSION}."
    ${ElseIf} $R1 == 0
      StrCpy $R1 "This reinstalls Line Rush ${VERSION}."
    ${Else}
      StrCpy $R1 "You have Line Rush $R0. This replaces it with version ${VERSION}."
    ${EndIf}
    StrCpy $lrWelcomeText "Good to see you again. $R1$\r$\n$\r$\nYour scores, settings and songs stay just as they are.$\r$\n$\r$\nClick Next to continue."
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$lrWelcomeTitle"
  !define MUI_WELCOMEPAGE_TEXT "$lrWelcomeText"
  !insertmacro MUI_PAGE_WELCOME

  ; electron-builder's license page comes next...
  !define MUI_PAGE_HEADER_TEXT "The fine print"
  !define MUI_PAGE_HEADER_SUBTEXT "It's short and friendly. Promise."
  !define MUI_LICENSEPAGE_TEXT_TOP "Line Rush is free, and its code is open source. Here's what that means:"
  !define MUI_LICENSEPAGE_TEXT_BOTTOM "That's it! Click I Agree to keep going."
  ; ...and later the folder page
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Line Rush goes in the folder below. To put it somewhere else, click Browse and pick another folder. Ready? Click Install."
!macroend

; right before the progress page
!macro customPageAfterChangeDir
  !define MUI_PAGE_HEADER_TEXT "Installing Line Rush"
  !define MUI_PAGE_HEADER_SUBTEXT "$lrHangTight"
  !define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Done!"
  !define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Line Rush is installed."
  !define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "Setup stopped"
  !define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "Line Rush wasn't installed. Run setup again whenever you like."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW lrInstFilesShow

  ; the line above the progress bar while the game unpacks (electron-builder keeps it quiet till then)
  Function lrInstFilesShow
    Push $0
    FindWindow $0 "#32770" "" $HWNDPARENT
    GetDlgItem $0 $0 1006
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Unpacking the beats..."
    Pop $0
  FunctionEnd
!macroend

; at the end of the install: the Songs folder, with a note on what it's for
!macro customInstall
  ${IfNot} ${Silent}
    SetDetailsPrint textonly
  ${EndIf}
  DetailPrint "Making a Songs folder for your music..."
  ; it's in your own Documents (where the game looks), even when installing for everyone
  ${If} $installMode == "all"
    SetShellVarContext current
  ${EndIf}
  ; only once: an update or a reinstall leaves the folder (and what you did with it) alone
  ${IfNot} ${FileExists} "$DOCUMENTS\Line Rush\Songs\*.*"
    CreateDirectory "$DOCUMENTS\Line Rush\Songs"
    ClearErrors
    FileOpen $0 "$DOCUMENTS\Line Rush\Songs\Drop songs here.txt" w
    ${IfNot} ${Errors}
      FileWrite $0 "Your Line Rush Songs folder$\r$\n"
      FileWrite $0 "===========================$\r$\n$\r$\n"
      FileWrite $0 "Drop music in here and Line Rush adds it to the game the next time you open$\r$\n"
      FileWrite $0 "song select. Each song gets charts made from the music itself.$\r$\n$\r$\n"
      FileWrite $0 "- Works with mp3, wav, ogg, m4a, aac, flac, opus and webm files (up to 40 MB each).$\r$\n"
      FileWrite $0 "- A whole album folder works too: drop the folder in as it is.$\r$\n"
      FileWrite $0 "- Your songs and their scores stay on this computer. Nothing is uploaded.$\r$\n$\r$\n"
      FileWrite $0 "In the game, APP > OPEN SONGS FOLDER brings you right back here. Have fun!$\r$\n"
      FileClose $0
    ${EndIf}
  ${EndIf}
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
  DetailPrint "Ready to play!"
  ${IfNot} ${Silent}
    SetDetailsPrint none
  ${EndIf}
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    ; like electron-builder's own: opens the game as the player, not as an admin
    Function lrPlayNow
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${Else}
        StrCpy $1 ""
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "Play Line Rush now"
    !define MUI_FINISHPAGE_RUN_FUNCTION lrPlayNow
  !endif
  !define MUI_FINISHPAGE_TITLE "$lrDoneTitle"
  !define MUI_FINISHPAGE_TEXT "Line Rush is installed and ready to play. You'll find it on your desktop and in the Start menu.$\r$\n$\r$\nGot music of your own? Drop it in this folder to play it:$\r$\nDocuments\Line Rush\Songs"
  !define MUI_FINISHPAGE_TEXT_LARGE
  !define MUI_FINISHPAGE_LINK "What's new in Line Rush ${VERSION}"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/w7llywonka/rythym-web/releases/latest"
  !insertmacro MUI_PAGE_FINISH
!macroend

; ---- uninstaller ----
!macro customUnInit
  !insertmacro lrReadName
  ${If} $lrName != ""
    StrCpy $lrByeTitle "Taking a break, $lrName?"
    StrCpy $lrSeeYouTitle "See you soon, $lrName!"
  ${Else}
    StrCpy $lrByeTitle "Taking a break?"
    StrCpy $lrSeeYouTitle "See you soon!"
  ${EndIf}
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$lrByeTitle"
  !define MUI_WELCOMEPAGE_TEXT "This removes Line Rush from this computer.$\r$\n$\r$\nYour scores and settings stay on this computer and in your account, and so do your imported songs and your Songs folder. If you come back, everything's right where you left it.$\r$\n$\r$\nClick Uninstall to remove Line Rush."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.lrByeShow
  !insertmacro MUI_UNPAGE_WELCOME
  ; the progress page that follows
  !define MUI_PAGE_HEADER_TEXT "Uninstalling Line Rush"
  !define MUI_PAGE_HEADER_SUBTEXT "Your scores and settings stay right where they are."

  ; Next goes straight to removing (unless there are two installs to pick from first): say so on the button
  Function un.lrByeShow
    ${If} $hasPerUserInstallation != "1"
    ${OrIf} $hasPerMachineInstallation != "1"
      Push $0
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:$(^UninstallBtn)"
      Pop $0
    ${EndIf}
  FunctionEnd
!macroend

; at the start of the uninstall: one friendly line instead of every file being deleted
!macro customUnInstall
  ${IfNot} ${Silent}
    SetDetailsPrint textonly
    DetailPrint "Packing up Line Rush..."
    SetDetailsPrint none
  ${EndIf}
!macroend

; right before the uninstaller's finish page
!macro customUninstallPage
  !define MUI_FINISHPAGE_TITLE "$lrSeeYouTitle"
  !define MUI_FINISHPAGE_TEXT "Line Rush has been removed from this computer.$\r$\n$\r$\nYour progress is waiting for you whenever you want to play again."
!macroend
