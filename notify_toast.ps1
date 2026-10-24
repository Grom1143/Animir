param(
  [string]$title = "Animax",
  [string]$body = "",
  [string]$launch = ""
)
# Тост-уведомление Windows без сторонних модулей (WinRT из PowerShell).
# AppId — системный powershell.exe, у него уже есть разрешение на уведомления.
# launch — ссылка animax:open?h=... : клик по уведомлению откроет Animax на нужном экране.
try {
  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
  $e = { param($s) [System.Security.SecurityElement]::Escape($s) }
  $act = if ($launch) { " activationType=`"protocol`" launch=`"$(& $e $launch)`"" } else { "" }
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml("<toast$act><visual><binding template=`"ToastGeneric`"><text>$(& $e $title)</text><text>$(& $e $body)</text></binding></visual></toast>")
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  $app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)
  exit 0
} catch {
  [Console]::Error.WriteLine("toast error: $($_.Exception.Message)")
  exit 1
}
