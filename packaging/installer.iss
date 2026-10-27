; Animax — установщик для Windows 10/11 (64 бита)
; Сборка: python packaging\build_installer.py  (нужен Inno Setup 6)

#define MyAppName "Animax"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "OVER_LORD"
#define MyAppURL "https://github.com/0verLorD228"
#define MyAppExeName "Animax.exe"

[Setup]
; файл лежит в packaging/, а пути ниже считаются от корня исходников
SourceDir=..
; свой AppId: Animax — отдельная программа, установщик не должен перезаписать установленный AnyX
AppId={{87F84988-AB76-4E35-99A1-60D855159907}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\Animax
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=Animax-{#MyAppVersion}-win64-setup
SetupIconFile=animax.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=yes
RestartApplications=no
CloseApplicationsFilter=Animax.exe
VersionInfoVersion=1.0.0.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "Animax.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "packaging\README.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

; Данные пользователя (%APPDATA%\Animax) при удалении не трогаем.
