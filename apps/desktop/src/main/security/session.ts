import type { Session } from "electron";
import { denyPermissionRequest, sanitizeUrlForDiagnostics } from "./policies";
import type { SecurityLog } from "./ipc";

export function registerSessionSecurity(
  session: Session,
  options: Readonly<{ contentSecurityPolicy: string; log: SecurityLog }>,
): () => void {
  const onHeadersReceived = (
    details: Electron.OnHeadersReceivedListenerDetails,
    callback: (response: Electron.HeadersReceivedResponse) => void,
  ): void => {
    const responseHeaders = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {}).filter(([name]) => name.toLowerCase() !== "content-security-policy"),
    );
    responseHeaders["Content-Security-Policy"] = [options.contentSecurityPolicy];
    callback({ responseHeaders });
  };

  const onWillDownload = (
    event: Electron.Event,
    item: Electron.DownloadItem,
  ): void => {
    event.preventDefault();
    options.log("download-rejected", { url: sanitizeUrlForDiagnostics(item.getURL()) });
  };

  session.webRequest.onHeadersReceived(onHeadersReceived);
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    options.log("permission-rejected", {
      kind: "check",
      permission,
      origin: sanitizeUrlForDiagnostics(requestingOrigin),
    });
    return denyPermissionRequest();
  });
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    options.log("permission-rejected", {
      kind: "request",
      permission,
      origin: sanitizeUrlForDiagnostics(details?.requestingUrl ?? ""),
    });
    callback(denyPermissionRequest());
  });
  session.on("will-download", onWillDownload);

  return () => {
    session.webRequest.onHeadersReceived(null);
    session.setPermissionCheckHandler(null);
    session.setPermissionRequestHandler(null);
    session.removeListener("will-download", onWillDownload);
  };
}
