; Анимир — установщик для Windows 10/11 (64 бита)
; Сборка: python packaging\build_installer.py  (нужен Inno Setup 6)

#define MyAppName "Анимир"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "OVER_LORD"
#define MyAppURL "https://github.com/0verLorD228"
#define MyAppExeName "Animir.exe"

[Setup]
; файл лежит в packaging/, а пути ниже считаются от корня исходников
SourceDir=..
; свой AppId: Анимир — отдельная программа, установщик не должен перезаписать установленные Animax или AnyX
AppId={{D49337E7-8EA9-40BB-82F3-B06683F41595}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\Animir
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=Animir-{#MyAppVersion}-win64-setup
SetupIconFile=animir.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=yes
RestartApplications=no
CloseApplicationsFilter=Animir.exe
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
Source: "Animir.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "packaging\README.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

; Данные пользователя (%APPDATA%\Animir) при удалении не трогаем.
