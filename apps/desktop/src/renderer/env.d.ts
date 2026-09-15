type DesktopEnvironment = {
  mode: "development" | "production";
  platform: string;
  electron: string;
};

interface Window {
  supervideo: {
    getEnvironment: () => Promise<DesktopEnvironment>;
  };
}
