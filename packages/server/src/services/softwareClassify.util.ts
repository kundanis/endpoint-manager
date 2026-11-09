// Software that doesn't need a licence record: drivers, runtimes, OS components, OEM utilities
// and well-known free apps. Used only for the endpoint Software tab's licence column, so an
// Intel driver or a Visual C++ runtime isn't shown as "no licence recorded" next to paid software.
// It's a best guess from the publisher and display name; anything it doesn't recognise falls
// through to "no licence recorded", never to "licensed".

// Hardware vendors whose installed entries are drivers, firmware tools and OEM utilities.
const OEM_PUBLISHER =
  /\b(intel|dell|hewlett[- ]?packard|hp inc|hp development|lenovo|realtek|nvidia|advanced micro devices|amd|qualcomm|broadcom|synaptics|elan microelectronics|conexant|waves audio|dolby|asus|asustek|acer|micro-star|msi|gigabyte|samsung electronics|toshiba|dynabook|fujitsu|panasonic|cirrus logic|marvell|mediatek|killer networking|rivet networks|alps|cypress|validity sensors|goodix)\b/i;

// Names that are components rather than products, whoever publishes them.
const COMPONENT_NAME =
  /\b(driver|drivers|chipset|firmware|bios|runtime|redistributable|redist|webview2|\.net (framework|runtime|desktop runtime)|asp\.net core|visual c\+\+|directx|vcredist|sdk|language pack|update health tools|hotfix)\b|\(KB\d+\)|^\s*(security |definition |critical |cumulative )?update for\b/i;

// Microsoft products that ship with Windows or are free. Paid Microsoft software (Office,
// Microsoft 365 apps, Visio, Project, SQL Server, Visual Studio editions) is deliberately absent.
const MICROSOFT_FREE_NAME =
  /^\s*(microsoft )?(edge|edge update|edge webview2|teams|onedrive|windows\b|pc health check|gameinput|silverlight|visual studio code|power ?bi desktop|update health tools|policy platform|intune management extension|azure ad connect health|windows app runtime|xna)\b|^\s*microsoft (windows|\.net|asp\.net|visual c\+\+|odbc driver|ole db driver|sql server (\d{4} )?(native client|management objects|t-sql language service|odbc|ole db|express localdb|compact|clr types|setup support files|browser|vss writer))/i;

// Widely used free applications. Left out on purpose because business use needs a paid licence:
// Oracle Java, WinRAR, AnyDesk, TeamViewer, Zoom (paid plans), Foxit editor.
const FREE_APP_NAME =
  /^\s*(google chrome|mozilla firefox|mozilla maintenance service|7-zip|notepad\+\+|vlc media player|adobe acrobat reader|adobe reader|adobe refresh manager|adobe genuine service|eclipse temurin|python \d|git\b|node\.js|putty|winscp|foxit pdf reader|whatsapp|telegram|brave|vivaldi|libreoffice|greenshot|paint\.net|keepass|wireshark|npcap|filezilla)\b/i;

export function isSystemOrFreeSoftware(name: string, publisher: string | null): boolean {
  if (COMPONENT_NAME.test(name)) return true;
  if (publisher && OEM_PUBLISHER.test(publisher)) return true;
  if (/^\s*(intel|dell|hp|lenovo|realtek|nvidia|amd|qualcomm|synaptics)\b/i.test(name)) return true;
  if (publisher && /microsoft/i.test(publisher) && MICROSOFT_FREE_NAME.test(name)) return true;
  if (!publisher && MICROSOFT_FREE_NAME.test(name)) return true;
  return FREE_APP_NAME.test(name);
}
