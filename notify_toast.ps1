param(
  [string]$title = "Animir",
  [string]$body = "",
  [string]$launch = "",
  [string]$appid = "Animir",
  [string]$name = "Animir",
  [string]$icon = "",
  [string]$logo = "",
  [string]$hero = ""
)
# Тост-уведомление Windows от имени самого Анимира (WinRT из PowerShell, без сторонних модулей).
# Раньше AppId был системный powershell.exe - поэтому уведомления и шли «от Windows PowerShell» с чужим значком.
# Теперь AppId свой: запись HKCU\Software\Classes\AppUserModelId\<appid> даёт уведомлению название и значок,
# а картинка в самом тосте (appLogoOverride) показывает логотип, даже если Windows не подхватила значок записи.
# launch - ссылка animir:open?h=… : клик по уведомлению откроет Анимир на нужном экране.
try {
  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
  $e = { param($s) [System.Security.SecurityElement]::Escape($s) }
  if ($icon -and (Test-Path -LiteralPath $icon)) {
    $uri = ([Uri](Resolve-Path -LiteralPath $icon).Path).AbsoluteUri
    try {
      $reg = "HKCU:\Software\Classes\AppUserModelId\$appid"
      New-Item -Path $reg -Force | Out-Null
      Set-ItemProperty -Path $reg -Name DisplayName -Value $name
      Set-ItemProperty -Path $reg -Name IconUri -Value $uri
    } catch { }
  }
  # в тосте картинкой может быть только png/jpg: .ico Windows не покажет
  $img = ""
  if ($logo -and (Test-Path -LiteralPath $logo)) {
    $luri = ([Uri](Resolve-Path -LiteralPath $logo).Path).AbsoluteUri
    $img = "<image placement=`"appLogoOverride`" hint-crop=`"circle`" src=`"$(& $e $luri)`"/>"
  }
  $act = if ($launch) { " activationType=`"protocol`" launch=`"$(& $e $launch)`"" } else { "" }
  # постер тайтла: большая картинка в уведомлении (hero). hint-crop=none - не обрезать постер
  $big = ""
  if ($hero -and (Test-Path -LiteralPath $hero)) {
    $huri = ([Uri](Resolve-Path -LiteralPath $hero).Path).AbsoluteUri
    $big = "<image placement=`"hero`" hint-crop=`"none`" src=`"$(& $e $huri)`"/>"
  }
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml("<toast$act><visual><binding template=`"ToastGeneric`">$img<text>$(& $e $title)</text><text>$(& $e $body)</text>$big</binding></visual></toast>")
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appid).Show($toast)
  exit 0
} catch {
  [Console]::Error.WriteLine("toast error: $($_.Exception.Message)")
  exit 1
}
