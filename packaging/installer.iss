; Windows installer for the standalone desktop build.
;
;   ISCC.exe packaging\installer.iss        (after build-desktop.bat)
;   → packaging\out\室內設計繪圖-安裝程式.exe
;
; Why an installer and not a zip. The package is a *folder* — the executable
; plus `_internal\`. Windows shows a zip as if it were a folder, so a person who
; has never extracted one double-clicks the .exe where they see it; Windows
; unpacks that single file to a temp directory without `_internal\`, and the app
; dies on a missing Python DLL. Nothing about that is recoverable by someone who
; does not know what extracting is. An installer has no extract step to skip.
;
; Two choices that exist purely to remove a scary moment:
;
;   PrivilegesRequired=lowest — installs under the user's own AppData, so there
;   is no UAC prompt. Program Files would need one, and a yellow "do you want to
;   allow this app to make changes" shield on an unsigned installer is exactly
;   the point at which somebody stops.
;
;   Every wizard page that asks a question is disabled. There is nothing to
;   decide here: no components, no install location worth choosing. What is left
;   is a progress bar and a finish button.
;
; Inno ships no Traditional Chinese language file (the bundled set is European
; plus Japanese), so the visible strings are overridden in [Messages] below
; rather than depending on a third-party .isl that would have to be fetched at
; build time.
;
; This does NOT get past SmartScreen. Nothing does except a code-signing
; certificate — see docs/handoff-windows.md.

#define AppName "室內設計繪圖"
#define AppVer "1.0.0"
#define SrcDir "..\dist\InteriorDesigner"

[Setup]
AppId={{8F3C1A62-7D94-4E5B-9C11-2A6E0B4D7F38}
AppName={#AppName}
AppVersion={#AppVer}
AppVerName={#AppName}
DefaultDirName={localappdata}\Programs\InteriorDesigner
DefaultGroupName={#AppName}
UninstallDisplayName={#AppName}
OutputDir=out
OutputBaseFilename=室內設計繪圖-安裝程式
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; No elevation, so no UAC prompt.
PrivilegesRequired=lowest

; Nothing on these pages is a real choice for this audience.
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=no

[Languages]
Name: "zh"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\InteriorDesigner.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\InteriorDesigner.exe"
Name: "{autoprograms}\{#AppName} 使用說明"; Filename: "{app}\使用說明.txt"

[Run]
Filename: "{app}\InteriorDesigner.exe"; Description: "現在就打開室內設計繪圖"; Flags: nowait postinstall skipifsilent

[Messages]
SetupAppTitle=安裝
SetupWindowTitle=安裝 —— %1
ExitSetupTitle=結束安裝
ExitSetupMessage=安裝還沒有完成。現在結束的話，程式不會被安裝。%n%n確定要結束嗎？
ButtonNext=下一步(&N)
ButtonBack=上一步(&B)
ButtonInstall=開始安裝(&I)
ButtonCancel=取消
ButtonFinish=完成(&F)
ButtonYes=是(&Y)
ButtonNo=否(&N)
WizardPreparing=正在準備
PreparingDesc=正在準備安裝 [name]，請稍候。
WizardInstalling=安裝中
InstallingLabel=正在把 [name] 安裝到你的電腦，請稍候。
StatusExtractFiles=正在複製檔案…
FinishedHeadingLabel=[name] 安裝好了
FinishedLabel=[name] 已經裝到你的電腦裡了。%n%n桌面上會出現一個叫「室內設計繪圖」的圖示，以後從那裡打開就可以。%n%n第一次打開時，Windows 可能會跳出藍色的「Windows 已保護您的電腦」——那不是病毒警告，點「其他資訊」再點「仍要執行」就好。詳細說明在「開始」選單裡的「使用說明」。
ClickFinish=按「完成」結束安裝。
FinishedLabelNoIcons=[name] 安裝好了。
SetupAborted=安裝沒有完成。%n%n請重新執行一次安裝程式。
ErrorTitle=發生錯誤
